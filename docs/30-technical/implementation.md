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
│   ├── name_map.json   # 英語名→日本語名の対応表
│   └── team_league.json # チーム略称→リーグ(AL/NL)の固定対応表（⑥リーグ絞り込み用）
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
- **試合日は日本時間に変換**して表示。gameLog には日付しか無いため、`gamePk` で `/schedule` を引いて開始時刻(UTC)を取得し +9時間。同じ試合の重複問い合わせはキャッシュで回避。
- **リーグ（AL/NL）は固定対応表**：`config/team_league.json` にチーム略称→リーグを持ち、各選手に `league` を付与。MLB APIから動的に引くことも可能だが、予測しやすさ重視で固定表を採用（球団増減時のみ手直し）。画面の絞り込みボタンで `league` を使って表示を絞る。
- **「試合中」判定は `/schedule` の `status.abstractGameState`**（`Preview`/`Live`/`Final`）。試合日取得と同じ schedule 呼び出しから一緒に読み、最新試合に `live` を付与。`Live` のときカードに「🟢 試合中」タグを表示。fetch_stats.py（毎朝）と app.js（🔄ボタン）の両方に実装。
- **手動更新（🔄）の結果を端末に記憶**（2026-06-04）：静的サイトはブラウザから保存先に書き戻せないため、🔄で取得した最新を `localStorage`（キー `mlb_jp_last_update`）に保存。次回読み込み時は「保存ファイル(`data/latest.json`)」と「端末の記憶」の `updated_at` を比べ、**新しい方**を表示（`pickNewer`）。これで手動更新が開き直しても残り、毎朝の自動更新が新しければそちらが優先される。
- **ハイライト行のレイアウト**（2026-06-04）：顔写真を左に固定し、名前＋成績を `.h-body` でひとまとめにして自然に折り返す。狭いスマホ幅で成績だけが細く折り返される崩れを解消。

## PWA（アプリ風）2026-06-04 追加

- **追加ファイル**：`manifest.json`（アプリ名・アイコン・全画面起動）／アイコン各種（`icon-192.png`・`icon-512.png`・`icon-maskable-512.png`・`apple-touch-icon.png`）。
- **index.html の変更**：manifest 読み込み・`theme-color`・Apple向けメタタグを追加。
- **オフライン機能（サービスワーカー）は取り下げ**：キャッシュ由来で「英語名・空表示・更新日—」になる不具合が出たため。
  `sw.js` は現在「自分の登録解除＋全キャッシュ削除＋再読み込み」の後始末専用。index.html 側でも登録解除・キャッシュ削除を実行。
- **キャッシュ対策は `?v=日付` に一本化**（従来どおり。サービスワーカーは使わない）。パスは相対（`./`）。
- 詳細・取り下げの経緯は [feature-05-pwa.md](../10-product/feature-05-pwa.md)。

## 今後の拡張余地

- 毎朝の自動更新（スケジューラで `fetch_stats.fetch_and_save()` を定期実行）。
- 過去日（`data/history/`）を画面から振り返る機能。
- メールやチャットへの通知。
