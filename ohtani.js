// 選手のシーズン推移ページの動き（全選手共通）
//  - 今シーズンの「試合ごとログ」をMLB公式から取得
//  - 各項目を上下2段で表示：上段=移り変わり(折れ線) / 下段=1試合ごと(棒)
//  - 「投手」「野手」をタブで切り替え（その選手に記録がある側だけ表示）
//  - どの選手かはURLの ?id= で受け取る（指定が無ければ大谷翔平）
//  （※静的サイト用。裏方サーバーは不要）

const API = "https://statsapi.mlb.com/api/v1";
const DEFAULT_ID = 660271; // 指定が無いときの既定（大谷翔平）
const $ = (id) => document.getElementById(id);

// URLから「どの選手か」を受け取る。?id= が選手ID、?name= が日本語名（一覧から渡される）。
const _params = new URLSearchParams(location.search);
const PLAYER_ID = parseInt(_params.get("id"), 10) || DEFAULT_ID;
let PLAYER_NAME = _params.get("name") || (PLAYER_ID === DEFAULT_ID ? "大谷 翔平" : "");

let SPLITS = { pitching: null, hitting: null }; // 取得した試合ごとログ
let charts = [];                                 // 表示中のグラフ（切替時に破棄する）
let currentGroup = "pitching";

// ===== 共通の小道具 =====
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
function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = "status" + (isError ? " error" : "");
}
const num = (v) => (v == null || v === "" || isNaN(+v) ? 0 : +v);
const mmdd = (d) => (d ? d.slice(5).replace("-", "/") : "");

// 投球回の "6.1"（6と1/3回）をアウト数に直す → 累計の合算に使う
function ipToOuts(ip) {
  if (ip == null) return 0;
  const [w, f] = String(ip).split(".");
  return (parseInt(w) || 0) * 3 + (parseInt(f) || 0);
}
function outsToIpStr(o) {
  const w = Math.floor(o / 3), r = o % 3;
  return r ? w + "." + r : "" + w;
}

// ===== 表示する項目の定義 =====
// line: 上段(移り変わり)。cum=数えるものの累計 / cumIp=投球回の累計 / get=その時点の通算値（割合系）
// bar : 下段(1試合ごと)。get=その試合の数字
// fmt : 数字の見せ方（rate3=.310 / rate2=2.50 / ip=6.1 / int=整数）
const BAT_METRICS = [
  { title: "打率 AVG", fmt: "rate3",
    line: { label: "通算打率", get: (s) => parseFloat(s.avg) || 0 },
    bar: { label: "その試合の安打数", get: (s) => num(s.hits), fmt: "int" } },
  { title: "本塁打 HR", fmt: "int",
    line: { label: "累計本塁打", cum: "homeRuns" },
    bar: { label: "その試合の本塁打", get: (s) => num(s.homeRuns), fmt: "int" } },
  { title: "打点 RBI", fmt: "int",
    line: { label: "累計打点", cum: "rbi" },
    bar: { label: "その試合の打点", get: (s) => num(s.rbi), fmt: "int" } },
  { title: "OPS（総合力）", fmt: "rate3",
    line: { label: "通算OPS", get: (s) => parseFloat(s.ops) || 0 },
    bar: { label: "その試合の塁打数", get: (s) => num(s.totalBases), fmt: "int" } },
  { title: "盗塁 SB", fmt: "int",
    line: { label: "累計盗塁", cum: "stolenBases" },
    bar: { label: "その試合の盗塁", get: (s) => num(s.stolenBases), fmt: "int" } },
];
const PIT_METRICS = [
  { title: "防御率 ERA（低いほど良い）", fmt: "rate2",
    line: { label: "通算防御率", get: (s) => parseFloat(s.era) || 0 },
    bar: { label: "その試合の自責点", get: (s) => num(s.earnedRuns), fmt: "int" } },
  { title: "奪三振 K", fmt: "int",
    line: { label: "累計奪三振", cum: "strikeOuts" },
    bar: { label: "その試合の奪三振", get: (s) => num(s.strikeOuts), fmt: "int" } },
  { title: "投球回（イニング）", fmt: "ip",
    line: { label: "累計投球回", cumIp: "inningsPitched" },
    bar: { label: "その試合の投球回", get: (s) => ipToOuts(s.inningsPitched) / 3, fmt: "ip" } },
  { title: "WHIP（安定感・低いほど良い）", fmt: "rate2",
    line: { label: "通算WHIP", get: (s) => parseFloat(s.whip) || 0 },
    bar: { label: "その試合の与四球＋被安打", get: (s) => num(s.baseOnBalls) + num(s.hits), fmt: "int" } },
];

// ===== データ取得 =====
async function fetchGameLog(group, season) {
  const data = await getJson(`${API}/people/${PLAYER_ID}/stats?stats=gameLog&group=${group}&season=${season}`);
  const st = data.stats || [];
  if (st.length && st[0].splits && st[0].splits.length) return st[0].splits;
  return [];
}

// 名前がURLで渡されなかった時だけ、MLBから選手名（英語）を1回引いて補う
async function fetchPlayerName() {
  try {
    const data = await getJson(`${API}/people/${PLAYER_ID}`);
    const person = (data.people || [])[0] || {};
    return person.fullName || "";
  } catch (e) {
    return "";
  }
}

// 見出し・顔写真・ページタイトルを、選んだ選手に合わせて差し替える
function applyPlayerIdentity() {
  const name = PLAYER_NAME || "選手";
  const h1 = $("page-title");
  if (h1) h1.textContent = name + " シーズン推移";
  const intro = $("intro-name");
  if (intro) intro.firstChild ? (intro.firstChild.textContent = name + " ") : (intro.textContent = name);
  const av = $("player-avatar");
  if (av) {
    av.src = `https://midfield.mlbstatic.com/v1/people/${PLAYER_ID}/spots/120`;
    av.alt = name;
  }
  document.title = `${name} シーズン推移 ｜ 日本人メジャーリーガー成績ダッシュボード`;
}

// ===== SPOTV NOW ダイジェスト動画の埋め込み =====
// 毎朝の自動更新(fetch_stats.py)が「各選手の最新ダイジェスト動画」を data/spotv_videos.json に保存する。
// ここではまずその最新動画(1本)を埋め込む。無ければ再生リストまるごとにフォールバックする。
async function setupSpotvVideo() {
  const section = $("spotv");
  const holder = $("spotv-player");
  if (!section || !holder) return;

  // ① 最新動画（毎朝の自動更新が選んだ1本）
  let videoId = null;
  try {
    const data = await getJson("data/spotv_videos.json");
    const v = (data.videos || {})[String(PLAYER_ID)];
    if (v && v.videoId) videoId = v.videoId;
  } catch (e) { /* 無ければ再生リストにフォールバック */ }

  // ② 再生リストID（最新動画が無い選手のフォールバック用）
  let listId = null;
  try {
    const map = await getJson("config/spotv_playlists.json");
    listId = map[String(PLAYER_ID)] || null;
  } catch (e) { /* 対応表が無ければ listId は null */ }

  if (!videoId && !listId) return; // この選手は未対応 → 動画欄は隠したまま

  // 最新動画があればその1本を、無ければ再生リストを埋め込む。
  const src = videoId
    ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`
    : `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(listId)}`;

  const iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.title = `${PLAYER_NAME || "選手"} ダイジェスト動画（SPOTV NOW）`;
  iframe.loading = "lazy";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.allowFullscreen = true;
  holder.appendChild(iframe);
  section.hidden = false;
}

// ===== 起動 =====
window.addEventListener("DOMContentLoaded", init);

async function init() {
  const season = currentSeason();
  $("season").textContent = "シーズン: " + season;

  // 名前がURLで渡っていなければ、先にMLBから補ってから見出しを整える
  if (!PLAYER_NAME) PLAYER_NAME = await fetchPlayerName();
  applyPlayerIdentity();

  // SPOTV NOW のダイジェスト動画（再生リスト）を出す（登録がある選手だけ）
  setupSpotvVideo();

  setStatus("成績を取得しています…（数秒かかります）");

  try {
    const [pit, hit] = await Promise.all([
      fetchGameLog("pitching", season),
      fetchGameLog("hitting", season),
    ]);
    SPLITS.pitching = pit;
    SPLITS.hitting = hit;
    setStatus("");
  } catch (e) {
    setStatus("成績の取得に失敗しました。少し待ってページを開き直してください。", true);
    return;
  }

  const hasPit = !!(SPLITS.pitching && SPLITS.pitching.length);
  const hasHit = !!(SPLITS.hitting && SPLITS.hitting.length);

  // どちらの記録も無い選手（故障中など）
  if (!hasPit && !hasHit) {
    document.getElementById("tabs").style.display = "none";
    $("charts").innerHTML = `<div class="highlight-empty">今シーズンの記録はまだありません。</div>`;
    return;
  }

  // その選手に記録がある側のタブだけ表示する（投手専任なら投手だけ、野手なら野手だけ）。
  // 片方しか無ければタブ自体を隠す（切り替える必要がないため）。
  const tabBar = document.getElementById("tabs");
  document.querySelectorAll("#tabs .tab-btn").forEach((btn) => {
    const has = btn.dataset.group === "pitching" ? hasPit : hasHit;
    btn.style.display = has ? "" : "none";
    btn.addEventListener("click", () => showTab(btn.dataset.group));
  });
  if (!(hasPit && hasHit)) tabBar.style.display = "none";

  // どのタブで開くか：一覧のボタンが付けた ?tab=pitching/hitting を優先。
  // 指定が無い／その種類の記録がまだ無ければ、記録のある側を表示する。
  const requested = _params.get("tab");
  let first = (requested === "pitching" || requested === "hitting") ? requested : "pitching";
  if (!(SPLITS[first] && SPLITS[first].length)) {
    first = hasPit ? "pitching" : "hitting";
  }
  showTab(first);
}

function showTab(group) {
  currentGroup = group;
  document.querySelectorAll("#tabs .tab-btn").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.group === group));
  renderGroup(group);
}

// ===== 描画 =====
function renderGroup(group) {
  // 既存グラフを破棄（メモリ・描画の二重化を防ぐ）
  charts.forEach((c) => c.destroy());
  charts = [];

  const area = $("charts");
  area.innerHTML = "";

  const splits = SPLITS[group] || [];
  if (!splits.length) {
    area.innerHTML = `<div class="highlight-empty">今シーズンの${group === "pitching" ? "登板" : "出場"}記録はまだありません。</div>`;
    return;
  }

  const metrics = group === "pitching" ? PIT_METRICS : BAT_METRICS;
  const labels = splits.map((sp) => mmdd(sp.date));

  metrics.forEach((m, idx) => {
    const lineData = buildLine(splits, m);
    const barData = splits.map((sp) => m.bar.get(sp.stat || {}));

    const block = document.createElement("div");
    block.className = "metric";
    block.innerHTML = `
      <h3 class="metric-title">${m.title}</h3>
      <div class="chart-panel">
        <div class="panel-label">▲ 移り変わり（${m.line.label}）</div>
        <div class="canvas-wrap"><canvas id="line-${idx}"></canvas></div>
      </div>
      <div class="chart-panel">
        <div class="panel-label">▼ 1試合ごと（${m.bar.label}）</div>
        <div class="canvas-wrap"><canvas id="bar-${idx}"></canvas></div>
      </div>`;
    area.appendChild(block);

    charts.push(makeLine($(`line-${idx}`), labels, lineData, m.line.label, m.fmt));
    charts.push(makeBar($(`bar-${idx}`), labels, barData, m.bar.label, m.bar.fmt));
  });

  // 下部に「最近の試合」の表を少しだけ
  area.appendChild(recentTable(splits, group));
}

// 上段（移り変わり）の数値列を作る
function buildLine(splits, m) {
  const out = [];
  let sum = 0, outs = 0;
  for (const sp of splits) {
    const s = sp.stat || {};
    if (m.line.cum) { sum += num(s[m.line.cum]); out.push(sum); }
    else if (m.line.cumIp) { outs += ipToOuts(s[m.line.cumIp]); out.push(Math.round((outs / 3) * 10) / 10); }
    else { out.push(m.line.get(s)); }
  }
  return out;
}

// ===== 数字の見せ方 =====
function fmtValue(v, fmt) {
  if (v == null || isNaN(v)) return "—";
  if (fmt === "rate3") return v.toFixed(3).replace(/^0/, ""); // .310
  if (fmt === "rate2") return v.toFixed(2);                   // 2.50
  if (fmt === "ip") return outsToIpStr(Math.round(v * 3));    // 6.1
  return "" + v;                                              // 整数
}

const NAVY = "#1B3A5C";
const ACCENT = "#4A90D9";

function makeLine(canvas, labels, data, label, fmt) {
  return new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label, data,
        borderColor: ACCENT, backgroundColor: "rgba(74,144,217,.12)",
        borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.25, fill: true,
      }],
    },
    options: chartOptions(fmt, false),
  });
}
function makeBar(canvas, labels, data, label, fmt) {
  return new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ label, data, backgroundColor: NAVY, borderRadius: 2 }] },
    options: chartOptions(fmt, true),
  });
}
function chartOptions(fmt, beginAtZero) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => fmtValue(ctx.parsed.y, fmt),
          title: (items) => items[0].label,
        },
      },
    },
    scales: {
      x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8, font: { size: 10 } }, grid: { display: false } },
      y: {
        beginAtZero,
        ticks: { callback: (v) => fmtValue(v, fmt), font: { size: 10 } },
        grid: { color: "rgba(0,0,0,.06)" },
      },
    },
  };
}

// ===== 最近の試合の表 =====
function recentTable(splits, group) {
  const recent = splits.slice(-10).reverse(); // 直近10試合、新しい順
  const head = group === "pitching"
    ? "<tr><th>日付</th><th>相手</th><th>内容</th><th>通算ERA</th></tr>"
    : "<tr><th>日付</th><th>相手</th><th>内容</th><th>通算打率</th></tr>";
  const rows = recent.map((sp) => {
    const s = sp.stat || {};
    const opp = (sp.opponent || {}).name || "";
    const summary = s.summary || "";
    const cum = group === "pitching" ? fmtValue(parseFloat(s.era) || 0, "rate2")
                                     : fmtValue(parseFloat(s.avg) || 0, "rate3");
    return `<tr><td>${mmdd(sp.date)}</td><td class="opp">${opp}</td><td>${summary}</td><td>${cum}</td></tr>`;
  }).join("");

  const wrap = document.createElement("div");
  wrap.className = "recent-table";
  wrap.innerHTML = `<div class="recent-label">直近の試合（新しい順・最大10試合）</div>
    <table>${head}${rows}</table>`;
  return wrap;
}
