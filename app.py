# -*- coding: utf-8 -*-
"""
ローカルで画面を確認するための簡単な静的サーバー。
公開版（GitHub Pages）と同じ表示を手元で確認できる。
- 追加インストール不要（Python標準ライブラリのみ）
- データ取得は画面（ブラウザ）側で行うため、ここでは「ファイルを配るだけ」
"""
import sys
import os
import http.server
import socketserver
import webbrowser
import threading

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    port = int(os.environ.get("PORT", PORT))
    with Server(("127.0.0.1", port), Handler) as httpd:
        url = f"http://127.0.0.1:{port}/"
        print("=" * 50)
        print("  日本人メジャーリーガー成績ダッシュボード（ローカル確認用）")
        print(f"  ブラウザで開く: {url}")
        print("  終了するには Ctrl + C")
        print("=" * 50)
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n終了しました。")


if __name__ == "__main__":
    main()
