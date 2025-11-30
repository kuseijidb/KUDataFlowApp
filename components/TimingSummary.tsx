"use client";

// タイミングサマリ表示コンポーネント
// 3パターンの詳細タイミングを常時表示

import { useEffect, useState } from "react";

interface TimingData {
  csvLoadMs: number;
  dbWriteRawMs: number;
  dbReadRawMs: number;
  computeMs: number;
  dbWriteResultMs: number;
  dbReadResultMs: number;
  csvWriteMs: number;
  totalMs: number;
}

interface MergeRun {
  id: number;
  pattern: number;
  csvLoadMs: number;
  dbWriteRawMs: number;
  dbReadRawMs: number;
  computeMs: number;
  dbWriteResultMs: number;
  dbReadResultMs: number;
  csvWriteMs: number;
  totalMs: number;
  rowCount: number;
  outputPath: string;
  startedAt: string;
  finishedAt: string;
  note: string | null;
}

interface PatternRun {
  pattern: number;
  run: MergeRun | null;
}

export default function TimingSummary() {
  const [timingData, setTimingData] = useState<PatternRun[]>([
    { pattern: 1, run: null },
    { pattern: 2, run: null },
    { pattern: 3, run: null },
  ]);
  const [loading, setLoading] = useState(true);

  // タイミングデータを取得
  const fetchTimings = async () => {
    try {
      const response = await fetch("/api/timings");
      const result = await response.json();

      if (result.success) {
        setTimingData(result.data);
      }
    } catch (error) {
      console.error("Failed to fetch timings:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTimings();

    // 10秒ごとに自動更新（実行後すぐに反映されるように）
    const interval = setInterval(fetchTimings, 10000);
    return () => clearInterval(interval);
  }, []);

  const getPatternName = (pattern: number) => {
    switch (pattern) {
      case 1:
        return "パターン1: ETL分離型";
      case 2:
        return "パターン2: UNION一括処理";
      case 3:
        return "パターン3: 多段JOIN検証型";
      default:
        return `パターン${pattern}`;
    }
  };

  if (loading) {
    return (
      <div className="mt-8 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
        <p className="text-center text-gray-600 dark:text-gray-400">
          タイミングデータを読み込み中...
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-4">
      <h2 className="text-2xl font-bold mb-4">実行タイミングサマリ</h2>

      {timingData.map(({ pattern, run }) => (
        <div
          key={pattern}
          className="p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm"
        >
          <h3 className="text-lg font-semibold mb-4 text-blue-600 dark:text-blue-400">
            {getPatternName(pattern)}
          </h3>

          {run ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    CSV読み込み
                  </p>
                  <p className="text-lg font-bold">{run.csvLoadMs}ms</p>
                </div>

                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    DB書き込み（生）
                  </p>
                  <p className="text-lg font-bold">{run.dbWriteRawMs}ms</p>
                </div>

                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    DB読み込み（生）
                  </p>
                  <p className="text-lg font-bold">{run.dbReadRawMs}ms</p>
                </div>

                <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    計算処理
                  </p>
                  <p className="text-lg font-bold">{run.computeMs}ms</p>
                </div>

                <div className="p-3 bg-pink-50 dark:bg-pink-900/20 rounded">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    DB書き込み（結果）
                  </p>
                  <p className="text-lg font-bold">{run.dbWriteResultMs}ms</p>
                </div>

                <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    DB読み込み（結果）
                  </p>
                  <p className="text-lg font-bold">{run.dbReadResultMs}ms</p>
                </div>

                <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    CSV出力
                  </p>
                  <p className="text-lg font-bold">{run.csvWriteMs}ms</p>
                </div>

                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded">
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    合計時間
                  </p>
                  <p className="text-lg font-bold text-red-600 dark:text-red-400">
                    {run.totalMs}ms
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">
                      出力行数:
                    </span>{" "}
                    <span className="font-semibold">{run.rowCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">
                      実行時刻:
                    </span>{" "}
                    <span className="font-semibold">
                      {new Date(run.finishedAt).toLocaleString("ja-JP")}
                    </span>
                  </div>
                </div>
                {run.note && (
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {run.note}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 italic">
              まだ実行されていません
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
