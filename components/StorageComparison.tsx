"use client";

import { useEffect, useState } from "react";

interface StorageMetrics {
  rawDataRows: number;
  resultDataRows: number;
  intermediateRows: number;
  dbWriteOps: number;
  dbReadOps: number;
  peakMemoryMB: number;
}

interface MergeRun {
  id: number;
  pattern: number;
  totalMs: number;
  rawDataRows: number;
  resultDataRows: number;
  intermediateRows: number;
  dbWriteOps: number;
  dbReadOps: number;
  peakMemoryMB: number;
  note: string | null;
}

interface PatternRun {
  pattern: number;
  run: MergeRun | null;
}

export default function StorageComparison() {
  const [storageData, setStorageData] = useState<PatternRun[]>([
    { pattern: 1, run: null },
    { pattern: 2, run: null },
    { pattern: 3, run: null },
  ]);
  const [loading, setLoading] = useState(true);

  const fetchStorageData = async () => {
    try {
      const response = await fetch("/api/timings");
      const result = await response.json();

      if (result.success) {
        setStorageData(result.data);
      }
    } catch (error) {
      console.error("Failed to fetch storage data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStorageData();
    const interval = setInterval(fetchStorageData, 10000);
    return () => clearInterval(interval);
  }, []);

  const getPatternName = (pattern: number) => {
    switch (pattern) {
      case 1:
        return "分割ETL + 統合JOIN";
      case 2:
        return "UNION一括処理";
      case 3:
        return "多段JOIN検証型";
      default:
        return `パターン${pattern}`;
    }
  };

  const getPatternColor = (pattern: number) => {
    switch (pattern) {
      case 1:
        return "from-indigo-500 to-indigo-400";
      case 2:
        return "from-emerald-500 to-emerald-400";
      case 3:
        return "from-sky-500 to-sky-400";
      default:
        return "from-slate-500 to-slate-400";
    }
  };

  const getMaxValue = (key: keyof StorageMetrics) => {
    const values = storageData
      .filter((d) => d.run !== null)
      .map((d) => (d.run as MergeRun)[key as keyof MergeRun] as number);
    return values.length > 0 ? Math.max(...values) : 0;
  };

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200/80 bg-white/70 p-6 shadow-sm backdrop-blur">
        <p className="text-center text-slate-600">ストレージ/I/Oデータを読み込み中...</p>
      </div>
    );
  }

  const hasData = storageData.some((d) => d.run !== null);

  if (!hasData) {
    return (
      <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-6 text-slate-700 shadow-md backdrop-blur">
        <h2 className="text-2xl font-semibold text-slate-900">ストレージ & I/O 比較</h2>
        <p className="mt-2 text-sm">
          パターンを実行すると、ストレージ使用量・I/O回数・メモリピークをここで比較できます。
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white/80 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Storage & Logical I/O
          </p>
          <h2 className="text-2xl font-semibold text-slate-900">ストレージ・論理I/O比較</h2>
          <p className="text-sm text-slate-600">
            中間生成行数・論理I/O回数（アルゴリズム上の読み書きパス数）・推定ピークメモリを揃えた値です。
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          Live 10s refresh
        </span>
      </div>

      <div className="space-y-8 p-6">
        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-900">中間生成行数（処理途中の一時データ）</h3>
          <div className="space-y-3">
            {storageData.map(({ pattern, run }) => {
              if (!run) return null;
              const maxRows = getMaxValue("intermediateRows");
              const percentage = maxRows > 0 ? (run.intermediateRows / maxRows) * 100 : 0;

              return (
                <div key={pattern}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-slate-800">{getPatternName(pattern)}</span>
                    <span className="font-bold text-slate-900">
                      {run.intermediateRows.toLocaleString()} 行
                    </span>
                  </div>
                  <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-3 rounded-full bg-gradient-to-r ${getPatternColor(pattern)} transition-all duration-500`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-slate-900">論理書き込み回数（累計）</h3>
            <div className="space-y-2">
              {storageData.map(({ pattern, run }) => {
                if (!run) return null;
                const maxWrites = getMaxValue("dbWriteOps");
                const percentage = maxWrites > 0 ? (run.dbWriteOps / maxWrites) * 100 : 0;

                return (
                  <div key={pattern} className="flex items-center gap-3">
                    <span className="w-28 text-xs font-semibold text-slate-600">
                      {getPatternName(pattern)}
                    </span>
                    <div className="flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-3 bg-gradient-to-r ${getPatternColor(pattern)} transition-all duration-500`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <span className="w-16 text-right text-sm font-semibold text-slate-900">
                      {run.dbWriteOps}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-slate-900">論理読み込み回数（累計）</h3>
            <div className="space-y-2">
              {storageData.map(({ pattern, run }) => {
                if (!run) return null;
                const maxReads = getMaxValue("dbReadOps");
                const percentage = maxReads > 0 ? (run.dbReadOps / maxReads) * 100 : 0;

                return (
                  <div key={pattern} className="flex items-center gap-3">
                    <span className="w-28 text-xs font-semibold text-slate-600">
                      {getPatternName(pattern)}
                    </span>
                    <div className="flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-3 bg-gradient-to-r ${getPatternColor(pattern)} transition-all duration-500`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <span className="w-16 text-right text-sm font-semibold text-slate-900">
                      {run.dbReadOps}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-900">ピークメモリ使用量（推定）</h3>
          <div className="space-y-3">
            {storageData.map(({ pattern, run }) => {
              if (!run) return null;
              const maxMemory = getMaxValue("peakMemoryMB");
              const percentage = maxMemory > 0 ? (run.peakMemoryMB / maxMemory) * 100 : 0;

              return (
                <div key={pattern}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-slate-800">{getPatternName(pattern)}</span>
                    <span className="font-bold text-slate-900">
                      {run.peakMemoryMB.toFixed(2)} MB
                    </span>
                  </div>
                  <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-3 rounded-full bg-gradient-to-r ${getPatternColor(pattern)} transition-all duration-500`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-900">DBテーブル行数（Raw / Result）</h3>
          <div className="grid gap-4 md:grid-cols-3">
            {storageData.map(({ pattern, run }) => {
              if (!run) return null;

              return (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4" key={pattern}>
                  <p className="text-sm font-semibold text-slate-800">{getPatternName(pattern)}</p>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between text-slate-600">
                      <span>RawElectionData</span>
                      <span className="font-semibold text-slate-900">
                        {run.rawDataRows.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>ElectionResult</span>
                      <span className="font-semibold text-slate-900">
                        {run.resultDataRows.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-2 text-slate-700">
                      <span className="font-semibold">合計</span>
                      <span className="font-bold text-indigo-600">
                        {(run.rawDataRows + run.resultDataRows).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm text-blue-800">
          <div className="flex items-center gap-2 text-blue-900">
            <span className="text-lg">📊</span>
            <p className="font-semibold">評価ポイント（計測ロジック準拠）</p>
          </div>
          <ul className="mt-2 space-y-1 leading-relaxed">
            <li>
              <strong>中間生成行数</strong>: `recordIntermediateRows`で積算した一時データの総行数。大きいほどメモリ圧と中間I/Oが増えます。
            </li>
            <li>
              <strong>論理I/O回数</strong>: `incrementWriteOps` / `incrementReadOps`で数えた、アルゴリズム上の読み書きパス回数（実DB I/Oではなく理論値）。
            </li>
            <li>
              <strong>ピークメモリ</strong>: `recordMemoryUsage` / `recordProcessMemory`で算出した推定・実測ピーク。大規模データ耐性の指標になります。
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
