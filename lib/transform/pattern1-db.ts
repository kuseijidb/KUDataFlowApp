// Pattern 1: ETL分離型（データベースファースト版）
// フロー:
// 1. CSV読み込み → 2. 生データDB保存 → 3. 生データDB読み込み
// 4. 計算処理 → 5. 結果DB保存 → 6. 結果DB読み込み → 7. CSV出力

import { loadElectionCsv, ElectionRow } from "../csv/loader";
import {
  computeTurnout,
  computeRelativeShare,
  makePartyColumn,
} from "./common";
import { prisma } from "@/lib/prisma";
import { DetailedTimer, saveMergeRun, TimingSteps } from "@/lib/metrics/detailedTracker";
import * as fs from "fs";
import * as path from "path";

export interface Pattern1Result {
  timings: TimingSteps;
  rowCount: number;
  outputPath: string;
  sqlExplanation: string;
}

/**
 * パターン1: ETL分離型（データベースファースト実装）
 */
export async function runPattern1DB(
  csv13Path: string,
  csv23Path: string
): Promise<Pattern1Result> {
  const timer = new DetailedTimer();

  // ========== Step 1: CSV読み込み ==========
  timer.startStep();
  const data13 = loadElectionCsv(csv13Path, 13);
  const data23 = loadElectionCsv(csv23Path, 23);
  timer.endStep("csvLoadMs");

  // ========== Step 2: 生データをDBに保存 ==========
  timer.startStep();
  await saveRawDataToDB(data13.rows, 13);
  await saveRawDataToDB(data23.rows, 23);
  timer.endStep("dbWriteRawMs");

  // ========== Step 3: 生データをDBから読み込み ==========
  timer.startStep();
  const rawData13 = await loadRawDataFromDB(13);
  const rawData23 = await loadRawDataFromDB(23);
  timer.endStep("dbReadRawMs");

  // ========== Step 4: 計算処理 ==========
  timer.startStep();
  const processed13 = processElectionData(rawData13, 13);
  const processed23 = processElectionData(rawData23, 23);

  // JOIN処理
  const joinedResults = joinResults(processed13, processed23);
  timer.endStep("computeMs");

  // ========== Step 5: 結果をDBに保存 ==========
  timer.startStep();
  await saveResultsToDB(joinedResults);
  timer.endStep("dbWriteResultMs");

  // ========== Step 6: 結果をDBから読み込み ==========
  timer.startStep();
  const finalResults = await loadResultsFromDB();
  timer.endStep("dbReadResultMs");

  // ========== Step 7: CSV出力 ==========
  timer.startStep();
  const outputPath = path.join(process.cwd(), "output", "pattern1_result.csv");
  const csvContent = convertToCSV(finalResults, data13.partyNames, data23.partyNames);

  // output ディレクトリが存在しない場合は作成
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, csvContent, "utf-8");
  timer.endStep("csvWriteMs");

  // タイミング情報を取得してDBに保存
  const timings = timer.getTimings();
  await saveMergeRun(
    1,
    timings,
    finalResults.length,
    outputPath,
    `Parties: ${[...data13.partyNames, ...data23.partyNames].join(", ")}`
  );

  const sqlExplanation = generateSQLExplanation(data13.partyNames, data23.partyNames);

  return {
    timings,
    rowCount: finalResults.length,
    outputPath,
    sqlExplanation,
  };
}

/**
 * 生データをDBに保存
 */
async function saveRawDataToDB(rows: ElectionRow[], electionNo: number) {
  // 既存データを削除
  await prisma.rawElectionData.deleteMany({
    where: { electionNo },
  });

  for (const row of rows) {
    // Municipality を upsert
    const municipality = await prisma.municipality.upsert({
      where: { jisCode: row.jisCode },
      update: {
        prefCode: row.prefCode,
        prefName: row.prefName,
        cityName: row.cityName,
      },
      create: {
        jisCode: row.jisCode,
        prefCode: row.prefCode,
        prefName: row.prefName,
        cityName: row.cityName,
      },
    });

    // 各政党のデータを保存
    for (const [party, votes] of Object.entries(row.parties)) {
      await prisma.rawElectionData.create({
        data: {
          municipalityId: municipality.id,
          electionNo,
          party,
          votes,
          electorate: row.electorate,
          ballots: row.ballots,
          validVotes: row.validVotes,
        },
      });
    }
  }
}

/**
 * 生データをDBから読み込み
 */
async function loadRawDataFromDB(electionNo: number) {
  const rawData = await prisma.rawElectionData.findMany({
    where: { electionNo },
    include: {
      municipality: true,
    },
  });

  // JISコードごとにグループ化
  const grouped = new Map<string, {
    municipality: any;
    electorate: number;
    ballots: number;
    validVotes: number;
    parties: Record<string, number>;
  }>();

  for (const record of rawData) {
    const jisCode = record.municipality.jisCode;

    if (!grouped.has(jisCode)) {
      grouped.set(jisCode, {
        municipality: record.municipality,
        electorate: record.electorate,
        ballots: record.ballots,
        validVotes: record.validVotes,
        parties: {},
      });
    }

    const entry = grouped.get(jisCode)!;
    entry.parties[record.party] = record.votes;
  }

  return Array.from(grouped.entries()).map(([jisCode, data]) => ({
    jisCode,
    ...data,
  }));
}

/**
 * 選挙データを計算処理
 */
interface ProcessedData {
  jisCode: string;
  prefCode: string;
  prefName: string;
  cityName: string;
  turnout: number;
  partyShares: Record<string, number>;
}

function processElectionData(rawData: any[], electionNo: number): ProcessedData[] {
  return rawData.map((data) => {
    const turnout = computeTurnout(data.ballots, data.electorate);

    const partyShares: Record<string, number> = {};
    for (const [party, votes] of Object.entries(data.parties)) {
      partyShares[party] = computeRelativeShare(votes as number, data.validVotes);
    }

    return {
      jisCode: data.jisCode,
      prefCode: data.municipality.prefCode,
      prefName: data.municipality.prefName,
      cityName: data.municipality.cityName,
      turnout,
      partyShares,
    };
  });
}

/**
 * 13回と23回のデータをJOIN
 */
interface JoinedResult {
  jisCode: string;
  prefCode: string;
  prefName: string;
  cityName: string;
  turnout13: number;
  turnout23: number;
  partyShares13: Record<string, number>;
  partyShares23: Record<string, number>;
}

function joinResults(data13: ProcessedData[], data23: ProcessedData[]): JoinedResult[] {
  const map13 = new Map(data13.map(d => [d.jisCode, d]));
  const map23 = new Map(data23.map(d => [d.jisCode, d]));

  const results: JoinedResult[] = [];

  for (const [jisCode, d13] of map13.entries()) {
    const d23 = map23.get(jisCode);
    if (d23) {
      results.push({
        jisCode,
        prefCode: d13.prefCode,
        prefName: d13.prefName,
        cityName: d13.cityName,
        turnout13: d13.turnout,
        turnout23: d23.turnout,
        partyShares13: d13.partyShares,
        partyShares23: d23.partyShares,
      });
    }
  }

  return results;
}

/**
 * 結果をDBに保存
 */
async function saveResultsToDB(results: JoinedResult[]) {
  // 既存の結果を削除
  await prisma.electionResult.deleteMany({});

  for (const result of results) {
    const municipality = await prisma.municipality.findUnique({
      where: { jisCode: result.jisCode },
    });

    if (!municipality) continue;

    // 13回のデータを保存
    for (const [party, relativeShare] of Object.entries(result.partyShares13)) {
      await prisma.electionResult.create({
        data: {
          municipalityId: municipality.id,
          electionNo: 13,
          electorate: 0, // 集約済みなので個別値は保持しない
          ballots: 0,
          validVotes: 0,
          turnout: result.turnout13,
          party,
          votes: 0,
          relativeShare,
        },
      });
    }

    // 23回のデータを保存
    for (const [party, relativeShare] of Object.entries(result.partyShares23)) {
      await prisma.electionResult.create({
        data: {
          municipalityId: municipality.id,
          electionNo: 23,
          electorate: 0,
          ballots: 0,
          validVotes: 0,
          turnout: result.turnout23,
          party,
          votes: 0,
          relativeShare,
        },
      });
    }
  }
}

/**
 * 結果をDBから読み込み
 */
async function loadResultsFromDB() {
  const results = await prisma.electionResult.findMany({
    include: {
      municipality: true,
    },
    orderBy: [
      { municipality: { jisCode: "asc" } },
      { electionNo: "asc" },
      { party: "asc" },
    ],
  });

  // JISコードごとにグループ化
  const grouped = new Map<string, JoinedResult>();

  for (const record of results) {
    const jisCode = record.municipality.jisCode;

    if (!grouped.has(jisCode)) {
      grouped.set(jisCode, {
        jisCode,
        prefCode: record.municipality.prefCode,
        prefName: record.municipality.prefName,
        cityName: record.municipality.cityName,
        turnout13: 0,
        turnout23: 0,
        partyShares13: {},
        partyShares23: {},
      });
    }

    const entry = grouped.get(jisCode)!;

    if (record.electionNo === 13) {
      entry.turnout13 = record.turnout;
      entry.partyShares13[record.party] = record.relativeShare;
    } else if (record.electionNo === 23) {
      entry.turnout23 = record.turnout;
      entry.partyShares23[record.party] = record.relativeShare;
    }
  }

  return Array.from(grouped.values());
}

/**
 * CSV形式に変換
 */
function convertToCSV(
  results: JoinedResult[],
  parties13: string[],
  parties23: string[]
): string {
  const allParties = new Set([...parties13, ...parties23]);

  // ヘッダー行
  const header = [
    "pref_code",
    "pref_name",
    "jis_code",
    "city_name",
    "turnout_13",
    "turnout_23",
    ...Array.from(allParties).flatMap(party => [
      makePartyColumn(party, 13),
      makePartyColumn(party, 23),
    ]),
  ];

  const lines = [header.join(",")];

  // データ行
  for (const result of results) {
    const row = [
      result.prefCode,
      result.prefName,
      result.jisCode,
      result.cityName,
      result.turnout13.toFixed(4),
      result.turnout23.toFixed(4),
      ...Array.from(allParties).flatMap(party => [
        (result.partyShares13[party] || 0).toFixed(4),
        (result.partyShares23[party] || 0).toFixed(4),
      ]),
    ];
    lines.push(row.join(","));
  }

  return lines.join("\n");
}

/**
 * SQL説明文を生成
 */
function generateSQLExplanation(parties13: string[], parties23: string[]): string {
  return `
-- パターン1: ETL分離型 (Extract-Transform-Load per Election)
-- 各選挙回を独立したパイプラインで処理し、最後にJOINする

-- ステップ1: 13回生データをDBから読み込み
WITH raw_13 AS (
  SELECT
    m.jis_code,
    m.pref_code,
    m.pref_name,
    m.city_name,
    r.party,
    r.votes,
    r.electorate,
    r.ballots,
    r.valid_votes
  FROM raw_election_data r
  JOIN municipalities m ON r.municipality_id = m.id
  WHERE r.election_no = 13
),

-- ステップ2: 13回データを計算・集約
T_13 AS (
  SELECT
    jis_code,
    pref_code,
    pref_name,
    city_name,
    CAST(ballots AS FLOAT) / electorate AS turnout_13,
    ${parties13.map(p => `MAX(CASE WHEN party = '${p}' THEN CAST(votes AS FLOAT) / valid_votes ELSE 0 END) AS ${makePartyColumn(p, 13)}`).join(",\n    ")}
  FROM raw_13
  GROUP BY jis_code, pref_code, pref_name, city_name, ballots, electorate
),

-- ステップ3: 23回生データをDBから読み込み
raw_23 AS (
  SELECT
    m.jis_code,
    r.party,
    r.votes,
    r.electorate,
    r.ballots,
    r.valid_votes
  FROM raw_election_data r
  JOIN municipalities m ON r.municipality_id = m.id
  WHERE r.election_no = 23
),

-- ステップ4: 23回データを計算・集約
T_23 AS (
  SELECT
    jis_code,
    CAST(ballots AS FLOAT) / electorate AS turnout_23,
    ${parties23.map(p => `MAX(CASE WHEN party = '${p}' THEN CAST(votes AS FLOAT) / valid_votes ELSE 0 END) AS ${makePartyColumn(p, 23)}`).join(",\n    ")}
  FROM raw_23
  GROUP BY jis_code, ballots, electorate
)

-- ステップ5: 最終統合 (INNER JOIN)
SELECT
  T_13.pref_code,
  T_13.pref_name,
  T_13.jis_code,
  T_13.city_name,
  T_13.turnout_13,
  T_23.turnout_23,
  T_13.*,  -- 13回の全政党列
  T_23.*   -- 23回の全政党列
FROM T_13
INNER JOIN T_23 ON T_13.jis_code = T_23.jis_code;

-- 特徴:
-- - 各選挙回のロジックが独立している（疎結合）
-- - 並列処理が可能
-- - デバッグ・検証がしやすい
-- - データベースに中間結果を保存することで再利用可能
`.trim();
}
