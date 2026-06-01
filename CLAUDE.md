# プロジェクト: 日本人メジャーリーガー成績ダッシュボード

## これは何か

MLBに在籍する日本人選手（投手・野手）の成績を、自分のPCのブラウザで一覧できる
ローカルWebダッシュボード。「最新試合」と「シーズン通算」を投手・野手に分けて表示する。
非エンジニアのユーザーがバイブコーディングで作った「1日1個アプリ」の1つ。

## 動かし方

- このフォルダで `python app.py` を実行 → 自動でブラウザが開く（`http://127.0.0.1:8000/`）。
- 画面右上「🔄 更新」でMLB公式から最新成績を取得。
- 終了は実行画面で `Ctrl + C`。
- 追加インストール不要（Python標準ライブラリのみで動く）。
- ポート競合時は環境変数 `PORT` で変更可（例: `PORT=8001`）。

## 構成

```
app.py            … Webサーバー（画面表示＋「更新」処理の裏方）
fetch_stats.py    … MLB公式APIから成績を取得・整形・保存する中核
config/name_map.json … 英語名→日本語名の対応表
data/latest.json  … 最新の表示用データ（自動生成）
data/history/     … 日付ごとのスナップショット（自動生成・蓄積）
web/index.html, style.css, app.js … 画面（骨組み・見た目・動き）
docs/             … 要件・設計・実装・運用ドキュメント
```

## データの取得元

- MLB公式 StatsAPI（`https://statsapi.mlb.com/api/v1`）。**無料・APIキー不要**。
- 日本人選手は `/sports/1/players?season=YYYY` の `birthCountry == "Japan"` で自動抽出。
- 成績は `/people/{id}/stats`（`stats=season` / `stats=gameLog`、`group=hitting|pitching`）。

## 重要な仕様・設計判断

- **対象選手は自動抽出**（固定リストは持たない）。移籍・昇格・引退に自動追従。
- **今シーズンの成績が無い選手は非表示**（例: 故障者リスト中）。成績が出れば自動表示。
- 大谷翔平は二刀流（position=`TWP`）なので投手・野手の**両方**に表示。
- ポジション判定: `P`=投手、`TWP`=二刀流、それ以外=野手。
- 「最新試合」は gameLog の最後の試合（厳密な「昨日」ではなく直近試合）。
- **ハイライトは、直近の試合日にプレーした選手を全員表示**（活躍した人には🔥）。
- 保存は**JSONファイル**（データ量が小さく単一ユーザーのため。将来DBへ差し替え可能）。
- シーズン年は米国時間基準で算出。

## 開発上の注意（このユーザー向け）

- ユーザーは非エンジニア。専門用語を避け、平易な言葉で説明する。
- 変更時は何を・なぜ変えたかを平易に説明し、さわったファイル一覧を示す。
- 判断に迷ったら自己判断せず `AskUserQuestion` で質問する。
- コード変更時は `docs/` 配下のドキュメントも更新する（[docs/claude-doc-rules.md](docs/claude-doc-rules.md) が索引）。
- 一時スクリプトは実行後に削除する。

## 今後の拡張アイデア（未実装）

- 毎朝の自動更新（スケジューラで `fetch_stats.fetch_and_save()` を定期実行）。
- 過去日（`data/history/`）を画面から振り返る機能。
- メール／チャットへの通知。
- 見た目のデザイン調整。

## 関連ドキュメント

- 要件: [docs/10-product/requirements.md](docs/10-product/requirements.md)
- 設計: [docs/20-design/](docs/20-design/)
- 実装メモ: [docs/30-technical/implementation.md](docs/30-technical/implementation.md)
- 使い方: [docs/40-operations/how-to-run.md](docs/40-operations/how-to-run.md)
