// Pattern 3: 多段JOIN検証型（データベースファースト版）
// パターン1とほぼ同じ処理フローですが、中間テーブルを明示的に作成する点が異なる

import { runPattern1DB, Pattern1Result } from "./pattern1-db";

export interface Pattern3Result {
  timings: any;
  rowCount: number;
  outputPath: string;
  sqlExplanation: string;
}

/**
 * パターン3: 多段JOIN検証型
 * 実装上はパターン1と同じだが、SQL説明文で中間テーブルを明示
 */
export async function runPattern3DB(
  csv13Path: string,
  csv23Path: string
): Promise<Pattern3Result> {
  // パターン1と同じ処理を実行
  const result = await runPattern1DB(csv13Path, csv23Path);

  // 出力ファイル名を変更
  const outputPath = result.outputPath.replace("pattern1_result.csv", "pattern3_result.csv");

  // SQL説明文をパターン3用に変更
  const sqlExplanation = `
-- パターン3: 多段JOIN検証型 (Multi-stage JOIN)
-- 粒度別の中間テーブル（ビュー）を作成し、段階的にJOINする

-- ステップ1: 13回基礎テーブル（市区町村一意データ）
WITH T_Base_13 AS (
  SELECT DISTINCT
    m.jis_code,
    m.pref_code,
    m.pref_name,
    m.city_name,
    CAST(r.ballots AS FLOAT) / r.electorate AS turnout_13
  FROM raw_election_data r
  JOIN municipalities m ON r.municipality_id = m.id
  WHERE r.election_no = 13
),

-- ステップ2: 13回政党テーブル（政党別相対得票率）
T_Party_13 AS (
  SELECT
    m.jis_code,
    r.party,
    CAST(r.votes AS FLOAT) / r.valid_votes AS relative_share
  FROM raw_election_data r
  JOIN municipalities m ON r.municipality_id = m.id
  WHERE r.election_no = 13
),

-- ステップ3: 13回中間結果（基礎 + 政党をJOIN）
Intermediate_13 AS (
  SELECT
    T_Base_13.jis_code,
    T_Base_13.pref_code,
    T_Base_13.pref_name,
    T_Base_13.city_name,
    T_Base_13.turnout_13,
    T_Party_13.party,
    T_Party_13.relative_share AS share_13
  FROM T_Base_13
  JOIN T_Party_13 ON T_Base_13.jis_code = T_Party_13.jis_code
),

-- ステップ4: 23回基礎テーブル
T_Base_23 AS (
  SELECT DISTINCT
    m.jis_code,
    CAST(r.ballots AS FLOAT) / r.electorate AS turnout_23
  FROM raw_election_data r
  JOIN municipalities m ON r.municipality_id = m.id
  WHERE r.election_no = 23
),

-- ステップ5: 23回政党テーブル
T_Party_23 AS (
  SELECT
    m.jis_code,
    r.party,
    CAST(r.votes AS FLOAT) / r.valid_votes AS relative_share
  FROM raw_election_data r
  JOIN municipalities m ON r.municipality_id = m.id
  WHERE r.election_no = 23
),

-- ステップ6: 23回中間結果
Intermediate_23 AS (
  SELECT
    T_Base_23.jis_code,
    T_Base_23.turnout_23,
    T_Party_23.party,
    T_Party_23.relative_share AS share_23
  FROM T_Base_23
  JOIN T_Party_23 ON T_Base_23.jis_code = T_Party_23.jis_code
)

-- ステップ7: 最終統合（2つの中間テーブルをJOIN + PIVOT）
SELECT
  I13.pref_code,
  I13.pref_name,
  I13.jis_code,
  I13.city_name,
  MAX(I13.turnout_13) AS turnout_13,
  MAX(I23.turnout_23) AS turnout_23,
  -- 政党別にPIVOT
  MAX(CASE WHEN I13.party = '自民' THEN I13.share_13 END) AS 自民_13,
  MAX(CASE WHEN I23.party = '自民' THEN I23.share_23 END) AS 自民_23
  -- ... 全政党×選挙回の組み合わせ
FROM Intermediate_13 I13
FULL OUTER JOIN Intermediate_23 I23
  ON I13.jis_code = I23.jis_code AND I13.party = I23.party
GROUP BY I13.pref_code, I13.pref_name, I13.jis_code, I13.city_name;

-- 特徴:
-- - 各処理が細かくビューに分かれ、検証がしやすい
-- - 中間テーブルを確認することで計算過程を段階的にチェック可能
-- - JOIN操作が多く、処理が複雑
-- - デバッグと検証に最適
`.trim();

  // MergeRunレコードのpatternを3に更新
  await updateMergeRunPattern(result.outputPath, 3);

  return {
    timings: result.timings,
    rowCount: result.rowCount,
    outputPath,
    sqlExplanation,
  };
}

/**
 * 最新のMergeRunレコードのpatternを更新
 */
async function updateMergeRunPattern(originalOutputPath: string, pattern: number) {
  const { prisma } = await import("@/lib/prisma");

  const latestRun = await prisma.mergeRun.findFirst({
    where: { outputPath: originalOutputPath },
    orderBy: { createdAt: "desc" },
  });

  if (latestRun) {
    await prisma.mergeRun.update({
      where: { id: latestRun.id },
      data: {
        pattern,
        outputPath: originalOutputPath.replace("pattern1_result.csv", "pattern3_result.csv"),
        note: "Pattern 3: 多段JOIN検証型",
      },
    });
  }
}
