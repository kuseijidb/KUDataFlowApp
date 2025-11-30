# Implementation Plan (for Next.js + Prisma + Supabase)

本ファイルは、実装担当エージェント向けの詳細な指示書です。`DESIGN.md` のゴールを満たすための具体手順とチェックリストを記載します。

## 1. 環境・依存
- Next.js App Router + TypeScript 前提。必要パッケージ:
  - CSV処理: `csv-parse` or `papaparse`, 文字コード変換: `iconv-lite`.
  - DB: `@prisma/client`, `prisma`.
  - 計測: 標準 `performance.now()` で十分。必要なら `perf_hooks`.
- `.env` に Supabase 接続を設定（提示された `DATABASE_URL`, `DIRECT_URL`）。Git へコミットしないこと。

## 2. ディレクトリと責務
- `lib/csv/loader.ts`: 
  - `loadElectionCsv(path, electionNo)` で `Buffer` を CP932→UTF8 デコードし、ヘッダーと行を返す。
  - ヘッダーから政党列名を抽出（固定名ではなく、メタ列以外を動的抽出）。
  - 数値列は `parseInt`/`parseFloat` し、空文字は0。
- `lib/transform/common.ts`:
  - `computeTurnout(ballots, electorate)`, `computeRelative(votes, valid)`。
  - `normalizeRow(raw, electionNo)` で汎用的な型 `{ prefCode, prefName, jisCode, cityName, electorate, ballots, validVotes, parties: Record<string, number> }` に整形。
- `lib/transform/pattern1.ts|pattern2.ts|pattern3.ts`:
  - 返り値は `{ rows: Array<Record<string, string|number>>, header: string[] }`。
  - 入出力は共通の中間構造を受け取り、最終CSV互換の列順に揃える。
- `lib/output/writer.ts`:
  - `writeCsv({ header, rows, fileName })` を用意。`output/` へ保存（ローカル想定）。Vercel では `fs` 書込不可に備え、バッファ返却も可能にしておく。
- `lib/metrics/runner.ts`:
  - `runWithMetrics(patternId, fn)` で実行時間計測し、Prisma 経由で `MergeRun` に保存。`durationMs`, `rowCount`, `outputPath` を返す。

## 3. Prisma モデル
- `prisma/schema.prisma` に以下を定義し `npx prisma migrate dev`。
  - `Municipality`, `ElectionResult`, `MergeRun`（詳細は `DESIGN.md` 参照）。
  - `ElectionResult` の `party` は文字列、`relativeShare` は `Float`。
- 初期データ投入はマージ処理後の保存で自動生成する（別途シード不要）。

## 4. アルゴリズム詳細
- 共通: `normalizeRow` で原始CSVをフラット化し、`parties` キーに政党名→得票数を格納。政党列は「メタ列以外」の全列を採用。
- パターン1（選挙回ごとETL）:
  1. 13回・23回を別々に `normalizeRow`→`computeTurnout/Relative`。
  2. 各回で `parties` を列展開し `{party}_{election}` の列名で相対得票率を格納。
  3. 回ごとに `pref_code/pref_name/jis_code/city_name/turnout` を含む中間配列を作成。
  4. JIS をキーに2配列を JOIN して完成。
- パターン2（UNION→一括処理）:
  1. 13回・23回を `normalizeRow` で1配列に UNION（`election` フラグ付与）。
  2. 全行に対して投票率/相対得票率を計算。
  3. `pivot({jisCode, election, party})` で `party_election` 列を生成し、最後に JIS ごとに横持ちへ集約。
- パターン3（多段JOIN検証型）:
  1. 選挙回ごとに `T_Base`（メタ + turnout）と `T_Party`（`party`, `relativeShare`）を生成。
  2. `T_Base` と `T_Party` を JOIN し、回ごとの中間表を完成。
  3. 2回分の中間表を JIS JOIN して完成。
- どのパターンでも最終ヘッダー順は完成CSVに合わせる（ヘッダーは読取データから動的に並べ替え）。

## 5. API ルート
- `app/api/run/[pattern]/route.ts`（App Router）:
  - POST のみ許可。`pattern` は `1|2|3`。
  - 対応する `patternX` モジュールを呼び、`runWithMetrics` で計測。
  - レスポンス JSON: `{ pattern, durationMs, rowCount, outputPath, message }`。エラー時は `status 500` とエラーログ。

## 6. フロントエンド
- `app/page.tsx` に1画面を構成。
  - 縦3ボタン（`pattern1/2/3`）。実行中は disabled + ラベル変更。
  - 実行結果テーブル（最新数件）とステータス表示。
  - UI はプレーンでもよいが、ボタン/テーブルのコンポーネントは `components/RunCard.tsx` などに分離。

## 7. テスト
- `lib/csv/loader.test.ts`: ヘッダー抽出・数値化・Shift_JIS デコード。
- `lib/transform/common.test.ts`: 投票率・相対得票率計算の端数処理（小数点4桁丸めなど必要ならここで決定）。
- `lib/transform/pattern*.test.ts`: 簡易モックデータで出力列数とキー重複がないこと。
- E2E 簡易: `app/api/run/pattern1` に対して fetch し、`output/` が生成されることを確認（ローカルのみ）。

## 8. バリデーションと精度
- 小数点の丸め方は完成CSVを基準に `round(v, 4)` で揃える（差分が出た場合は「四捨五入」で調整）。
- 欠損値は0扱い。除算時の0割りは `0` とし、ログに警告を残す。
- 行数・JISユニーク件数を完成CSVと比較し、差分があれば API レスポンスに `note` を載せる。

## 9. ロギング
- 実行ログは `MergeRun` に保存。`note` にパーティー列一覧、ヘッダー長、検証結果（行数一致か）を記録。
- サーバーログには CSV ファイル名と所要時間のみを出力し、個票は記録しない。

## 10. デプロイ考慮
- Vercel では `output/` 書込が不可なため、`NODE_ENV === 'production'` では `Buffer` を生成して API レスポンスからダウンロードさせるモードを用意する。
- 接続は pgbouncer 用 `DATABASE_URL` を通常使用し、マイグレーション時のみ `DIRECT_URL`。

以上を満たせば、ボタン3つから各パターンを実行し、処理時間を表示・記録できる実装が行えます。
