# -*- coding: utf-8 -*-
"""
日本人メジャーリーガーの成績を MLB 公式 StatsAPI から取得・整形するプログラム。
- 追加インストール不要（Python標準ライブラリのみ）
- 「出身国=日本」の選手を自動抽出し、各選手のシーズン通算＋最新試合の成績を取得する
"""
import sys
import json
import os
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

API = "https://statsapi.mlb.com/api/v1"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_DIR = os.path.join(BASE_DIR, "config")
DATA_DIR = os.path.join(BASE_DIR, "data")
HISTORY_DIR = os.path.join(DATA_DIR, "history")


def current_season():
    """今の年（シーズン）を返す。MLBは米国時間基準なので米東部の年を使う。"""
    us_now = datetime.now(timezone.utc) - timedelta(hours=5)
    return us_now.year


def get_json(url):
    """URLを叩いてJSONを取得する。失敗時は例外を投げる。"""
    req = urllib.request.Request(url, headers={"User-Agent": "jp-mlb-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode("utf-8"))


def load_name_map():
    path = os.path.join(CONFIG_DIR, "name_map.json")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def load_team_league():
    """チーム略称→リーグ（AL/NL）の固定対応表を読み込む。先頭の説明キーは除外。"""
    path = os.path.join(CONFIG_DIR, "team_league.json")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return {k: v for k, v in data.items() if not k.startswith("_")}
    except FileNotFoundError:
        return {}


def get_japanese_players(season):
    """その季にMLBに在籍する『日本出身』の選手一覧を返す。"""
    url = f"{API}/sports/1/players?season={season}"
    data = get_json(url)
    players = [p for p in data.get("people", []) if p.get("birthCountry") == "Japan"]
    return players


def get_team_abbr_map(season):
    """チームID→略称（例: LAD）の対応表を作る。"""
    url = f"{API}/teams?sportId=1&season={season}"
    data = get_json(url)
    return {t["id"]: t.get("abbreviation", "") for t in data.get("teams", [])}


def fetch_season_stat(pid, group, season):
    """シーズン通算成績を取得。無ければ None。"""
    url = f"{API}/people/{pid}/stats?stats=season&group={group}&season={season}"
    data = get_json(url)
    stats = data.get("stats", [])
    if stats and stats[0].get("splits"):
        return stats[0]["splits"][0]["stat"]
    return None


_game_info_cache = {}


def get_game_info(game_pk):
    """gamePk から試合の日本時間日付と進行状態を取得する。
    戻り値: {"date": "YYYY-MM-DD" or None, "live": True/False}
    live=True は試合が進行中（abstractGameState == "Live"）の意味。"""
    empty = {"date": None, "live": False}
    if game_pk is None:
        return empty
    if game_pk in _game_info_cache:
        return _game_info_cache[game_pk]
    result = dict(empty)
    try:
        data = get_json(f"{API}/schedule?gamePks={game_pk}")
        for d in data.get("dates", []):
            for g in d.get("games", []):
                if g.get("gamePk") == game_pk:
                    if g.get("gameDate"):
                        dt = datetime.fromisoformat(g["gameDate"].replace("Z", "+00:00"))
                        jst = dt + timedelta(hours=9)
                        result["date"] = jst.strftime("%Y-%m-%d")
                    state = g.get("status", {}).get("abstractGameState", "")
                    result["live"] = (state == "Live")
    except Exception:
        result = dict(empty)
    _game_info_cache[game_pk] = result
    return result


def fetch_latest_game(pid, group, season):
    """試合ごとの成績から最新の1試合を取得。日付は日本時間に変換。無ければ None。"""
    url = f"{API}/people/{pid}/stats?stats=gameLog&group={group}&season={season}"
    data = get_json(url)
    stats = data.get("stats", [])
    if stats and stats[0].get("splits"):
        last = stats[0]["splits"][-1]
        game_pk = last.get("game", {}).get("gamePk")
        info = get_game_info(game_pk)
        return {
            "date": info["date"] or last.get("date"),  # 日本時間（取れない時は元の日付）
            "opponent": last.get("opponent", {}).get("name"),
            "stat": last.get("stat", {}),
            "live": info["live"],  # True=試合中（途中経過）
        }
    return None


def build_player_data(player, name_map, season, team_map, league_map):
    """1選手分の表示用データを組み立てる。今季成績が無ければ None（=非表示）。"""
    pid = player["id"]
    name_en = player.get("fullName", "")
    name_ja = name_map.get(name_en, name_en)
    pos = player.get("primaryPosition", {}).get("abbreviation", "")
    is_pitcher = pos == "P"
    is_two_way = pos == "TWP"
    team_id = player.get("currentTeam", {}).get("id")
    team = team_map.get(team_id, "")
    league = league_map.get(team, "")  # AL / NL（不明なら空）

    result = {
        "id": pid,
        "name_ja": name_ja,
        "name_en": name_en,
        "position": pos,
        "team": team,
        "league": league,
        "hitting": None,
        "pitching": None,
    }

    has_stat = False

    # 野手成績（投手専任以外は打撃も取る。二刀流・野手が対象）
    if not is_pitcher:
        season_h = fetch_season_stat(pid, "hitting", season)
        if season_h:
            has_stat = True
            result["hitting"] = {
                "season": season_h,
                "latest": fetch_latest_game(pid, "hitting", season),
            }

    # 投手成績（投手・二刀流が対象）
    if is_pitcher or is_two_way:
        season_p = fetch_season_stat(pid, "pitching", season)
        if season_p:
            has_stat = True
            result["pitching"] = {
                "season": season_p,
                "latest": fetch_latest_game(pid, "pitching", season),
            }

    if not has_stat:
        return None  # 今季成績が無い選手は非表示
    return result


def fetch_all(limit=None):
    season = current_season()
    name_map = load_name_map()
    league_map = load_team_league()
    team_map = get_team_abbr_map(season)
    players = get_japanese_players(season)
    if limit:
        players = players[:limit]

    results = []
    for p in players:
        try:
            data = build_player_data(p, name_map, season, team_map, league_map)
            if data:
                results.append(data)
                print(f"  取得OK: {data['name_ja']} ({data['position']})")
            else:
                print(f"  スキップ(今季成績なし): {p.get('fullName')}")
        except Exception as e:
            print(f"  取得失敗: {p.get('fullName')} -> {e}")

    payload = {
        "season": season,
        "updated_at": (datetime.now(timezone.utc) + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M"),
        "players": results,
    }
    return payload


def save_data(payload):
    """取得結果を latest.json（表示用）と history/日付.json（蓄積用）に保存する。"""
    os.makedirs(HISTORY_DIR, exist_ok=True)
    latest_path = os.path.join(DATA_DIR, "latest.json")
    with open(latest_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    today = (datetime.now(timezone.utc) + timedelta(hours=9)).strftime("%Y-%m-%d")
    history_path = os.path.join(HISTORY_DIR, f"{today}.json")
    with open(history_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return latest_path


# ============================================================
#  SPOTV NOW のダイジェスト動画（YouTube）
#  各選手の「最新のダイジェスト動画」を探して data/spotv_videos.json に保存する。
#  - APIキー不要。YouTubeの公開フィード(RSS)だけを使う。
#  - 一部の選手は選手別の再生リストが更新されない(古い)ため、
#    チャンネル全体の最新フィードから「名前＋ダイジェスト」の最新動画を拾うのが要点。
# ============================================================
SPOTV_CHANNEL_ID = "UCJ-l-sMQFHogSy8KXRyMIRA"  # SPOTV NOW 公式チャンネル
_ATOM = "{http://www.w3.org/2005/Atom}"
_YT = "{http://www.youtube.com/xml/schemas/2015}"


def load_spotv_playlists():
    """選手ID→SPOTV NOWの再生リストID の対応表を読む。先頭の説明キーは除外。"""
    path = os.path.join(CONFIG_DIR, "spotv_playlists.json")
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return {k: v for k, v in data.items() if not k.startswith("_")}
    except FileNotFoundError:
        return {}


def get_xml(url):
    req = urllib.request.Request(url, headers={"User-Agent": "jp-mlb-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=20) as res:
        return ET.fromstring(res.read())


def parse_feed_entries(root):
    """YouTubeのAtomフィードから [{videoId, title, published}] を返す。"""
    out = []
    for entry in root.findall(f"{_ATOM}entry"):
        vid = entry.findtext(f"{_YT}videoId")
        title = entry.findtext(f"{_ATOM}title") or ""
        published = entry.findtext(f"{_ATOM}published") or ""
        if vid:
            out.append({"videoId": vid, "title": title, "published": published})
    return out


def fetch_channel_entries():
    """SPOTV NOW公式チャンネルの最新アップロード一覧（新しい順・約15件）。"""
    try:
        root = get_xml(f"https://www.youtube.com/feeds/videos.xml?channel_id={SPOTV_CHANNEL_ID}")
        return parse_feed_entries(root)
    except Exception as e:
        print(f"  SPOTV チャンネルフィード取得失敗: {e}")
        return []


def fetch_playlist_entries(playlist_id):
    """選手別の再生リストの動画一覧を返す（無ければ空）。"""
    try:
        root = get_xml(f"https://www.youtube.com/feeds/videos.xml?playlist_id={playlist_id}")
        return parse_feed_entries(root)
    except Exception as e:
        print(f"  SPOTV 再生リスト取得失敗({playlist_id}): {e}")
        return []


def is_digest(title, name_key):
    """その選手の『まとめ(ダイジェスト)動画』らしいタイトルか。
    選手名を含み・『ダイジェスト』を含み・ショート動画(#shorts)ではないもの。
    現地実況クリップや試合ハイライト等(まとめ以外)を除くための判定。"""
    if not name_key:
        return False
    t = title or ""
    return (name_key in t) and ("ダイジェスト" in t) and ("shorts" not in t.lower())


def load_existing_spotv_videos():
    """前回保存した動画情報を読む（後退防止＝一度拾った最新より古いものに戻さないため）。"""
    path = os.path.join(DATA_DIR, "spotv_videos.json")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f).get("videos", {})
    except (FileNotFoundError, ValueError):
        return {}


def build_spotv_videos(players):
    """登録選手ごとに『最新のダイジェスト動画』を見つけて辞書で返す。
    候補＝(前回保存) / (チャンネル最新フィードで 名前＋ダイジェスト 一致) / (選手別再生リストの最新)
    の中で、最も新しい(published)ものを採用する。"""
    playlists = load_spotv_playlists()
    if not playlists:
        return {}
    name_by_id = {str(p["id"]): p.get("name_ja", "") for p in players}
    channel = fetch_channel_entries()
    existing = load_existing_spotv_videos()

    videos = {}
    for pid, playlist_id in playlists.items():
        key = name_by_id.get(pid, "").replace(" ", "").replace("　", "")
        candidates = []
        # 前回保存（後退防止）。※まとめ動画と判定できるものだけ引き継ぐ。
        if pid in existing and existing[pid].get("videoId") and is_digest(existing[pid].get("title", ""), key):
            candidates.append(existing[pid])
        # チャンネル最新フィードから「選手名＋ダイジェスト」一致
        candidates += [e for e in channel if is_digest(e["title"], key)]
        # 選手別再生リストの中の「ダイジェスト」一致（フィードに載っていない選手の保険）
        candidates += [e for e in fetch_playlist_entries(playlist_id) if is_digest(e["title"], key)]
        # 最も新しいものを採用
        if candidates:
            best = max(candidates, key=lambda e: e.get("published", ""))
            videos[pid] = {
                "videoId": best["videoId"],
                "title": best.get("title", ""),
                "published": best.get("published", ""),
            }
            print(f"  SPOTV動画: {name_by_id.get(pid, pid)} -> {best.get('title', '')[:34]}")
    return videos


def save_spotv_videos(videos):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, "spotv_videos.json")
    payload = {
        "updated_at": (datetime.now(timezone.utc) + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M"),
        "videos": videos,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return path


def update_spotv_videos(players):
    """SPOTV動画情報を組み立てて保存する（失敗しても本体の処理は止めない）。"""
    try:
        videos = build_spotv_videos(players)
        if videos:
            save_spotv_videos(videos)
        return videos
    except Exception as e:
        print(f"  SPOTV動画の更新でエラー（スキップ）: {e}")
        return {}


def fetch_and_save(limit=None):
    payload = fetch_all(limit=limit)
    save_data(payload)
    update_spotv_videos(payload["players"])
    return payload


if __name__ == "__main__":
    # 使い方:
    #   python fetch_stats.py        … 全選手を取得して保存（本番・自動更新で使用）
    #   python fetch_stats.py 3      … 3人だけ取得（保存しないテスト）
    #   python fetch_stats.py spotv  … 成績は取らず、SPOTV動画情報だけ更新（既存の latest.json を使用）
    if len(sys.argv) > 1 and sys.argv[1] == "spotv":
        print("=== SPOTV動画情報のみ更新 ===")
        latest_path = os.path.join(DATA_DIR, "latest.json")
        with open(latest_path, encoding="utf-8") as f:
            players = json.load(f).get("players", [])
        videos = update_spotv_videos(players)
        print(f"=== 完了: SPOTV動画 {len(videos)} 人ぶんを保存しました ===")
        sys.exit(0)

    print(f"=== {current_season()}年シーズン 取得開始 ===")
    if len(sys.argv) > 1:
        data = fetch_all(limit=int(sys.argv[1]))
        print(f"=== テスト完了: 表示対象 {len(data['players'])} 人（保存なし）===")
    else:
        data = fetch_and_save()
        print(f"=== 完了: 表示対象 {len(data['players'])} 人 / data に保存しました ===")
