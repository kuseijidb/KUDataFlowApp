// CSV Output Writer - CSV出力モジュール
// ローカル環境とVercel（production）の両方に対応

import * as fs from "fs";
import * as path from "path";
import { stringify } from "csv-parse/sync";

export interface WriteOptions {
  header: string[];
  rows: Record<string, string | number>[];
  fileName: string;
}

export interface WriteResult {
  outputPath: string;
  rowCount: number;
  buffer?: Buffer; // Vercel用
}

/**
 * CSVファイルを出力
 * @param options 出力オプション
 * @returns 出力結果
 */
export function writeCsv(options: WriteOptions): WriteResult {
  const { header, rows, fileName } = options;

  // ヘッダー順にデータを整形
  const orderedRows = rows.map((row) => {
    const ordered: Record<string, string | number> = {};
    header.forEach((col) => {
      ordered[col] = row[col] !== undefined ? row[col] : "";
    });
    return ordered;
  });

  // CSV文字列生成
  const csvContent = generateCsv(header, orderedRows);
  const buffer = Buffer.from(csvContent, "utf-8");

  // 出力パス
  const outputDir = path.join(process.cwd(), "output");
  const outputPath = path.join(outputDir, fileName);

  // 本番環境（Vercel）ではファイル書き込みをスキップ
  if (process.env.NODE_ENV === "production") {
    console.log(`[Production Mode] Skipping file write for ${fileName}`);
    return {
      outputPath: `/output/${fileName}`,
      rowCount: rows.length,
      buffer,
    };
  }

  // ローカル環境: ディレクトリ作成とファイル書き込み
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, buffer);
  console.log(`CSV written to: ${outputPath} (${rows.length} rows)`);

  return {
    outputPath,
    rowCount: rows.length,
  };
}

/**
 * CSV文字列を生成
 */
function generateCsv(
  header: string[],
  rows: Record<string, string | number>[]
): string {
  // ヘッダー行
  const headerLine = header.join(",");

  // データ行
  const dataLines = rows.map((row) => {
    return header
      .map((col) => {
        const value = row[col];
        if (value === undefined || value === null || value === "") {
          return "";
        }
        // 数値はそのまま、文字列はCSVエスケープ
        if (typeof value === "number") {
          return value.toString();
        }
        // 文字列のエスケープ（カンマ、改行、ダブルクォートを含む場合）
        const str = value.toString();
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(",");
  });

  return [headerLine, ...dataLines].join("\n");
}
