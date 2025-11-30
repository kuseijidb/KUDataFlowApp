// Pattern 3: 多段JOIN検証型（基礎テーブル＋政党テーブルを段階結合）
// SQL的概念:
// 1. 選挙回ごとに T_Base（メタ＋投票率）と T_Party（政党別相対得票率）を生成
// 2. T_Base と T_Party を JOIN して選挙回ごとの中間表を作成
// 3. 2つの中間表を JIS でJOIN して最終結果

import { loadElectionCsv, ElectionRow } from "../csv/loader";
import {
  computeTurnout,
  computeRelativeShare,
  joinByJisCode,
  makePartyColumn,
} from "./common";

export interface TransformResult {
  rows: Record<string, string | number>[];
  header: string[];
  sqlExplanation: string;
}

/**
 * パターン3: 多段JOIN検証型の実装
 * 粒度別の中間ビューを作成し、段階的にJOINする
 */
export function transformPattern3(
  csv13Path: string,
  csv23Path: string
): TransformResult {
  // ステップ1: データ読み込み
  const data13 = loadElectionCsv(csv13Path, 13);
  const data23 = loadElectionCsv(csv23Path, 23);

  // ステップ2: 13回の中間テーブル作成
  const base13 = createBaseTable(data13.rows, 13);
  const party13 = createPartyTable(data13.rows, 13, data13.partyNames);
  const intermediate13 = joinBaseAndParty(base13, party13, 13);

  // ステップ3: 23回の中間テーブル作成
  const base23 = createBaseTable(data23.rows, 23);
  const party23 = createPartyTable(data23.rows, 23, data23.partyNames);
  const intermediate23 = joinBaseAndParty(base23, party23, 23);

  // ステップ4: 最終統合（2つの中間表をJOIN）
  const final = joinByJisCode(
    intermediate13,
    intermediate23,
    (row13, row23) => {
      const base: Record<string, string | number> = {
        pref_code: row13.prefCode,
        pref_name: row13.prefName,
        jis_code: row13.jisCode,
        city_name: row13.cityName,
        turnout_13: row13.turnout,
        turnout_23: row23.turnout,
      };

      // 政党別相対得票率
      Object.entries(row13.partyShares).forEach(([party, share]) => {
        base[makePartyColumn(party, 13)] = share;
      });
      Object.entries(row23.partyShares).forEach(([party, share]) => {
        base[makePartyColumn(party, 23)] = share;
      });

      return base;
    }
  );

  // ヘッダー生成
  const allParties = new Set([...data13.partyNames, ...data23.partyNames]);
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
-- パターン3: 多段JOIN検証型 (Multi-stage JOIN with Verification)
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
    -- ... 全政党列
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
  -- ... 全政党×選挙回
FROM Intermediate_13 AS I13
INNER JOIN Intermediate_23 AS I23 ON I13.jis_code = I23.jis_code;

-- 特徴:
-- - 検証性が最高（各中間テーブルを個別に確認可能）
-- - JOIN操作が多く、記述が冗長
-- - 粒度別にビューを分けるため、ロジックの整理がしやすい
-- - デバッグ時に中間結果を見やすい
`.trim();

  return { rows: final, header, sqlExplanation };
}

// 基礎テーブル: JISコードごとのメタデータ＋投票率
interface BaseTable {
  jisCode: string;
  prefCode: string;
  prefName: string;
  cityName: string;
  turnout: number;
}

function createBaseTable(rows: ElectionRow[], electionNo: number): BaseTable[] {
  return rows.map((row) => ({
    jisCode: row.jisCode,
    prefCode: row.prefCode,
    prefName: row.prefName,
    cityName: row.cityName,
    turnout: computeTurnout(row.ballots, row.electorate),
  }));
}

// 政党テーブル: JISコードごとの政党別相対得票率
interface PartyTable {
  jisCode: string;
  partyShares: Record<string, number>;
}

function createPartyTable(
  rows: ElectionRow[],
  electionNo: number,
  partyNames: string[]
): PartyTable[] {
  return rows.map((row) => {
    const partyShares: Record<string, number> = {};
    partyNames.forEach((party) => {
      const votes = row.parties[party] || 0;
      partyShares[party] = computeRelativeShare(votes, row.validVotes);
    });

    return {
      jisCode: row.jisCode,
      partyShares,
    };
  });
}

// 基礎テーブルと政党テーブルをJOIN
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
  return joinByJisCode(base, party, (b, p) => ({
    jisCode: b.jisCode,
    prefCode: b.prefCode,
    prefName: b.prefName,
    cityName: b.cityName,
    turnout: b.turnout,
    partyShares: p.partyShares,
  }));
}
