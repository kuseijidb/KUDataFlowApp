// API Route: Pattern 1 実行エンドポイント（データベースファースト版）

import { NextResponse } from "next/server";
import { runPattern1DB } from "@/lib/transform/pattern1-db";
import * as path from "path";

export async function POST() {
  try {
    // CSVファイルパス
    const csv13Path = path.join(process.cwd(), "data", "csv", "hirei_13_hyogo_seiki.csv");
    const csv23Path = path.join(process.cwd(), "data", "csv", "hirei_23_hyogo_seiki.csv");

    // パターン1実行（データベースファースト）
    const result = await runPattern1DB(csv13Path, csv23Path);

    return NextResponse.json({
      success: true,
      pattern: 1,
      timings: result.timings,
      rowCount: result.rowCount,
      outputPath: result.outputPath,
      message: "Pattern 1 executed successfully",
      sqlExplanation: result.sqlExplanation,
    });
  } catch (error) {
    console.error("Pattern 1 execution error:", error);
    return NextResponse.json(
      {
        success: false,
        pattern: 1,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
