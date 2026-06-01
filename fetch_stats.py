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


def fetch_latest_game(pid, group, season):
    """試合ごとの成績から最新の1試合を取得。無ければ None。"""
    url = f"{API}/people/{pid}/stats?stats=gameLog&group={group}&season={season}"
    data = get_json(url)
    stats = data.get("stats", [])
    if stats and stats[0].get("splits"):
        last = stats[0]["splits"][-1]
        return {
            "date": last.get("date"),
            "opponent": last.get("opponent", {}).get("name"),
            "stat": last.get("stat", {}),
        }
    return None


def build_player_data(player, name_map, season, team_map):
    """1選手分の表示用データを組み立てる。今季成績が無ければ None（=非表示）。"""
    pid = player["id"]
    name_en = player.get("fullName", "")
    name_ja = name_map.get(name_en, name_en)
    pos = player.get("primaryPosition", {}).get("abbreviation", "")
    is_pitcher = pos == "P"
    is_two_way = pos == "TWP"
    team_id = player.get("currentTeam", {}).get("id")
    team = team_map.get(team_id, "")

    result = {
        "id": pid,
        "name_ja": name_ja,
        "name_en": name_en,
        "position": pos,
        "team": team,
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
    team_map = get_team_abbr_map(season)
    players = get_japanese_players(season)
    if limit:
        players = players[:limit]

    results = []
    for p in players:
        try:
            data = build_player_data(p, name_map, season, team_map)
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


def fetch_and_save(limit=None):
    payload = fetch_all(limit=limit)
    save_data(payload)
    return payload


if __name__ == "__main__":
    # テスト実行：引数で人数を絞れる（例: python fetch_stats.py 2）
    lim = int(sys.argv[1]) if len(sys.argv) > 1 else None
    print(f"=== {current_season()}年シーズン 取得開始 ===")
    data = fetch_all(limit=lim)
    print(f"=== 完了: 表示対象 {len(data['players'])} 人 ===")
    print(json.dumps(data, ensure_ascii=False, indent=2)[:2000])
