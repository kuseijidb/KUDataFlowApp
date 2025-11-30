# KUDataFlowApp - プロジェクトサマリー

## 実装完了内容

### ✅ 完成した機能

1. **データベース（Prisma + Supabase PostgreSQL）**
   - Municipality モデル: JISコードをキーとする自治体マスタ
   - ElectionResult モデル: 選挙結果データ（市区町村 × 選挙回 × 政党）
   - MergeRun モデル: 実行ログとパフォーマンス計測

2. **CSVローダー（`lib/csv/loader.ts`）**
   - Shift_JIS (CP932) エンコーディング対応
   - 動的な政党列抽出
   - 数値変換と欠損値処理

3. **3つのデータ統合パターン**
   - **パターン1: ETL分離型** (`lib/transform/pattern1.ts`)
     - 各選挙回を独立して処理し、最後にJOIN
     - 疎結合で保守性が高い

   - **パターン2: UNION一括処理型** (`lib/transform/pattern2.ts`)
     - UNION ALLで統合後、一括計算・PIVOT
     - コード記述量が最小

   - **パターン3: 多段JOIN検証型** (`lib/transform/pattern3.ts`)
     - 粒度別の中間ビューを段階的にJOIN
     - 検証性が最高

4. **API エンドポイント**
   - `POST /api/run/1` - パターン1実行
   - `POST /api/run/2` - パターン2実行
   - `POST /api/run/3` - パターン3実行
   - `GET /api/explain/[pattern]` - SQL説明取得（実行なし）
   - `GET /api/history` - 実行履歴取得

5. **UIコンポーネント**
   - メインページ: 3つのパターンボタンと実行履歴テーブル
   - PatternButton: 実行ボタンとヘルプアイコン
   - HelpDialog: SQL的なロジック説明を表示するモーダル
   - レスポンシブデザイン（Tailwind CSS）

6. **パフォーマンス計測**
   - `performance.now()` による高精度計測
   - データベースへの自動ログ保存
   - 実行時間、行数、出力パスの記録

## ディレクトリ構造

```
KUDataFlowApp/
├── app/
│   ├── api/
│   │   ├── run/
│   │   │   ├── 1/route.ts        # パターン1実行
│   │   │   ├── 2/route.ts        # パターン2実行
│   │   │   └── 3/route.ts        # パターン3実行
│   │   ├── explain/
│   │   │   └── [pattern]/route.ts # SQL説明取得
│   │   └── history/route.ts      # 実行履歴
│   ├── layout.tsx
│   ├── page.tsx                  # メインUI
│   └── globals.css
├── components/
│   ├── PatternButton.tsx         # パターン実行ボタン
│   └── HelpDialog.tsx            # SQL説明ダイアログ
├── lib/
│   ├── csv/
│   │   └── loader.ts             # CSV読み込み
│   ├── transform/
│   │   ├── common.ts             # 共通ユーティリティ
│   │   ├── pattern1.ts           # ETL分離型
│   │   ├── pattern2.ts           # UNION一括処理型
│   │   └── pattern3.ts           # 多段JOIN検証型
│   ├── output/
│   │   └── writer.ts             # CSV出力
│   ├── metrics/
│   │   └── runner.ts             # パフォーマンス計測
│   └── prisma.ts                 # Prisma Client
├── prisma/
│   └── schema.prisma             # データベーススキーマ
├── data/
│   └── csv/
│       ├── hirei_13_hyogo_seiki.csv   # 13回データ（配置が必要）
│       └── hirei_23_hyogo_seiki.csv   # 23回データ（配置が必要）
├── output/                       # 生成CSV出力先
├── .env                          # 環境変数
├── CLAUDE.md                     # Claude Code向け指示書
├── DESIGN.md                     # 設計ドキュメント
└── IMPLEMENTATION.md             # 実装計画書
```

## 使用方法

### 1. セットアップ

```bash
# 依存関係インストール
npm install

# Prismaマイグレーション
npx prisma migrate dev
npx prisma generate
```

### 2. データ配置

`data/csv/` ディレクトリに以下のファイルを配置してください:
- `hirei_13_hyogo_seiki.csv`
- `hirei_23_hyogo_seiki.csv`

### 3. 開発サーバー起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開く

### 4. パターン実行

1. 各パターンボタンの右側にある「?」アイコンをクリックして、SQL的なロジックを確認
2. 「実行」ボタンをクリックしてデータ統合を実行
3. 実行履歴テーブルで処理時間や結果を確認

## SQL的な特徴

### パターン1: ETL分離型
- **SQL概念**: CTE (Common Table Expression) を使った段階的処理
- **キー操作**: SELECT ... GROUP BY → INNER JOIN
- **特徴**: 疎結合、並列処理可能、デバッグしやすい

### パターン2: UNION一括処理型
- **SQL概念**: UNION ALL → 一括計算 → PIVOT
- **キー操作**: UNION ALL → GROUP BY → CASE WHEN (PIVOT)
- **特徴**: コード最小、計算ロジック一元化、メモリ使用量多

### パターン3: 多段JOIN検証型
- **SQL概念**: 粒度別ビュー作成 → 段階的JOIN
- **キー操作**: 基礎テーブル JOIN 政党テーブル → 最終JOIN
- **特徴**: 検証性最高、中間結果確認可能、記述冗長

## 技術スタック

- **フレームワーク**: Next.js 16 (App Router)
- **言語**: TypeScript
- **データベース**: Supabase PostgreSQL
- **ORM**: Prisma 7
- **スタイリング**: Tailwind CSS
- **CSV処理**: csv-parse, papaparse, iconv-lite
- **デプロイ**: Vercel対応

## 注意事項

1. `.env` ファイルは絶対にコミットしないこと
2. Vercel本番環境では `output/` への書き込み不可（Bufferで対応）
3. データベース接続は pgbouncer 経由（`DATABASE_URL`）
4. マイグレーションは直接接続（`DIRECT_URL`）

## 今後の拡張案

- [ ] パターン間の性能比較グラフ
- [ ] CSV出力のダウンロード機能
- [ ] 他の都道府県データへの対応
- [ ] テストコード追加
- [ ] エラーハンドリング強化
