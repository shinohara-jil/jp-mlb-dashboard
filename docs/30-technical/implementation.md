# 実装メモ（技術詳細）

## 構成

- 言語：Python（標準ライブラリのみ）＋ HTML / CSS / JavaScript
- 外部ライブラリ：なし（`urllib`・`http.server` など標準機能だけで実装）

## ファイル構成

```
260601/
├── app.py              # Webサーバー（画面表示＋「更新」処理の裏方）
├── fetch_stats.py      # MLB公式APIから成績を取得・整形・保存する中核
├── config/
│   └── name_map.json   # 英語名→日本語名の対応表
├── data/
│   ├── latest.json     # 最新の表示用データ（自動生成）
│   └── history/        # 日付ごとのスナップショット（自動生成）
├── web/
│   ├── index.html      # 画面の骨組み
│   ├── style.css       # 見た目
│   └── app.js          # 画面の動き（データ描画・更新ボタン）
└── docs/               # ドキュメント
```

## データの流れ

1. `app.py` がローカルWebサーバーを起動（`http://127.0.0.1:8000/`）。
2. ブラウザが `web/` の画面を表示し、`/api/data` で保存済みデータを読む。
3. 「更新」ボタン → `/api/update`（POST）→ `fetch_stats.fetch_and_save()` を実行。
4. `fetch_stats.py` の処理：
   - `/sports/1/players?season=YYYY` で在籍選手を取得し、`birthCountry == "Japan"` で日本人選手を抽出。
   - `/teams?sportId=1&season=YYYY` でチームID→略称の対応表を作成。
   - 各選手について `/people/{id}/stats?stats=season&group=hitting|pitching` で通算成績、
     `stats=gameLog` で最新試合を取得。
   - ポジションで投手/野手/二刀流を判定（`P`=投手、`TWP`=二刀流、それ以外=野手）。
   - 今季成績がまったく無い選手は除外（非表示）。
   - `data/latest.json` と `data/history/日付.json` に保存。

## 主なAPIエンドポイント（MLB公式 StatsAPI / 無料・キー不要）

- ベースURL：`https://statsapi.mlb.com/api/v1`
- `/sports/1/players?season=YYYY` … 在籍選手一覧（`birthCountry` 含む）
- `/teams?sportId=1&season=YYYY` … チーム一覧（略称）
- `/people/{id}/stats?stats=season&group=hitting|pitching&season=YYYY` … シーズン通算
- `/people/{id}/stats?stats=gameLog&group=hitting|pitching&season=YYYY` … 試合ごと

## 設計上の判断メモ

- **保存はJSONファイル**：データ量が小さく単一ユーザーのため、DBは使わずJSONで蓄積。
  保存処理は分離してあるので、将来DBへ差し替え可能。
- **追加インストール不要**：非エンジニアのPCで確実に動くよう、標準ライブラリのみで構成。
- **シーズン年は米国時間基準**で算出（`current_season()`）。
- **「最新試合」は gameLog の最後の試合**を表示（厳密な「昨日」ではなく直近試合。休養日にも強い）。

## 今後の拡張余地

- 毎朝の自動更新（スケジューラで `fetch_stats.fetch_and_save()` を定期実行）。
- 過去日（`data/history/`）を画面から振り返る機能。
- メールやチャットへの通知。
