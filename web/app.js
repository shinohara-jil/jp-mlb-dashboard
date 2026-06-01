// 画面の動き：データを読み込んでカードを描く / 更新ボタンの処理

const $ = (id) => document.getElementById(id);

// ページを開いたら、保存済みの最新データを表示
window.addEventListener("DOMContentLoaded", () => {
  loadData();
  $("update-btn").addEventListener("click", updateData);
});

async function loadData() {
  try {
    const res = await fetch("/api/data");
    const data = await res.json();
    render(data);
  } catch (e) {
    setStatus("データの読み込みに失敗しました。", true);
  }
}

async function updateData() {
  const btn = $("update-btn");
  btn.disabled = true;
  setStatus("MLB公式サービスから最新成績を取得しています…（数秒かかります）");
  try {
    const res = await fetch("/api/update", { method: "POST" });
    if (!res.ok) throw new Error("server error");
    const data = await res.json();
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

// ===== 描画 =====
function render(data) {
  $("updated").textContent = "最終更新: " + (data.updated_at || "—");

  const players = data.players || [];
  if (players.length === 0) {
    $("pitchers").innerHTML = emptyMsg("まだデータがありません。「🔄 更新」を押してください。");
    $("batters").innerHTML = "";
    $("highlights").innerHTML = `<div class="highlight-empty">データがありません。</div>`;
    return;
  }

  // 投手セクション：pitching を持つ選手
  const pitchers = players.filter((p) => p.pitching);
  $("pitchers").innerHTML = pitchers.map(pitcherCard).join("") || emptyMsg("対象なし");

  // 野手セクション：hitting を持つ選手
  const batters = players.filter((p) => p.hitting);
  $("batters").innerHTML = batters.map(batterCard).join("") || emptyMsg("対象なし");

  renderHighlights(players);
}

function emptyMsg(text) {
  return `<div class="highlight-empty">${text}</div>`;
}

function teamTag(p) {
  return p.team ? `<span class="card-team">${p.team}</span>` : "";
}

// 最新試合が「活躍」かどうかを判定（強調用）
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

// ===== 投手カード =====
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
    <div class="card-head"><span class="card-name">${p.name_ja}</span>${teamTag(p)}</div>
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

// ===== 野手カード =====
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
    <div class="card-head"><span class="card-name">${p.name_ja}</span>${teamTag(p)}</div>
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

// ===== ハイライト（最新の試合日に活躍した選手）=====
function renderHighlights(players) {
  // すべての最新試合の中で一番新しい日付を求める
  let maxDate = "";
  players.forEach((p) => {
    [p.hitting, p.pitching].forEach((g) => {
      if (g && g.latest && g.latest.date > maxDate) maxDate = g.latest.date;
    });
  });

  const rows = [];
  players.forEach((p) => {
    // 直近の試合日に出場した野手は全員表示（活躍した人には🔥）
    if (p.hitting && p.hitting.latest && p.hitting.latest.date === maxDate) {
      const ls = p.hitting.latest.stat;
      const hr = (ls.homeRuns || 0) >= 1 ? ` ${ls.homeRuns}本塁打` : "";
      const rbi = (ls.rbi || 0) >= 1 ? ` ${ls.rbi}打点` : "";
      const fire = isHotHitting(p.hitting.latest) ? " 🔥" : "";
      rows.push(`<span class="h-name">${p.name_ja}</span> ${ls.atBats ?? 0}打数${ls.hits ?? 0}安打${hr}${rbi}${fire}`);
    }
    // 直近の試合日に登板した投手は全員表示（活躍した人には🔥）
    if (p.pitching && p.pitching.latest && p.pitching.latest.date === maxDate) {
      const ls = p.pitching.latest.stat;
      const fire = isHotPitching(p.pitching.latest) ? " 🔥" : "";
      rows.push(`<span class="h-name">${p.name_ja}</span> ${ls.inningsPitched ?? 0}回 ${ls.earnedRuns ?? 0}失点 ${ls.strikeOuts ?? 0}奪三振${decision(ls)}${fire}`);
    }
  });

  const html = rows.length
    ? `<div class="highlight-date" style="font-size:12px;color:#8a97a3;margin-bottom:6px;">${maxDate}（米国時間）の試合より</div>` +
      rows.map((r) => `<div class="highlight-row">${r}</div>`).join("")
    : `<div class="highlight-empty">直近の試合で目立った成績はありませんでした。</div>`;
  $("highlights").innerHTML = html;
}
