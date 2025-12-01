"use client";

import { useEffect, useMemo, useState } from "react";
import PatternButton from "@/components/PatternButton";
import HelpDialog from "@/components/HelpDialog";
import TimingSummary from "@/components/TimingSummary";
import StorageComparison from "@/components/StorageComparison";

interface RunHistory {
  id: number;
  pattern: number;
  durationMs: number;
  rowCount: number;
  outputPath: string;
  startedAt: string;
}

interface HelpState {
  isOpen: boolean;
  pattern: number;
  title: string;
  sqlExplanation: string;
}

export default function Home() {
  const [history, setHistory] = useState<RunHistory[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [helpState, setHelpState] = useState<HelpState>({
    isOpen: false,
    pattern: 1,
    title: "",
    sqlExplanation: "",
  });

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/history");
      const data = await res.json();
      if (data.success) {
        setHistory(data.runs);
      }
    } catch (error) {
      console.error("Failed to fetch history:", error);
    }
  };

  const executePattern = async (pattern: number) => {
    setIsExecuting(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/run/${pattern}`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.success) {
        setMessage({
          type: "success",
          text: `パターン${pattern}を実行しました（${data.durationMs}ms, ${data.rowCount}行）`,
        });
        fetchHistory();
      } else {
        setMessage({
          type: "error",
          text: `エラー: ${data.error}`,
        });
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: `実行エラー: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const showHelp = async (pattern: number, title: string) => {
    try {
      const res = await fetch(`/api/explain/${pattern}`);
      const data = await res.json();

      setHelpState({
        isOpen: true,
        pattern,
        title,
        sqlExplanation: data.sqlExplanation || "説明がありません",
      });
    } catch (error) {
      console.error("Failed to show help:", error);
      setHelpState({
        isOpen: true,
        pattern,
        title,
        sqlExplanation: "説明の取得に失敗しました",
      });
    }
  };

  const patterns = [
    {
      pattern: 1,
      title: "分割ETL + 統合JOIN",
      description: "選挙回ごとにETLし、最後にJOINで統合する堅実な設計。検証やデバッグがしやすい。",
    },
    {
      pattern: 2,
      title: "UNION一括処理",
      description: "すべてのデータをUNIONでまとめてから一括計算。実装量を抑えつつ一気に計算するスピード型。",
    },
    {
      pattern: 3,
      title: "多段JOIN検証型",
      description: "中間ビューを段階的に積み上げ、JOINで磨き上げるパターン。各段で品質をチェックしやすい。",
    },
  ];

  const latestRun = history[0];
  const averageDuration = useMemo(() => {
    if (history.length === 0) return null;
    const total = history.reduce((sum, run) => sum + run.durationMs, 0);
    return Math.round(total / history.length);
  }, [history]);

  const totalRows = useMemo(() => {
    if (history.length === 0) return null;
    return history.reduce((sum, run) => sum + run.rowCount, 0);
  }, [history]);

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-10 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-32 h-72 w-72 rounded-full bg-sky-200/60 blur-3xl" />
        <div className="absolute top-40 right-0 h-80 w-80 rounded-full bg-indigo-200/50 blur-3xl" />
        <div className="absolute bottom-10 left-20 h-72 w-72 rounded-full bg-emerald-200/50 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl space-y-10">
        <div className="grid items-stretch gap-6 lg:grid-cols-[1.4fr,1fr]">
          <div className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white/80 shadow-2xl backdrop-blur">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-white to-sky-50" />
            <div className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-sky-200/60 blur-3xl" />
            <div className="absolute -left-10 bottom-0 h-40 w-40 rounded-full bg-emerald-100/70 blur-2xl" />
            <div className="relative space-y-6 p-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-indigo-700">
                Election Data Merge Lab
              </div>
              <div className="space-y-3">
                <h1 className="text-4xl font-semibold text-slate-900 sm:text-5xl">
                  KU DataFlow App
                </h1>
                <p className="max-w-3xl text-lg text-slate-600">
                  選挙データを3つのSQLアルゴリズムで統合し、速度・I/O・メモリの観点でスマートに比較できます。データ処理のチューニングを遊ぶように試せるコントロールパネルです。
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard
                  label="実行回数"
                  value={history.length ? `${history.length} 回` : "—"}
                  hint="APIで保存された履歴の件数"
                />
                <MetricCard
                  label="最新の処理時間"
                  value={
                    latestRun ? `${latestRun.durationMs} ms` : "まだ実行されていません"
                  }
                  hint={latestRun ? new Date(latestRun.startedAt).toLocaleString("ja-JP") : "最初の実行をお試しください"}
                />
                <MetricCard
                  label="平均処理時間"
                  value={
                    averageDuration !== null
                      ? `${averageDuration} ms`
                      : "—"
                  }
                  hint={
                    totalRows !== null
                      ? `処理済み行数 ${totalRows.toLocaleString()} 行`
                      : "まだ統計はありません"
                  }
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="relative overflow-hidden rounded-3xl border border-slate-800/50 bg-slate-900 text-slate-50 shadow-2xl">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.25),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(56,189,248,0.22),transparent_30%)]" />
              <div className="relative p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-slate-200">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    Live Control
                  </div>
                  <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-slate-300">
                    SQL Patterns x3
                  </span>
                </div>
                <div className="space-y-2">
                  <p className="text-2xl font-semibold">データマージの実験場</p>
                  <p className="text-sm text-slate-300">
                    実行 → 計測 → 可視化を最短距離で回すためのダッシュボード。ストレージやI/Oのボトルネックを即座に把握できます。
                  </p>
                </div>
                <ul className="space-y-2 text-sm text-slate-200">
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-6 rounded-full bg-emerald-400" />
                    <span>タイミング・I/O・メモリをリアルタイムで更新</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-6 rounded-full bg-sky-400" />
                    <span>SQLロジックのヘルプはいつでもポップアップで確認</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-6 rounded-full bg-indigo-400" />
                    <span>複数パターンを並走させて最適解を素早く探索</span>
                  </li>
                </ul>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                  {isExecuting ? "処理中... 完了するまでお待ちください。" : "任意のパターンを選んで実行できます。"}
                </div>
              </div>
            </div>

            {message && (
              <div
                className={`relative overflow-hidden rounded-3xl border shadow-xl ${
                  message.type === "success"
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-rose-200 bg-rose-50"
                }`}
              >
                <div
                  className={`absolute inset-0 ${
                    message.type === "success"
                      ? "bg-gradient-to-r from-emerald-50 via-white to-emerald-50"
                      : "bg-gradient-to-r from-rose-50 via-white to-rose-50"
                  }`}
                />
                <div className="relative p-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full ${
                        message.type === "success"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {message.type === "success" ? "✓" : "!"}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {message.type === "success" ? "実行完了" : "エラー"}
                      </p>
                      <p className="text-sm text-slate-700">{message.text}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                SQL Patterns
              </p>
              <h2 className="text-2xl font-semibold text-slate-900">
                パターンを選んで実行する
              </h2>
              <p className="text-sm text-slate-600">
                アルゴリズムの違いをその場で比較。気になるパターンを実行してタイミングとI/Oをチェックしましょう。
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              {isExecuting
                ? "処理中... キューを監視しています"
                : "準備完了 — すぐに実行できます"}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {patterns.map((p) => (
              <PatternButton
                key={p.pattern}
                pattern={p.pattern}
                title={p.title}
                description={p.description}
                onExecute={() => executePattern(p.pattern)}
                onShowHelp={() => showHelp(p.pattern, p.title)}
                disabled={isExecuting}
              />
            ))}
          </div>
        </section>

        <div className="grid gap-8">
          <TimingSummary />
          <StorageComparison />
        </div>

        <div className="rounded-3xl border border-slate-200/80 bg-white/80 shadow-xl backdrop-blur">
          <div className="border-b border-slate-100 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  History
                </p>
                <h2 className="text-2xl font-semibold text-slate-900">実行履歴</h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                {history.length} runs
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    パターン
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    実行時間
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    行数
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    出力パス
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    実行日時
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {history.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-8 text-center text-slate-500"
                    >
                      まだ実行履歴がありません。パターンを実行して計測を始めましょう。
                    </td>
                  </tr>
                ) : (
                  history.map((run) => (
                    <tr
                      key={run.id}
                      className="transition-colors hover:bg-slate-50"
                    >
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-slate-900">
                        パターン {run.pattern}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                        {run.durationMs} ms
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                        {run.rowCount.toLocaleString()} 行
                      </td>
                      <td className="max-w-xs px-6 py-4 text-sm text-slate-600">
                        <span className="inline-flex max-w-full items-center gap-2 truncate rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          <span className="h-2 w-2 rounded-full bg-indigo-400" />
                          <span className="truncate">{run.outputPath}</span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-700">
                        {new Date(run.startedAt).toLocaleString("ja-JP")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <HelpDialog
        isOpen={helpState.isOpen}
        onClose={() => setHelpState({ ...helpState, isOpen: false })}
        pattern={helpState.pattern}
        title={helpState.title}
        sqlExplanation={helpState.sqlExplanation}
      />
    </main>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
