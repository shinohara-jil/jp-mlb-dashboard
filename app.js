// 画面の動き
//  - ページを開いたら、保存済みデータ(data/latest.json)をすぐ表示
//  - 「更新」ボタンを押したら、ブラウザが直接MLB公式から最新を取得して表示
//  （※静的サイト用。裏方サーバーは不要）

const API = "https://statsapi.mlb.com/api/v1";
const $ = (id) => document.getElementById(id);

window.addEventListener("DOMContentLoaded", () => {
  loadSaved();
  $("update-btn").addEventListener("click", liveUpdate);
});

// ===== 保存済みデータの読み込み（高速表示）=====
async function loadSaved() {
  try {
    const res = await fetch("data/latest.json", { cache: "no-store" });
    if (!res.ok) throw new Error("no data");
    const data = await res.json();
    render(data);
  } catch (e) {
    // 保存データが無ければ、その場で取得を試みる
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

async function fetchSeasonStat(pid, group, season) {
  const url = `${API}/people/${pid}/stats?stats=season&group=${group}&season=${season}`;
  const data = await getJson(url);
  const stats = data.stats || [];
  if (stats.length && stats[0].splits && stats[0].splits.length) {
    return stats[0].splits[0].stat;
  }
  return null;
}

const gameDateCache = {};
// gamePk から試合開始時刻を取得し、日本時間の日付(YYYY-MM-DD)を返す
async function getGameJstDate(gamePk) {
  if (gamePk == null) return null;
  if (gamePk in gameDateCache) return gameDateCache[gamePk];
  let result = null;
  try {
    const data = await getJson(`${API}/schedule?gamePks=${gamePk}`);
    for (const d of data.dates || []) {
      for (const g of d.games || []) {
        if (g.gamePk === gamePk && g.gameDate) {
          const jst = new Date(new Date(g.gameDate).getTime() + 9 * 3600 * 1000);
          result = jst.toISOString().slice(0, 10);
        }
      }
    }
  } catch (e) {
    result = null;
  }
  gameDateCache[gamePk] = result;
  return result;
}

async function fetchLatestGame(pid, group, season) {
  const url = `${API}/people/${pid}/stats?stats=gameLog&group=${group}&season=${season}`;
  const data = await getJson(url);
  const stats = data.stats || [];
  if (stats.length && stats[0].splits && stats[0].splits.length) {
    const last = stats[0].splits[stats[0].splits.length - 1];
    const jst = await getGameJstDate((last.game || {}).gamePk);
    return { date: jst || last.date, opponent: (last.opponent || {}).name, stat: last.stat || {} };
  }
  return null;
}

async function buildPlayer(player, nameMap, season, teamMap) {
  const pid = player.id;
  const nameEn = player.fullName || "";
  const nameJa = nameMap[nameEn] || nameEn;
  const pos = (player.primaryPosition || {}).abbreviation || "";
  const isPitcher = pos === "P";
  const isTwoWay = pos === "TWP";
  const teamId = (player.currentTeam || {}).id;
  const team = teamMap[teamId] || "";

  const result = { id: pid, name_ja: nameJa, name_en: nameEn, position: pos, team, hitting: null, pitching: null };
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

  const teamsData = await getJson(`${API}/teams?sportId=1&season=${season}`);
  const teamMap = {};
  (teamsData.teams || []).forEach((t) => { teamMap[t.id] = t.abbreviation || ""; });

  const playersData = await getJson(`${API}/sports/1/players?season=${season}`);
  const japanese = (playersData.people || []).filter((p) => p.birthCountry === "Japan");

  // 全選手を並行取得（速くするため）
  const built = await Promise.all(
    japanese.map((p) => buildPlayer(p, nameMap, season, teamMap).catch(() => null))
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
  $("updated").textContent = "最終更新: " + (data.updated_at || "—");
  const players = data.players || [];
  if (players.length === 0) {
    $("pitchers").innerHTML = emptyMsg("まだデータがありません。「🔄 更新」を押してください。");
    $("batters").innerHTML = "";
    $("highlights").innerHTML = `<div class="highlight-empty">データがありません。</div>`;
    return;
  }
  $("pitchers").innerHTML = players.filter((p) => p.pitching).map(pitcherCard).join("") || emptyMsg("対象なし");
  $("batters").innerHTML = players.filter((p) => p.hitting).map(batterCard).join("") || emptyMsg("対象なし");
  renderHighlights(players);
}

function emptyMsg(text) { return `<div class="highlight-empty">${text}</div>`; }
function teamTag(p) { return p.team ? `<span class="card-team">${p.team}</span>` : ""; }

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
    <div class="block-label">最新登板</div>
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
    <div class="block-label">最新試合</div>
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
      rows.push(`${avatar(p, "avatar-mini")}<span class="h-name">${p.name_ja}</span> ${ls.atBats ?? 0}打数${ls.hits ?? 0}安打${hr}${rbi}${fire}`);
    }
    if (p.pitching && p.pitching.latest && p.pitching.latest.date === maxDate) {
      const ls = p.pitching.latest.stat;
      const fire = isHotPitching(p.pitching.latest) ? " 🔥" : "";
      rows.push(`${avatar(p, "avatar-mini")}<span class="h-name">${p.name_ja}</span> ${ls.inningsPitched ?? 0}回 ${ls.earnedRuns ?? 0}失点 ${ls.strikeOuts ?? 0}奪三振${decision(ls)}${fire}`);
    }
  });
  const html = rows.length
    ? `<div class="highlight-date" style="font-size:12px;color:#8a97a3;margin-bottom:6px;">${maxDate}（日本時間）の試合より</div>` +
      rows.map((r) => `<div class="highlight-row">${r}</div>`).join("")
    : `<div class="highlight-empty">直近の試合で目立った成績はありませんでした。</div>`;
  $("highlights").innerHTML = html;
}
