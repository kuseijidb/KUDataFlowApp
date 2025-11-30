// API Route: Pattern 3 実行エンドポイント

import { NextResponse } from "next/server";
import { transformPattern3 } from "@/lib/transform/pattern3";
import { writeCsv } from "@/lib/output/writer";
import { saveMetrics } from "@/lib/metrics/runner";
import * as path from "path";

export async function POST() {
  try {
    const startTime = performance.now();

    // CSVファイルパス
    const csv13Path = path.join(process.cwd(), "data", "csv", "hirei_13_hyogo_seiki.csv");
    const csv23Path = path.join(process.cwd(), "data", "csv", "hirei_23_hyogo_seiki.csv");

    // パターン3実行
    const result = transformPattern3(csv13Path, csv23Path);

    // CSV出力
    const writeResult = writeCsv({
      header: result.header,
      rows: result.rows,
      fileName: "hirei_13.23_hyogo_pattern3.csv",
    });

    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);

    // メトリクス保存
    const metrics = await saveMetrics({
      pattern: 3,
      durationMs,
      rowCount: writeResult.rowCount,
      outputPath: writeResult.outputPath,
      note: `Pattern 3: 多段JOIN検証型 | ${result.header.length} columns`,
    });

    return NextResponse.json({
      success: true,
      pattern: 3,
      durationMs: metrics.durationMs,
      rowCount: metrics.rowCount,
      outputPath: metrics.outputPath,
      message: "Pattern 3 executed successfully",
      sqlExplanation: result.sqlExplanation,
    });
  } catch (error) {
    console.error("Pattern 3 execution error:", error);
    return NextResponse.json(
      {
        success: false,
        pattern: 3,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
