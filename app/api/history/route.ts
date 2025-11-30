// API Route: 実行履歴取得エンドポイント

import { NextResponse } from "next/server";
import { getRecentRuns } from "@/lib/metrics/runner";

export async function GET() {
  try {
    const runs = await getRecentRuns(20);

    return NextResponse.json({
      success: true,
      runs,
    });
  } catch (error) {
    console.error("Failed to fetch history:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
