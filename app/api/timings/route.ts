// API Route: タイミングサマリ取得エンドポイント
// 全3パターンの最新実行結果を返す

import { NextResponse } from "next/server";
import { getLatestRunsByPattern } from "@/lib/metrics/detailedTracker";

export async function GET() {
  try {
    const latestRuns = await getLatestRunsByPattern();

    return NextResponse.json({
      success: true,
      data: latestRuns,
    });
  } catch (error) {
    console.error("Error fetching timing summaries:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
