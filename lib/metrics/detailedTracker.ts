// Detailed Timing & Storage Tracker
// 7段階のタイミング計測とストレージ/メモリ/I/Oメトリクスを保存

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
  rawDataRows: number; // RawElectionDataの行数
  resultDataRows: number; // ElectionResultの行数
  intermediateRows: number; // 中間テーブルの行数（メモリ上も含む）
  dbWriteOps: number; // DB書き込み回数
  dbReadOps: number; // DB読み込み回数
  peakMemoryMB: number; // ピークメモリ使用量（推定 or RSS実測）
}

export class DetailedTimer {
  private stepTimes: Partial<TimingSteps> = {};
  private currentStepStart = 0;
  private overallStart = 0;

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

  startStep(): void {
    this.currentStepStart = performance.now();
  }

  endStep(stepName: keyof TimingSteps): void {
    const elapsed = Math.round(performance.now() - this.currentStepStart);
    this.stepTimes[stepName] = elapsed;
  }

  recordStorage(metrics: Partial<StorageMetrics>): void {
    this.storage = { ...this.storage, ...metrics };
  }

  incrementWriteOps(count: number = 1): void {
    this.storage.dbWriteOps += count;
  }

  incrementReadOps(count: number = 1): void {
    this.storage.dbReadOps += count;
  }

  recordIntermediateRows(count: number): void {
    this.storage.intermediateRows += count;
  }

  /**
   * 概算メモリ使用量を記録（配列長×推定バイト）
   */
  recordMemoryUsage(arrayLength: number, estimatedBytesPerRow: number = 1024): void {
    const mb = (arrayLength * estimatedBytesPerRow) / (1024 * 1024);
    if (mb > this.storage.peakMemoryMB) {
      this.storage.peakMemoryMB = Math.round(mb * 100) / 100;
    }
  }

  /**
   * 実メモリ使用量（RSS）を記録
   */
  recordProcessMemory(): void {
    const rss = process.memoryUsage().rss;
    const mb = Math.round((rss / (1024 * 1024)) * 100) / 100;
    if (mb > this.storage.peakMemoryMB) {
      this.storage.peakMemoryMB = mb;
    }
  }

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

  getStorageMetrics(): StorageMetrics {
    return { ...this.storage };
  }
}

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
