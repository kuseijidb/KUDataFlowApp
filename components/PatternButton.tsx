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
    <div className="border border-gray-300 rounded-lg p-6 bg-white shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            パターン {pattern}: {title}
          </h3>
          <p className="text-sm text-gray-600">{description}</p>
        </div>
        <button
          onClick={onShowHelp}
          className="ml-4 p-2 text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
          title="SQL説明を表示"
        >
          <svg
            className="w-6 h-6"
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
      <button
        onClick={handleExecute}
        disabled={disabled || isExecuting}
        className={`w-full py-3 px-6 rounded-lg font-semibold text-white transition-colors ${
          disabled || isExecuting
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
        }`}
      >
        {isExecuting ? "実行中..." : "実行"}
      </button>
    </div>
  );
}
