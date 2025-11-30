// Pattern 1: ETL分離型（選挙回ごとに完結させて最後に結合）
// SQL的概念:
// 1. 13回データを完全に整形 → T_13 (SELECT ... GROUP BY jisCode)
// 2. 23回データを完全に整形 → T_23 (SELECT ... GROUP BY jisCode)
// 3. 最終統合: SELECT * FROM T_13 JOIN T_23 ON T_13.jisCode = T_23.jisCode

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
  sqlExplanation: string; // SQL的な説明
}

/**
 * パターン1: ETL分離型の実装
 * 各選挙回を独立して処理し、最後にJOINする
 */
export function transformPattern1(
  csv13Path: string,
  csv23Path: string
): TransformResult {
  // ステップ1: 13回データ読み込みと整形
  const data13 = loadElectionCsv(csv13Path, 13);
  const processed13 = processElection(data13.rows, 13, data13.partyNames);

  // ステップ2: 23回データ読み込みと整形
  const data23 = loadElectionCsv(csv23Path, 23);
  const processed23 = processElection(data23.rows, 23, data23.partyNames);

  // ステップ3: JOINして最終結果を作成
  const joined = joinByJisCode(
    processed13,
    processed23,
    (row13, row23) => {
      // メタデータは13回から取得（どちらでも同じはず）
      const base: Record<string, string | number> = {
        pref_code: row13.prefCode,
        pref_name: row13.prefName,
        jis_code: row13.jisCode,
        city_name: row13.cityName,
        turnout_13: row13.turnout,
        turnout_23: row23.turnout,
      };

      // 13回の政党別相対得票率
      Object.entries(row13.partyShares).forEach(([party, share]) => {
        base[makePartyColumn(party, 13)] = share;
      });

      // 23回の政党別相対得票率
      Object.entries(row23.partyShares).forEach(([party, share]) => {
        base[makePartyColumn(party, 23)] = share;
      });

      return base;
    }
  );

  // ヘッダー生成（全政党名を取得）
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
-- パターン1: ETL分離型 (Extract-Transform-Load per Election)
-- 各選挙回を独立したパイプラインで処理し、最後にJOINする

-- ステップ1: 13回データを整形 (T_13)
WITH T_13 AS (
  SELECT
    市区町村コード AS jis_code,
    都道府県コード AS pref_code,
    都道府県名 AS pref_name,
    市区町村名 AS city_name,
    投票者数 / 有権者数 AS turnout_13,
    ${data13.partyNames.map((p) => `${p} / 有効投票数 AS ${makePartyColumn(p, 13)}`).join(",\n    ")}
  FROM election_13_raw
  GROUP BY jis_code
),

-- ステップ2: 23回データを整形 (T_23)
T_23 AS (
  SELECT
    市区町村コード AS jis_code,
    投票者数 / 有権者数 AS turnout_23,
    ${data23.partyNames.map((p) => `${p} / 有効投票数 AS ${makePartyColumn(p, 23)}`).join(",\n    ")}
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
-- - コード重複がやや多い
`.trim();

  return { rows: joined, header, sqlExplanation };
}

/**
 * 1つの選挙回データを処理する
 * SQL的には: SELECT jisCode, turnout, party1/validVotes AS rel1, ... FROM raw
 */
interface ProcessedElection {
  prefCode: string;
  prefName: string;
  jisCode: string;
  cityName: string;
  turnout: number;
  partyShares: Record<string, number>; // 政党 → 相対得票率
}

function processElection(
  rows: ElectionRow[],
  electionNo: number,
  partyNames: string[]
): ProcessedElection[] {
  return rows.map((row) => {
    const turnout = computeTurnout(row.ballots, row.electorate);

    const partyShares: Record<string, number> = {};
    partyNames.forEach((party) => {
      const votes = row.parties[party] || 0;
      partyShares[party] = computeRelativeShare(votes, row.validVotes);
    });

    return {
      prefCode: row.prefCode,
      prefName: row.prefName,
      jisCode: row.jisCode,
      cityName: row.cityName,
      turnout,
      partyShares,
    };
  });
}
