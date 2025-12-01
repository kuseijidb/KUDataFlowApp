// Detailed Timing Tracker
// 7段階のタイミングを個別に計測し、MergeRunへ保存
// ストレージとデータ量の計測も含む

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

export interface StorageMetrics {
  rawDataRows: number;        // RawElectionDataの行数
  resultDataRows: number;      // ElectionResultの行数
  intermediateRows: number;    // 中間テーブルの行数（メモリ上）
  dbWriteOps: number;          // DB書き込み回数
  dbReadOps: number;           // DB読み込み回数
  peakMemoryMB: number;        // ピークメモリ使用量（MB）
}

export class DetailedTimer {
  private stepTimes: Partial<TimingSteps> = {};
  private currentStepStart: number = 0;
  private overallStart: number = 0;

  // ストレージメトリクス
  private storage: StorageMetrics = {
    rawDataRows: 0,
    resultDataRows: 0,
    intermediateRows: 0,
    dbWriteOps: 0,
    dbReadOps: 0,
    peakMemoryMB: 0,
  };

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
   * ストレージメトリクスを記録
   */
  recordStorage(metrics: Partial<StorageMetrics>): void {
    this.storage = { ...this.storage, ...metrics };
  }

  /**
   * DB書き込み操作をカウント
   */
  incrementWriteOps(count: number = 1): void {
    this.storage.dbWriteOps += count;
  }

  /**
   * DB読み込み操作をカウント
   */
  incrementReadOps(count: number = 1): void {
    this.storage.dbReadOps += count;
  }

  /**
   * 中間テーブルの行数を記録
   */
  recordIntermediateRows(count: number): void {
    this.storage.intermediateRows += count;
  }

  /**
   * メモリ使用量を記録（概算）
   */
  recordMemoryUsage(arrayLength: number, estimatedBytesPerRow: number = 1024): void {
    const mb = (arrayLength * estimatedBytesPerRow) / (1024 * 1024);
    if (mb > this.storage.peakMemoryMB) {
      this.storage.peakMemoryMB = Math.round(mb * 100) / 100;
    }
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

  /**
   * ストレージメトリクスを取得
   */
  getStorageMetrics(): StorageMetrics {
    return { ...this.storage };
  }
}

/**
 * MergeRun レコードを保存
 */
export async function saveMergeRun(
  pattern: number,
  timings: TimingSteps,
  storage: StorageMetrics,
  rowCount: number,
  outputPath: string,
  note?: string
) {
  return await prisma.mergeRun.create({
    data: {
      pattern,
      ...timings,
      ...storage,
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
