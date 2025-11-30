// Pattern 2: UNION一括処理型（縦持ち統合→まとめて計算→最終横持ち）
// SQL的概念:
// 1. UNION ALL: 13回と23回を縦に結合（election列でフラグ付与）
// 2. 一括計算: 投票率と相対得票率を全行に対して計算
// 3. PIVOT: (jisCode, election, party) を横展開

import { loadElectionCsv } from "../csv/loader";
import {
  computeTurnout,
  computeRelativeShare,
  NormalizedRow,
  normalizeRow,
  makePartyColumn,
  groupBy,
} from "./common";

export interface TransformResult {
  rows: Record<string, string | number>[];
  header: string[];
  sqlExplanation: string;
}

/**
 * パターン2: UNION一括処理型の実装
 * 全データを統合してから一括処理し、最後にピボット
 */
export function transformPattern2(
  csv13Path: string,
  csv23Path: string
): TransformResult {
  // ステップ1: データ読み込み
  const data13 = loadElectionCsv(csv13Path, 13);
  const data23 = loadElectionCsv(csv23Path, 23);

  // ステップ2: UNION ALL（縦持ち統合）
  const normalized13 = data13.rows.map((row) => normalizeRow(row, 13));
  const normalized23 = data23.rows.map((row) => normalizeRow(row, 23));
  const unionAll = [...normalized13, ...normalized23];

  // ステップ3: 一括で投票率と相対得票率を計算
  interface ComputedRow extends NormalizedRow {
    turnout: number;
    partyShares: Record<string, number>;
  }

  const computed: ComputedRow[] = unionAll.map((row) => {
    const turnout = computeTurnout(row.ballots, row.electorate);
    const partyShares: Record<string, number> = {};

    Object.entries(row.parties).forEach(([party, votes]) => {
      partyShares[party] = computeRelativeShare(votes, row.validVotes);
    });

    return { ...row, turnout, partyShares };
  });

  // ステップ4: PIVOT（横持ち変換）
  // JISコードごとにグループ化
  const grouped = groupBy(computed, (row) => row.jisCode);

  const pivoted: Record<string, string | number>[] = [];
  const allParties = new Set([...data13.partyNames, ...data23.partyNames]);

  grouped.forEach((group, jisCode) => {
    // 13回と23回のデータを分離
    const row13 = group.find((r) => r.electionNo === 13);
    const row23 = group.find((r) => r.electionNo === 23);

    if (!row13 || !row23) {
      // JOINできないデータはスキップ
      return;
    }

    // ベースデータ
    const base: Record<string, string | number> = {
      pref_code: row13.prefCode,
      pref_name: row13.prefName,
      jis_code: jisCode,
      city_name: row13.cityName,
      turnout_13: row13.turnout,
      turnout_23: row23.turnout,
    };

    // 政党別相対得票率を横展開
    allParties.forEach((party) => {
      base[makePartyColumn(party, 13)] = row13.partyShares[party] || 0;
      base[makePartyColumn(party, 23)] = row23.partyShares[party] || 0;
    });

    pivoted.push(base);
  });

  // ヘッダー生成
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

  // SQL説明文
  const sqlExplanation = `
-- パターン2: UNION一括処理型 (Union-then-Transform)
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
    自民 AS party_jimin,
    立民 AS party_rikken,
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
    自民,
    立民,
    -- ... 全政党列
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
    party_jimin / valid_votes AS jimin_share,
    party_rikken / valid_votes AS rikken_share
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
-- - グループ化とPIVOTのコストがやや高い
`.trim();

  return { rows: pivoted, header, sqlExplanation };
}
