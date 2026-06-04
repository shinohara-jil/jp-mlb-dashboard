# プロジェクト: 日本人メジャーリーガー成績ダッシュボード

## これは何か

MLBに在籍する日本人選手（投手・野手）の成績を、自分のPCのブラウザで一覧できる
ローカルWebダッシュボード。「最新試合」と「シーズン通算」を投手・野手に分けて表示する。
非エンジニアのユーザーがバイブコーディングで作った「1日1個アプリ」の1つ。

## 公開と構成（重要）

- **静的サイトとして GitHub Pages で公開**している。リポジトリは**パブリック**。
- データ取得は**ブラウザ側(app.js)**で行う（MLB APIはCORS許可済み `Access-Control-Allow-Origin: *`）。裏方サーバーは不要。
- **毎朝 日本時間10時ごろ、GitHub Actions が `fetch_stats.py` を実行**して成績を取得し、
  `data/` をリポジトリにコミット（＝リポジトリ自体が履歴の保管庫。外部DB不要）。
- 画面は `data/latest.json` を読んで即表示。「🔄 更新」ボタンはブラウザが直接MLBからライブ取得。

## ローカルで動かす

- このフォルダで `python app.py` を実行 → ブラウザが開く（`http://127.0.0.1:8000/`）。
  これは公開版と同じ表示を手元で確認するための簡易静的サーバー。
- 追加インストール不要（Python標準ライブラリのみ）。ポート競合時は `PORT` 環境変数で変更可。

## 構成（GitHub Pages 用にサイトファイルはリポジトリ直下）

```
index.html, style.css, app.js … 画面（app.js がブラウザ側でデータ取得・表示）
fetch_stats.py    … MLB公式APIから成績を取得・整形・保存（自動更新で使用）
config/name_map.json … 英語名→日本語名の対応表
data/latest.json  … 最新の表示用データ
data/history/     … 日付ごとのスナップショット（蓄積）
app.py            … ローカル確認用の簡易静的サーバー
.github/workflows/update.yml … 毎朝の自動更新（GitHub Actions）
docs/             … 要件・設計・実装・運用ドキュメント
```

## パス・公開の注意

- GitHub Pages はURLに階層が付く（`https://<user>.github.io/<repo>/`）ため、
  HTML内の参照は**相対パス**（`style.css` / `app.js` / `data/latest.json`）にすること。先頭スラッシュ禁止。
- サイトファイルはリポジトリ**直下**に置く（Pagesは `main` ブランチのルートを配信）。`docs/` は別用途なので使わない。
- **キャッシュ対策**：`index.html` は `app.js?v=日付` / `style.css?v=日付` の形でバージョン印を付けている。
  **`app.js` または `style.css` を更新したら、`index.html` の `?v=` の日付も必ず更新する**こと（古いファイルがブラウザに残って反映されない事故を防ぐ）。

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
