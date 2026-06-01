# 公開（デプロイ）と自動更新

## 公開先

- **GitHub Pages**（無料）で静的サイトとして公開。
- 公開URL：https://shinohara-jil.github.io/jp-mlb-dashboard/
- リポジトリ：https://github.com/shinohara-jil/jp-mlb-dashboard （パブリック）

## 仕組み

```
GitHub Actions（毎朝 日本時間10時ごろ）
   └ fetch_stats.py を実行 → data/ を更新してリポジトリにコミット
        ↓
GitHub Pages が main ブランチのルートを配信
   └ index.html / app.js が data/latest.json を読んで表示
```

- データ取得はブラウザ側（app.js）でも行えるため、「🔄 更新」ボタンでその場でも最新化できる。
- 履歴は `data/history/日付.json` としてリポジトリに蓄積される（外部DB不要）。

## 自動更新の設定

- 設定ファイル：`.github/workflows/update.yml`
- スケジュール：`cron: "0 1 * * *"`（01:00 UTC ＝ 日本時間 10:00 ごろ）
- 手動実行：GitHubの「Actions」タブ →「成績を毎朝自動更新」→「Run workflow」。
  - コマンドなら `gh workflow run update.yml`

## 公開時にハマったポイント（メモ）

- **workflowファイルのpushには `workflow` 権限が必要**。
  権限が無いと push が拒否される。`gh auth refresh -h github.com -s workflow` で一度だけ承認して追加した。
- **パスは相対指定**にすること（GitHub PagesのURLは `/<repo>/` 階層が付くため、先頭スラッシュは不可）。
- サイトファイルはリポジトリ**直下**に置く（Pagesは `main` ルートを配信。`docs/` は別用途）。

## 更新方法（コードを直したとき）

1. ローカルで `python app.py` を実行して表示を確認。
2. `git add -A && git commit -m "説明" && git push`。
3. 数十秒〜1分で公開サイトに反映される。
