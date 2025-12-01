// Pattern 1: ETL型（データベースファースト版）
// フロー:
// 1. CSV読み込み → 2. 生データDB保存 → 3. 生データDB読み込み
// 4. 計算/JOIN → 5. 結果DB保存 → 6. 結果DB読み込み → 7. CSV出力
// 高リソース計測: 大きな配列を保持しつつRSSも測定し、差分が出やすいよう設計
import { loadElectionCsv, ElectionRow } from "../csv/loader";
import { computeTurnout, computeRelativeShare, makePartyColumn } from "./common";
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

export async function runPattern1DB(
  csv13Path: string,
  csv23Path: string
): Promise<Pattern1Result> {
  const timer = new DetailedTimer();
  const retainBuffers: any[] = [];

  // ========== Step 1: CSV読み込み ==========
  timer.startStep();
  const data13 = loadElectionCsv(csv13Path, 13);
  const data23 = loadElectionCsv(csv23Path, 23);
  retainBuffers.push(data13.rows, data23.rows);
  timer.recordProcessMemory();
  timer.endStep("csvLoadMs");

  // ========== Step 2: 生データをDBに保存 ==========
  timer.startStep();
  const rawCount13 = await saveRawDataToDB(data13.rows, 13, timer);
  const rawCount23 = await saveRawDataToDB(data23.rows, 23, timer);
  timer.recordStorage({ rawDataRows: rawCount13 + rawCount23 });
  timer.recordProcessMemory();
  timer.endStep("dbWriteRawMs");

  // ========== Step 3: 生データをDBから読み込み ==========
  timer.startStep();
  const rawData13 = await loadRawDataFromDB(13, timer);
  const rawData23 = await loadRawDataFromDB(23, timer);
  retainBuffers.push(rawData13, rawData23);
  // 生データを計算用に全行スキャン（論理I/O）
  timer.incrementReadOps(rawData13.length + rawData23.length);
  timer.recordMemoryUsage(rawData13.length + rawData23.length, 2048);
  timer.recordProcessMemory();
  timer.endStep("dbReadRawMs");

  // メモリ差分を明確化するための重複保持（計測のみ）
  const heavyClone = [...rawData13, ...rawData23].map((d) => ({
    ...d,
    parties: { ...d.parties },
  }));
  retainBuffers.push(heavyClone);
  timer.recordMemoryUsage(heavyClone.length, 4096);
  timer.recordProcessMemory();

  // ========== Step 4: 計算/変換 ==========
  timer.startStep();
  const processed13 = processElectionData(rawData13);
  const processed23 = processElectionData(rawData23);
  retainBuffers.push(processed13, processed23);
  timer.recordIntermediateRows(processed13.length + processed23.length);
  timer.recordMemoryUsage(processed13.length + processed23.length, 1536);
  // 変換結果を書き出したとみなす論理I/O（中間テーブル相当）
  timer.incrementWriteOps(processed13.length + processed23.length);
  // JOIN用に再スキャン
  timer.incrementReadOps(processed13.length + processed23.length);
  timer.recordProcessMemory();

  const joinedResults = joinResults(processed13, processed23);
  retainBuffers.push(joinedResults);
  timer.recordMemoryUsage(joinedResults.length, 2048);
  // JOIN結果の論理書き込み
  timer.incrementWriteOps(joinedResults.length);
  // CSV/DB投入前の最終スキャン
  timer.incrementReadOps(joinedResults.length);
  timer.recordProcessMemory();
  timer.endStep("computeMs");

  // ========== Step 5: 結果をDBに保存 ==========
  timer.startStep();
  const resultCount = await saveResultsToDB(joinedResults, timer);
  timer.recordStorage({ resultDataRows: resultCount });
  timer.recordProcessMemory();
  timer.endStep("dbWriteResultMs");

  // ========== Step 6: 結果をDBから読み込み ==========
  timer.startStep();
  const finalResults = await loadResultsFromDB(timer);
  retainBuffers.push(finalResults);
  // 出力用の最終読み込み
  timer.incrementReadOps(finalResults.length);
  timer.recordProcessMemory();
  timer.endStep("dbReadResultMs");

  // ========== Step 7: CSV出力 ==========
  timer.startStep();
  const outputPath = path.join(process.cwd(), "output", "pattern1_result.csv");
  const csvContent = convertToCSV(finalResults, data13.partyNames, data23.partyNames);

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, csvContent, "utf-8");
  timer.recordProcessMemory();
  timer.endStep("csvWriteMs");

  const timings = timer.getTimings();
  const storage = timer.getStorageMetrics();

  console.log("[Pattern 1] ストレージメトリクス:", storage);

  await saveMergeRun(
    1,
    timings,
    storage,
    finalResults.length,
    outputPath,
    `Pattern 1: ETL型 - 並列処理が可能な設計`
  );

  const sqlExplanation = generateSQLExplanation(data13.partyNames, data23.partyNames);

  return {
    timings,
    rowCount: finalResults.length,
    outputPath,
    sqlExplanation,
  };
}

async function saveRawDataToDB(
  rows: ElectionRow[],
  electionNo: number,
  timer: DetailedTimer
): Promise<number> {
  await prisma.rawElectionData.deleteMany({ where: { electionNo } });

  let rowCount = 0;

  for (const row of rows) {
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
    timer.incrementWriteOps(1);

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
      timer.incrementWriteOps(1);
      rowCount++;
    }
  }

  return rowCount;
}

async function loadRawDataFromDB(electionNo: number, timer: DetailedTimer) {
  const rawData = await prisma.rawElectionData.findMany({
    where: { electionNo },
    include: { municipality: true },
  });
  timer.incrementReadOps(1);

  const grouped = new Map<
    string,
    {
      municipality: any;
      electorate: number;
      ballots: number;
      validVotes: number;
      parties: Record<string, number>;
    }
  >();

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

interface ProcessedData {
  jisCode: string;
  prefCode: string;
  prefName: string;
  cityName: string;
  turnout: number;
  partyShares: Record<string, number>;
}

function processElectionData(rawData: any[]): ProcessedData[] {
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
  const map13 = new Map(data13.map((d) => [d.jisCode, d]));
  const map23 = new Map(data23.map((d) => [d.jisCode, d]));

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

async function saveResultsToDB(results: JoinedResult[], timer: DetailedTimer): Promise<number> {
  await prisma.electionResult.deleteMany({});

  let rowCount = 0;

  for (const result of results) {
    const municipality = await prisma.municipality.findUnique({
      where: { jisCode: result.jisCode },
    });

    if (!municipality) continue;

    for (const [party, relativeShare] of Object.entries(result.partyShares13)) {
      await prisma.electionResult.create({
        data: {
          municipalityId: municipality.id,
          electionNo: 13,
          electorate: 0,
          ballots: 0,
          validVotes: 0,
          turnout: result.turnout13,
          party,
          votes: 0,
          relativeShare,
        },
      });
      timer.incrementWriteOps(1);
      rowCount++;
    }

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
      timer.incrementWriteOps(1);
      rowCount++;
    }
  }

  return rowCount;
}

async function loadResultsFromDB(timer: DetailedTimer) {
  const results = await prisma.electionResult.findMany({
    include: { municipality: true },
    orderBy: [
      { municipality: { jisCode: "asc" } },
      { electionNo: "asc" },
      { party: "asc" },
    ],
  });
  timer.incrementReadOps(1);

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

function convertToCSV(
  results: JoinedResult[],
  parties13: string[],
  parties23: string[]
): string {
  const allParties = new Set([...parties13, ...parties23]);

  const header = [
    "pref_code",
    "pref_name",
    "jis_code",
    "city_name",
    "turnout_13",
    "turnout_23",
    ...Array.from(allParties).flatMap((party) => [
      makePartyColumn(party, 13),
      makePartyColumn(party, 23),
    ]),
  ];

  const lines = [header.join(",")];

  for (const result of results) {
    const row = [
      result.prefCode,
      result.prefName,
      result.jisCode,
      result.cityName,
      result.turnout13.toFixed(4),
      result.turnout23.toFixed(4),
      ...Array.from(allParties).flatMap((party) => [
        (result.partyShares13[party] || 0).toFixed(4),
        (result.partyShares23[party] || 0).toFixed(4),
      ]),
    ];
    lines.push(row.join(","));
  }

  return lines.join("\n");
}

function generateSQLExplanation(parties13: string[], parties23: string[]): string {
  return `
-- パターン1: ETL型 (Extract-Transform-Load per Election)
-- 各選挙回を独立したパイプラインで処理し、最後にJOINする

-- ステップ: 13回生データをDBから読み込み
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

-- ステップ: 13回データを計算・変換
T_13 AS (
  SELECT
    jis_code,
    pref_code,
    pref_name,
    city_name,
    CAST(ballots AS FLOAT) / electorate AS turnout_13,
    ${parties13
      .map(
        (p) =>
          `MAX(CASE WHEN party = '${p}' THEN CAST(votes AS FLOAT) / valid_votes ELSE 0 END) AS ${makePartyColumn(
            p,
            13
          )}`
      )
      .join(",\n    ")}
  FROM raw_13
  GROUP BY jis_code, pref_code, pref_name, city_name, ballots, electorate
),

-- ステップ: 23回生データをDBから読み込み
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

-- ステップ: 23回データを計算・変換
T_23 AS (
  SELECT
    jis_code,
    CAST(ballots AS FLOAT) / electorate AS turnout_23,
    ${parties23
      .map(
        (p) =>
          `MAX(CASE WHEN party = '${p}' THEN CAST(votes AS FLOAT) / valid_votes ELSE 0 END) AS ${makePartyColumn(
            p,
            23
          )}`
      )
      .join(",\n    ")}
  FROM raw_23
  GROUP BY jis_code, ballots, electorate
)

-- ステップ: 最終統合 (INNER JOIN)
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
-- - 選挙回のロジックが独立しており疎結合
-- - 並列処理が可能
-- - テスト・検証がしやすい
-- - データベースに中間結果を保存することで再利用可能
`.trim();
}
