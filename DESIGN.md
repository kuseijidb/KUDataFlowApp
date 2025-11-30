# KUDataFlowApp 設計メモ

このドキュメントは、人間（レビューア・開発者）が要求を一読して全体像を掴めるようにするための設計メモです。実装フェーズの詳細手順は `CLAUDE.md` に委ね、ここでは要件とアーキテクチャの全体像を示します。

## ゴール

- 兵庫県の第13回・第23回参院選比例区（政党別）正規化CSV（`data/csv/hirei_13_hyogo_seiki.csv` と `data/csv/hirei_23_hyogo_seiki.csv`）を JIS 市区町村コードで結合し、`data/csv/hirei_13.23_hyogo.csv` と同じ内容を出力するロジックを Next.js アプリに実装する。
- README で提示された3つの統合パターンを実行し、それぞれの処理時間（実行後の実測値）を計測・表示する。
- 出力は `output/` 配下に生成し、計測結果は画面とDBに記録する（Prisma + Supabase、Vercel デプロイ前提）。

## スタックと前提

- Next.js App Router（TypeScript）。UIは1画面・ボタン3つを縦並び。
- CSV は Shift_JIS/CP932 の可能性が高いため、`iconv-lite` などで UTF-8 にデコードして扱う。
- Prisma で Supabase(PostgreSQL) に接続。接続文字列は `.env` 経由で以下を使う：  
  - `DATABASE_URL="postgresql://postgres.qietjyododaswutgdpou:KUSeijiDB2025@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"`  
  - `DIRECT_URL="postgresql://postgres.qietjyododaswutgdpou:KUSeijiDB2025@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"`
- 出力先：`output/hirei_13.23_hyogo_pattern{1,2,3}.csv`
- 計算式
  - 投票率 = 投票者数 / 有権者数
  - 相対得票率 = 政党得票数 / 有効投票数

## 入出力データのイメージ

- ソース（13・23回）共通カラム例  
  `pref_code, pref_name, jis_code, city_name, electorate, ballots, valid_votes, ...政党別得票..., 備考`
- 出力（完成形）は 13回・23回の値を横持ち（JISコードキー）で並べ、投票率・政党別相対得票率を列展開したCSV。
- 想定パーティーカラムは完成データから推定（例：自民・立民・公明・共産・維新 など）。実装時にヘッダーを動的抽出し、全政党分をそのまま相対得票率計算へ回す。

## 三つの統合パターン（実装で計測するアルゴリズム）

1) **パターン1: ETL分離型（選挙回ごとに完結させて最後に結合）**  
   - 13回と23回をそれぞれ「整形→ピボット（政党列展開）→派生指標計算」まで行い、中間テーブルを作成。最後に JIS で JOIN。
   - 特徴: ロジック独立性が高く、並列処理で短縮可。コード重複はやや多め。

2) **パターン2: 一括処理型（縦持ち統合→まとめて計算→最終横持ち）**  
   - 2つのソースを UNION ALL し、選挙回フラグを付与。共通計算（投票率・相対得票率）を一括で行い、選挙回×政党でピボット後に横展開。
   - 特徴: 記述量は最小。中間テーブルが大きく、メモリ圧は高め。

3) **パターン3: 多段JOIN・ビュー検証型（基礎テーブル＋政党テーブルを段階結合）**  
   - 粒度別に中間ビューを用意（T_Base: JIS×市区町村メタ＋投票率、T_Party: JIS×政党相対得票率）。選挙回ごとに T_Base と T_Party をJOINして中間集計を作り、最後に両選挙回を JIS でJOIN。
   - 特徴: 検証容易。JOIN 多めでコードは冗長。

## アーキテクチャ概要

- **層構成**
  - `lib/csv/loader.ts`: ファイル読込（CP932→UTF8変換、ヘッダー抽出、数値正規化）。
  - `lib/transform/common.ts`: 投票率・相対得票率計算、政党列一覧抽出。
  - `lib/transform/pattern{1,2,3}.ts`: 各パターンの具体ロジック。
  - `lib/output/writer.ts`: `output/` へのCSV書き出し＋Supabase保存（オプション）。
  - `lib/metrics/runner.ts`: 処理時間計測（`performance.now()`）と Prisma 経由の run-log 保存。
  - Prisma models: Municipality, ElectionResult (per election, per party), MergeRun (実行ログ)。
- **API / サーバーアクション**
  - `/api/run/pattern1|2|3`: POST で実行。レスポンスに `durationMs`, `outputPath`, `rowCount`, `note` を返す。
  - 共通で `lib/metrics/runner` を呼び、ログを Supabase に保存。フロントは結果をテーブル表示。
- **UI (1画面)**
  - 縦並びボタン: 「パターン1 実行」「パターン2 実行」「パターン3 実行」。
  - 直近の計測結果リスト（パターン別に最新1件＋履歴数件）。
  - ステータス表示: 実行中スピナー、成功/失敗トースト。必要なら出力ファイルパスのコピーリンク。

## Prisma モデル草案

```prisma
model Municipality {
  id        Int    @id @default(autoincrement())
  jisCode   String @unique
  prefCode  String
  cityName  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  results   ElectionResult[]
}

model ElectionResult {
  id            Int    @id @default(autoincrement())
  municipality  Municipality @relation(fields: [municipalityId], references: [id])
  municipalityId Int
  electionNo    Int   // 13 or 23
  electorate    Int
  ballots       Int
  validVotes    Int
  turnout       Float
  party         String
  votes         Int
  relativeShare Float
  createdAt     DateTime @default(now())
}

model MergeRun {
  id          Int      @id @default(autoincrement())
  pattern     Int      // 1, 2, or 3
  durationMs  Int
  rowCount    Int
  outputPath  String
  startedAt   DateTime @default(now())
  finishedAt  DateTime @default(now())
  note        String?
}
```

## 処理フロー（共通部）

1. `loader` で CSV を読み込み、ヘッダー行から政党列を動的取得。数値は `Number()`、欠損は0で埋める。
2. 選挙回を示すメタデータ（`electionNo`）を付与したオブジェクト配列に変換。
3. パターン別ロジックで整形・結合。
4. 最終CSVを `output/` に書き出し。完成データと行数・カラム数を比較（検証用）。
5. 計測時間とメタ情報を DB に保存し、フロントに返却。

## 計測方法

- サーバー側で `performance.now()` の差分を取得し `durationMs` として返す。
- Prisma を経由して Supabase の `MergeRun` テーブルに保存。
- オプションで Node の `process.hrtime.bigint()` も併用し、高分解能計測を実験的に保持。

## UI 仕様（最小）

- レイアウト: 縦並びボタン（パターン1〜3）。右側/下部に実行結果テーブル。
- 各ボタン押下で `fetch("/api/run/patternX", {method: "POST"})`。進行中はボタン disabled、ラベルを「実行中…」に。
- 結果表示: `pattern`, `durationMs`, `rows`, `outputPath`, `timestamp`。失敗時はエラーメッセージ。

## テスト方針

- ユニット: CSVパーサー（ヘッダー抽出・数値変換）、投票率/相対得票率計算。
- スナップショット: 出力CSVのヘッダー順と件数。
- 簡易エンドツーエンド: `/api/run/pattern1` を叩き、`output/` にファイルが生成されることを確認。

## 非機能・注意点

- 文字コード: Shift_JIS → UTF-8 を必ず明示。空行・BOM を許容するパーサー設定を使う。
- 秘匿情報: 接続文字列は `.env` にのみ配置。コード・ログへ直書きしない。
- 並列実行: 同時押下時はキュー制御（実行中パターンは再度押せないようにする）か、`MergeRun` にステータスを持たせて排他する。
- デプロイ: Vercel では `output/` はビルド成果物として読み取りのみになるため、ローカル検証用とし、クラウドでは Supabase に書き出した結果を返す設計も用意する。

## 今後の実装順

1. Prisma schema 定義とマイグレーション（ローカル→Supabase）。  
2. CSV ローダーと共通計算ユーティリティ。  
3. 3パターンの変換ロジック（ユニットテスト含む）。  
4. API ルート + 計測ロガー。  
5. UI でボタン/結果表示 + スタイル。  
6. 本番想定の Supabase 接続確認、デプロイ調整。
