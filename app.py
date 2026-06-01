# -*- coding: utf-8 -*-
"""
日本人メジャーリーガー成績ダッシュボードの裏方（Webサーバー）。
- 追加インストール不要（Python標準ライブラリのみ）
- ブラウザに画面を表示し、「更新」ボタンが押されたら最新成績を取得して保存する
"""
import sys
import json
import os
import http.server
import socketserver
import webbrowser
import threading

import fetch_stats

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
DATA_DIR = os.path.join(BASE_DIR, "data")
PORT = 8000


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # 余計なログを出さない

    def _send(self, code, body, content_type="application/json"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, path, content_type):
        try:
            with open(path, "rb") as f:
                self._send(200, f.read(), content_type)
        except FileNotFoundError:
            self._send(404, "Not Found", "text/plain")

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._serve_file(os.path.join(WEB_DIR, "index.html"), "text/html")
        elif self.path == "/style.css":
            self._serve_file(os.path.join(WEB_DIR, "style.css"), "text/css")
        elif self.path == "/app.js":
            self._serve_file(os.path.join(WEB_DIR, "app.js"), "application/javascript")
        elif self.path == "/api/data":
            # 保存済みの最新データを返す。無ければ空。
            latest = os.path.join(DATA_DIR, "latest.json")
            if os.path.exists(latest):
                with open(latest, encoding="utf-8") as f:
                    self._send(200, f.read())
            else:
                self._send(200, json.dumps({"players": [], "updated_at": None}, ensure_ascii=False))
        else:
            self._send(404, "Not Found", "text/plain")

    def do_POST(self):
        if self.path == "/api/update":
            try:
                print("更新リクエストを受信。MLB公式サービスから取得中...")
                payload = fetch_stats.fetch_and_save()
                print(f"取得完了：{len(payload['players'])}人")
                self._send(200, json.dumps(payload, ensure_ascii=False))
            except Exception as e:
                print(f"取得失敗: {e}")
                self._send(500, json.dumps({"error": str(e)}, ensure_ascii=False))
        else:
            self._send(404, "Not Found", "text/plain")


class DashboardServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True  # 終了直後でも同じポートで再起動できるようにする
    daemon_threads = True


def main():
    os.chdir(BASE_DIR)
    port = int(os.environ.get("PORT", PORT))
    with DashboardServer(("127.0.0.1", port), Handler) as httpd:
        url = f"http://127.0.0.1:{port}/"
        print("=" * 50)
        print("  日本人メジャーリーガー成績ダッシュボード")
        print(f"  ブラウザで開く: {url}")
        print("  終了するには、この画面で Ctrl + C を押してください")
        print("=" * 50)
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n終了しました。")


if __name__ == "__main__":
    main()
