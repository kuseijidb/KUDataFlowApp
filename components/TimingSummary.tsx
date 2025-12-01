"use client";

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
    const interval = setInterval(fetchTimings, 10000);
    return () => clearInterval(interval);
  }, []);

  const getPatternName = (pattern: number) => {
    switch (pattern) {
      case 1:
        return "パターン1: 分割ETL + 統合JOIN";
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
      <div className="rounded-3xl border border-slate-200/80 bg-white/70 p-6 shadow-sm backdrop-blur">
        <p className="text-center text-slate-600">タイミングデータを読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white/80 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Performance
          </p>
          <h2 className="text-2xl font-semibold text-slate-900">実行タイミング</h2>
          <p className="text-sm text-slate-600">
            各パターンの最新実行時間を段階ごとにチェックできます（10秒毎に自動更新）。
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          Live 10s refresh
        </span>
      </div>

      <div className="space-y-4 p-6">
        {timingData.map(({ pattern, run }) => (
          <div
            key={pattern}
            className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 rounded-full bg-emerald-500" />
                <p className="text-lg font-semibold text-slate-900">
                  {getPatternName(pattern)}
                </p>
              </div>
              {run ? (
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  最終更新 {new Date(run.finishedAt).toLocaleString("ja-JP")}
                </span>
              ) : null}
            </div>

            {run ? (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <TimingStat label="CSV読み込み" value={`${run.csvLoadMs} ms`} tone="sky" />
                  <TimingStat
                    label="DB書き込み（生データ）"
                    value={`${run.dbWriteRawMs} ms`}
                    tone="emerald"
                  />
                  <TimingStat
                    label="DB読み込み（生データ）"
                    value={`${run.dbReadRawMs} ms`}
                    tone="amber"
                  />
                  <TimingStat label="計算フェーズ" value={`${run.computeMs} ms`} tone="violet" />
                  <TimingStat
                    label="DB書き込み（結果）"
                    value={`${run.dbWriteResultMs} ms`}
                    tone="pink"
                  />
                  <TimingStat
                    label="DB読み込み（結果）"
                    value={`${run.dbReadResultMs} ms`}
                    tone="indigo"
                  />
                  <TimingStat label="CSV出力" value={`${run.csvWriteMs} ms`} tone="orange" />
                  <TimingStat
                    label="合計時間"
                    value={`${run.totalMs} ms`}
                    tone="rose"
                    highlight
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                  <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                    <span className="h-2 w-2 rounded-full bg-indigo-400" />
                    出力行数: {run.rowCount.toLocaleString()} 行
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    合計時間: {run.totalMs} ms
                  </span>
                </div>
                {run.note && (
                  <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    {run.note}
                  </div>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-500">まだ実行されていません。</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type Tone =
  | "sky"
  | "emerald"
  | "amber"
  | "violet"
  | "pink"
  | "indigo"
  | "orange"
  | "rose";

function TimingStat({
  label,
  value,
  tone,
  highlight,
}: {
  label: string;
  value: string;
  tone: Tone;
  highlight?: boolean;
}) {
  const toneMap: Record<Tone, string> = {
    sky: "bg-sky-50 text-sky-800",
    emerald: "bg-emerald-50 text-emerald-800",
    amber: "bg-amber-50 text-amber-800",
    violet: "bg-violet-50 text-violet-800",
    pink: "bg-pink-50 text-pink-800",
    indigo: "bg-indigo-50 text-indigo-800",
    orange: "bg-orange-50 text-orange-800",
    rose: "bg-rose-50 text-rose-800",
  };

  return (
    <div
      className={`rounded-xl border border-slate-100 px-4 py-3 ${toneMap[tone]} ${
        highlight ? "shadow-sm ring-1 ring-rose-200/80" : ""
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">
        {label}
      </p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
