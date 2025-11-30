// API Route: Pattern 2 実行エンドポイント（データベースファースト版）

import { NextResponse } from "next/server";
import { runPattern2DB } from "@/lib/transform/pattern2-db";
import * as path from "path";

export async function POST() {
  try {
    // CSVファイルパス
    const csv13Path = path.join(process.cwd(), "data", "csv", "hirei_13_hyogo_seiki.csv");
    const csv23Path = path.join(process.cwd(), "data", "csv", "hirei_23_hyogo_seiki.csv");

    // パターン2実行（データベースファースト）
    const result = await runPattern2DB(csv13Path, csv23Path);

    return NextResponse.json({
      success: true,
      pattern: 2,
      timings: result.timings,
      rowCount: result.rowCount,
      outputPath: result.outputPath,
      message: "Pattern 2 executed successfully",
      sqlExplanation: result.sqlExplanation,
    });
  } catch (error) {
    console.error("Pattern 2 execution error:", error);
    return NextResponse.json(
      {
        success: false,
        pattern: 2,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
