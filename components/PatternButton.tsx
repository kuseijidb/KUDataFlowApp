"use client";

import { useState } from "react";

interface PatternButtonProps {
  pattern: number;
  title: string;
  description: string;
  onExecute: () => Promise<void>;
  onShowHelp: () => void;
  disabled: boolean;
}

export default function PatternButton({
  pattern,
  title,
  description,
  onExecute,
  onShowHelp,
  disabled,
}: PatternButtonProps) {
  const [isExecuting, setIsExecuting] = useState(false);

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      await onExecute();
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/80 shadow-md backdrop-blur transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-white to-sky-50 opacity-80" />
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-sky-400 to-emerald-400" />
      <div className="relative flex flex-1 flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
                Pattern {pattern}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                SQL Flow
              </span>
            </div>
            <h3 className="text-xl font-semibold text-slate-900">{title}</h3>
            <p className="text-sm leading-relaxed text-slate-600">{description}</p>
          </div>
          <button
            type="button"
            onClick={onShowHelp}
            className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-full border border-slate-200 bg-white text-indigo-600 shadow-sm transition hover:-translate-y-[1px] hover:shadow-md"
            title="SQL説明を表示"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>
        </div>

        <div className="mt-auto flex items-center justify-between text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                disabled || isExecuting ? "bg-slate-400" : "bg-emerald-500"
              }`}
            />
            {disabled || isExecuting ? "実行中..." : "準備OK"}
          </div>
          <span className="text-[11px] text-slate-400">ヘルプでSQLロジックを確認</span>
        </div>

        <button
          type="button"
          onClick={handleExecute}
          disabled={disabled || isExecuting}
          className={`mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg transition-all duration-200 ${
            disabled || isExecuting
              ? "cursor-not-allowed bg-slate-400"
              : "bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500 hover:shadow-xl"
          }`}
        >
          {isExecuting ? "実行中..." : "このパターンで実行"}
        </button>
      </div>
    </div>
  );
}
