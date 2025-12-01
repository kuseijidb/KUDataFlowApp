// API Route: Pattern 3 実行エンドポイント（データベースファースト版）

import { NextResponse } from "next/server";
import { runPattern3DB } from "@/lib/transform/pattern3-db";
import * as path from "path";

export async function POST() {
  try {
    // CSVファイルパス
    const csv13Path = path.join(process.cwd(), "data", "csv", "hirei_13_hyogo_seiki.csv");
    const csv23Path = path.join(process.cwd(), "data", "csv", "hirei_23_hyogo_seiki.csv");

    // パターン3実行（データベースファースト）
    const result = await runPattern3DB(csv13Path, csv23Path);

    return NextResponse.json({
      success: true,
      pattern: 3,
      timings: result.timings,
      rowCount: result.rowCount,
      outputPath: result.outputPath,
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
