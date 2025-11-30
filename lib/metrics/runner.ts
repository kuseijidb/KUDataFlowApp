// Metrics Runner - 処理時間計測とログ記録
// performance.now()で高精度計測し、Prismaでデータベースに保存

import prisma from "../prisma";

export interface RunMetrics {
  pattern: number;
  durationMs: number;
  rowCount: number;
  outputPath: string;
  note?: string;
}

export interface RunResult extends RunMetrics {
  id: number;
  startedAt: Date;
  finishedAt: Date;
}

/**
 * パターン実行を計測してログを記録
 * @param pattern パターン番号(1, 2, or 3)
 * @param fn 実行する関数
 * @returns 実行結果とメトリクス
 */
export async function runWithMetrics<T>(
  pattern: number,
  fn: () => T
): Promise<{ result: T; metrics: RunResult }> {
  const startedAt = new Date();
  const startTime = performance.now();

  // 関数実行
  const result = fn();

  const endTime = performance.now();
  const finishedAt = new Date();
  const durationMs = Math.round(endTime - startTime);

  console.log(`[Pattern ${pattern}] Execution completed in ${durationMs}ms`);

  // メトリクスはAPI層で保存されるため、ここでは返すのみ
  const metrics: RunResult = {
    id: 0, // 仮の値（保存後に更新される）
    pattern,
    durationMs,
    rowCount: 0, // 呼び出し側で設定
    outputPath: "", // 呼び出し側で設定
    startedAt,
    finishedAt,
  };

  return { result, metrics };
}

/**
 * メトリクスをデータベースに保存
 * @deprecated 新スキーマでは detailedTracker.ts の saveMergeRun を使用してください
 * @param metrics 保存するメトリクス
 * @returns 保存されたレコード
 */
export async function saveMetrics(metrics: RunMetrics): Promise<RunResult> {
  // 旧パターン（2,3）との互換性のため、totalMsとして保存
  const saved = await prisma.mergeRun.create({
    data: {
      pattern: metrics.pattern,
      csvLoadMs: 0,
      dbWriteRawMs: 0,
      dbReadRawMs: 0,
      computeMs: 0,
      dbWriteResultMs: 0,
      dbReadResultMs: 0,
      csvWriteMs: 0,
      totalMs: metrics.durationMs,
      rowCount: metrics.rowCount,
      outputPath: metrics.outputPath,
      note: metrics.note || null,
    },
  });

  return {
    id: saved.id,
    pattern: saved.pattern,
    durationMs: saved.totalMs,
    rowCount: saved.rowCount,
    outputPath: saved.outputPath,
    note: saved.note || undefined,
    startedAt: saved.startedAt,
    finishedAt: saved.finishedAt,
  };
}

/**
 * 最近の実行履歴を取得
 * @param limit 取得件数
 * @returns 実行履歴
 */
export async function getRecentRuns(limit: number = 10): Promise<RunResult[]> {
  const runs = await prisma.mergeRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
  });

  return runs.map((run) => ({
    id: run.id,
    pattern: run.pattern,
    durationMs: run.totalMs, // 新スキーマではtotalMsを使用
    rowCount: run.rowCount,
    outputPath: run.outputPath,
    note: run.note || undefined,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  }));
}

/**
 * パターン別の実行履歴を取得
 * @param pattern パターン番号
 * @param limit 取得件数
 * @returns 実行履歴
 */
export async function getRunsByPattern(
  pattern: number,
  limit: number = 5
): Promise<RunResult[]> {
  const runs = await prisma.mergeRun.findMany({
    where: { pattern },
    orderBy: { startedAt: "desc" },
    take: limit,
  });

  return runs.map((run) => ({
    id: run.id,
    pattern: run.pattern,
    durationMs: run.totalMs, // 新スキーマではtotalMsを使用
    rowCount: run.rowCount,
    outputPath: run.outputPath,
    note: run.note || undefined,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  }));
}
