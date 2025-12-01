// Pattern 2: UNION一括処理（データベースファースト版）
// フロー: CSV読み込み → DB保存 → DB読み込み → UNION/計算 → DB保存 → DB読み込み → CSV出力
// 高リソース計測: UNIONとPIVOTを大きな配列として保持し、RSSも計測して差を顕在化
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
  // 生データを統合前に全行スキャン（論理I/O）
  timer.incrementReadOps(rawData13.length + rawData23.length);
  timer.recordMemoryUsage(rawData13.length + rawData23.length, 2048);
  timer.recordProcessMemory();
  timer.endStep("dbReadRawMs");

  // ========== Step 4: 計算フェーズ (UNION → 一括計算 → PIVOT) ==========
  timer.startStep();
  const unionAll = [...rawData13, ...rawData23];
  retainBuffers.push(unionAll);
  timer.recordIntermediateRows(unionAll.length);
  timer.recordMemoryUsage(unionAll.length, 4096);
  // UNION結果を書いたとみなす論理I/O
  timer.incrementWriteOps(unionAll.length);
  // UNIONを読み出して計算
  timer.incrementReadOps(unionAll.length);
  timer.recordProcessMemory();

  const computed = unionAll.map((data) => ({
    jisCode: data.jisCode,
    electionNo: data.electionNo,
    prefCode: data.municipality.prefCode,
    prefName: data.municipality.prefName,
    cityName: data.municipality.cityName,
    turnout: computeTurnout(data.ballots, data.electorate),
    partyShares: Object.fromEntries(
      Object.entries(data.parties).map(([party, votes]) => [
        party,
        computeRelativeShare(votes as number, data.validVotes),
      ])
    ),
  }));
  retainBuffers.push(computed);
  timer.recordIntermediateRows(computed.length);
  timer.recordMemoryUsage(computed.length, 3072);
  // 一括計算結果の論理書き込み
  timer.incrementWriteOps(computed.length);
  // PIVOTのために再スキャン
  timer.incrementReadOps(computed.length);
  timer.recordProcessMemory();

  const pivoted = pivotData(computed);
  retainBuffers.push(pivoted);
  timer.recordIntermediateRows(pivoted.length);
  timer.recordMemoryUsage(pivoted.length, 4096);
  // PIVOT結果を書いたとみなす論理I/O
  timer.incrementWriteOps(pivoted.length);
  timer.incrementReadOps(pivoted.length); // CSV/DB投入前のスキャン
  timer.recordProcessMemory();
  timer.endStep("computeMs");

  // ========== Step 5: 結果をDBに保存 ==========
  timer.startStep();
  const resultCount = await saveResultsToDB(pivoted, timer);
  timer.recordStorage({ resultDataRows: resultCount });
  timer.recordProcessMemory();
  timer.endStep("dbWriteResultMs");

  // ========== Step 6: 結果をDBから読み込み ==========
  timer.startStep();
  const finalResults = await loadResultsFromDB(timer);
  retainBuffers.push(finalResults);
  timer.incrementReadOps(finalResults.length);
  timer.recordProcessMemory();
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
  timer.recordProcessMemory();
  timer.endStep("csvWriteMs");

  const timings = timer.getTimings();
  const storage = timer.getStorageMetrics();

  console.log("[Pattern 2] ストレージメトリクス:", storage);

  await saveMergeRun(
    2,
    timings,
    storage,
    finalResults.length,
    outputPath,
    `Pattern 2: UNION一括処理 - UNION ALL ${unionAll.length}行を処理`
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
    const data13 = group.find((d) => d.electionNo === 13);
    const data23 = group.find((d) => d.electionNo === 23);

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

async function saveResultsToDB(results: PivotedData[], timer: DetailedTimer): Promise<number> {
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
-- パターン2: UNION一括処理 (Union-then-Transform)
-- 全データを統合してから一括処理し、最後にPIVOTで横展開

-- ステップ: UNION ALLで縦持ち統合
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

-- ステップ: 一括計算（投票率・相対得票率）
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

-- ステップ: PIVOTで横展開
SELECT
  MAX(CASE WHEN election_no = 13 THEN pref_code END) AS pref_code,
  MAX(CASE WHEN election_no = 13 THEN pref_name END) AS pref_name,
  jis_code,
  MAX(CASE WHEN election_no = 13 THEN city_name END) AS city_name,
  MAX(CASE WHEN election_no = 13 THEN turnout END) AS turnout_13,
  MAX(CASE WHEN election_no = 23 THEN turnout END) AS turnout_23,
  ${parties13
      .map(
        (p) =>
          `MAX(CASE WHEN election_no = 13 AND party = '${p}' THEN relative_share ELSE 0 END) AS ${makePartyColumn(
            p,
            13
          )}`
      )
      .join(",\n  ")},
  ${parties23
      .map(
        (p) =>
          `MAX(CASE WHEN election_no = 23 AND party = '${p}' THEN relative_share ELSE 0 END) AS ${makePartyColumn(
            p,
            23
          )}`
      )
      .join(",\n  ")}
FROM Computed
GROUP BY jis_code;

-- 特徴:
-- - コード記述量が最小
-- - 計算ロジックが一貫
-- - 中間テーブルサイズが大きくメモリ使用量が多い
-- - グループ化とPIVOTのコストがやや高い
`.trim();
}
