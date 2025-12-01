# 計測方法まとめ

本アプリで保存しているメトリクス（タイミング・ストレージ・論理 I/O・メモリ）の定義と、各パターンでのカウント方法を整理します。

## 1. タイミング計測 (TimingSteps)

- `csvLoadMs` … CSV 読み込み（`loadElectionCsv`）にかかった時間。
- `dbWriteRawMs` … 生データを書き込む時間。
- `dbReadRawMs` … 生データを読み出す時間。
- `computeMs` … UNION/PIVOT/JOIN など計算処理にかかった時間。
- `dbWriteResultMs` … 計算結果を書き込む時間。
- `dbReadResultMs` … 計算結果を読み出す時間。
- `csvWriteMs` … 最終 CSV を書き出す時間。
- `totalMs` … 実行開始から終了までの合計時間。

計測器: `DetailedTimer.startStep()` / `endStep()` （`lib/metrics/detailedTracker.ts`）

## 2. ストレージ/論理 I/O/メモリ (StorageMetrics)

- `rawDataRows` … `RawElectionData` に保存した行数。
- `resultDataRows` … `ElectionResult` に保存した行数。
- `intermediateRows` … 中間生成物の行数合計（メモリ上も含む）。`recordIntermediateRows` で加算。
- `dbWriteOps` … アルゴリズム上の論理書き込み回数。実 DB I/O に加え、中間生成物を書き出したとみなした回数を `incrementWriteOps` で加算。
- `dbReadOps` … アルゴリズム上の論理読み込み回数。実 DB I/O に加え、中間生成物をスキャンしたとみなした回数を `incrementReadOps` で加算。
- `peakMemoryMB` … `recordMemoryUsage`（推定: 配列長 × バイト）と `recordProcessMemory`（実測: RSS）の大きい方を採用。

計測器: `DetailedTimer` （`lib/metrics/detailedTracker.ts`）

## 3. パターン別のカウントポイント

### Pattern 1 (ETL 型) — `lib/transform/pattern1-db.ts`

- 生データ書き込み: 実 DB write（`incrementWriteOps`）。`rawDataRows` 更新。
- 生データ読み込み: 実 DB read + 全行スキャンを論理 read に加算。
- 独立変換（13/23 回）: 変換結果行を論理 write に加算、中間スキャンを論理 read に加算。`intermediateRows` に変換行数を積算。
- JOIN: 結合結果行を論理 write に加算、出力前スキャンを論理 read に加算。`intermediateRows` に結合結果行を積算。
- 結果書き込み/読み込み: 実 DB I/O をカウント。最終出力前に論理 read 加算。
- メモリ: raw/processed/joined 結果を保持しつつ `recordMemoryUsage` と `recordProcessMemory` でピークを記録。

### Pattern 2 (UNION 一括処理) — `lib/transform/pattern2-db.ts`

- 生データ I/O: パターン 1 と同様。
- UNION ALL: 連結結果行を論理 write に加算。計算前スキャンを論理 read に加算。`intermediateRows` に UNION 行数を積算。
- 一括計算: 計算結果行を論理 write に加算、PIVOT 前スキャンを論理 read に加算。`intermediateRows` に計算行数を積算。
- PIVOT: 変換結果行を論理 write・論理 read に加算。`intermediateRows` に PIVOT 行数を積算。
- 結果 I/O: 実 DB I/O + 出力前スキャンを論理 read に加算。
- メモリ: UNION/計算/PIVOT 配列を保持しつつピーク記録。

### Pattern 3 (多段 JOIN 検証型) — `lib/transform/pattern3-db.ts`

- 生データ I/O: パターン 1 と同様。
- 13 回: `T_Base_13` / `T_Party_13` / `Intermediate_13` を生成。各行数を論理 write に、スキャンを論理 read に加算。`intermediateRows` へ行数を積算。
- 23 回: 同上 (`T_Base_23` / `T_Party_23` / `Intermediate_23`)。
- 最終 JOIN: 最終結果行を論理 write・論理 read に加算。`intermediateRows` へ行数積算。
- 結果 I/O: 実 DB I/O + 出力前スキャンを論理 read に加算。
- メモリ: 各中間配列を保持しつつピーク記録。

## 4. UI での表示

- `TimingSummary` は各パターンの最新 `TimingSteps` を表示。
- `StorageComparison` は `StorageMetrics` を表示し、I/O は「論理 I/O」としてラベル付け。

## 5. 差分が出る理由

- パターン 2 は UNION→ 計算 →PIVOT の一括処理で中間行数と論理 I/O が大きくなりやすい。
- パターン 3 は段階的に基礎/政党/中間テーブルを積むため、論理 I/O と中間行数がさらに大きくなりがち。
- パターン 1 は選挙回ごとに独立処理してから JOIN するため、中間保持が比較的少なく、論理 I/O も抑えめ。
