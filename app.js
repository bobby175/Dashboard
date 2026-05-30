/* Catat Keuangan — Web Dashboard
 * Sinkron dengan aplikasi Android via Apps Script Web App + Webhook Secret.
 * Tidak ada server sendiri: semua fetch langsung ke URL Apps Script kamu.
 */

const LS_KEY = "ck_dashboard_config_v1";
const LS_HIDE = "ck_dashboard_hide";

const state = {
  url: "",
  secret: "",
  transactions: [],
  budgets: [],
  goals: [],
  recurring: [],
  month: currentYM(),
  gran: "harian",
  filterTipe: null,
  filterAkun: null,
  search: "",
  hide: localStorage.getItem(LS_HIDE) === "1",
};

let cashflowChart = null;
let categoryChart = null;

// ---------------- Utils ----------------
function currentYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function addMonths(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  const names = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  return `${names[m] || m} ${y}`;
}
function ymOf(iso) {
  return (iso || "").slice(0, 7);
}
function fmtRp(n) {
  if (state.hide) return "Rp ••••••";
  const neg = n < 0 ? "-" : "";
  return "Rp " + neg + Math.abs(Math.round(n)).toLocaleString("id-ID");
}
function shortRp(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + "M";
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "jt";
  if (a >= 1e3) return Math.round(n / 1e3) + "rb";
  return String(Math.round(n));
}
function isTransfer(t) { return (t.kategori || "").toLowerCase() === "transfer"; }
function isIncome(t) { return (t.tipe || "").toLowerCase() === "pemasukan"; }
function isExpense(t) { return (t.tipe || "").toLowerCase() === "pengeluaran"; }

const PALETTE = ["#6366f1", "#f43f5e", "#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#ec4899", "#84cc16", "#64748b"];

// ---------------- Network ----------------
async function callApi(action, extra = {}) {
  const payload = JSON.stringify({ secret: state.secret, action, ...extra });
  // text/plain → hindari CORS preflight (Apps Script tidak menangani OPTIONS)
  const resp = await fetch(state.url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: payload,
    redirect: "follow",
  });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); }
  catch (e) { throw new Error("Respons tidak valid (cek URL Web App)."); }
  if (json.ok === false) {
    if ((json.error || "").toLowerCase().includes("unauthorized"))
      throw new Error("Secret salah / tidak cocok dengan Apps Script.");
    throw new Error(json.error || "Backend menolak permintaan.");
  }
  return json;
}

async function loadAll() {
  showLoader(true);
  setStatus("Memuat...");
  try {
    // Transaksi wajib; budget/goal/recurring opsional (bila backend versi lama)
    const tx = await callApi("list");
    state.transactions = (tx.transactions || []).filter((t) => t.id);

    state.budgets = await safe(() => callApi("budgetList").then((r) => r.budgets || []), []);
    state.goals = await safe(() => callApi("goalList").then((r) => r.goals || []), []);
    state.recurring = await safe(() => callApi("recurringList").then((r) => r.recurring || []), []);

    render();
    setStatus("Tersinkron • " + new Date().toLocaleTimeString("id-ID"));
  } catch (e) {
    setStatus("Gagal: " + e.message);
    alert("Gagal memuat data: " + e.message);
  } finally {
    showLoader(false);
  }
}

async function safe(fn, fallback) {
  try { return await fn(); } catch (e) { return fallback; }
}

// ---------------- Computations ----------------
function accountBalances() {
  const map = {};
  for (const t of state.transactions) {
    const akun = (t.akun || "Tunai").trim() || "Tunai";
    const delta = isIncome(t) ? t.jumlah : isExpense(t) ? -t.jumlah : 0;
    map[akun] = (map[akun] || 0) + delta;
  }
  return map;
}
function totalBalance() {
  return Object.values(accountBalances()).reduce((a, b) => a + b, 0);
}
function monthTx(ym) {
  return state.transactions.filter((t) => ymOf(t.tanggal) === ym);
}

// ---------------- Render ----------------
function render() {
  renderKpi();
  renderAccounts();
  renderCashflow();
  renderCategory();
  renderBudgets();
  renderGoals();
  renderRecurring();
  renderFilters();
  renderTable();
  document.getElementById("monthLabel").textContent = monthLabel(state.month);
  document.getElementById("todayLabel").textContent =
    new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function renderKpi() {
  const mtx = monthTx(state.month).filter((t) => !isTransfer(t));
  const income = mtx.filter(isIncome).reduce((a, t) => a + t.jumlah, 0);
  const expense = mtx.filter(isExpense).reduce((a, t) => a + t.jumlah, 0);
  document.getElementById("kpiBalance").textContent = fmtRp(totalBalance());
  document.getElementById("kpiIncome").textContent = fmtRp(income);
  document.getElementById("kpiExpense").textContent = fmtRp(expense);
  document.getElementById("kpiCount").textContent = state.hide ? "•••" : String(monthTx(state.month).length);
}

function renderAccounts() {
  const map = accountBalances();
  const el = document.getElementById("accounts");
  const entries = Object.entries(map).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) { el.innerHTML = '<div class="muted">Belum ada akun.</div>'; return; }
  el.innerHTML = entries.map(([name, val]) => `
    <div class="acct">
      <div class="name">${esc(name)}</div>
      <div class="val">${fmtRp(val)}</div>
    </div>`).join("");
}

function buildCashflowPoints() {
  const ym = state.month;
  if (state.gran === "bulanan") {
    const pts = [];
    for (let off = -5; off <= 0; off++) {
      const m = addMonths(ym, off);
      const mt = state.transactions.filter((t) => ymOf(t.tanggal) === m && !isTransfer(t));
      pts.push({
        label: monthLabel(m).split(" ")[0].slice(0, 3),
        income: mt.filter(isIncome).reduce((a, t) => a + t.jumlah, 0),
        expense: mt.filter(isExpense).reduce((a, t) => a + t.jumlah, 0),
      });
    }
    return pts;
  }
  const [y, m] = ym.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const daily = [];
  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dt = state.transactions.filter((t) => t.tanggal === iso && !isTransfer(t));
    daily.push({
      day: d,
      income: dt.filter(isIncome).reduce((a, t) => a + t.jumlah, 0),
      expense: dt.filter(isExpense).reduce((a, t) => a + t.jumlah, 0),
    });
  }
  if (state.gran === "mingguan") {
    const weeks = {};
    daily.forEach((b) => {
      const w = Math.floor((b.day - 1) / 7);
      if (!weeks[w]) weeks[w] = { income: 0, expense: 0 };
      weeks[w].income += b.income; weeks[w].expense += b.expense;
    });
    return Object.keys(weeks).sort((a, b) => a - b).map((w) => ({
      label: "Mg " + (Number(w) + 1), income: weeks[w].income, expense: weeks[w].expense,
    }));
  }
  return daily.map((b) => ({ label: String(b.day), income: b.income, expense: b.expense }));
}

function renderCashflow() {
  const pts = buildCashflowPoints();
  const ctx = document.getElementById("cashflowChart");
  const data = {
    labels: pts.map((p) => p.label),
    datasets: [
      { label: "Pemasukan", data: pts.map((p) => p.income), borderColor: "#10b981", backgroundColor: "rgba(16,185,129,0.15)", fill: true, tension: 0.4, pointRadius: 2 },
      { label: "Pengeluaran", data: pts.map((p) => p.expense), borderColor: "#f43f5e", backgroundColor: "rgba(244,63,94,0.12)", fill: true, tension: 0.4, pointRadius: 2 },
    ],
  };
  const opts = {
    responsive: true,
    plugins: { legend: { labels: { color: "#9aa3c7", boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: "#9aa3c7", maxTicksLimit: 10 }, grid: { color: "rgba(46,55,96,0.4)" } },
      y: { ticks: { color: "#9aa3c7", callback: (v) => shortRp(v) }, grid: { color: "rgba(46,55,96,0.4)" } },
    },
  };
  if (cashflowChart) { cashflowChart.data = data; cashflowChart.options = opts; cashflowChart.update(); }
  else cashflowChart = new Chart(ctx, { type: "line", data, options: opts });
}

function renderCategory() {
  const mtx = monthTx(state.month).filter((t) => isExpense(t) && !isTransfer(t));
  const by = {};
  mtx.forEach((t) => { const k = t.kategori || "Lainnya"; by[k] = (by[k] || 0) + t.jumlah; });
  const entries = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const ctx = document.getElementById("categoryChart");
  const data = {
    labels: entries.map((e) => e[0]),
    datasets: [{ data: entries.map((e) => e[1]), backgroundColor: PALETTE, borderWidth: 0 }],
  };
  const opts = {
    responsive: true,
    plugins: {
      legend: { position: "right", labels: { color: "#9aa3c7", boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: { label: (c) => `${c.label}: ${fmtRp(c.raw)}` } },
    },
  };
  if (entries.length === 0) {
    if (categoryChart) { categoryChart.destroy(); categoryChart = null; }
    ctx.style.display = "none";
    return;
  }
  ctx.style.display = "";
  if (categoryChart) { categoryChart.data = data; categoryChart.options = opts; categoryChart.update(); }
  else categoryChart = new Chart(ctx, { type: "doughnut", data, options: opts });
}

function renderBudgets() {
  const el = document.getElementById("budgets");
  const list = state.budgets.filter((b) => b.bulan === state.month);
  if (list.length === 0) { el.innerHTML = '<div class="muted">Belum ada budget bulan ini.</div>'; return; }
  const mtx = monthTx(state.month).filter((t) => isExpense(t) && !isTransfer(t));
  el.innerHTML = list.map((b) => {
    const spent = mtx.filter((t) => (t.kategori || "").toLowerCase() === (b.kategori || "").toLowerCase()).reduce((a, t) => a + t.jumlah, 0);
    const pct = b.limitAmount > 0 ? (spent / b.limitAmount) * 100 : 0;
    const color = pct >= 100 ? "#f43f5e" : pct >= 80 ? "#f59e0b" : "#10b981";
    const sisa = b.limitAmount - spent;
    const label = pct >= 100 ? `Terlewati ${fmtRp(-sisa)}` : `Sisa ${fmtRp(sisa)}`;
    return progItem(b.kategori, pct, color, `${fmtRp(spent)} / ${fmtRp(b.limitAmount)} · ${label}`);
  }).join("");
}

function renderGoals() {
  const el = document.getElementById("goals");
  const bal = accountBalances();
  const list = state.goals.filter((g) => g.enabled !== false);
  if (list.length === 0) { el.innerHTML = '<div class="muted">Belum ada goal.</div>'; return; }
  el.innerHTML = list.map((g) => {
    const goalAkun = g.goalAkun || `Tabungan ${g.name}`;
    const saldo = bal[goalAkun] || g.currentAmount || 0;
    const pct = g.targetAmount > 0 ? (saldo / g.targetAmount) * 100 : 0;
    const color = pct >= 100 ? "#10b981" : "#6366f1";
    return progItem(g.name, pct, color, `${fmtRp(saldo)} / ${fmtRp(g.targetAmount)} · deadline ${g.deadline || "-"}`);
  }).join("");
}

function progItem(name, pct, color, sub) {
  const w = Math.max(0, Math.min(100, pct));
  return `
    <div class="prog-item">
      <div class="prog-top"><span>${esc(name)}</span><span class="pct" style="color:${color}">${Math.round(pct)}%</span></div>
      <div class="bar"><span style="width:${w}%;background:${color}"></span></div>
      <div class="prog-sub">${sub}</div>
    </div>`;
}

function renderRecurring() {
  const el = document.getElementById("recurring");
  const list = state.recurring.filter((r) => r.enabled !== false);
  if (list.length === 0) { el.innerHTML = '<div class="muted">Belum ada transaksi berulang aktif.</div>'; return; }
  const freq = { DAILY: "Harian", WEEKLY: "Mingguan", MONTHLY: "Bulanan", YEARLY: "Tahunan" };
  el.innerHTML = list.map((r) => {
    const inc = (r.tipe || "").toLowerCase() === "pemasukan";
    let f = freq[(r.frequency || "").toUpperCase()] || r.frequency;
    if ((r.frequency || "").toUpperCase() === "MONTHLY") f += ` (tgl ${r.dayOfMonth})`;
    return `
      <div class="rec-item">
        <div class="rec-ico">🔁</div>
        <div class="rec-main">
          <div class="rec-title">${esc(r.merchant || r.kategori)}</div>
          <div class="rec-sub">${f} · ${esc(r.akun || "Tunai")}</div>
        </div>
        <div class="${inc ? "amt-in" : "amt-out"}">${inc ? "+ " : "- "}${fmtRp(r.jumlah)}</div>
      </div>`;
  }).join("");
}

function renderFilters() {
  const el = document.getElementById("filters");
  const akuns = [...new Set(state.transactions.map((t) => t.akun).filter(Boolean))].sort();
  const chips = [
    chip("Pemasukan", state.filterTipe === "Pemasukan", () => toggleTipe("Pemasukan")),
    chip("Pengeluaran", state.filterTipe === "Pengeluaran", () => toggleTipe("Pengeluaran")),
    ...akuns.map((a) => chip(a, state.filterAkun === a, () => toggleAkun(a))),
  ];
  el.innerHTML = "";
  chips.forEach((c) => el.appendChild(c));
}
function chip(label, active, onClick) {
  const b = document.createElement("button");
  b.className = "chip" + (active ? " active" : "");
  b.textContent = label;
  b.onclick = onClick;
  return b;
}
function toggleTipe(t) { state.filterTipe = state.filterTipe === t ? null : t; render(); }
function toggleAkun(a) { state.filterAkun = state.filterAkun === a ? null : a; render(); }

function renderTable() {
  const body = document.getElementById("txBody");
  const empty = document.getElementById("txEmpty");
  let rows = monthTx(state.month).slice();
  if (state.filterTipe) rows = rows.filter((t) => (t.tipe || "").toLowerCase() === state.filterTipe.toLowerCase());
  if (state.filterAkun) rows = rows.filter((t) => (t.akun || "") === state.filterAkun);
  if (state.search) {
    const q = state.search.toLowerCase();
    rows = rows.filter((t) => [t.merchant, t.deskripsi, t.kategori, t.akun].join(" ").toLowerCase().includes(q));
  }
  rows.sort((a, b) => (b.tanggal + (b.jam || "")).localeCompare(a.tanggal + (a.jam || "")));

  if (rows.length === 0) { body.innerHTML = ""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  body.innerHTML = rows.map((t) => {
    const inc = isIncome(t);
    return `<tr>
      <td>${esc(t.tanggal)}${t.jam ? `<br><span class="muted" style="font-size:11px">${esc(t.jam.slice(0,5))}</span>` : ""}</td>
      <td>${esc(t.tipe)}</td>
      <td>${esc(t.kategori || "-")}</td>
      <td>${esc(t.akun || "-")}</td>
      <td>${esc(t.merchant || "-")}</td>
      <td class="right ${inc ? "amt-in" : "amt-out"}">${inc ? "+ " : "- "}${fmtRp(t.jumlah)}</td>
    </tr>`;
  }).join("");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------- UI plumbing ----------------
function showLoader(b) { document.getElementById("loader").classList.toggle("hidden", !b); }
function setStatus(s) { document.getElementById("status").textContent = s; }

function connect(url, secret) {
  state.url = (url || "").trim().replace(/\s/g, "");
  state.secret = (secret || "").trim();
  if (!state.url.startsWith("https://") || !state.url.includes("script.google.com")) {
    return setupMsg("URL harus URL Web App Apps Script (diakhiri /exec).", true);
  }
  if (!state.secret) return setupMsg("Secret tidak boleh kosong.", true);
  localStorage.setItem(LS_KEY, JSON.stringify({ url: state.url, secret: state.secret }));
  showApp();
  loadAll();
}

function setupMsg(msg, err) {
  const el = document.getElementById("setupMsg");
  el.textContent = msg;
  el.className = "setup-msg " + (err ? "err" : "ok");
}

function showApp() {
  document.getElementById("setup").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
}
function showSetup() {
  document.getElementById("app").classList.add("hidden");
  document.getElementById("setup").classList.remove("hidden");
}

function parseConfig(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return null; }
  const url = obj.webhookUrl || obj.url || "";
  const secret = obj.webhookSecret || obj.secret || "";
  if (!url) return null;
  return { url, secret };
}

// ---------------- Init ----------------
function init() {
  // Setup tabs
  document.querySelectorAll(".tab").forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      document.querySelectorAll(".tab-body").forEach((b) => b.classList.add("hidden"));
      document.getElementById("tab-" + t.dataset.tab).classList.remove("hidden");
    };
  });

  // File import
  const dz = document.getElementById("dropzone");
  const fi = document.getElementById("fileInput");
  fi.onchange = (e) => handleFile(e.target.files[0]);
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault(); dz.classList.remove("drag");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  document.getElementById("pasteBtn").onclick = () => {
    const cfg = parseConfig(document.getElementById("pasteArea").value);
    if (!cfg) return setupMsg("JSON tidak valid / tidak ada webhookUrl.", true);
    connect(cfg.url, cfg.secret);
  };
  document.getElementById("manualBtn").onclick = () => {
    connect(document.getElementById("manualUrl").value, document.getElementById("manualSecret").value);
  };

  // App controls
  document.getElementById("refreshBtn").onclick = loadAll;
  document.getElementById("disconnectBtn").onclick = () => {
    if (confirm("Putuskan koneksi & hapus config dari browser ini?")) {
      localStorage.removeItem(LS_KEY); showSetup();
    }
  };
  document.getElementById("hideBtn").onclick = () => {
    state.hide = !state.hide;
    localStorage.setItem(LS_HIDE, state.hide ? "1" : "0");
    render();
  };
  document.getElementById("prevMonth").onclick = () => { state.month = addMonths(state.month, -1); render(); };
  document.getElementById("nextMonth").onclick = () => { state.month = addMonths(state.month, 1); render(); };
  document.getElementById("searchInput").oninput = (e) => { state.search = e.target.value; renderTable(); };
  document.querySelectorAll(".seg-btn").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      state.gran = b.dataset.gran;
      renderCashflow();
    };
  });

  // Auto-connect kalau sudah pernah
  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    try {
      const cfg = JSON.parse(saved);
      state.url = cfg.url; state.secret = cfg.secret;
      showApp(); loadAll();
    } catch (e) { showSetup(); }
  }
}

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const cfg = parseConfig(reader.result);
    if (!cfg) return setupMsg("File config tidak valid.", true);
    connect(cfg.url, cfg.secret);
  };
  reader.readAsText(file);
}

document.addEventListener("DOMContentLoaded", init);
