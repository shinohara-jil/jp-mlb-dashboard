// 画面の動き
//  - ページを開いたら、保存済みデータ(data/latest.json)をすぐ表示
//  - 「更新」ボタンを押したら、ブラウザが直接MLB公式から最新を取得して表示
//  （※静的サイト用。裏方サーバーは不要）

const API = "https://statsapi.mlb.com/api/v1";
const $ = (id) => document.getElementById(id);

let currentData = null;        // 直近に読み込んだ全データ（絞り込みの元）
let currentLeague = "ALL";     // 選択中のリーグ（ALL / AL / NL）
const LS_KEY = "mlb_jp_last_update"; // この端末で最後に「🔄更新」した結果の保存先

// 2つのデータのうち、更新日時が新しい方を返す（updated_at は "YYYY-MM-DD HH:MM" 形式で文字列比較できる）
function pickNewer(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return (b.updated_at || "") > (a.updated_at || "") ? b : a;
}

window.addEventListener("DOMContentLoaded", () => {
  loadSaved();
  $("update-btn").addEventListener("click", liveUpdate);
  // リーグ絞り込みボタン
  document.querySelectorAll("#league-filter .filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentLeague = btn.dataset.league;
      document.querySelectorAll("#league-filter .filter-btn").forEach((b) =>
        b.classList.toggle("is-active", b === btn));
      if (currentData) render(currentData);
    });
  });
});

// ===== 保存済みデータの読み込み（高速表示）=====
// 「毎朝の自動更新で保存されたファイル」と「この端末で前回🔄更新した結果」の
// 新しい方を表示する。これで手動更新が開き直しても残り、かつ自動更新が新しければそちらを優先。
async function loadSaved() {
  let serverData = null;
  try {
    const res = await fetch("data/latest.json", { cache: "no-store" });
    if (res.ok) serverData = await res.json();
  } catch (e) { /* 取れなければ後でライブ取得 */ }

  let localData = null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) localData = JSON.parse(raw);
  } catch (e) { /* 保存が壊れていれば無視 */ }

  const data = pickNewer(serverData, localData);
  if (data) {
    render(data);
  } else {
    // どちらも無ければ、その場で取得を試みる
    setStatus("保存データがありません。最新を取得します…");
    liveUpdate();
  }
}

// ===== ブラウザから直接MLBを取得（更新ボタン）=====
async function liveUpdate() {
  const btn = $("update-btn");
  btn.disabled = true;
  setStatus("MLB公式サービスから最新成績を取得しています…（数秒〜十数秒かかります）");
  try {
    const data = await fetchAll();
    // この端末に記憶（開き直しても残るように）
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) { /* 容量超過等は無視 */ }
    render(data);
    setStatus("");
  } catch (e) {
    setStatus("取得に失敗しました。少し待って再度お試しください。", true);
  } finally {
    btn.disabled = false;
  }
}

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = "status" + (isError ? " error" : "");
}

// ============================================================
//  データ取得（fetch_stats.py のブラウザ版）
// ============================================================
function currentSeason() {
  // MLBは米国時間基準。米東部(UTC-5)の年を使う
  const us = new Date(Date.now() - 5 * 3600 * 1000);
  return us.getUTCFullYear();
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function loadNameMap() {
  try {
    return await getJson("config/name_map.json");
  } catch (e) {
    return {};
  }
}

// チーム略称→リーグ（AL/NL）の固定対応表。先頭の説明キー(_)は除外。
async function loadTeamLeague() {
  try {
    const data = await getJson("config/team_league.json");
    const map = {};
    Object.keys(data).forEach((k) => { if (!k.startsWith("_")) map[k] = data[k]; });
    return map;
  } catch (e) {
    return {};
  }
}

async function fetchSeasonStat(pid, group, season) {
  const url = `${API}/people/${pid}/stats?stats=season&group=${group}&season=${season}`;
  const data = await getJson(url);
  const stats = data.stats || [];
  if (stats.length && stats[0].splits && stats[0].splits.length) {
    return stats[0].splits[0].stat;
  }
  return null;
}

const gameInfoCache = {};
// gamePk から試合の日本時間日付と進行状態を取得する。
// 戻り値: { date: "YYYY-MM-DD"|null, live: true/false }（live=試合進行中）
async function getGameInfo(gamePk) {
  const empty = { date: null, live: false };
  if (gamePk == null) return empty;
  if (gamePk in gameInfoCache) return gameInfoCache[gamePk];
  let result = { ...empty };
  try {
    const data = await getJson(`${API}/schedule?gamePks=${gamePk}`);
    for (const d of data.dates || []) {
      for (const g of d.games || []) {
        if (g.gamePk === gamePk) {
          if (g.gameDate) {
            const jst = new Date(new Date(g.gameDate).getTime() + 9 * 3600 * 1000);
            result.date = jst.toISOString().slice(0, 10);
          }
          result.live = ((g.status || {}).abstractGameState === "Live");
        }
      }
    }
  } catch (e) {
    result = { ...empty };
  }
  gameInfoCache[gamePk] = result;
  return result;
}

async function fetchLatestGame(pid, group, season) {
  const url = `${API}/people/${pid}/stats?stats=gameLog&group=${group}&season=${season}`;
  const data = await getJson(url);
  const stats = data.stats || [];
  if (stats.length && stats[0].splits && stats[0].splits.length) {
    const last = stats[0].splits[stats[0].splits.length - 1];
    const info = await getGameInfo((last.game || {}).gamePk);
    return { date: info.date || last.date, opponent: (last.opponent || {}).name, stat: last.stat || {}, live: info.live };
  }
  return null;
}

async function buildPlayer(player, nameMap, season, teamMap, leagueMap) {
  const pid = player.id;
  const nameEn = player.fullName || "";
  const nameJa = nameMap[nameEn] || nameEn;
  const pos = (player.primaryPosition || {}).abbreviation || "";
  const isPitcher = pos === "P";
  const isTwoWay = pos === "TWP";
  const teamId = (player.currentTeam || {}).id;
  const team = teamMap[teamId] || "";
  const league = leagueMap[team] || ""; // AL / NL（不明なら空）

  const result = { id: pid, name_ja: nameJa, name_en: nameEn, position: pos, team, league, hitting: null, pitching: null };
  let hasStat = false;

  if (!isPitcher) {
    const seasonH = await fetchSeasonStat(pid, "hitting", season);
    if (seasonH) {
      hasStat = true;
      result.hitting = { season: seasonH, latest: await fetchLatestGame(pid, "hitting", season) };
    }
  }
  if (isPitcher || isTwoWay) {
    const seasonP = await fetchSeasonStat(pid, "pitching", season);
    if (seasonP) {
      hasStat = true;
      result.pitching = { season: seasonP, latest: await fetchLatestGame(pid, "pitching", season) };
    }
  }
  return hasStat ? result : null;
}

async function fetchAll() {
  const season = currentSeason();
  const nameMap = await loadNameMap();
  const leagueMap = await loadTeamLeague();

  const teamsData = await getJson(`${API}/teams?sportId=1&season=${season}`);
  const teamMap = {};
  (teamsData.teams || []).forEach((t) => { teamMap[t.id] = t.abbreviation || ""; });

  const playersData = await getJson(`${API}/sports/1/players?season=${season}`);
  const japanese = (playersData.people || []).filter((p) => p.birthCountry === "Japan");

  // 全選手を並行取得（速くするため）
  const built = await Promise.all(
    japanese.map((p) => buildPlayer(p, nameMap, season, teamMap, leagueMap).catch(() => null))
  );
  const players = built.filter(Boolean);

  const now = new Date(Date.now() + 9 * 3600 * 1000); // JST
  const updated = now.toISOString().slice(0, 16).replace("T", " ");
  return { season, updated_at: updated, players };
}

// ============================================================
//  描画
// ============================================================
function render(data) {
  currentData = data; // 絞り込みのため元データを保持
  $("updated").textContent = "最終更新: " + (data.updated_at || "—");
  const all = data.players || [];
  if (all.length === 0) {
    $("pitchers").innerHTML = emptyMsg("まだデータがありません。「🔄 更新」を押してください。");
    $("batters").innerHTML = "";
    $("highlights").innerHTML = `<div class="highlight-empty">データがありません。</div>`;
    return;
  }
  // 選択中のリーグで絞り込み（ALLは全員）
  const players = currentLeague === "ALL"
    ? all
    : all.filter((p) => p.league === currentLeague);

  const noMatch = `該当する選手がいません（${leagueLabel(currentLeague)}）`;
  $("pitchers").innerHTML = players.filter((p) => p.pitching).map(pitcherCard).join("") || emptyMsg(noMatch);
  $("batters").innerHTML = players.filter((p) => p.hitting).map(batterCard).join("") || emptyMsg(noMatch);
  renderHighlights(players);
}

function leagueLabel(code) {
  return code === "AL" ? "ア・リーグ" : code === "NL" ? "ナ・リーグ" : "全部";
}

function emptyMsg(text) { return `<div class="highlight-empty">${text}</div>`; }
function teamTag(p) { return p.team ? `<span class="card-team">${p.team}</span>` : ""; }
// 各選手カードに、成績の推移ページへのボタンを出す（全選手対象）。
// group="pitching" / "hitting" を渡すと、その種類のタブで推移ページを開く。
// 選手ID(id)と日本語名(name)をURLで渡し、推移ページ側がそのまま使えるようにする。
function trendButton(p, group) {
  const name = encodeURIComponent(p.name_ja || p.name_en || "");
  return `<a class="trend-btn" href="ohtani.html?id=${p.id}&tab=${group}&name=${name}">📈 推移を見る</a>`;
}
// 直近試合が進行中なら「🟢 試合中」タグを返す（カードのみで使用）
function liveTag(latest) { return (latest && latest.live) ? `<span class="live-tag">🟢 試合中</span>` : ""; }

// ===== 顔写真 =====
// 選手IDからMLB公式の顔写真URLを作る。画像ファイルは持たず、表示時にブラウザが読み込む。
function headshotUrl(pid) {
  return `https://midfield.mlbstatic.com/v1/people/${pid}/spots/120`;
}
// 写真が無い／読み込み失敗の選手は、灰色の丸に差し替えてレイアウトを崩さない。
function avatarFallback(img) {
  img.onerror = null;
  img.src = "data:image/svg+xml," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><circle cx='24' cy='24' r='24' fill='#dfe5ec'/></svg>"
  );
}
function avatar(p, cls) {
  return `<img class="avatar ${cls}" src="${headshotUrl(p.id)}" alt="${p.name_ja}" loading="lazy" onerror="avatarFallback(this)">`;
}

function isHotHitting(latest) {
  if (!latest) return false;
  const s = latest.stat || {};
  return (s.homeRuns || 0) >= 1 || (s.hits || 0) >= 3 || (s.rbi || 0) >= 3;
}
function isHotPitching(latest) {
  if (!latest) return false;
  const s = latest.stat || {};
  const ip = parseFloat(s.inningsPitched || "0");
  return (s.wins || 0) >= 1 || (s.saves || 0) >= 1 || (ip >= 5 && (s.earnedRuns || 0) <= 1);
}

function statCell(value, label) {
  return `<div class="stat"><b>${value ?? "—"}</b><span>${label}</span></div>`;
}

function pitcherCard(p) {
  const s = p.pitching.season || {};
  const latest = p.pitching.latest;
  const hot = isHotPitching(latest);
  let latestHtml;
  if (latest) {
    const ls = latest.stat || {};
    const fire = hot ? ' <span class="fire">🔥</span>' : "";
    latestHtml = `<div class="latest-line"><span class="date">${latest.date}</span>` +
      `${ls.inningsPitched ?? "0"}回 ${ls.earnedRuns ?? 0}失点 ${ls.strikeOuts ?? 0}奪三振${decision(ls)}${fire}</div>`;
  } else {
    latestHtml = `<div class="latest-none">登板なし</div>`;
  }
  return `
  <div class="card ${hot ? "hot" : ""}">
    <div class="card-head"><div class="card-id">${avatar(p, "avatar-card")}<span class="card-name">${p.name_ja}</span></div>${teamTag(p)}</div>
    <div class="block-label">最新登板 ${liveTag(latest)}</div>
    ${latestHtml}
    <div class="block-label">シーズン通算</div>
    <div class="stat-row">
      ${statCell(s.era, "防御率")}
      ${statCell((s.wins ?? 0) + "-" + (s.losses ?? 0), "勝敗")}
      ${statCell(s.saves, "S")}
      ${statCell(s.strikeOuts, "奪三振")}
      ${statCell(s.inningsPitched, "投球回")}
      ${statCell(s.whip, "WHIP")}
    </div>
    ${trendButton(p, "pitching")}
  </div>`;
}

function decision(ls) {
  if (ls.wins >= 1) return " 勝";
  if (ls.losses >= 1) return " 敗";
  if (ls.saves >= 1) return " S";
  if (ls.holds >= 1) return " H";
  return "";
}

function batterCard(p) {
  const s = p.hitting.season || {};
  const latest = p.hitting.latest;
  const hot = isHotHitting(latest);
  let latestHtml;
  if (latest) {
    const ls = latest.stat || {};
    const fire = hot ? ' <span class="fire">🔥</span>' : "";
    const hr = (ls.homeRuns || 0) >= 1 ? ` ${ls.homeRuns}本塁打` : "";
    const rbi = (ls.rbi || 0) >= 1 ? ` ${ls.rbi}打点` : "";
    latestHtml = `<div class="latest-line"><span class="date">${latest.date}</span>` +
      `${ls.atBats ?? 0}打数${ls.hits ?? 0}安打${hr}${rbi}${fire}</div>`;
  } else {
    latestHtml = `<div class="latest-none">出場なし</div>`;
  }
  return `
  <div class="card ${hot ? "hot" : ""}">
    <div class="card-head"><div class="card-id">${avatar(p, "avatar-card")}<span class="card-name">${p.name_ja}</span></div>${teamTag(p)}</div>
    <div class="block-label">最新試合 ${liveTag(latest)}</div>
    ${latestHtml}
    <div class="block-label">シーズン通算</div>
    <div class="stat-row">
      ${statCell(s.avg, "打率")}
      ${statCell(s.homeRuns, "本塁打")}
      ${statCell(s.rbi, "打点")}
      ${statCell(s.ops, "OPS")}
      ${statCell(s.obp, "出塁率")}
      ${statCell(s.stolenBases, "盗塁")}
    </div>
    ${trendButton(p, "hitting")}
  </div>`;
}

function renderHighlights(players) {
  let maxDate = "";
  players.forEach((p) => {
    [p.hitting, p.pitching].forEach((g) => {
      if (g && g.latest && g.latest.date > maxDate) maxDate = g.latest.date;
    });
  });
  const rows = [];
  players.forEach((p) => {
    if (p.hitting && p.hitting.latest && p.hitting.latest.date === maxDate) {
      const ls = p.hitting.latest.stat;
      const hr = (ls.homeRuns || 0) >= 1 ? ` ${ls.homeRuns}本塁打` : "";
      const rbi = (ls.rbi || 0) >= 1 ? ` ${ls.rbi}打点` : "";
      const fire = isHotHitting(p.hitting.latest) ? " 🔥" : "";
      const stat = `${ls.atBats ?? 0}打数${ls.hits ?? 0}安打${hr}${rbi}${fire}`;
      rows.push(`${avatar(p, "avatar-mini")}<div class="h-body"><span class="h-name">${p.name_ja}</span>${liveTag(p.hitting.latest)}<span class="h-stat">${stat}</span></div>`);
    }
    if (p.pitching && p.pitching.latest && p.pitching.latest.date === maxDate) {
      const ls = p.pitching.latest.stat;
      const fire = isHotPitching(p.pitching.latest) ? " 🔥" : "";
      const stat = `${ls.inningsPitched ?? 0}回 ${ls.earnedRuns ?? 0}失点 ${ls.strikeOuts ?? 0}奪三振${decision(ls)}${fire}`;
      rows.push(`${avatar(p, "avatar-mini")}<div class="h-body"><span class="h-name">${p.name_ja}</span>${liveTag(p.pitching.latest)}<span class="h-stat">${stat}</span></div>`);
    }
  });
  const html = rows.length
    ? `<div class="highlight-date" style="font-size:12px;color:#8a97a3;margin-bottom:6px;">${maxDate}（日本時間）の試合より</div>` +
      rows.map((r) => `<div class="highlight-row">${r}</div>`).join("")
    : `<div class="highlight-empty">直近の試合で目立った成績はありませんでした。</div>`;
  $("highlights").innerHTML = html;
}
