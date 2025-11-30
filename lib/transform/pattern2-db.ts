// Pattern 2: UNION一括処理型（データベースファースト版）
// フロー: CSV読み込み → DB保存 → DB読み込み → 計算 → DB保存 → DB読み込み → CSV出力

import { loadElectionCsv, ElectionRow } from "../csv/loader";
import { computeTurnout, computeRelativeShare, makePartyColumn } from "./common";
import { prisma } from "@/lib/prisma";
import { DetailedTimer, saveMergeRun, TimingSteps } from "@/lib/metrics/detailedTracker";
import * as fs from "fs";
import * as path from "path";

export interface Pattern2Result {
  timings: TimingSteps;
  rowCount: number;
  outputPath: string;
  sqlExplanation: string;
}

export async function runPattern2DB(
  csv13Path: string,
  csv23Path: string
): Promise<Pattern2Result> {
  const timer = new DetailedTimer();

  // ========== Step 1: CSV読み込み ==========
  timer.startStep();
  const data13 = loadElectionCsv(csv13Path, 13);
  const data23 = loadElectionCsv(csv23Path, 23);
  timer.endStep("csvLoadMs");

  // ========== Step 2: 生データをDBに保存 (Pattern 1と同じ処理) ==========
  timer.startStep();
  await saveRawDataToDB(data13.rows, 13);
  await saveRawDataToDB(data23.rows, 23);
  timer.endStep("dbWriteRawMs");

  // ========== Step 3: 生データをDBから読み込み ==========
  timer.startStep();
  const rawData13 = await loadRawDataFromDB(13);
  const rawData23 = await loadRawDataFromDB(23);
  timer.endStep("dbReadRawMs");

  // ========== Step 4: 計算処理（UNION→計算→PIVOT） ==========
  timer.startStep();
  // UNION ALL: 2つのデータセットを結合
  const unionAll = [...rawData13, ...rawData23];

  // 一括計算
  const computed = unionAll.map(data => ({
    jisCode: data.jisCode,
    electionNo: data.electionNo,
    prefCode: data.municipality.prefCode,
    prefName: data.municipality.prefName,
    cityName: data.municipality.cityName,
    turnout: computeTurnout(data.ballots, data.electorate),
    partyShares: Object.fromEntries(
      Object.entries(data.parties).map(([party, votes]) => [
        party,
        computeRelativeShare(votes as number, data.validVotes)
      ])
    )
  }));

  // PIVOT: JISコードでグループ化して横持ちに変換
  const pivoted = pivotData(computed);
  timer.endStep("computeMs");

  // ========== Step 5: 結果をDBに保存 ==========
  timer.startStep();
  await saveResultsToDB(pivoted);
  timer.endStep("dbWriteResultMs");

  // ========== Step 6: 結果をDBから読み込み ==========
  timer.startStep();
  const finalResults = await loadResultsFromDB();
  timer.endStep("dbReadResultMs");

  // ========== Step 7: CSV出力 ==========
  timer.startStep();
  const outputPath = path.join(process.cwd(), "output", "pattern2_result.csv");
  const csvContent = convertToCSV(finalResults, data13.partyNames, data23.partyNames);

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, csvContent, "utf-8");
  timer.endStep("csvWriteMs");

  // タイミング情報を保存
  const timings = timer.getTimings();
  await saveMergeRun(
    2,
    timings,
    finalResults.length,
    outputPath,
    `Pattern 2: UNION一括処理型`
  );

  const sqlExplanation = generateSQLExplanation(data13.partyNames, data23.partyNames);

  return {
    timings,
    rowCount: finalResults.length,
    outputPath,
    sqlExplanation,
  };
}

// 以下、パターン1と同じヘルパー関数（再利用）

async function saveRawDataToDB(rows: ElectionRow[], electionNo: number) {
  await prisma.rawElectionData.deleteMany({ where: { electionNo } });

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

async function loadRawDataFromDB(electionNo: number) {
  const rawData = await prisma.rawElectionData.findMany({
    where: { electionNo },
    include: { municipality: true },
  });

  const grouped = new Map<string, any>();

  for (const record of rawData) {
    const jisCode = record.municipality.jisCode;

    if (!grouped.has(jisCode)) {
      grouped.set(jisCode, {
        jisCode,
        electionNo,
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

  return Array.from(grouped.values());
}

interface ComputedData {
  jisCode: string;
  electionNo: number;
  prefCode: string;
  prefName: string;
  cityName: string;
  turnout: number;
  partyShares: Record<string, number>;
}

interface PivotedData {
  jisCode: string;
  prefCode: string;
  prefName: string;
  cityName: string;
  turnout13: number;
  turnout23: number;
  partyShares13: Record<string, number>;
  partyShares23: Record<string, number>;
}

function pivotData(computed: ComputedData[]): PivotedData[] {
  const grouped = new Map<string, ComputedData[]>();

  for (const data of computed) {
    if (!grouped.has(data.jisCode)) {
      grouped.set(data.jisCode, []);
    }
    grouped.get(data.jisCode)!.push(data);
  }

  const results: PivotedData[] = [];

  for (const [jisCode, group] of grouped.entries()) {
    const data13 = group.find(d => d.electionNo === 13);
    const data23 = group.find(d => d.electionNo === 23);

    if (data13 && data23) {
      results.push({
        jisCode,
        prefCode: data13.prefCode,
        prefName: data13.prefName,
        cityName: data13.cityName,
        turnout13: data13.turnout,
        turnout23: data23.turnout,
        partyShares13: data13.partyShares,
        partyShares23: data23.partyShares,
      });
    }
  }

  return results;
}

async function saveResultsToDB(results: PivotedData[]) {
  await prisma.electionResult.deleteMany({});

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
    }
  }
}

async function loadResultsFromDB() {
  const results = await prisma.electionResult.findMany({
    include: { municipality: true },
    orderBy: [
      { municipality: { jisCode: "asc" } },
      { electionNo: "asc" },
      { party: "asc" },
    ],
  });

  const grouped = new Map<string, PivotedData>();

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
  results: PivotedData[],
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
    ...Array.from(allParties).flatMap(party => [
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
      ...Array.from(allParties).flatMap(party => [
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
-- パターン2: UNION一括処理型 (Union-then-Transform)
-- 全データを統合してから一括処理し、最後にPIVOTで横展開

-- ステップ1: UNION ALL（縦持ち統合）
WITH UnionAll AS (
  SELECT
    13 AS election_no,
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

  UNION ALL

  SELECT
    23 AS election_no,
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
  WHERE r.election_no = 23
),

-- ステップ2: 一括計算（投票率と相対得票率）
Computed AS (
  SELECT
    election_no,
    jis_code,
    pref_code,
    pref_name,
    city_name,
    party,
    CAST(ballots AS FLOAT) / electorate AS turnout,
    CAST(votes AS FLOAT) / valid_votes AS relative_share
  FROM UnionAll
)

-- ステップ3: PIVOT（横展開）
SELECT
  MAX(CASE WHEN election_no = 13 THEN pref_code END) AS pref_code,
  MAX(CASE WHEN election_no = 13 THEN pref_name END) AS pref_name,
  jis_code,
  MAX(CASE WHEN election_no = 13 THEN city_name END) AS city_name,
  MAX(CASE WHEN election_no = 13 THEN turnout END) AS turnout_13,
  MAX(CASE WHEN election_no = 23 THEN turnout END) AS turnout_23,
  ${parties13.map(p => `MAX(CASE WHEN election_no = 13 AND party = '${p}' THEN relative_share ELSE 0 END) AS ${makePartyColumn(p, 13)}`).join(",\n  ")},
  ${parties23.map(p => `MAX(CASE WHEN election_no = 23 AND party = '${p}' THEN relative_share ELSE 0 END) AS ${makePartyColumn(p, 23)}`).join(",\n  ")}
FROM Computed
GROUP BY jis_code;

-- 特徴:
-- - コード記述量が最小
-- - 計算ロジックが一元化
-- - 中間テーブルサイズが大きくメモリ使用量が多い
-- - グループ化とPIVOTのコストがやや高い
`.trim();
}
