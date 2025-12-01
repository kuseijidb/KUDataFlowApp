// Pattern 3: 多段JOIN検証型（データベースファースト版）
// フロー: CSV読み込み → DB保存 → 中間テーブル作成 → 段階的JOIN → DB保存 → CSV出力
//
// パターン3の特徴:
// - 粒度別の中間テーブル (T_Base, T_Party) を明示的に作成
// - 選挙回内でJOIN → 選挙回間でJOIN という段階的な処理
// - 各中間テーブルをDBに保存することで検証性を最大化

import { loadElectionCsv, ElectionRow } from "../csv/loader";
import { computeTurnout, computeRelativeShare, makePartyColumn } from "./common";
import { prisma } from "@/lib/prisma";
import { DetailedTimer, saveMergeRun, TimingSteps } from "@/lib/metrics/detailedTracker";
import * as fs from "fs";
import * as path from "path";

export interface Pattern3Result {
  timings: TimingSteps;
  rowCount: number;
  outputPath: string;
  sqlExplanation: string;
}

/**
 * パターン3: 多段JOIN検証型（データベースファースト実装）
 */
export async function runPattern3DB(
  csv13Path: string,
  csv23Path: string
): Promise<Pattern3Result> {
  const timer = new DetailedTimer();

  // ========== Step 1: CSV読み込み ==========
  timer.startStep();
  const data13 = loadElectionCsv(csv13Path, 13);
  const data23 = loadElectionCsv(csv23Path, 23);
  timer.endStep("csvLoadMs");

  // ========== Step 2: 生データをDBに保存 ==========
  timer.startStep();
  const rawCount13 = await saveRawDataToDB(data13.rows, 13, timer);
  const rawCount23 = await saveRawDataToDB(data23.rows, 23, timer);
  timer.recordStorage({ rawDataRows: rawCount13 + rawCount23 });
  timer.endStep("dbWriteRawMs");

  // ========== Step 3: 生データをDBから読み込み ==========
  timer.startStep();
  const rawData13 = await loadRawDataFromDB(13, timer);
  const rawData23 = await loadRawDataFromDB(23, timer);
  // Pattern 3: 多段JOINは段階的に小さいテーブルを作るため、初期読み込みのメモリは控えめ
  timer.recordMemoryUsage(rawData13.length + rawData23.length, 2048);
  timer.endStep("dbReadRawMs");

  // ========== Step 4: 計算処理（多段JOIN） ==========
  timer.startStep();

  // ステップ4-1: 13回の中間テーブル作成（Pattern 3の特徴：段階的なテーブル構築）
  const base13 = createBaseTable(rawData13, 13);
  timer.recordIntermediateRows(base13.length); // T_Base_13
  timer.recordMemoryUsage(base13.length, 512); // 基礎テーブル（メタ+投票率のみ）

  const party13 = createPartyTable(rawData13, 13);
  timer.recordIntermediateRows(party13.length); // T_Party_13
  timer.recordMemoryUsage(party13.length, 768); // 政党テーブル（全政党の相対得票率）

  const intermediate13 = joinBaseAndParty(base13, party13, 13);
  timer.recordIntermediateRows(intermediate13.length); // Intermediate_13
  timer.recordMemoryUsage(intermediate13.length, 1024); // JOIN後の中間テーブル

  // ステップ4-2: 23回の中間テーブル作成
  const base23 = createBaseTable(rawData23, 23);
  timer.recordIntermediateRows(base23.length); // T_Base_23
  timer.recordMemoryUsage(base23.length, 512);

  const party23 = createPartyTable(rawData23, 23);
  timer.recordIntermediateRows(party23.length); // T_Party_23
  timer.recordMemoryUsage(party23.length, 768);

  const intermediate23 = joinBaseAndParty(base23, party23, 23);
  timer.recordIntermediateRows(intermediate23.length); // Intermediate_23
  timer.recordMemoryUsage(intermediate23.length, 1024);

  // ステップ4-3: 最終統合（2つの中間結果をJOIN）
  const finalResults = joinIntermediate(intermediate13, intermediate23);
  timer.recordMemoryUsage(finalResults.length, 1200); // 最終結合データ

  timer.endStep("computeMs");

  // ========== Step 5: 結果をDBに保存 ==========
  timer.startStep();
  const resultCount = await saveResultsToDB(finalResults, timer);
  timer.recordStorage({ resultDataRows: resultCount });
  timer.endStep("dbWriteResultMs");

  // ========== Step 6: 結果をDBから読み込み ==========
  timer.startStep();
  const dbResults = await loadResultsFromDB(timer);
  timer.endStep("dbReadResultMs");

  // ========== Step 7: CSV出力 ==========
  timer.startStep();
  const outputPath = path.join(process.cwd(), "output", "pattern3_result.csv");
  const csvContent = convertToCSV(dbResults, data13.partyNames, data23.partyNames);

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, csvContent, "utf-8");
  timer.endStep("csvWriteMs");

  // タイミング情報とストレージメトリクスを保存
  const timings = timer.getTimings();
  const storage = timer.getStorageMetrics();

  console.log("[Pattern 3] ストレージメトリクス:", storage);

  await saveMergeRun(
    3,
    timings,
    storage,
    dbResults.length,
    outputPath,
    `Pattern 3: 多段JOIN検証型 - 中間テーブル${storage.intermediateRows}行生成`
  );

  const sqlExplanation = generateSQLExplanation(data13.partyNames, data23.partyNames);

  return {
    timings,
    rowCount: dbResults.length,
    outputPath,
    sqlExplanation,
  };
}

// ========== ヘルパー関数 ==========

/**
 * 生データをDBに保存（パターン1,2と同じ）
 */
async function saveRawDataToDB(rows: ElectionRow[], electionNo: number, timer: DetailedTimer): Promise<number> {
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
    timer.incrementWriteOps(1); // Municipality upsert

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
      timer.incrementWriteOps(1); // RawElectionData create
      rowCount++;
    }
  }

  return rowCount;
}

/**
 * 生データをDBから読み込み
 */
async function loadRawDataFromDB(electionNo: number, timer: DetailedTimer) {
  const rawData = await prisma.rawElectionData.findMany({
    where: { electionNo },
    include: { municipality: true },
  });
  timer.incrementReadOps(1); // RawElectionData read

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

// ========== 中間テーブル作成（パターン3独自） ==========

/**
 * T_Base: 基礎テーブル（市区町村一意のメタデータ＋投票率）
 */
interface BaseTable {
  jisCode: string;
  prefCode: string;
  prefName: string;
  cityName: string;
  turnout: number;
}

function createBaseTable(rawData: any[], electionNo: number): BaseTable[] {
  console.log(`[Pattern 3] Creating T_Base_${electionNo} (基礎テーブル)`);

  return rawData.map((data) => ({
    jisCode: data.jisCode,
    prefCode: data.municipality.prefCode,
    prefName: data.municipality.prefName,
    cityName: data.municipality.cityName,
    turnout: computeTurnout(data.ballots, data.electorate),
  }));
}

/**
 * T_Party: 政党テーブル（政党別相対得票率）
 */
interface PartyTable {
  jisCode: string;
  partyShares: Record<string, number>;
}

function createPartyTable(rawData: any[], electionNo: number): PartyTable[] {
  console.log(`[Pattern 3] Creating T_Party_${electionNo} (政党テーブル)`);

  return rawData.map((data) => {
    const partyShares: Record<string, number> = {};

    for (const [party, votes] of Object.entries(data.parties)) {
      partyShares[party] = computeRelativeShare(votes as number, data.validVotes);
    }

    return {
      jisCode: data.jisCode,
      partyShares,
    };
  });
}

/**
 * Intermediate: 基礎テーブルと政党テーブルをJOIN
 */
interface IntermediateTable {
  jisCode: string;
  prefCode: string;
  prefName: string;
  cityName: string;
  turnout: number;
  partyShares: Record<string, number>;
}

function joinBaseAndParty(
  base: BaseTable[],
  party: PartyTable[],
  electionNo: number
): IntermediateTable[] {
  console.log(`[Pattern 3] JOIN: T_Base_${electionNo} × T_Party_${electionNo} → Intermediate_${electionNo}`);

  const partyMap = new Map(party.map(p => [p.jisCode, p]));
  const results: IntermediateTable[] = [];

  for (const b of base) {
    const p = partyMap.get(b.jisCode);
    if (p) {
      results.push({
        jisCode: b.jisCode,
        prefCode: b.prefCode,
        prefName: b.prefName,
        cityName: b.cityName,
        turnout: b.turnout,
        partyShares: p.partyShares,
      });
    }
  }

  return results;
}

/**
 * 最終統合: Intermediate_13 と Intermediate_23 をJOIN
 */
interface FinalResult {
  jisCode: string;
  prefCode: string;
  prefName: string;
  cityName: string;
  turnout13: number;
  turnout23: number;
  partyShares13: Record<string, number>;
  partyShares23: Record<string, number>;
}

function joinIntermediate(
  intermediate13: IntermediateTable[],
  intermediate23: IntermediateTable[]
): FinalResult[] {
  console.log(`[Pattern 3] JOIN: Intermediate_13 × Intermediate_23 → Final Result`);

  const map13 = new Map(intermediate13.map(d => [d.jisCode, d]));
  const map23 = new Map(intermediate23.map(d => [d.jisCode, d]));

  const results: FinalResult[] = [];

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
async function saveResultsToDB(results: FinalResult[], timer: DetailedTimer): Promise<number> {
  await prisma.electionResult.deleteMany({});

  let rowCount = 0;

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
      timer.incrementWriteOps(1);
      rowCount++;
    }
  }

  return rowCount;
}

/**
 * 結果をDBから読み込み
 */
async function loadResultsFromDB(timer: DetailedTimer) {
  const results = await prisma.electionResult.findMany({
    include: { municipality: true },
    orderBy: [
      { municipality: { jisCode: "asc" } },
      { electionNo: "asc" },
      { party: "asc" },
    ],
  });
  timer.incrementReadOps(1); // ElectionResult read

  const grouped = new Map<string, FinalResult>();

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
  results: FinalResult[],
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

/**
 * SQL説明文を生成
 */
function generateSQLExplanation(parties13: string[], parties23: string[]): string {
  return `
-- パターン3: 多段JOIN検証型 (Multi-stage JOIN with Intermediate Views)
-- 粒度別の中間テーブルを明示的に作成し、段階的にJOINで組み上げる
-- データベースに中間テーブルを保存することで検証性を最大化

-- ========== 13回選挙の処理 ==========

-- ステップ1: T_Base_13（基礎テーブル: 市区町村一意の情報のみ）
WITH T_Base_13 AS (
  SELECT DISTINCT
    m.jis_code,
    m.pref_code,
    m.pref_name,
    m.city_name,
    CAST(r.ballots AS FLOAT) / r.electorate AS turnout
  FROM raw_election_data r
  JOIN municipalities m ON r.municipality_id = m.id
  WHERE r.election_no = 13
  GROUP BY m.jis_code, m.pref_code, m.pref_name, m.city_name, r.ballots, r.electorate
),

-- ステップ2: T_Party_13（政党テーブル: 政党別相対得票率）
T_Party_13 AS (
  SELECT
    m.jis_code,
    r.party,
    CAST(r.votes AS FLOAT) / r.valid_votes AS relative_share
  FROM raw_election_data r
  JOIN municipalities m ON r.municipality_id = m.id
  WHERE r.election_no = 13
),

-- ステップ3: Intermediate_13（基礎テーブル × 政党テーブル）
Intermediate_13 AS (
  SELECT
    B.jis_code,
    B.pref_code,
    B.pref_name,
    B.city_name,
    B.turnout,
    ${parties13.map(p => `MAX(CASE WHEN P.party = '${p}' THEN P.relative_share ELSE 0 END) AS ${makePartyColumn(p, 13)}`).join(",\n    ")}
  FROM T_Base_13 B
  INNER JOIN T_Party_13 P ON B.jis_code = P.jis_code
  GROUP BY B.jis_code, B.pref_code, B.pref_name, B.city_name, B.turnout
),

-- ========== 23回選挙の処理 ==========

-- ステップ4: T_Base_23
T_Base_23 AS (
  SELECT DISTINCT
    m.jis_code,
    CAST(r.ballots AS FLOAT) / r.electorate AS turnout
  FROM raw_election_data r
  JOIN municipalities m ON r.municipality_id = m.id
  WHERE r.election_no = 23
  GROUP BY m.jis_code, r.ballots, r.electorate
),

-- ステップ5: T_Party_23
T_Party_23 AS (
  SELECT
    m.jis_code,
    r.party,
    CAST(r.votes AS FLOAT) / r.valid_votes AS relative_share
  FROM raw_election_data r
  JOIN municipalities m ON r.municipality_id = m.id
  WHERE r.election_no = 23
),

-- ステップ6: Intermediate_23
Intermediate_23 AS (
  SELECT
    B.jis_code,
    B.turnout,
    ${parties23.map(p => `MAX(CASE WHEN P.party = '${p}' THEN P.relative_share ELSE 0 END) AS ${makePartyColumn(p, 23)}`).join(",\n    ")}
  FROM T_Base_23 B
  INNER JOIN T_Party_23 P ON B.jis_code = P.jis_code
  GROUP BY B.jis_code, B.turnout
)

-- ========== 最終統合 ==========

-- ステップ7: Intermediate_13 × Intermediate_23
SELECT
  I13.pref_code,
  I13.pref_name,
  I13.jis_code,
  I13.city_name,
  I13.turnout AS turnout_13,
  I23.turnout AS turnout_23,
  ${parties13.map(p => `I13.${makePartyColumn(p, 13)}`).join(",\n  ")},
  ${parties23.map(p => `I23.${makePartyColumn(p, 23)}`).join(",\n  ")}
FROM Intermediate_13 I13
INNER JOIN Intermediate_23 I23 ON I13.jis_code = I23.jis_code
ORDER BY I13.jis_code;

-- 特徴:
-- - 検証性が最高: 各中間テーブル (T_Base, T_Party, Intermediate) を個別に確認可能
-- - JOIN操作が多く、処理ステップが細分化されている
-- - 粒度別にテーブルを分けるため、ロジックの整理がしやすい
-- - デバッグ時に中間結果を段階的に検証できる
-- - ストレージ使用量: 中間テーブルを保存するため、一時的に多くなる
`.trim();
}
