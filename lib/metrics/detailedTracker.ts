// Detailed Timing Tracker
// 7段階のタイミングを個別に計測し、MergeRunへ保存

import { prisma } from "@/lib/prisma";

export interface TimingSteps {
  csvLoadMs: number;
  dbWriteRawMs: number;
  dbReadRawMs: number;
  computeMs: number;
  dbWriteResultMs: number;
  dbReadResultMs: number;
  csvWriteMs: number;
  totalMs: number;
}

export class DetailedTimer {
  private stepTimes: Partial<TimingSteps> = {};
  private currentStepStart: number = 0;
  private overallStart: number = 0;

  constructor() {
    this.overallStart = performance.now();
  }

  /**
   * 新しいステップを開始
   */
  startStep(): void {
    this.currentStepStart = performance.now();
  }

  /**
   * 現在のステップを終了し、時間を記録
   */
  endStep(stepName: keyof TimingSteps): void {
    const elapsed = Math.round(performance.now() - this.currentStepStart);
    this.stepTimes[stepName] = elapsed;
  }

  /**
   * すべてのタイミングを取得（totalMsは自動計算）
   */
  getTimings(): TimingSteps {
    const totalMs = Math.round(performance.now() - this.overallStart);

    return {
      csvLoadMs: this.stepTimes.csvLoadMs || 0,
      dbWriteRawMs: this.stepTimes.dbWriteRawMs || 0,
      dbReadRawMs: this.stepTimes.dbReadRawMs || 0,
      computeMs: this.stepTimes.computeMs || 0,
      dbWriteResultMs: this.stepTimes.dbWriteResultMs || 0,
      dbReadResultMs: this.stepTimes.dbReadResultMs || 0,
      csvWriteMs: this.stepTimes.csvWriteMs || 0,
      totalMs,
    };
  }
}

/**
 * MergeRun レコードを保存
 */
export async function saveMergeRun(
  pattern: number,
  timings: TimingSteps,
  rowCount: number,
  outputPath: string,
  note?: string
) {
  return await prisma.mergeRun.create({
    data: {
      pattern,
      ...timings,
      rowCount,
      outputPath,
      note,
      startedAt: new Date(Date.now() - timings.totalMs),
      finishedAt: new Date(),
    },
  });
}

/**
 * 各パターンの最新実行結果を取得
 */
export async function getLatestRunsByPattern() {
  const patterns = [1, 2, 3];

  const results = await Promise.all(
    patterns.map(async (pattern) => {
      const latestRun = await prisma.mergeRun.findFirst({
        where: { pattern },
        orderBy: { finishedAt: "desc" },
      });

      return {
        pattern,
        run: latestRun,
      };
    })
  );

  return results;
}
