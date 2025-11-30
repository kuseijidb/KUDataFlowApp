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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-blue-600 to-blue-700">
          <h2 className="text-2xl font-bold text-white">
            パターン {pattern}: {title}
          </h2>
          <button
            onClick={onClose}
            className="text-white hover:text-gray-200 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              SQL的なアルゴリズム説明
            </h3>
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <pre className="text-sm text-gray-800 whitespace-pre-wrap font-mono overflow-x-auto">
                {sqlExplanation}
              </pre>
            </div>
          </div>

          {/* 補足情報 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 mb-2">
              このパターンについて
            </h4>
            <p className="text-sm text-blue-800">
              {getPatternInfo(pattern)}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
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
      return "ETL分離型は、各選挙回を独立したパイプラインとして処理し、最後にJOINで統合します。SQLのCTE（Common Table Expression）を使った段階的な処理に相当します。保守性が高く、デバッグしやすいのが特徴です。";
    case 2:
      return "UNION一括処理型は、まず全データをUNION ALLで縦方向に結合し、その後一括で計算・集計を行います。コード記述量が最小で済みますが、中間テーブルが大きくなるため、メモリ使用量には注意が必要です。";
    case 3:
      return "多段JOIN検証型は、粒度別に中間ビュー（基礎テーブルと政党テーブル）を作成し、段階的にJOINで組み上げます。各ステップで結果を検証できるため、計算過程の正確性を厳しくチェックする必要がある場合に適しています。";
    default:
      return "";
  }
}
