"use client";

interface HelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  pattern: number;
  title: string;
  sqlExplanation: string;
}

export default function HelpDialog({
  isOpen,
  onClose,
  pattern,
  title,
  sqlExplanation,
}: HelpDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="relative flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-indigo-600 to-sky-500 px-6 py-4 text-white">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/80">
              Pattern {pattern}
            </p>
            <h2 className="text-2xl font-semibold">
              {title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-white/20 p-2 text-white transition hover:bg-white/30"
            aria-label="閉じる"
            type="button"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">SQLアルゴリズム説明</h3>
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <pre className="whitespace-pre-wrap text-sm text-slate-800">
                {sqlExplanation}
              </pre>
            </div>
          </div>

          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4">
            <h4 className="text-sm font-semibold text-blue-900">このパターンの狙い</h4>
            <p className="mt-2 text-sm text-blue-800">
              {getPatternInfo(pattern)}
            </p>
          </div>
        </div>

        <div className="border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl"
            type="button"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

function getPatternInfo(pattern: number): string {
  switch (pattern) {
    case 1:
      return "各選挙回を独立したパイプラインとして処理し、最後にJOINで統合するパターン。保守性が高く、段階ごとに検証しやすいのが強みです。";
    case 2:
      return "すべてのデータをUNION ALLで縦に積み、一括で集計と変換を行うパターン。コード量を減らし、単一のクエリで完結させるスピード重視のアプローチです。";
    case 3:
      return "中間ビューを粒度別に作成し、多段階でJOINを重ねて仕上げるパターン。各ステップで品質を確認しながら計算過程の透明性を高めたい場合に向いています。";
    default:
      return "";
  }
}
