"use client";

import { useState, useEffect } from "react";
import PatternButton from "@/components/PatternButton";
import HelpDialog from "@/components/HelpDialog";
import TimingSummary from "@/components/TimingSummary";

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

  // 履歴の読み込み
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
          text: `パターン${pattern}が正常に実行されました（${data.durationMs}ms, ${data.rowCount}行）`,
        });
        fetchHistory(); // 履歴を更新
      } else {
        setMessage({
          type: "error",
          text: `エラー: ${data.error}`,
        });
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: `実行エラー: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const showHelp = async (pattern: number, title: string) => {
    try {
      // SQL説明のみを取得（実行はしない）
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
      title: "ETL分離型",
      description: "各選挙回を独立して処理し、最後にJOINで統合",
    },
    {
      pattern: 2,
      title: "UNION一括処理型",
      description: "全データを統合してから一括処理し、PIVOTで横展開",
    },
    {
      pattern: 3,
      title: "多段JOIN検証型",
      description: "粒度別の中間ビューを作成し、段階的にJOINで組み上げ",
    },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            KU DataFlow App
          </h1>
          <p className="text-gray-600">
            選挙データ統合システム - 3つのSQL的アルゴリズムパターンの比較
          </p>
        </div>

        {/* Message */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              message.type === "success"
                ? "bg-green-100 border border-green-300 text-green-800"
                : "bg-red-100 border border-red-300 text-red-800"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Pattern Buttons */}
        <div className="grid grid-cols-1 gap-6 mb-8">
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

        {/* Timing Summary - Always Visible */}
        <TimingSummary />

        {/* History Table */}
        <div className="bg-white rounded-lg shadow-md p-6 mt-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">実行履歴</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    パターン
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    実行時間
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    行数
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    出力パス
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    実行日時
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {history.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-4 text-center text-gray-500"
                    >
                      まだ実行履歴がありません
                    </td>
                  </tr>
                ) : (
                  history.map((run) => (
                    <tr key={run.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        パターン {run.pattern}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {run.durationMs} ms
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {run.rowCount} 行
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 truncate max-w-xs">
                        {run.outputPath}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
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

      {/* Help Dialog */}
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
