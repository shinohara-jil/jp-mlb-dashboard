# ⚾ 日本人メジャーリーガー成績ダッシュボード

MLBに在籍する日本人選手（投手・野手）の成績を一覧できるWebダッシュボードです。
「最新試合」と「シーズン通算」を投手・野手に分けて表示します。

## 特徴

- 🇯🇵 MLBの日本人選手を**自動で全員表示**（移籍・昇格・引退に自動追従）
- ⚾ 投手・野手で見やすく分けて表示（大谷翔平は二刀流で両方に登場）
- 🔄 「更新」ボタンで、その場でブラウザが直接最新成績を取得
- 🤖 毎朝（日本時間10時ごろ）自動で成績を取得し、リポジトリに蓄積
- 💰 完全無料（GitHub Pages ＋ GitHub Actions）

## データの取得元

- [MLB公式 StatsAPI](https://statsapi.mlb.com/)（無料・APIキー不要）

## 仕組み

```
GitHub Actions（毎朝）→ fetch_stats.py が成績を取得 → data/ に保存（コミット）
                                                         ↓
GitHub Pages がサイトを公開 ← index.html / app.js が data/latest.json を表示
```

- 日付ごとのスナップショットは `data/history/` に溜まっていきます。

## ローカルで動かすには

```
python app.py
```

ブラウザで `http://127.0.0.1:8000/` が開きます（追加インストール不要）。

## ファイル構成

| ファイル | 役割 |
|----------|------|
| `index.html` / `style.css` / `app.js` | 画面（ブラウザ側でデータ取得・表示） |
| `fetch_stats.py` | 成績を取得・保存（自動更新で使用） |
| `config/name_map.json` | 英語名→日本語名の対応表 |
| `data/latest.json` / `data/history/` | 取得したデータ |
| `app.py` | ローカル確認用の簡易サーバー |
| `.github/workflows/update.yml` | 毎朝の自動更新設定 |
| `docs/` | 要件・設計・実装ドキュメント |
