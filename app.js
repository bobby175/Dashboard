/* Catat Keuangan — Web Dashboard
 * Sinkron dengan aplikasi Android via Apps Script Web App + Webhook Secret.
 * Tidak ada server sendiri: semua fetch langsung ke URL Apps Script kamu.
 */

const LS_KEY = "ck_dashboard_config_v1";
const LS_HIDE = "ck_dashboard_hide";
const LS_ACCOUNT_ORDER = "ck_dashboard_account_order";

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
  editAccounts: false,
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
  return fmtRpRaw(n);
}
function fmtRpRaw(n) {
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
const DEFAULT_ACCOUNT_ORDER = [
  "Tunai", "DANA", "GoPay", "OVO", "ShopeePay",
  "BCA", "Mandiri", "BRI", "BNI", "Kartu Kredit", "Lainnya"
];
const ACCOUNT_STYLES = {
  Tunai: { badge: "Rp", from: "#16a34a", to: "#15803d" },
  DANA: { badge: "DW", from: "#3b82f6", to: "#1d4ed8" },
  GoPay: { badge: "GP", from: "#06b6d4", to: "#0e7490" },
  OVO: { badge: "OV", from: "#8b5cf6", to: "#6d28d9" },
  ShopeePay: { badge: "SP", from: "#f97316", to: "#c2410c" },
  BCA: { badge: "BC", from: "#2563eb", to: "#1e40af" },
  Mandiri: { badge: "MD", from: "#14b8a6", to: "#0f766e" },
  BRI: { badge: "BR", from: "#1e40af", to: "#1e3a8a" },
  BNI: { badge: "BN", from: "#f59e0b", to: "#b45309" },
  "Kartu Kredit": { badge: "CC", from: "#f43f5e", to: "#be123c" },
  Lainnya: { badge: "LA", from: "#64748b", to: "#334155" },
};

function accountStyle(name) { return ACCOUNT_STYLES[name] || ACCOUNT_STYLES.Lainnya; }
function savedAccountOrder() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_ACCOUNT_ORDER) || "[]");
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  } catch (e) {
    return [];
  }
}
function normalizedAccountOrder(extraNames = []) {
  return [...new Set([...savedAccountOrder(), ...DEFAULT_ACCOUNT_ORDER, ...extraNames])];
}
function saveAccountOrder(order) {
  localStorage.setItem(LS_ACCOUNT_ORDER, JSON.stringify(normalizedAccountOrder(order)));
}
function sortAccounts(names) {
  const order = normalizedAccountOrder(names);
  const index = new Map(order.map((name, i) => [name.toLowerCase(), i]));
  return names.slice().sort((a, b) => {
    const ia = index.has(a.toLowerCase()) ? index.get(a.toLowerCase()) : Number.MAX_SAFE_INTEGER;
    const ib = index.has(b.toLowerCase()) ? index.get(b.toLowerCase()) : Number.MAX_SAFE_INTEGER;
    return ia - ib || a.localeCompare(b, "id-ID");
  });
}

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
    const data = await loadDashboardData();
    state.transactions = (data.transactions || []).filter((t) => t.id);
    state.budgets = data.budgets || [];
    state.goals = data.goals || [];
    state.recurring = data.recurring || [];

    render();
    setStatus("Tersinkron • " + new Date().toLocaleTimeString("id-ID"));
  } catch (e) {
    setStatus("Gagal: " + e.message);
    alert("Gagal memuat data: " + e.message);
  } finally {
    showLoader(false);
  }
}

async function loadDashboardData() {
  const combined = await safe(() => callApi("dashboardData"), null);
  if (combined) return combined;

  const [tx, budgets, goals, recurring] = await Promise.all([
    callApi("list"),
    safe(() => callApi("budgetList").then((r) => r.budgets || []), []),
    safe(() => callApi("goalList").then((r) => r.goals || []), []),
    safe(() => callApi("recurringList").then((r) => r.recurring || []), []),
  ]);
  return {
    transactions: tx.transactions || [],
    budgets,
    goals,
    recurring,
  };
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
  const editBtn = document.getElementById("editAccountsBtn");
  const names = sortAccounts(Object.keys(map).filter((name) => map[name] !== 0));
  const entries = names.map((name) => [name, map[name]]);
  if (editBtn) {
    editBtn.textContent = state.editAccounts ? "Selesai" : "Edit";
    editBtn.classList.toggle("active", state.editAccounts);
  }
  if (entries.length === 0) { el.innerHTML = '<div class="muted">Belum ada akun.</div>'; return; }
  el.innerHTML = entries.map(([name, val]) => `
    <div class="acct ${state.editAccounts ? "editing" : ""}"
      style="--from:${accountStyle(name).from};--to:${accountStyle(name).to}"
      draggable="${state.editAccounts ? "true" : "false"}"
      data-account="${esc(name)}">
      <div class="acct-top">
        <div class="acct-badge">${esc(accountStyle(name).badge)}</div>
        <div class="name">${esc(name)}</div>
        ${state.editAccounts ? '<div class="drag-mark">=</div>' : ""}
      </div>
      <div class="acct-sub">Saldo</div>
      <div class="val">${fmtRp(val)}</div>
    </div>`).join("");
  if (state.editAccounts) setupAccountDrag();
}

function setupAccountDrag() {
  let dragged = null;
  document.querySelectorAll(".acct").forEach((card) => {
    card.addEventListener("dragstart", () => {
      dragged = card.dataset.account;
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      dragged = null;
    });
    card.addEventListener("dragover", (e) => e.preventDefault());
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      const target = card.dataset.account;
      if (!dragged || dragged === target) return;
      const current = sortAccounts(Object.keys(accountBalances()).filter((name) => accountBalances()[name] !== 0));
      const from = current.indexOf(dragged);
      const to = current.indexOf(target);
      if (from < 0 || to < 0) return;
      const [moved] = current.splice(from, 1);
      current.splice(to, 0, moved);
      saveAccountOrder(current);
      renderAccounts();
      renderFilters();
    });
  });
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
  const akuns = sortAccounts([...new Set(state.transactions.map((t) => t.akun).filter(Boolean))]);
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

// ---------------- Settlement download ----------------
function settlementRows() {
  return monthTx(state.month)
    .slice()
    .sort((a, b) => (a.tanggal + (a.jam || "")).localeCompare(b.tanggal + (b.jam || "")));
}

function settlementSummary() {
  const rows = settlementRows();
  const nonTransfer = rows.filter((t) => !isTransfer(t));
  const income = nonTransfer.filter(isIncome).reduce((a, t) => a + t.jumlah, 0);
  const expense = nonTransfer.filter(isExpense).reduce((a, t) => a + t.jumlah, 0);
  const balances = accountBalances();
  const categoryExpense = {};
  const accountDelta = {};

  rows.forEach((t) => {
    const akun = t.akun || "Tunai";
    const delta = isIncome(t) ? t.jumlah : isExpense(t) ? -t.jumlah : 0;
    accountDelta[akun] = (accountDelta[akun] || 0) + delta;
    if (isExpense(t) && !isTransfer(t)) {
      const kategori = t.kategori || "Lainnya";
      categoryExpense[kategori] = (categoryExpense[kategori] || 0) + t.jumlah;
    }
  });

  return {
    rows,
    income,
    expense,
    net: income - expense,
    balance: Object.values(balances).reduce((a, b) => a + b, 0),
    accountBalances: sortAccounts(Object.keys(balances))
      .filter((name) => balances[name] !== 0)
      .map((name) => [name, balances[name]]),
    accountDelta: Object.entries(accountDelta).sort((a, b) => b[1] - a[1]),
    categoryExpense: Object.entries(categoryExpense).sort((a, b) => b[1] - a[1]),
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadSettlementCsv() {
  const sum = settlementSummary();
  const lines = [
    ["Settlement Bulanan", monthLabel(state.month)],
    ["Saldo Total", fmtRpRaw(sum.balance)],
    ["Pemasukan", fmtRpRaw(sum.income)],
    ["Pengeluaran", fmtRpRaw(sum.expense)],
    ["Selisih", fmtRpRaw(sum.net)],
    ["Total Transaksi", sum.rows.length],
    [],
    ["Saldo per Akun"],
    ...sum.accountBalances.map(([name, val]) => [name, fmtRpRaw(val)]),
    [],
    ["Tanggal", "Jam", "Tipe", "Kategori", "Akun", "Merchant", "Deskripsi", "Jumlah"],
    ...sum.rows.map((t) => [
      t.tanggal || "",
      (t.jam || "").slice(0, 5),
      t.tipe || "",
      t.kategori || "",
      t.akun || "",
      t.merchant || "",
      t.deskripsi || "",
      Math.round(t.jumlah || 0),
    ]),
  ];
  const csv = lines.map((row) => row.map(csvCell).join(";")).join("\n");
  downloadBlob(`settlement-${state.month}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");
}

function downloadSettlementPdf() {
  const api = window.jspdf;
  if (!api?.jsPDF) {
    alert("Library PDF belum termuat. Coba refresh halaman lalu download lagi.");
    return;
  }
  const doc = new api.jsPDF({ unit: "mm", format: "a4" });
  const sum = settlementSummary();
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 44;

  const drawMotif = () => {
    doc.setFillColor(248, 250, 252);
    doc.rect(0, 0, pageWidth, pageHeight, "F");

    doc.setFillColor(79, 70, 229);
    doc.rect(0, 0, pageWidth, 34, "F");
    doc.setFillColor(124, 58, 237);
    doc.circle(pageWidth - 10, -8, 38, "F");
    doc.setFillColor(67, 56, 202);
    doc.circle(pageWidth - 42, 24, 18, "F");

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    for (let x = -20; x < pageWidth; x += 14) {
      doc.line(x, 48, x + 40, 8);
    }

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text("Settlement Bulanan", margin, 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(monthLabel(state.month), margin, 23);
    doc.text("Catat Keuangan", pageWidth - margin, 15, { align: "right" });
    doc.text(new Date().toLocaleDateString("id-ID"), pageWidth - margin, 23, { align: "right" });
    doc.setTextColor(15, 23, 42);
  };

  const addPage = () => {
    doc.addPage();
    drawMotif();
    y = 44;
  };

  const ensureSpace = (height) => {
    if (y + height > pageHeight - 16) addPage();
  };

  const addLine = (text, size = 10, style = "normal") => {
    ensureSpace(8);
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(15, 23, 42);
    doc.text(String(text), margin, y);
    y += size >= 14 ? 8 : 6;
  };

  const sectionTitle = (title) => {
    ensureSpace(13);
    y += 2;
    doc.setFillColor(238, 242, 255);
    doc.roundedRect(margin, y - 5, pageWidth - margin * 2, 10, 3, 3, "F");
    doc.setTextColor(67, 56, 202);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title, margin + 4, y + 1.5);
    doc.setTextColor(15, 23, 42);
    y += 13;
  };

  const summaryCard = (x, yPos, label, value, color) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, yPos, 88, 24, 4, 4, "FD");
    doc.setFillColor(color[0], color[1], color[2]);
    doc.roundedRect(x, yPos, 3, 24, 2, 2, "F");
    doc.setTextColor(100, 116, 139);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(label, x + 8, yPos + 8);
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(value, x + 8, yPos + 17);
  };

  const addKeyValueRows = (rows, emptyText) => {
    if (rows.length === 0) {
      addLine(emptyText, 9);
      return;
    }
    rows.forEach(([name, val]) => {
      ensureSpace(7);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      doc.text(String(name), margin + 2, y);
      doc.setFont("helvetica", "bold");
      doc.text(fmtRpRaw(val), pageWidth - margin - 2, y, { align: "right" });
      y += 6;
    });
  };

  drawMotif();

  ensureSpace(55);
  summaryCard(margin, y, "Saldo Total", fmtRpRaw(sum.balance), [79, 70, 229]);
  summaryCard(margin + 94, y, "Pemasukan", fmtRpRaw(sum.income), [16, 185, 129]);
  y += 30;
  summaryCard(margin, y, "Pengeluaran", fmtRpRaw(sum.expense), [244, 63, 94]);
  summaryCard(margin + 94, y, "Selisih", fmtRpRaw(sum.net), [124, 58, 237]);
  y += 32;

  sectionTitle("Saldo per Akun");
  addKeyValueRows(sum.accountBalances, "Tidak ada saldo akun.");

  sectionTitle("Mutasi Akun Bulan Ini");
  addKeyValueRows(sum.accountDelta, "Tidak ada akun.");

  sectionTitle("Pengeluaran per Kategori");
  addKeyValueRows(sum.categoryExpense.slice(0, 12), "Tidak ada pengeluaran.");

  sectionTitle(`Daftar Transaksi (${sum.rows.length})`);
  doc.setFontSize(8);
  sum.rows.forEach((t, idx) => {
    ensureSpace(13);
    const sign = isIncome(t) ? "+" : isExpense(t) ? "-" : "";
    const left = `${t.tanggal || ""} ${(t.jam || "").slice(0, 5)}  ${t.tipe || ""}  ${t.kategori || ""}  ${t.akun || ""}`;
    const merchant = t.merchant || t.deskripsi || "-";
    if (idx % 2 === 0) {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin, y - 4, pageWidth - margin * 2, 10, 2, 2, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(doc.splitTextToSize(left, 118), margin, y);
    doc.setTextColor(100, 116, 139);
    doc.text(doc.splitTextToSize(merchant, 70), margin, y + 4);
    doc.setFont("helvetica", "bold");
    if (isIncome(t)) doc.setTextColor(5, 150, 105);
    else if (isExpense(t)) doc.setTextColor(190, 18, 60);
    else doc.setTextColor(100, 116, 139);
    doc.text(`${sign} ${fmtRpRaw(t.jumlah || 0)}`, pageWidth - margin, y, { align: "right" });
    doc.setTextColor(15, 23, 42);
    y += 11;
  });

  doc.save(`settlement-${state.month}.pdf`);
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
  document.getElementById("editAccountsBtn").onclick = () => {
    state.editAccounts = !state.editAccounts;
    renderAccounts();
  };
  document.getElementById("settlementDownloadBtn").onclick = (e) => {
    e.stopPropagation();
    document.getElementById("settlementDownloadMenu").classList.toggle("hidden");
  };
  document.getElementById("downloadSettlementPdf").onclick = () => {
    document.getElementById("settlementDownloadMenu").classList.add("hidden");
    downloadSettlementPdf();
  };
  document.getElementById("downloadSettlementCsv").onclick = () => {
    document.getElementById("settlementDownloadMenu").classList.add("hidden");
    downloadSettlementCsv();
  };
  document.addEventListener("click", () => {
    document.getElementById("settlementDownloadMenu").classList.add("hidden");
  });
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
