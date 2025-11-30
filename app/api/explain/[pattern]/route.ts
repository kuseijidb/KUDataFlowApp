// API Route: SQL説明取得エンドポイント（実行なし）

import { NextRequest, NextResponse } from "next/server";

const explanations: Record<number, string> = {
  1: `-- パターン1: ETL分離型 (Extract-Transform-Load per Election)
-- 各選挙回を独立したパイプラインで処理し、最後にJOINする

-- ステップ1: 13回データを整形 (T_13)
WITH T_13 AS (
  SELECT
    市区町村コード AS jis_code,
    都道府県コード AS pref_code,
    都道府県名 AS pref_name,
    市区町村名 AS city_name,
    投票者数 / 有権者数 AS turnout_13,
    自民 / 有効投票数 AS 自民_13,
    立民 / 有効投票数 AS 立民_13
    -- ... その他全政党
  FROM election_13_raw
  GROUP BY jis_code
),

-- ステップ2: 23回データを整形 (T_23)
T_23 AS (
  SELECT
    市区町村コード AS jis_code,
    投票者数 / 有権者数 AS turnout_23,
    自民 / 有効投票数 AS 自民_23,
    立民 / 有効投票数 AS 立民_23
    -- ... その他全政党
  FROM election_23_raw
  GROUP BY jis_code
)

-- ステップ3: 最終統合 (INNER JOIN)
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
-- - コード重複がやや多い`,

  2: `-- パターン2: UNION一括処理型 (Union-then-Transform)
-- 全データを統合してから一括処理し、最後にPIVOTで横展開

-- ステップ1: UNION ALL（縦持ち統合）
WITH UnionAll AS (
  SELECT
    13 AS election_no,
    市区町村コード AS jis_code,
    都道府県コード AS pref_code,
    都道府県名 AS pref_name,
    市区町村名 AS city_name,
    有権者数 AS electorate,
    投票者数 AS ballots,
    有効投票数 AS valid_votes,
    自民, 立民, 公明, 共産
    -- ... 全政党列
  FROM election_13_raw

  UNION ALL

  SELECT
    23 AS election_no,
    市区町村コード,
    都道府県コード,
    都道府県名,
    市区町村名,
    有権者数,
    投票者数,
    有効投票数,
    自民, 立民, 公明, 共産
  FROM election_23_raw
),

-- ステップ2: 一括計算（投票率と相対得票率）
Computed AS (
  SELECT
    election_no,
    jis_code,
    pref_code,
    pref_name,
    city_name,
    ballots / electorate AS turnout,
    自民 / valid_votes AS jimin_share,
    立民 / valid_votes AS rikken_share
    -- ... 全政党の相対得票率
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
  MAX(CASE WHEN election_no = 13 THEN jimin_share END) AS 自民_13,
  MAX(CASE WHEN election_no = 23 THEN jimin_share END) AS 自民_23
  -- ... 全政党×選挙回の組み合わせ
FROM Computed
GROUP BY jis_code;

-- 特徴:
-- - コード記述量が最小
-- - 計算ロジックが一元化
-- - 中間テーブルが大きくメモリ使用量が多い
-- - グループ化とPIVOTのコストがやや高い`,

  3: `-- パターン3: 多段JOIN検証型 (Multi-stage JOIN with Verification)
-- 粒度別の中間ビューを作成し、段階的にJOINで組み上げる

-- ステップ1: 13回の基礎テーブル（市区町村一意の情報のみ）
WITH T_Base_13 AS (
  SELECT
    市区町村コード AS jis_code,
    都道府県コード AS pref_code,
    都道府県名 AS pref_name,
    市区町村名 AS city_name,
    投票者数 / 有権者数 AS turnout
  FROM election_13_raw
  GROUP BY jis_code  -- 一意性を保証
),

-- ステップ2: 13回の政党テーブル（政党別相対得票率）
T_Party_13 AS (
  SELECT
    市区町村コード AS jis_code,
    自民 / 有効投票数 AS 自民_share,
    立民 / 有効投票数 AS 立民_share
    -- ... 全政党の相対得票率
  FROM election_13_raw
  GROUP BY jis_code
),

-- ステップ3: 13回の中間集計（基礎テーブル × 政党テーブル）
Intermediate_13 AS (
  SELECT
    B.pref_code,
    B.pref_name,
    B.jis_code,
    B.city_name,
    B.turnout,
    P.自民_share AS 自民_13,
    P.立民_share AS 立民_13
  FROM T_Base_13 AS B
  INNER JOIN T_Party_13 AS P ON B.jis_code = P.jis_code
),

-- ステップ4-6: 23回も同様に処理
T_Base_23 AS (
  SELECT
    市区町村コード AS jis_code,
    投票者数 / 有権者数 AS turnout
  FROM election_23_raw
  GROUP BY jis_code
),

T_Party_23 AS (
  SELECT
    市区町村コード AS jis_code,
    自民 / 有効投票数 AS 自民_share,
    立民 / 有効投票数 AS 立民_share
  FROM election_23_raw
  GROUP BY jis_code
),

Intermediate_23 AS (
  SELECT
    B.jis_code,
    B.turnout,
    P.自民_share AS 自民_23,
    P.立民_share AS 立民_23
  FROM T_Base_23 AS B
  INNER JOIN T_Party_23 AS P ON B.jis_code = P.jis_code
)

-- ステップ7: 最終統合（2つの中間集計をJOIN）
SELECT
  I13.pref_code,
  I13.pref_name,
  I13.jis_code,
  I13.city_name,
  I13.turnout AS turnout_13,
  I23.turnout AS turnout_23,
  I13.自民_13,
  I23.自民_23,
  I13.立民_13,
  I23.立民_23
FROM Intermediate_13 AS I13
INNER JOIN Intermediate_23 AS I23 ON I13.jis_code = I23.jis_code;

-- 特徴:
-- - 検証性が最高（各中間テーブルを個別に確認可能）
-- - JOIN操作が多く、記述が冗長
-- - 粒度別にビューを分けるため、ロジックの整理がしやすい
-- - デバッグ時に中間結果を見やすい`,
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pattern: string }> }
) {
  const { pattern } = await params;
  const patternNum = parseInt(pattern, 10);

  if (![1, 2, 3].includes(patternNum)) {
    return NextResponse.json(
      { success: false, error: "Invalid pattern number" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    pattern: patternNum,
    sqlExplanation: explanations[patternNum],
  });
}
