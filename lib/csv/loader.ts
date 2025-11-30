// CSV Loader - 縦持ち政党データを横持ち集計データに変換
// 実際のCSVは政党ごとに行が分かれている形式

import * as fs from "fs";
import * as path from "path";

export interface ElectionRow {
  prefCode: string;
  prefName: string;
  jisCode: string;
  cityName: string;
  electorate: number;
  ballots: number;
  validVotes: number;
  parties: Record<string, number>; // 政党名 → 得票数
}

export interface LoadResult {
  rows: ElectionRow[];
  header: string[];
  partyNames: string[];
}

/**
 * 選挙CSVファイルを読み込み、市区町村レベルで集約
 * CSVは政党ごとに行が分かれている縦持ち形式
 * @param filePath CSVファイルのパス
 * @param electionNo 選挙回(13 or 23)
 * @returns 読み込み結果
 */
export function loadElectionCsv(filePath: string, electionNo: number): LoadResult {
  // ファイル読み込み
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`CSV file not found: ${absolutePath}`);
  }

  // UTF-8 (BOM付き)として読み込み
  const buffer = fs.readFileSync(absolutePath);
  let content = buffer.toString("utf-8");

  // BOM削除
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  // CSVパース（ヘッダーを手動処理）
  const lines = content.split(/\r?\n/);

  // 最初の2行をスキップ（Column1... と説明行）
  const dataLines = lines.slice(2).filter(line => line.trim().length > 0);

  // 実際のヘッダーは3行目（インデックス2）
  const headerLine = lines[2];
  const headers = headerLine.split(',').map(h => h.trim());

  console.log(`Headers (first 10):`, headers.slice(0, 10));

  // データをパース
  const rawRecords = dataLines.map(line => {
    const values = line.split(',');
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (values[index] || "").trim();
    });
    return record;
  });

  console.log(`Sample record:`, rawRecords[0]);

  // JISコードごとにグループ化して集約
  const grouped = new Map<string, {
    prefCode: string;
    prefName: string;
    jisCode: string;
    cityName: string;
    electorate: number;
    ballots: number;
    validVotes: number;
    parties: Record<string, number>;
  }>();

  const partySet = new Set<string>();

  rawRecords.forEach(record => {
    const jisCode = record["JISコード"] || record["市区町村コード"];
    const party = record["党派・会派等"];
    const votes = parseNumber(record["市区町村別得票数"]);

    if (!jisCode || !party || jisCode.startsWith("uh")) return; // Skip header rows

    partySet.add(party);

    if (!grouped.has(jisCode)) {
      grouped.set(jisCode, {
        prefCode: record["都道府県コード"],
        prefName: record["都道府県名"],
        jisCode,
        cityName: record["市区町村名"],
        electorate: parseNumber(record["有権者数"]),
        ballots: parseNumber(record["投票者数"]),
        validVotes: parseNumber(record["有効投票数"]),
        parties: {},
      });
    }

    const entry = grouped.get(jisCode)!;
    entry.parties[party] = (entry.parties[party] || 0) + votes;
  });

  const rows = Array.from(grouped.values());
  const partyNames = Array.from(partySet).sort();

  console.log(`Loaded ${rows.length} municipalities with ${partyNames.length} parties from election ${electionNo}`);
  console.log(`First 10 parties:`, partyNames.slice(0, 10));

  return { rows, header: partyNames, partyNames };
}

/**
 * 文字列を数値に変換（空文字・undefined は 0）
 */
function parseNumber(value: string | undefined): number {
  if (!value || value.trim() === "") return 0;
  const num = Number(value.replace(/,/g, ""));
  return isNaN(num) ? 0 : num;
}
