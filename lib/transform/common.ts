// Common Transform Utilities - 共通計算処理
// 投票率、相対得票率の計算と正規化処理

import { ElectionRow } from "../csv/loader";

/**
 * 投票率を計算（投票者数 / 有権者数）
 * @param ballots 投票者数
 * @param electorate 有権者数
 * @returns 投票率（小数点4桁）
 */
export function computeTurnout(ballots: number, electorate: number): number {
  if (electorate === 0) {
    console.warn("Warning: Division by zero in computeTurnout");
    return 0;
  }
  return round(ballots / electorate, 4);
}

/**
 * 相対得票率を計算（政党得票数 / 有効投票数）
 * @param votes 政党得票数
 * @param validVotes 有効投票数
 * @returns 相対得票率（小数点4桁）
 */
export function computeRelativeShare(votes: number, validVotes: number): number {
  if (validVotes === 0) {
    console.warn("Warning: Division by zero in computeRelativeShare");
    return 0;
  }
  return round(votes / validVotes, 4);
}

/**
 * 数値を指定桁数で丸める
 * @param value 数値
 * @param decimals 小数点以下桁数
 * @returns 丸めた数値
 */
export function round(value: number, decimals: number = 4): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * CSV行データを正規化された中間形式に変換
 * @param raw CSVから読み込んだ生データ
 * @param electionNo 選挙回番号
 * @returns 正規化された行データ
 */
export interface NormalizedRow extends ElectionRow {
  electionNo: number;
}

export function normalizeRow(raw: ElectionRow, electionNo: number): NormalizedRow {
  return {
    ...raw,
    electionNo,
  };
}

/**
 * 2つの配列をJISコードをキーにJOINする
 * SQL的には: SELECT * FROM a INNER JOIN b ON a.jisCode = b.jisCode
 */
export function joinByJisCode<T extends { jisCode: string }, U extends { jisCode: string }>(
  left: T[],
  right: U[],
  merger: (l: T, r: U) => any
): any[] {
  const rightMap = new Map<string, U>();
  right.forEach((row) => rightMap.set(row.jisCode, row));

  const result: any[] = [];
  left.forEach((leftRow) => {
    const rightRow = rightMap.get(leftRow.jisCode);
    if (rightRow) {
      result.push(merger(leftRow, rightRow));
    }
  });

  return result;
}

/**
 * 政党名と選挙回の組み合わせから列名を生成
 * 例: "自民" + 13 → "自民_13"
 */
export function makePartyColumn(party: string, electionNo: number): string {
  return `${party}_${electionNo}`;
}

/**
 * 配列をグループ化する（SQL の GROUP BY に相当）
 */
export function groupBy<T, K extends string | number>(
  array: T[],
  keyFn: (item: T) => K
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  array.forEach((item) => {
    const key = keyFn(item);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(item);
  });
  return map;
}
