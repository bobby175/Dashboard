/* Catalyst — Web App (PWA)
 *
 * Sinkron dua arah dengan aplikasi Android lewat backend yang sama (Apps Script Web App
 * + Webhook Secret). Bisa dipasang seperti aplikasi dan dipakai untuk menambah / mengubah /
 * menghapus transaksi, transfer, hutang & cicilan, budget, goal tabungan, dan transaksi berulang.
 *
 * Scan foto struk kamera tetap khusus di aplikasi HP; web menyediakan Catat Suara / Kalimat Cepat,
 * Dompet Terkelompok, serta manajemen Hutang & Riwayat Cicilan penuh.
 *
 * Tidak ada server sendiri: semua request langsung ke URL Apps Script milik pengguna.
 */
"use strict";

const APP_VERSION = "3.1.0";

const LS_KEY = "ck_dashboard_config_v1";
const LS_HIDE = "ck_dashboard_hide";
const LS_ACCOUNT_ORDER = "ck_dashboard_account_order";
const LS_THEME = "ck_dashboard_theme";
const LS_CACHE = "ck_dashboard_cache_v1";
const LS_NOTIFY = "ck_dashboard_notify";
const LS_INSTALL_DISMISS = "ck_dashboard_install_dismissed";
const LS_STATS_PREFS = "ck_dashboard_stats_prefs_v1";

const DEFAULT_STATS_SECTIONS = [
  "insights", "heatmap", "cashflow", "category", "wallets", "merchants", "compare", "progress", "export"
];
const STATS_SECTIONS_META = {
  insights: { emoji: "💡", title: "Ringkasan & Insight Pintar", desc: "Rasio tabungan, tren bulan lalu, hari terboros" },
  heatmap: { emoji: "🗓️", title: "Kalender Pengeluaran Harian", desc: "Peta intensitas jajan tgl 1–31" },
  cashflow: { emoji: "🌊", title: "Grafik Arus Kas", desc: "Pemasukan vs pengeluaran (Area / Batang)" },
  category: { emoji: "🍩", title: "Donut & Rincian Kategori", desc: "Breakdown pengeluaran & pemasukan" },
  wallets: { emoji: "👛", title: "Pengeluaran per Dompet", desc: "Porsi pemakaian BCA, DANA, Tunai, dll" },
  merchants: { emoji: "🏪", title: "Merchant Teratas", desc: "Tempat paling sering transaksi bulan ini" },
  compare: { emoji: "📈", title: "Dibanding Bulan Lalu", desc: "Perbandingan kategori MoM" },
  progress: { emoji: "🎯", title: "Progress Budget & Goal", desc: "Ringkasan target keuangan bulan ini" },
  export: { emoji: "📄", title: "Ekspor Laporan Bulanan", desc: "Unduh PDF / CSV laporan resmi" },
};
const STATS_TAB_GROUPS = {
  flow: ["insights", "cashflow", "heatmap"],
  category: ["category", "wallets", "merchants", "compare"],
  target: ["progress", "export"],
};

function sanitizeStatsPrefs(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const validSet = new Set(DEFAULT_STATS_SECTIONS);
  const rawOrder = Array.isArray(src.sectionOrder) ? src.sectionOrder : [];
  const seen = new Set();
  const sectionOrder = [];
  rawOrder.forEach((id) => { if (validSet.has(id) && !seen.has(id)) { seen.add(id); sectionOrder.push(id); } });
  DEFAULT_STATS_SECTIONS.forEach((id) => { if (!seen.has(id)) sectionOrder.push(id); });
  const rawEnabled = Array.isArray(src.enabledSections) ? src.enabledSections.filter((id) => validSet.has(id)) : DEFAULT_STATS_SECTIONS;
  return {
    useTabs: !!src.useTabs,
    useBarChart: !!src.useBarChart,
    showHeroSavingsRing: src.showHeroSavingsRing !== false,
    enabledSections: rawEnabled.length > 0 ? [...new Set(rawEnabled)] : [...DEFAULT_STATS_SECTIONS],
    sectionOrder,
  };
}

function loadStatsPrefs() {
  try { return sanitizeStatsPrefs(JSON.parse(localStorage.getItem(LS_STATS_PREFS) || "null")); }
  catch (e) { return sanitizeStatsPrefs(null); }
}
function saveStatsPrefs() {
  state.statsPrefs = sanitizeStatsPrefs(state.statsPrefs);
  try { localStorage.setItem(LS_STATS_PREFS, JSON.stringify(state.statsPrefs)); } catch (e) { /* abaikan */ }
}

const API_TIMEOUT_MS = 45000;
const HOME_LIST_LIMIT = 30;

// Kategori & akun sama dengan aplikasi Android (ui/Categories.kt & ui/Accounts.kt)
const CATEGORY_LIST = ["Makanan", "Belanja", "Transportasi", "Kesehatan", "Hiburan", "Tagihan", "Gaji", "Bonus", "Lainnya"];
const CATEGORY_STYLES = {
  Makanan: { emoji: "🍜", c: "#EA580C", bg: "#FFEDD5" },
  Belanja: { emoji: "🛍️", c: "#DB2777", bg: "#FCE7F3" },
  Transportasi: { emoji: "🛵", c: "#2563EB", bg: "#DBEAFE" },
  Kesehatan: { emoji: "💊", c: "#059669", bg: "#D1FAE5" },
  Hiburan: { emoji: "🎬", c: "#7C3AED", bg: "#EDE9FE" },
  Tagihan: { emoji: "🧾", c: "#0891B2", bg: "#CFFAFE" },
  Gaji: { emoji: "💰", c: "#15803D", bg: "#DCFCE7" },
  Bonus: { emoji: "🎁", c: "#CA8A04", bg: "#FEF9C3" },
  Lainnya: { emoji: "✨", c: "#A04FD6", bg: "#F3E8FF" },
  Transfer: { emoji: "🔁", c: "#8E5BD8", bg: "#EFE4FF" },
  Hutang: { emoji: "🤝", c: "#E11D48", bg: "#FFE4E6" },
  Piutang: { emoji: "🤝", c: "#047857", bg: "#D1FAE5" },
};

const DEFAULT_ACCOUNT_ORDER = ["Tunai", "DANA", "GoPay", "OVO", "ShopeePay", "BCA", "Mandiri", "BRI", "BNI", "Kartu Kredit", "Lainnya"];
const ACCOUNT_STYLES = {
  Tunai: { emoji: "💵", from: "#16A34A", to: "#15803D", c: "#15803D", bg: "#DCFCE7", group: "OTHER", catLabel: "Tunai" },
  DANA: { emoji: "📱", from: "#3B82F6", to: "#1D4ED8", c: "#1D4ED8", bg: "#DBEAFE", group: "EWALLET", catLabel: "E-Wallet" },
  GoPay: { emoji: "📱", from: "#06B6D4", to: "#0E7490", c: "#0E7490", bg: "#CFFAFE", group: "EWALLET", catLabel: "E-Wallet" },
  OVO: { emoji: "📱", from: "#8B5CF6", to: "#6D28D9", c: "#6D28D9", bg: "#EDE9FE", group: "EWALLET", catLabel: "E-Wallet" },
  ShopeePay: { emoji: "📱", from: "#F97316", to: "#C2410C", c: "#C2410C", bg: "#FFEDD5", group: "EWALLET", catLabel: "E-Wallet" },
  BCA: { emoji: "🏦", from: "#2563EB", to: "#1E40AF", c: "#1E40AF", bg: "#DBEAFE", group: "BANK", catLabel: "Bank" },
  Mandiri: { emoji: "🏦", from: "#14B8A6", to: "#0F766E", c: "#0F766E", bg: "#CCFBF1", group: "BANK", catLabel: "Bank" },
  BRI: { emoji: "🏦", from: "#1E40AF", to: "#1E3A8A", c: "#1E3A8A", bg: "#DBEAFE", group: "BANK", catLabel: "Bank" },
  BNI: { emoji: "🏦", from: "#F59E0B", to: "#B45309", c: "#B45309", bg: "#FEF3C7", group: "BANK", catLabel: "Bank" },
  "Kartu Kredit": { emoji: "💳", from: "#F43F5E", to: "#BE123C", c: "#BE123C", bg: "#FFE4E6", group: "OTHER", catLabel: "Kartu" },
  Lainnya: { emoji: "👛", from: "#64748B", to: "#334155", c: "#475569", bg: "#E2E8F0", group: "OTHER", catLabel: "Lainnya" },
};
const ACCOUNT_GROUP_META = {
  BANK: { title: "Rekening Bank", tabLabel: "Bank" },
  EWALLET: { title: "E-Wallet", tabLabel: "E-Wallet" },
  OTHER: { title: "Tunai & Lainnya", tabLabel: "Tunai" },
};
// Akun tabungan goal memakai ikon toples tabungan (bukan celengan babi)
const GOAL_ACCOUNT_STYLE = { emoji: "💰", svg: "i-jar", from: "#EC4899", to: "#A04FD6", c: "#C9367A", bg: "#FFE3F0", group: "OTHER", catLabel: "Tabungan" };
const JAR_ICON = `<svg class="art" aria-hidden="true"><use href="#i-jar"/></svg>`;

const FREQ_LABEL = { DAILY: "Harian", WEEKLY: "Mingguan", MONTHLY: "Bulanan", YEARLY: "Tahunan" };
const WEEKDAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]; // 1..7 (sama dengan app)
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const PALETTE = ["#EC4899", "#8B5CF6", "#F59E0B", "#10B981", "#38BDF8", "#FB7185", "#C084FC", "#84CC16", "#FB923C"];

const state = {
  url: "",
  secret: "",
  telegram: null, // { token, chatId } dari file config (opsional)
  transactions: [],
  budgets: [],
  goals: [],
  recurring: [],
  debts: [],
  debtPayments: [],
  debtTab: "HUTANG",
  debtFilter: "ALL",
  loadedAt: 0,
  loading: false,
  page: "home",
  month: currentYM(), // bulan untuk Riwayat & Statistik
  budgetMonth: currentYM(),
  gran: "harian",
  statsTab: "flow",
  statsCatType: "EXPENSE",
  statsSelectedDay: null,
  statsPrefs: loadStatsPrefs(),
  home: { tipe: null, akun: null, q: "" },
  hist: { tipe: null, akun: null, q: "" },
  hide: localStorage.getItem(LS_HIDE) === "1",
  theme: localStorage.getItem(LS_THEME) || "system",
  notify: localStorage.getItem(LS_NOTIFY) !== "0",
};

let cashflowChart = null;
let categoryChart = null;
let deferredInstallPrompt = null;
let refreshTimer = null;

// Layar PC (≥ 1024px): sidebar, ringkasan samping di Home, riwayat dalam bentuk tabel
const desktopQuery = window.matchMedia("(min-width: 1024px)");
function isDesktop() { return desktopQuery.matches; }

// ---------------- Utils: tanggal ----------------
function pad2(n) { return String(n).padStart(2, "0"); }
function currentYM() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function nowHms() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function addMonths(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function monthLabel(ym) {
  const [y, m] = (ym || "").split("-").map(Number);
  return `${MONTHS[m - 1] || m} ${y}`;
}
function ymOf(iso) { return (iso || "").slice(0, 7); }
function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}
function isoOf(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function addDaysIso(iso, n) {
  const p = parseIso(iso);
  if (!p) return iso;
  return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10);
}
/** 1 = Senin ... 7 = Minggu (sama dengan aplikasi). */
function weekdayOf(iso) {
  const p = parseIso(iso);
  if (!p) return 1;
  const js = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 = Minggu
  return js === 0 ? 7 : js;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function dateLabel(iso, withYear = false) {
  const p = parseIso(iso);
  if (!p) return iso || "-";
  const d = new Date(p.y, p.m - 1, p.d);
  return d.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}
function longDateLabel(iso) {
  const p = parseIso(iso);
  if (!p) return iso || "-";
  return new Date(p.y, p.m - 1, p.d).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function monthsBetween(fromIso, toIso) {
  const a = parseIso(fromIso);
  const b = parseIso(toIso);
  if (!a || !b) return 0;
  return (b.y - a.y) * 12 + (b.m - a.m);
}
function greeting() {
  const h = new Date().getHours();
  if (h >= 4 && h <= 10) return "Selamat pagi ☀️";
  if (h >= 11 && h <= 14) return "Selamat siang 🌤️";
  if (h >= 15 && h <= 17) return "Selamat sore 🌇";
  return "Selamat malam 🌙";
}

// ---------------- Utils: angka & teks ----------------
function fmtRpRaw(n) {
  const v = Number(n) || 0;
  const neg = v < 0 ? "-" : "";
  return "Rp " + neg + Math.abs(Math.round(v)).toLocaleString("id-ID");
}
function fmtRp(n) { return state.hide ? "Rp ••••••" : fmtRpRaw(n); }
function shortRp(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(".", ",") + "M";
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(".", ",") + "jt";
  if (a >= 1e3) return Math.round(n / 1e3) + "rb";
  return String(Math.round(n));
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function uuid() {
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function sameText(a, b) { return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase(); }
function extractTags(text) { return [...new Set((String(text || "").match(/#[\p{L}\p{N}_-]+/gu) || []).map((t) => t.slice(1)))]; }

function isTransfer(t) { return (t.kategori || "").toLowerCase() === "transfer"; }
function isIncome(t) { return (t.tipe || "").toLowerCase() === "pemasukan"; }
function isExpense(t) { return (t.tipe || "").toLowerCase() === "pengeluaran"; }

function categoryStyle(name) {
  const key = Object.keys(CATEGORY_STYLES).find((k) => sameText(k, name));
  return CATEGORY_STYLES[key || "Lainnya"];
}
function accountStyle(name) {
  const key = Object.keys(ACCOUNT_STYLES).find((k) => sameText(k, name));
  if (key) return ACCOUNT_STYLES[key];
  if (/^tabungan\b/i.test(name || "")) return GOAL_ACCOUNT_STYLE;
  return ACCOUNT_STYLES.Lainnya;
}
function catVars(name) {
  const s = categoryStyle(name);
  return `--c:${s.c};--cbg:${s.bg}`;
}
function acctVars(name) {
  const s = accountStyle(name);
  return `--ac:${s.c};--abg:${s.bg}`;
}

// ---------------- Urutan akun (lokal, sama seperti app) ----------------
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
/** Semua akun yang bisa dipilih di form: daftar bawaan + akun lain yang muncul di data. */
function allAccountNames() {
  const seen = new Map();
  [...DEFAULT_ACCOUNT_ORDER, ...state.transactions.map((t) => t.akun), ...state.goals.map((g) => g.goalAkun)]
    .filter((n) => n && String(n).trim())
    .forEach((n) => { const k = n.trim().toLowerCase(); if (!seen.has(k)) seen.set(k, n.trim()); });
  return sortAccounts([...seen.values()]);
}

// ---------------- Network ----------------
async function callApi(action, extra = {}) {
  const payload = JSON.stringify({ secret: state.secret, action, ...extra });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  let resp;
  try {
    // text/plain → hindari CORS preflight (Apps Script tidak menangani OPTIONS)
    resp = await fetch(state.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: payload,
      redirect: "follow",
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Server terlalu lama merespons. Coba lagi sebentar lagi.");
    throw new Error(navigator.onLine === false
      ? "Kamu sedang offline. Sambungkan internet dulu."
      : "Tidak bisa menghubungi server. Cek koneksi / URL Web App.");
  } finally {
    clearTimeout(timer);
  }
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error("Respons tidak valid (cek URL Web App)."); }
  if (json.ok === false) {
    if ((json.error || "").toLowerCase().includes("unauthorized"))
      throw new Error("Secret salah / tidak cocok dengan Apps Script.");
    throw new Error(json.error || "Backend menolak permintaan.");
  }
  return json;
}

function ensureOnline() {
  if (navigator.onLine === false) throw new Error("Kamu sedang offline. Sambungkan internet dulu untuk menyimpan.");
}

/** Notifikasi Telegram: pakai bot dari file config kalau ada; kalau tidak, Apps Script memakai Script Properties. */
function notifyExtras() {
  const extra = { notify: state.notify };
  if (state.notify && state.telegram && state.telegram.token && state.telegram.chatId) extra.telegram = state.telegram;
  return extra;
}

const api = {
  saveTx: (tx) => callApi("save", { transaction: tx, ...notifyExtras() }),
  updateTx: (tx) => callApi("update", { transaction: tx }),
  async deleteTx(id) {
    try {
      await callApi("delete", { id });
    } catch (e) {
      if (/tidak ditemukan/i.test(e.message)) return; // sudah terhapus (mis. retry) → anggap beres
      throw e;
    }
  },
  transfer: (t) => callApi("transfer", { transfer: t, ...notifyExtras() }),
  budgetUpsert: (b) => callApi("budgetUpsert", { budget: b }),
  budgetDelete: (id) => callApi("budgetDelete", { id }),
  goalUpsert: (g) => callApi("goalUpsert", { goal: g }),
  goalDelete: (id) => callApi("goalDelete", { id }),
  recurringUpsert: (r) => callApi("recurringUpsert", { recurring: r }),
  recurringDelete: (id) => callApi("recurringDelete", { id }),
  debtUpsert: (d) => callApi("debtUpsert", { debt: d }),
  debtDelete: (id) => callApi("debtDelete", { id }),
  debtPaymentUpsert: (p) => callApi("debtPaymentUpsert", { payment: p }),
  debtPaymentDelete: (id) => callApi("debtPaymentDelete", { id }),
};

// ---------------- Data ----------------
async function loadDashboardData() {
  const combined = await safe(() => callApi("dashboardData"), null);
  if (combined) return combined;

  const [tx, budgets, goals, recurring, debts, debtPayments] = await Promise.all([
    callApi("list"),
    safe(() => callApi("budgetList").then((r) => r.budgets || []), []),
    safe(() => callApi("goalList").then((r) => r.goals || []), []),
    safe(() => callApi("recurringList").then((r) => r.recurring || []), []),
    safe(() => callApi("debtList").then((r) => r.debts || []), []),
    safe(() => callApi("debtPaymentList").then((r) => r.payments || []), []),
  ]);
  return { transactions: tx.transactions || [], budgets, goals, recurring, debts, debtPayments };
}

async function safe(fn, fallback) {
  try { return await fn(); } catch (e) { return fallback; }
}

function normalizeTx(t) {
  return {
    id: String(t.id),
    tanggal: String(t.tanggal || ""),
    jam: String(t.jam || ""),
    tipe: String(t.tipe || ""),
    kategori: String(t.kategori || ""),
    merchant: String(t.merchant || ""),
    deskripsi: String(t.deskripsi || ""),
    jumlah: Number(t.jumlah) || 0,
    sumber: String(t.sumber || ""),
    akun: String(t.akun || "Tunai").trim() || "Tunai",
  };
}

function normalizeDebt(d) {
  const amount = Number(d.amount) || 0;
  const paidAmount = Number(d.paidAmount) || 0;
  const tipeRaw = String(d.tipe || "HUTANG").toUpperCase();
  const tipe = tipeRaw.includes("PIUTANG") ? "PIUTANG" : "HUTANG";
  return {
    id: String(d.id ?? "").trim(),
    tipe,
    personName: String(d.personName || "").trim(),
    amount,
    paidAmount,
    tanggal: String(d.tanggal || todayIso()),
    dueDate: String(d.dueDate || ""),
    akun: String(d.akun || "Tunai").trim() || "Tunai",
    catatan: String(d.catatan || ""),
    settled: d.settled === true || (amount > 0 && paidAmount >= amount - 0.01),
  };
}

function normalizeDebtPayment(p) {
  return {
    id: String(p.id ?? "").trim(),
    debtId: String(p.debtId ?? "").trim(),
    tipe: String(p.tipe || "HUTANG").toUpperCase().includes("PIUTANG") ? "PIUTANG" : "HUTANG",
    personName: String(p.personName || ""),
    amount: Number(p.amount) || 0,
    tanggal: String(p.tanggal || todayIso()),
    jam: String(p.jam || ""),
    akun: String(p.akun || "Tunai").trim() || "Tunai",
    catatan: String(p.catatan || ""),
    linkedTxId: p.linkedTxId ? String(p.linkedTxId).trim() : null,
  };
}

function applyData(data) {
  state.transactions = (data.transactions || []).filter((t) => t && t.id).map(normalizeTx);
  state.budgets = (data.budgets || []).filter((b) => b && b.id);
  state.goals = (data.goals || []).filter((g) => g && g.id);
  state.recurring = (data.recurring || []).filter((r) => r && r.id);
  state.debts = (data.debts || []).filter((d) => d && d.id).map(normalizeDebt);
  state.debtPayments = (data.debtPayments || []).filter((p) => p && p.id && p.debtId).map(normalizeDebtPayment);
}

function saveCache() {
  try {
    localStorage.setItem(LS_CACHE, JSON.stringify({
      v: 2, at: Date.now(), url: state.url,
      transactions: state.transactions, budgets: state.budgets, goals: state.goals, recurring: state.recurring,
      debts: state.debts, debtPayments: state.debtPayments,
    }));
  } catch (e) { /* kuota penuh → abaikan, data tetap ada di memori */ }
}

function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_CACHE) || "null");
    if (c && (c.v === 1 || c.v === 2) && c.url === state.url) return c;
  } catch (e) { /* cache rusak → abaikan */ }
  return null;
}

// Naik setiap ada perubahan lokal; hasil fetch yang dimulai sebelum perubahan dianggap basi.
let localRev = 0;
let reloadQueued = false;

async function loadAll({ silent = false } = {}) {
  if (state.loading) { reloadQueued = true; return; }
  state.loading = true;
  setSyncing(true);
  if (!silent && !state.loadedAt) showLoader(true);
  const revAtStart = localRev;
  try {
    const data = await loadDashboardData();
    if (revAtStart !== localRev) {
      // Ada transaksi yang baru disimpan selama fetch berjalan → jangan timpa, ambil ulang.
      reloadQueued = true;
      return;
    }
    applyData(data);
    state.loadedAt = Date.now();
    saveCache();
    render();
    setStatus("Tersinkron • " + new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }));
  } catch (e) {
    setStatus("Gagal sinkron: " + e.message);
    if (!silent) toast(e.message, "error");
  } finally {
    state.loading = false;
    setSyncing(false);
    showLoader(false);
    if (reloadQueued) {
      reloadQueued = false;
      scheduleRefresh();
    }
  }
}

/** Setelah menyimpan, tarik ulang data diam-diam supaya sama persis dengan Sheet. */
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => loadAll({ silent: true }), 1500);
}

function commitLocal() {
  localRev++;
  saveCache();
  render();
  scheduleRefresh();
}

function upsertById(list, item) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
}
function removeById(list, id) {
  const sid = String(id ?? "").trim();
  const i = list.findIndex((x) => String(x.id ?? "").trim() === sid);
  if (i >= 0) list.splice(i, 1);
}

// ---------------- Perhitungan ----------------
function accountBalances() {
  const map = {};
  for (const t of state.transactions) {
    const akun = t.akun || "Tunai";
    const delta = isIncome(t) ? t.jumlah : isExpense(t) ? -t.jumlah : 0;
    map[akun] = (map[akun] || 0) + delta;
  }
  return map;
}
function balanceOf(akun) {
  const map = accountBalances();
  const key = Object.keys(map).find((k) => sameText(k, akun));
  return key ? map[key] : 0;
}
function totalBalance() { return Object.values(accountBalances()).reduce((a, b) => a + b, 0); }
function monthTx(ym) { return state.transactions.filter((t) => ymOf(t.tanggal) === ym); }
function sortTxDesc(rows) {
  return rows.slice().sort((a, b) => (b.tanggal + (b.jam || "")).localeCompare(a.tanggal + (a.jam || "")));
}
function monthTotals(ym) {
  const rows = monthTx(ym).filter((t) => !isTransfer(t));
  const income = rows.filter(isIncome).reduce((a, t) => a + t.jumlah, 0);
  const expense = rows.filter(isExpense).reduce((a, t) => a + t.jumlah, 0);
  return { income, expense, net: income - expense, count: monthTx(ym).length };
}
function expenseByCategory(ym) {
  const by = {};
  monthTx(ym).filter((t) => isExpense(t) && !isTransfer(t)).forEach((t) => {
    const k = categoryKey(t.kategori);
    by[k] = (by[k] || 0) + t.jumlah;
  });
  return by;
}
function categoryKey(name) {
  return CATEGORY_LIST.find((c) => sameText(c, name)) || (String(name || "").trim() || "Lainnya");
}

/** Cari pasangan transaksi transfer (keluar ↔ masuk). Aplikasi tidak menyimpan link pasangan. */
function findTransferPair(t) {
  if (!t || !isTransfer(t)) return null;
  const candidates = state.transactions.filter((o) =>
    o.id !== t.id && isTransfer(o) &&
    o.tanggal === t.tanggal && (o.jam || "") === (t.jam || "") &&
    Math.abs(o.jumlah - t.jumlah) < 0.005 && (o.deskripsi || "") === (t.deskripsi || "") &&
    (isIncome(t) ? isExpense(o) : isIncome(o)));
  if (candidates.length === 0) return null;
  const out = isExpense(t) ? t : null;
  const inn = isIncome(t) ? t : null;
  const match = candidates.find((o) => {
    if (out) return sameText(out.merchant, "Transfer ke " + o.akun) && sameText(o.merchant, "Transfer dari " + out.akun);
    return sameText(o.merchant, "Transfer ke " + inn.akun) && sameText(inn.merchant, "Transfer dari " + o.akun);
  }) || candidates[0];
  return out ? { out, inn: match } : { out: match, inn };
}

// ---------------- Jadwal transaksi berulang (port dari RecurringRepository.kt) ----------------
function nextRunAfter(iso, rule) {
  const f = String(rule.frequency || "").toUpperCase();
  const p = parseIso(iso);
  if (!p) return iso;
  if (f === "WEEKLY") return addDaysIso(iso, 7);
  if (f === "MONTHLY") {
    let y = p.y; let m = p.m + 1;
    if (m > 12) { m = 1; y += 1; }
    return isoOf(y, m, clamp(Number(rule.dayOfMonth) || 1, 1, daysInMonth(y, m)));
  }
  if (f === "YEARLY") {
    const y = p.y + 1;
    const m = clamp(Number(rule.monthOfYear) || 1, 1, 12);
    return isoOf(y, m, clamp(Number(rule.dayOfMonth) || 1, 1, daysInMonth(y, m)));
  }
  return addDaysIso(iso, 1);
}
/** Perkiraan jadwal berikutnya (≥ hari ini). nextRunDate di Sheet bisa tertinggal karena HP memperbaruinya lokal. */
function upcomingRun(rule) {
  let cur = rule.nextRunDate || rule.startDate;
  if (!parseIso(cur)) return null;
  const today = todayIso();
  for (let i = 0; i < 800 && cur < today; i++) cur = nextRunAfter(cur, rule);
  if (rule.endDate && cur > rule.endDate) return null;
  return cur;
}
/** Tanggal mulai yang cocok dengan pola (≥ hari ini), dipakai sebagai saran di form. */
function suggestStartDate(freq, dayOfMonth, dayOfWeek, monthOfYear) {
  const today = todayIso();
  const t = parseIso(today);
  if (freq === "WEEKLY") {
    const diff = (Number(dayOfWeek) - weekdayOf(today) + 7) % 7;
    return addDaysIso(today, diff);
  }
  if (freq === "MONTHLY") {
    let y = t.y; let m = t.m;
    let cand = isoOf(y, m, clamp(dayOfMonth, 1, daysInMonth(y, m)));
    if (cand < today) {
      m += 1; if (m > 12) { m = 1; y += 1; }
      cand = isoOf(y, m, clamp(dayOfMonth, 1, daysInMonth(y, m)));
    }
    return cand;
  }
  if (freq === "YEARLY") {
    const mm = clamp(monthOfYear, 1, 12);
    let cand = isoOf(t.y, mm, clamp(dayOfMonth, 1, daysInMonth(t.y, mm)));
    if (cand < today) cand = isoOf(t.y + 1, mm, clamp(dayOfMonth, 1, daysInMonth(t.y + 1, mm)));
    return cand;
  }
  return today;
}
function describeSchedule(r) {
  const f = String(r.frequency || "").toUpperCase();
  if (f === "WEEKLY") return `Mingguan · tiap ${WEEKDAYS[clamp(weekdayOf(r.startDate || todayIso()), 1, 7) - 1]}`;
  if (f === "MONTHLY") return `Bulanan · tgl ${r.dayOfMonth}`;
  if (f === "YEARLY") return `Tahunan · ${r.dayOfMonth} ${MONTHS[clamp(Number(r.monthOfYear) || 1, 1, 12) - 1]}`;
  return FREQ_LABEL[f] || f || "Harian";
}

// ---------------- Budget & goal ----------------
function budgetView(b) {
  const spent = monthTx(b.bulan)
    .filter((t) => isExpense(t) && !isTransfer(t) && sameText(t.kategori, b.kategori))
    .reduce((a, t) => a + t.jumlah, 0);
  const limit = Number(b.limitAmount) || 0;
  const pct = limit > 0 ? (spent / limit) * 100 : 0;
  const status = b.enabled === false ? "off" : pct >= 100 ? "over" : pct >= 80 ? "warn" : "ok";
  return { b, spent, limit, pct, sisa: limit - spent, status };
}

function goalView(g) {
  const saldo = g.goalAkun ? balanceOf(g.goalAkun) : 0;
  const target = Number(g.targetAmount) || 0;
  const pct = target > 0 ? (saldo / target) * 100 : 0;
  const remaining = Math.max(target - saldo, 0);
  const today = todayIso();
  const months = Math.max(monthsBetween(today, g.deadline), 0);
  const required = months > 0 ? remaining / months : remaining;
  const overdue = !!g.deadline && g.deadline < today;
  let status;
  if (saldo >= target && target > 0) status = "done";
  else if (overdue) status = "overdue";
  else if (!g.autoDebit || !(Number(g.monthlyAllocation) > 0)) status = "manual";
  else if (Number(g.monthlyAllocation) >= required) status = "ontrack";
  else status = "behind";
  return { g, saldo, target, pct, remaining, months, required, status };
}

// ---------------- Render umum ----------------
function render() {
  renderHome();
  renderPage(state.page);
}

function renderPage(page) {
  if (page === "home") renderHome();
  else if (page === "history") renderHistory();
  else if (page === "stats") renderStats();
  else if (page === "money") renderMoney();
  else if (page === "settings") renderSettings();
  document.querySelectorAll("[data-month-label]").forEach((el) => { el.textContent = monthLabel(state.month); });
}

function txRow(t) {
  const inc = isIncome(t);
  const transfer = isTransfer(t);
  const cs = categoryStyle(transfer ? "Transfer" : t.kategori);
  const title = t.merchant || t.kategori || t.deskripsi || "(tanpa nama)";
  const tags = extractTags(t.deskripsi).slice(0, 3);
  const amtClass = transfer ? "amt-neutral" : inc ? "amt-in" : "amt-out";
  return `
    <button class="tx" type="button" data-tx="${esc(t.id)}">
      <span class="tx-ico" style="--c:${cs.c};--cbg:${cs.bg}" aria-hidden="true">${cs.emoji}</span>
      <span class="tx-main">
        <span class="tx-title">${esc(title)}</span>
        <span class="tx-sub">
          <span>${esc(dateLabel(t.tanggal))}${t.jam ? " · " + esc(t.jam.slice(0, 5)) : ""}</span>
          <span class="acct-tag" style="${acctVars(t.akun)}">${esc(t.akun)}</span>
          ${transfer ? "" : `<span>${esc(categoryKey(t.kategori))}</span>`}
          ${tags.map((g) => `<span class="tag">#${esc(g)}</span>`).join("")}
        </span>
      </span>
      <span class="tx-amt ${amtClass}">${inc ? "+" : "−"} ${esc(fmtRp(t.jumlah))}</span>
    </button>`;
}

function emptyState(emoji, text, actionHtml = "") {
  return `<div class="empty"><span class="empty-emoji" aria-hidden="true">${emoji}</span>${esc(text)}${actionHtml}</div>`;
}

function applyFilters(rows, f) {
  let out = rows;
  if (f.tipe) out = out.filter((t) => sameText(t.tipe, f.tipe));
  if (f.akun) out = out.filter((t) => sameText(t.akun, f.akun));
  if (f.q) {
    const q = f.q.toLowerCase();
    out = out.filter((t) => [t.merchant, t.deskripsi, t.kategori, t.akun].join(" ").toLowerCase().includes(q));
  }
  return out;
}

function renderFilterChips(elId, f, accountNames) {
  const el = document.getElementById(elId);
  const chips = [
    { kind: "tipe", value: "Pemasukan", label: "🔺 Pemasukan" },
    { kind: "tipe", value: "Pengeluaran", label: "🔻 Pengeluaran" },
    ...accountNames.map((a) => ({ kind: "akun", value: a, label: a })),
  ];
  el.innerHTML = chips.map((c) => {
    const active = c.kind === "tipe" ? f.tipe === c.value : sameText(f.akun, c.value);
    return `<button class="chip ${active ? "active" : ""}" type="button" data-filter-kind="${c.kind}" data-filter-value="${esc(c.value)}">${esc(c.label)}</button>`;
  }).join("");
}

// ---------------- Home ----------------
function latestTx() { return sortTxDesc(state.transactions)[0] || null; }

function renderHome() {
  const ym = currentYM();
  const totals = monthTotals(ym);
  document.getElementById("greeting").textContent = greeting();
  document.getElementById("todayLabel").textContent = longDateLabel(todayIso());
  document.getElementById("kpiBalance").textContent = fmtRp(totalBalance());
  document.getElementById("kpiIncome").textContent = fmtRp(totals.income);
  document.getElementById("kpiExpense").textContent = fmtRp(totals.expense);
  for (const id of ["hideBtn", "sideHideBtn"]) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.innerHTML = `<svg class="ico"><use href="#${state.hide ? "i-eye-off" : "i-eye"}"/></svg>`;
    btn.setAttribute("aria-label", state.hide ? "Tampilkan saldo" : "Sembunyikan saldo");
    btn.title = btn.getAttribute("aria-label");
  }

  renderAccounts();
  renderHomeSide();

  const monthRows = monthTx(ym);
  const accountNames = sortAccounts([...new Set(monthRows.map((t) => t.akun))]);
  renderFilterChips("homeFilters", state.home, accountNames);
  const rows = sortTxDesc(applyFilters(monthRows, state.home));
  const list = document.getElementById("homeList");
  if (rows.length === 0) {
    const last = latestTx();
    if (monthRows.length > 0) {
      list.innerHTML = emptyState("🔎", "Tidak ada transaksi yang cocok dengan filter.");
    } else if (last) {
      // Ada data di bulan lain → arahkan ke bulan terakhir yang ada transaksinya
      list.innerHTML = emptyState("🗓️", `Belum ada transaksi bulan ini. Terakhir dicatat ${dateLabel(last.tanggal, true)}.`,
        `<br><button class="btn btn-soft btn-sm" type="button" data-action="history-latest">Lihat ${esc(monthLabel(ymOf(last.tanggal)))}</button>
         <button class="btn btn-primary btn-sm" type="button" data-action="add">➕ Catat</button>`);
    } else {
      list.innerHTML = emptyState("🌸", "Belum ada transaksi. Yuk mulai catat!", `<br><button class="btn btn-primary btn-sm" type="button" data-action="add">➕ Catat transaksi</button>`);
    }
    return;
  }
  const shown = rows.slice(0, HOME_LIST_LIMIT);
  list.innerHTML = shown.map(txRow).join("") + (rows.length > shown.length
    ? `<button class="btn btn-ghost btn-block more-btn" type="button" data-goto="history">Lihat semua (${rows.length} transaksi)</button>`
    : "");
}

function miniProgress(emoji, name, pct, color, sub) {
  return `
    <div class="mini-prog">
      <div class="top"><span aria-hidden="true">${emoji}</span><span class="name">${esc(name)}</span><span style="color:${color}">${Math.round(pct)}%</span></div>
      <div class="bar"><span style="width:${clamp(pct, 0, 100).toFixed(1)}%;background:${color}"></span></div>
      <div class="sub">${sub}</div>
    </div>`;
}

/** Panel ringkasan di samping daftar transaksi (hanya terlihat di layar PC). */
function renderHomeSide() {
  const el = document.getElementById("homeSide");
  if (!el || !isDesktop()) return;
  const ym = currentYM();
  const t = monthTotals(ym);
  const budgets = state.budgets.filter((b) => b.bulan === ym && b.enabled !== false)
    .map(budgetView).sort((a, b) => b.pct - a.pct).slice(0, 4);
  const goals = state.goals.filter((g) => g.enabled !== false).map(goalView).sort((a, b) => b.pct - a.pct).slice(0, 3);
  const upcoming = state.recurring.filter((r) => r.enabled !== false)
    .map((r) => ({ r, next: upcomingRun(r) })).filter((x) => x.next)
    .sort((a, b) => a.next.localeCompare(b.next)).slice(0, 4);
  const topCats = Object.entries(expenseByCategory(ym)).sort((a, b) => b[1] - a[1]).slice(0, 4);

  el.innerHTML = `
    <section class="card side-card">
      <div class="card-head"><h2>📅 ${esc(monthLabel(ym))}</h2><button class="link-btn" type="button" data-goto="stats">Statistik ›</button></div>
      <div class="mini-stats">
        <div><span>Pemasukan</span><b class="amt-in">${esc(fmtRp(t.income))}</b></div>
        <div><span>Pengeluaran</span><b class="amt-out">${esc(fmtRp(t.expense))}</b></div>
        <div><span>Selisih</span><b>${esc(fmtRp(t.net))}</b></div>
      </div>
      ${topCats.length ? `<div style="margin-top:12px">${topCats.map(([name, val]) => {
        const pct = t.expense > 0 ? (val / t.expense) * 100 : 0;
        return miniProgress(categoryStyle(name).emoji, name, pct, categoryStyle(name).c, esc(fmtRp(val)));
      }).join("")}</div>` : ""}
    </section>
    <section class="card side-card">
      <div class="card-head"><h2>🧮 Budget</h2><button class="link-btn" type="button" data-goto="money">Kelola ›</button></div>
      ${budgets.length
        ? budgets.map((v) => miniProgress(categoryStyle(v.b.kategori).emoji, v.b.kategori, v.pct, STATUS_COLOR[v.status], `${esc(fmtRp(v.spent))} / ${esc(fmtRp(v.limit))}`)).join("")
        : `<p class="side-empty">Belum ada budget bulan ini.</p>`}
    </section>
    <section class="card side-card">
      <div class="card-head"><h2>🎯 Goal</h2><button class="link-btn" type="button" data-goto="money">Lihat ›</button></div>
      ${goals.length
        ? goals.map((v) => miniProgress(v.status === "done" ? "🏆" : "🎯", v.g.name, v.pct, v.status === "done" ? "#10B981" : "#C9367A", `${esc(fmtRp(v.saldo))} / ${esc(fmtRp(v.target))}`)).join("")
        : `<p class="side-empty">Belum ada goal tabungan.</p>`}
    </section>
    <section class="card side-card">
      <div class="card-head"><h2>🔁 Jadwal Berikutnya</h2></div>
      ${upcoming.length
        ? upcoming.map(({ r, next }) => `
          <div class="mini-stats" style="padding:6px 0;border-top:1px dashed var(--line)">
            <div><span>${esc(dateLabel(next))} · ${esc(r.merchant || r.kategori)}</span><b class="${sameText(r.tipe, "Pemasukan") ? "amt-in" : "amt-out"}">${esc(fmtRp(r.jumlah))}</b></div>
          </div>`).join("")
        : `<p class="side-empty">Belum ada transaksi berulang aktif.</p>`}
    </section>
    ${(() => {
      const hList = state.debts.filter((d) => !d.settled && d.tipe === "HUTANG");
      const pList = state.debts.filter((d) => !d.settled && d.tipe === "PIUTANG");
      const hSum = hList.reduce((s, d) => s + Math.max(0, d.amount - d.paidAmount), 0);
      const pSum = pList.reduce((s, d) => s + Math.max(0, d.amount - d.paidAmount), 0);
      return `
        <section class="card side-card">
          <div class="card-head"><h2>🤝 Hutang &amp; Piutang</h2><button class="link-btn" type="button" data-goto="money">Kelola ›</button></div>
          <div class="mini-stats">
            <div><span>Hutang Saya (${hList.length})</span><b class="amt-out">${esc(fmtRp(hSum))}</b></div>
            <div><span>Hutang Orang (${pList.length})</span><b class="amt-in">${esc(fmtRp(pSum))}</b></div>
          </div>
        </section>`;
    })()}`;
}

function renderAccounts() {
  const map = accountBalances();
  const el = document.getElementById("accounts");
  const openBtn = document.getElementById("openWalletsBtn");
  const orderedAll = allAccountNames();
  const nonZero = sortAccounts(Object.keys(map).filter((name) => Math.round(map[name]) !== 0));
  const shown = nonZero.length > 0 ? nonZero : orderedAll;
  const totalPos = shown.reduce((s, n) => s + Math.max(0, Number(map[n]) || 0), 0);

  if (openBtn) openBtn.textContent = `Semua (${orderedAll.length}) ›`;

  el.innerHTML = shown.map((name) => {
    const val = Number(map[name]) || 0;
    const s = accountStyle(name);
    const ratio = val > 0 && totalPos > 0 ? clamp((val / totalPos) * 100, 3, 100) : 0;
    return `
      <button class="acct" style="${acctVars(name)}" type="button" data-open-wallet="${esc(name)}">
        <div class="acct-top">
          <span class="acct-badge" aria-hidden="true">${s.svg ? JAR_ICON : s.emoji}</span>
          <span class="acct-cat">${esc(s.catLabel || "Lainnya")}</span>
        </div>
        <div class="acct-name">${esc(name)}</div>
        <div class="acct-val ${val < 0 ? "neg" : ""}">${esc(fmtRp(val))}</div>
        <div class="acct-bar"><span style="width:${ratio.toFixed(1)}%"></span></div>
      </button>`;
  }).join("");
}

function openWalletSheet(initialAccount = null) {
  const map = accountBalances();
  const ordered = allAccountNames().map((name) => {
    const style = accountStyle(name);
    return {
      name,
      saldo: Number(map[name]) || 0,
      style,
      group: style.group || "OTHER",
    };
  });
  const totalPos = ordered.reduce((s, x) => s + (x.saldo > 0 ? x.saldo : 0), 0);
  const initialIsZero = initialAccount
    ? Math.abs(ordered.find((x) => sameText(x.name, initialAccount))?.saldo || 0) <= 0.01
    : false;
  const ws = {
    filter: "ALL",
    hideZero: !initialIsZero && ordered.some((x) => Math.abs(x.saldo) > 0.01),
    expanded: initialAccount,
  };

  const renderSheetContent = (body) => {
    const visible = ordered.filter((x) => {
      const matchGroup = ws.filter === "ALL" || x.group === ws.filter;
      const matchBal = !ws.hideZero || Math.abs(x.saldo) > 0.01;
      return matchGroup && matchBal;
    });
    const groups = ["BANK", "EWALLET", "OTHER"]
      .filter((g) => ws.filter === "ALL" || ws.filter === g)
      .map((g) => ({ key: g, meta: ACCOUNT_GROUP_META[g], items: visible.filter((x) => x.group === g) }))
      .filter((g) => g.items.length > 0);

    const groupsHtml = groups.length === 0
      ? `<div class="empty"><span class="empty-emoji">👛</span>Semua akun pada filter ini bersaldo Rp 0.${ws.hideZero ? `<br><button class="btn btn-soft btn-sm" type="button" id="wsShowZeroBtn">Tampilkan Akun Rp 0</button>` : ""}</div>`
      : groups.map((g) => {
          const gSum = g.items.reduce((s, x) => s + x.saldo, 0);
          return `
            <div class="wallet-group-hdr">
              <span>${esc(g.meta.title)}</span>
              <b>${esc(fmtRp(gSum))}</b>
            </div>
            ${g.items.map((it) => {
              const exp = ws.expanded && sameText(ws.expanded, it.name);
              const pct = it.saldo > 0 && totalPos > 0 ? Math.round((it.saldo / totalPos) * 100) : 0;
              const barW = it.saldo > 0 && totalPos > 0 ? clamp((it.saldo / totalPos) * 100, 2, 100) : 0;
              return `
                <div class="wallet-row ${exp ? "expanded" : ""}" style="${acctVars(it.name)}">
                  <div class="wallet-row-main" data-ws-toggle="${esc(it.name)}">
                    <span class="acct-badge" aria-hidden="true">${it.style.svg ? JAR_ICON : it.style.emoji}</span>
                    <div class="wallet-row-info">
                      <div class="wallet-row-title">
                        <span>${esc(it.name)}</span>
                        ${it.saldo > 0 && totalPos > 0 ? `<span class="wallet-pct">${pct}%</span>` : ""}
                      </div>
                      <div class="acct-bar" style="margin-top:6px"><span style="width:${barW.toFixed(1)}%"></span></div>
                    </div>
                    <div class="wallet-row-right">
                      <div class="wallet-row-bal ${it.saldo < 0 ? "amt-out" : ""}">${esc(fmtRp(it.saldo))}</div>
                      <div class="wallet-row-sub">${esc(it.style.catLabel || "Lainnya")}</div>
                    </div>
                  </div>
                  ${exp ? `
                    <div class="wallet-qa">
                      <button class="btn btn-primary" type="button" data-ws-transfer="${esc(it.name)}">🔁 Pindah</button>
                      <button class="btn btn-soft" type="button" data-ws-add="${esc(it.name)}">➕ Catat</button>
                      <button class="btn btn-ghost" type="button" data-ws-hist="${esc(it.name)}">🧾 Riwayat</button>
                    </div>` : ""}
                </div>`;
            }).join("")}`;
        }).join("");

    body.innerHTML = `
      <div class="wallet-head-bar">
        <span style="font-size:12.5px;color:var(--muted);font-weight:700">Dikelompokkan otomatis · Tap akun untuk aksi</span>
        <span class="wallet-total-chip">${esc(fmtRp(totalBalance()))}</span>
      </div>
      <div class="seg seg-full">
        ${[["ALL", "Semua"], ["EWALLET", "E-Wallet"], ["BANK", "Bank"], ["OTHER", "Tunai"]].map(([k, lbl]) => `
          <button type="button" class="seg-btn ${ws.filter === k ? "active" : ""}" data-ws-filter="${k}">${lbl}</button>
        `).join("")}
      </div>
      <div class="wallet-switch-row">
        <span>Menampilkan ${visible.length} akun</span>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <span>Sembunyikan Rp 0</span>
          <span class="switch"><input type="checkbox" id="wsHideZero" ${ws.hideZero ? "checked" : ""} /><span class="track"></span></span>
        </label>
      </div>
      <div>${groupsHtml}</div>
      <div class="form-actions" style="margin-top:14px">
        <button class="btn btn-ghost" type="button" id="wsOrderBtn">Atur Urutan</button>
        <button class="btn btn-primary" type="button" id="wsTransferBtn">🔁 Pindah Saldo</button>
      </div>`;

    body.querySelectorAll("[data-ws-filter]").forEach((b) => b.addEventListener("click", () => {
      ws.filter = b.dataset.wsFilter;
      renderSheetContent(body);
    }));
    const hz = body.querySelector("#wsHideZero");
    if (hz) hz.addEventListener("change", () => { ws.hideZero = hz.checked; renderSheetContent(body); });
    const sz = body.querySelector("#wsShowZeroBtn");
    if (sz) sz.addEventListener("click", () => { ws.hideZero = false; renderSheetContent(body); });
    body.querySelectorAll("[data-ws-toggle]").forEach((row) => row.addEventListener("click", () => {
      const name = row.dataset.wsToggle;
      ws.expanded = ws.expanded && sameText(ws.expanded, name) ? null : name;
      renderSheetContent(body);
    }));
    body.querySelectorAll("[data-ws-transfer]").forEach((b) => b.addEventListener("click", () => {
      openTransferForm(null, b.dataset.wsTransfer);
    }));
    body.querySelectorAll("[data-ws-add]").forEach((b) => b.addEventListener("click", () => {
      openTxForm({ akun: b.dataset.wsAdd });
    }));
    body.querySelectorAll("[data-ws-hist]").forEach((b) => b.addEventListener("click", () => {
      state.home.akun = b.dataset.wsHist;
      closeSheet();
      goTo("home");
      renderHome();
    }));
    body.querySelector("#wsOrderBtn").addEventListener("click", () => openWalletOrderSheet());
    body.querySelector("#wsTransferBtn").addEventListener("click", () => openTransferForm());
  };

  openSheet("Akun Penyimpanan Dana 💳", "<div></div>", renderSheetContent);
}

function openWalletOrderSheet() {
  let current = allAccountNames();
  const draw = (body) => {
    body.innerHTML = `
      <p style="font-size:12.5px;color:var(--muted);font-weight:700;margin-bottom:10px">Geser naik atau turun urutan dompet di layar utama.</p>
      ${current.map((name, i) => {
        const s = accountStyle(name);
        return `
          <div class="wallet-order-row" style="${acctVars(name)}">
            <span class="acct-badge" aria-hidden="true">${s.svg ? JAR_ICON : s.emoji}</span>
            <b>${esc(name)}</b>
            <button class="icon-btn icon-btn-sm" type="button" data-ord="-1" data-idx="${i}" ${i === 0 ? "disabled" : ""}>▲</button>
            <button class="icon-btn icon-btn-sm" type="button" data-ord="1" data-idx="${i}" ${i === current.length - 1 ? "disabled" : ""}>▼</button>
          </div>`;
      }).join("")}
      <div class="form-actions" style="margin-top:12px">
        <button class="btn btn-primary" type="button" id="ordDone">Selesai ✓</button>
      </div>`;
    body.querySelectorAll("[data-ord]").forEach((b) => b.addEventListener("click", () => {
      const idx = Number(b.dataset.idx);
      const next = idx + Number(b.dataset.ord);
      if (next < 0 || next >= current.length) return;
      const [m] = current.splice(idx, 1);
      current.splice(next, 0, m);
      saveAccountOrder(current);
      renderAccounts();
      draw(body);
    }));
    body.querySelector("#ordDone").addEventListener("click", () => openWalletSheet());
  };
  openSheet("Atur Urutan Akun", "<div></div>", draw);
}

// ---------------- Riwayat ----------------
function renderHistory() {
  const rowsMonth = monthTx(state.month);
  const totals = monthTotals(state.month);
  document.getElementById("histSummary").innerHTML = `
    <div class="sum-card"><div class="lbl">Pemasukan</div><div class="val amt-in">${esc(fmtRp(totals.income))}</div></div>
    <div class="sum-card"><div class="lbl">Pengeluaran</div><div class="val amt-out">${esc(fmtRp(totals.expense))}</div></div>
    <div class="sum-card"><div class="lbl">Selisih</div><div class="val">${esc(fmtRp(totals.net))}</div></div>`;
  renderFilterChips("histFilters", state.hist, sortAccounts([...new Set(rowsMonth.map((t) => t.akun))]));

  const rows = sortTxDesc(applyFilters(rowsMonth, state.hist));
  const el = document.getElementById("histList");
  if (rows.length === 0) {
    el.innerHTML = emptyState(rowsMonth.length === 0 ? "🗓️" : "🔎",
      rowsMonth.length === 0 ? `Belum ada transaksi di ${monthLabel(state.month)}.` : "Tidak ada transaksi yang cocok.");
    return;
  }
  const groups = new Map();
  rows.forEach((t) => {
    if (!groups.has(t.tanggal)) groups.set(t.tanggal, []);
    groups.get(t.tanggal).push(t);
  });
  const dayNet = (list) => list.filter((t) => !isTransfer(t)).reduce((a, t) => a + (isIncome(t) ? t.jumlah : isExpense(t) ? -t.jumlah : 0), 0);
  const netHtml = (net, cls = "") => Math.round(net) === 0 ? "" :
    `<span class="${cls} ${net > 0 ? "amt-in" : "amt-out"}">${net > 0 ? "+" : "−"} ${esc(fmtRp(Math.abs(net)))}</span>`;

  if (isDesktop()) {
    // PC: tabel yang rapi, satu baris per transaksi, dikelompokkan per hari
    el.innerHTML = `
      <div class="table-card"><table class="tx-table">
        <thead><tr><th>Jam</th><th>Keterangan</th><th>Kategori</th><th>Akun</th><th class="right">Jumlah</th></tr></thead>
        <tbody>${[...groups.entries()].map(([date, list]) => `
          <tr class="day-row"><td colspan="5"><b>${esc(longDateLabel(date))}</b>${netHtml(dayNet(list), "day-net")}</td></tr>
          ${list.map(txTableRow).join("")}`).join("")}
        </tbody>
      </table></div>`;
    return;
  }
  el.innerHTML = [...groups.entries()].map(([date, list]) => `
      <div class="day-group">
        <div class="day-head"><b>${esc(longDateLabel(date))}</b>${netHtml(dayNet(list))}</div>
        <div class="tx-list">${list.map(txRow).join("")}</div>
      </div>`).join("");
}

function txTableRow(t) {
  const inc = isIncome(t);
  const transfer = isTransfer(t);
  const cs = categoryStyle(transfer ? "Transfer" : t.kategori);
  const title = t.merchant || t.kategori || "(tanpa nama)";
  const amtClass = transfer ? "amt-neutral" : inc ? "amt-in" : "amt-out";
  return `
    <tr class="tx-row" data-tx="${esc(t.id)}" tabindex="0">
      <td class="cell-time">${esc((t.jam || "").slice(0, 5) || "—")}</td>
      <td class="cell-main"><b>${esc(title)}</b>${t.deskripsi ? `<span>${esc(t.deskripsi)}</span>` : ""}</td>
      <td><span class="cat-chip" style="--c:${cs.c};--cbg:${cs.bg}">${cs.emoji} ${esc(transfer ? "Transfer" : categoryKey(t.kategori))}</span></td>
      <td><span class="acct-tag" style="${acctVars(t.akun)}">${esc(t.akun)}</span></td>
      <td class="right tx-amt ${amtClass}">${inc ? "+" : "−"} ${esc(fmtRp(t.jumlah))}</td>
    </tr>`;
}

// ---------------- Statistik ----------------
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function buildCashflowPoints() {
  const ym = state.month;
  const sum = (rows, pred) => rows.filter(pred).reduce((a, t) => a + t.jumlah, 0);
  if (state.gran === "bulanan") {
    const pts = [];
    for (let off = -5; off <= 0; off++) {
      const m = addMonths(ym, off);
      const mt = monthTx(m).filter((t) => !isTransfer(t));
      pts.push({ label: MONTHS[Number(m.slice(5)) - 1].slice(0, 3), income: sum(mt, isIncome), expense: sum(mt, isExpense) });
    }
    return pts;
  }
  const [y, m] = ym.split("-").map(Number);
  const days = daysInMonth(y, m);
  const rows = monthTx(ym).filter((t) => !isTransfer(t));
  const daily = [];
  for (let d = 1; d <= days; d++) {
    const iso = isoOf(y, m, d);
    const dt = rows.filter((t) => t.tanggal === iso);
    daily.push({ day: d, income: sum(dt, isIncome), expense: sum(dt, isExpense) });
  }
  if (state.gran === "mingguan") {
    const weeks = [];
    daily.forEach((b) => {
      const w = Math.floor((b.day - 1) / 7);
      if (!weeks[w]) weeks[w] = { label: "Mg " + (w + 1), income: 0, expense: 0 };
      weeks[w].income += b.income;
      weeks[w].expense += b.expense;
    });
    return weeks;
  }
  return daily.map((b) => ({ label: String(b.day), income: b.income, expense: b.expense }));
}

function categoryTotals(ym, wantIncome = false) {
  const by = {};
  monthTx(ym).filter((t) => !isTransfer(t) && (wantIncome ? isIncome(t) : isExpense(t))).forEach((t) => {
    const k = categoryKey(t.kategori);
    by[k] = (by[k] || 0) + t.jumlah;
  });
  return by;
}

function isStatsSecVisible(id) {
  const prefs = state.statsPrefs || loadStatsPrefs();
  if (!prefs.enabledSections.includes(id)) return false;
  if (!prefs.useTabs) return true;
  const group = STATS_TAB_GROUPS[state.statsTab || "flow"] || STATS_TAB_GROUPS.flow;
  return group.includes(id);
}

function applyStatsPreset(preset) {
  const base = loadStatsPrefs();
  let next;
  if (preset === "web") {
    next = { ...base, useTabs: false, useBarChart: false, showHeroSavingsRing: false, enabledSections: ["cashflow", "category", "merchants", "compare"] };
  } else if (preset === "health") {
    next = { ...base, useTabs: true, useBarChart: false, showHeroSavingsRing: true, enabledSections: ["insights", "cashflow", "heatmap", "category", "progress", "export"] };
  } else if (preset === "pro") {
    next = { ...base, useTabs: false, useBarChart: true, showHeroSavingsRing: true, enabledSections: [...DEFAULT_STATS_SECTIONS] };
  } else {
    next = sanitizeStatsPrefs(null);
  }
  state.statsPrefs = sanitizeStatsPrefs(next);
  saveStatsPrefs();
}

function renderStats() {
  state.statsPrefs = sanitizeStatsPrefs(state.statsPrefs);
  const prefs = state.statsPrefs;
  if (state.statsSelectedDay && ymOf(state.statsSelectedDay) !== state.month) state.statsSelectedDay = null;

  renderStatsHero(prefs);

  const tabWrap = document.getElementById("statsTabWrap");
  if (tabWrap) {
    tabWrap.classList.toggle("hidden", !prefs.useTabs);
    tabWrap.querySelectorAll("[data-stats-tab]").forEach((b) => {
      b.classList.toggle("active", b.dataset.statsTab === state.statsTab);
    });
  }

  document.querySelectorAll("#granSeg .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.gran === state.gran));
  document.querySelectorAll("#cashflowTypeSeg .seg-btn").forEach((b) => {
    b.classList.toggle("active", (b.dataset.chartType === "bar") === prefs.useBarChart);
  });
  document.querySelectorAll("#catKindSeg .seg-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.catKind === state.statsCatType);
  });

  const grid = document.getElementById("statsGrid");
  if (grid) {
    prefs.sectionOrder.forEach((id) => {
      const sec = grid.querySelector(`[data-stats-sec="${id}"]`);
      if (sec) {
        sec.classList.toggle("hidden", !isStatsSecVisible(id));
        grid.appendChild(sec);
      }
    });
  }

  if (isStatsSecVisible("insights")) renderStatsInsights();
  if (isStatsSecVisible("heatmap")) renderStatsHeatmap();
  if (isStatsSecVisible("cashflow")) renderCashflow();
  if (isStatsSecVisible("category")) renderCategory();
  if (isStatsSecVisible("wallets")) renderStatsWallets();
  if (isStatsSecVisible("merchants")) renderTopMerchants();
  if (isStatsSecVisible("compare")) renderCompare();
  if (isStatsSecVisible("progress")) renderStatsProgress();
  if (isStatsSecVisible("export")) {
    const sub = document.getElementById("statsExportSub");
    const cnt = monthTx(state.month).length;
    if (sub) sub.textContent = `Laporan ${monthLabel(state.month)} • ${cnt} transaksi siap diunduh PDF / CSV`;
  }
}

function renderStatsHero(prefs) {
  const el = document.getElementById("statsHeroSub");
  if (!el) return;
  const totals = monthTotals(state.month);
  const prevTotals = monthTotals(addMonths(state.month, -1));
  const momPct = prevTotals.expense > 0 ? ((totals.expense - prevTotals.expense) / prevTotals.expense) * 100 : null;
  const momText = momPct === null ? "" : `${momPct > 0 ? "▲" : momPct < 0 ? "▼" : "•"} ${Math.abs(momPct).toFixed(1)}% vs bln lalu`;

  if (!prefs.showHeroSavingsRing) {
    el.innerHTML = `<div class="hero-pills three">
      <div class="pill"><span class="pill-ico"><svg class="ico"><use href="#i-up"/></svg></span><div><div class="pill-label">Pemasukan</div><div class="pill-val">${esc(fmtRp(totals.income))}</div></div></div>
      <div class="pill"><span class="pill-ico"><svg class="ico"><use href="#i-down"/></svg></span><div><div class="pill-label">Pengeluaran</div><div class="pill-val">${esc(fmtRp(totals.expense))}</div></div></div>
      <div class="pill"><span class="pill-ico"><svg class="ico"><use href="#i-sparkle"/></svg></span><div><div class="pill-label">Selisih</div><div class="pill-val">${esc(fmtRp(totals.net))}</div></div></div>
    </div>`;
    return;
  }

  const rawRate = totals.income > 0 ? ((totals.income - totals.expense) / totals.income) * 100 : 0;
  const rateClamped = clamp(rawRate, 0, 100);
  const r = 30;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - rateClamped / 100);
  const ringColor = rawRate >= 20 ? "#86EFAC" : rawRate > 0 ? "#FDE047" : "#FDA4AF";

  el.innerHTML = `
    <div class="stats-ring-hero">
      <div class="stats-ring-svg" aria-hidden="true">
        <svg viewBox="0 0 76 76">
          <circle cx="38" cy="38" r="${r}" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="8"/>
          <circle cx="38" cy="38" r="${r}" fill="none" stroke="${ringColor}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${dashOffset.toFixed(1)}"/>
        </svg>
        <div class="stats-ring-center"><b>${totals.income > 0 ? Math.round(clamp(rawRate, -99, 100)) : 0}%</b><small>Tabung</small></div>
      </div>
      <div class="stats-ring-meta">
        <div class="stats-ring-row"><span>📈 Pemasukan</span><b>${esc(fmtRp(totals.income))}</b></div>
        <div class="stats-ring-row"><span>📉 Pengeluaran</span><b>${esc(fmtRp(totals.expense))}</b></div>
        <div class="stats-ring-row"><span>✨ Selisih Bersih</span><b>${esc(fmtRp(totals.net))}</b></div>
        ${momText ? `<span class="stats-mom-pill">${esc(momText)}</span>` : ""}
      </div>
    </div>`;
}

function renderStatsInsights() {
  const el = document.getElementById("statsInsights");
  if (!el) return;
  const rows = monthTx(state.month).filter((t) => !isTransfer(t));
  if (rows.length === 0) {
    el.innerHTML = emptyState("💡", `Belum ada transaksi di ${monthLabel(state.month)} untuk dianalisis.`);
    return;
  }
  const totals = monthTotals(state.month);
  const prevTotals = monthTotals(addMonths(state.month, -1));
  const [y, m] = state.month.split("-").map(Number);
  const now = new Date();
  const curYm = currentYM();
  const activeDays = state.month === curYm ? now.getDate() : daysInMonth(y, m);
  const avgDaily = activeDays > 0 ? totals.expense / activeDays : 0;

  const byDay = new Map();
  const byDow = [0, 0, 0, 0, 0, 0, 0];
  rows.filter(isExpense).forEach((t) => {
    byDay.set(t.tanggal, (byDay.get(t.tanggal) || 0) + t.jumlah);
    const p = parseIso(t.tanggal);
    if (p) byDow[(new Date(p.y, p.m - 1, p.d).getDay() + 6) % 7] += t.jumlah;
  });
  let peakDay = null;
  let peakDayAmt = 0;
  byDay.forEach((v, k) => { if (v > peakDayAmt) { peakDayAmt = v; peakDay = k; } });
  let peakDow = 0;
  byDow.forEach((v, idx) => { if (v > byDow[peakDow]) peakDow = idx; });

  const momDiff = totals.expense - prevTotals.expense;
  const momPct = prevTotals.expense > 0 ? ((momDiff / prevTotals.expense) * 100) : null;
  const topCat = Object.entries(categoryTotals(state.month, false)).sort((a, b) => b[1] - a[1])[0];
  const saveRate = totals.income > 0 ? Math.round(((totals.income - totals.expense) / totals.income) * 100) : 0;

  let tip = "Catat pemasukan dan pengeluaranmu secara rutin agar tren keuangan makin terbaca.";
  if (totals.expense > totals.income && totals.income > 0) {
    tip = `⚠️ Pengeluaran bulan ini melebihi pemasukan sebesar ${fmtRp(totals.expense - totals.income)}. Cek kategori ${topCat ? topCat[0] : "terbesar"}.`;
  } else if (saveRate >= 30) {
    tip = `🌟 Mantap! Rasio tabungan ${saveRate}% melampaui target ideal 20%. Pertahankan ritme ini!`;
  } else if (topCat) {
    const share = totals.expense > 0 ? Math.round((topCat[1] / totals.expense) * 100) : 0;
    tip = `💡 Pengeluaran terbesar ada di kategori ${topCat[0]} (${share}% dari total jajan bulan ini).`;
  }

  el.innerHTML = `
    <div class="insight-grid">
      <div class="insight-tile"><div class="lbl">Rata-rata Harian</div><div class="val">${esc(fmtRp(avgDaily))}/hr</div></div>
      <div class="insight-tile"><div class="lbl">Hari Terboros</div><div class="val">${peakDay ? esc(dateLabel(peakDay, true)) : "—"}</div><div class="lbl">${peakDayAmt > 0 ? esc(fmtRp(peakDayAmt)) : "Belum ada"}</div></div>
      <div class="insight-tile"><div class="lbl">Hari Favorit Jajan</div><div class="val">${byDow[peakDow] > 0 ? WEEKDAYS[peakDow] : "—"}</div></div>
      <div class="insight-tile"><div class="lbl">Tren vs Bulan Lalu</div><div class="val ${momDiff > 0 ? "amt-out" : "amt-in"}">${momPct === null ? "Baru" : `${momPct > 0 ? "▲" : momPct < 0 ? "▼" : "•"} ${Math.abs(momPct).toFixed(1)}%`}</div></div>
    </div>
    <div class="insight-tip">${esc(tip)}</div>`;
}

function renderStatsHeatmap() {
  const el = document.getElementById("statsHeatmap");
  const clearBtn = document.getElementById("heatmapClearBtn");
  if (!el) return;
  const [y, m] = state.month.split("-").map(Number);
  const days = daysInMonth(y, m);
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;

  const byDay = new Map();
  monthTx(state.month).filter((t) => isExpense(t) && !isTransfer(t)).forEach((t) => {
    byDay.set(t.tanggal, (byDay.get(t.tanggal) || 0) + t.jumlah);
  });
  const vals = [...byDay.values()];
  const maxV = vals.length > 0 ? Math.max(...vals) : 0;

  let cells = "";
  for (let i = 0; i < offset; i++) cells += `<div class="heat-cell empty" aria-hidden="true"></div>`;
  for (let d = 1; d <= days; d++) {
    const iso = isoOf(y, m, d);
    const v = byDay.get(iso) || 0;
    const ratio = maxV > 0 ? v / maxV : 0;
    const lv = v <= 0 ? "" : ratio >= 0.75 ? "lv4" : ratio >= 0.45 ? "lv3" : ratio >= 0.18 ? "lv2" : "lv1";
    const sel = state.statsSelectedDay === iso ? "selected" : "";
    cells += `<button type="button" class="heat-cell ${lv} ${sel}" data-heat-day="${iso}" title="${dateLabel(iso, true)}: ${fmtRp(v)}">${d}</button>`;
  }

  const selAmt = state.statsSelectedDay ? (byDay.get(state.statsSelectedDay) || 0) : 0;
  if (clearBtn) clearBtn.classList.toggle("hidden", !state.statsSelectedDay);

  el.innerHTML = `
    <div class="heat-dow"><span>Sn</span><span>Sl</span><span>Rb</span><span>Km</span><span>Jm</span><span>Sb</span><span>Mg</span></div>
    <div class="heat-grid">${cells}</div>
    <div class="heat-legend">
      <span>Max harian: <b>${maxV > 0 ? esc(fmtRp(maxV)) : "—"}</b></span>
      <span class="heat-scale"><span>Ringan</span><span class="heat-dot"></span><span class="heat-dot lv1"></span><span class="heat-dot lv2"></span><span class="heat-dot lv3"></span><span class="heat-dot lv4"></span><span>Tinggi</span></span>
    </div>
    ${state.statsSelectedDay ? `<div class="heat-detail"><span>📅 ${esc(dateLabel(state.statsSelectedDay, true))}</span><b>${esc(fmtRp(selAmt))}</b></div>` : ""}`;
}

function chartReady() { return typeof window.Chart !== "undefined"; }

function renderCashflow() {
  const canvas = document.getElementById("cashflowChart");
  const empty = document.getElementById("cashflowEmpty");
  const pts = buildCashflowPoints();
  const hasData = pts.some((p) => p.income > 0 || p.expense > 0);
  if (!chartReady() || !hasData) {
    if (cashflowChart) { cashflowChart.destroy(); cashflowChart = null; }
    canvas.parentElement.classList.add("hidden");
    empty.classList.remove("hidden");
    empty.textContent = chartReady() ? "Belum ada data di periode ini 🌱" : "Grafik belum termuat (butuh internet sekali untuk mengunduh library).";
    return;
  }
  canvas.parentElement.classList.remove("hidden");
  empty.classList.add("hidden");
  const tick = cssVar("--chart-tick");
  const grid = cssVar("--chart-grid");
  const inc = cssVar("--chart-income");
  const exp = cssVar("--chart-expense");
  const wantBar = !!(state.statsPrefs && state.statsPrefs.useBarChart);
  const targetType = wantBar ? "bar" : "line";

  const data = wantBar
    ? {
        labels: pts.map((p) => p.label),
        datasets: [
          { label: "Pemasukan", data: pts.map((p) => p.income), backgroundColor: inc + "CC", borderRadius: 6, maxBarThickness: 18 },
          { label: "Pengeluaran", data: pts.map((p) => p.expense), backgroundColor: exp + "CC", borderRadius: 6, maxBarThickness: 18 },
        ],
      }
    : {
        labels: pts.map((p) => p.label),
        datasets: [
          { label: "Pemasukan", data: pts.map((p) => p.income), borderColor: inc, backgroundColor: inc + "26", fill: true, tension: 0.4, pointRadius: 2, borderWidth: 2.5 },
          { label: "Pengeluaran", data: pts.map((p) => p.expense), borderColor: exp, backgroundColor: exp + "22", fill: true, tension: 0.4, pointRadius: 2, borderWidth: 2.5 },
        ],
      };

  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: tick, boxWidth: 10, usePointStyle: true, font: { family: "Nunito", weight: "700" } } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtRp(c.raw)}` } },
    },
    scales: {
      x: { ticks: { color: tick, maxTicksLimit: 10, font: { family: "Nunito" } }, grid: { color: grid } },
      y: { ticks: { color: tick, callback: (v) => (state.hide ? "•••" : shortRp(v)), font: { family: "Nunito" } }, grid: { color: grid }, beginAtZero: true },
    },
  };
  if (cashflowChart && cashflowChart.config.type !== targetType) {
    cashflowChart.destroy();
    cashflowChart = null;
  }
  if (cashflowChart) { cashflowChart.data = data; cashflowChart.options = opts; cashflowChart.update(); }
  else cashflowChart = new window.Chart(canvas, { type: targetType, data, options: opts });
}

function renderCategory() {
  const canvas = document.getElementById("categoryChart");
  const listEl = document.getElementById("categoryList");
  const titleEl = document.getElementById("statsCatTitle");
  const wantIncome = state.statsCatType === "INCOME";
  if (titleEl) titleEl.textContent = wantIncome ? "🍩 Pemasukan per Kategori" : "🍩 Pengeluaran per Kategori";

  const entries = Object.entries(categoryTotals(state.month, wantIncome)).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, e) => a + e[1], 0);
  if (entries.length === 0) {
    if (categoryChart) { categoryChart.destroy(); categoryChart = null; }
    canvas.parentElement.classList.add("hidden");
    listEl.innerHTML = emptyState("🍩", wantIncome ? "Belum ada pemasukan di bulan ini." : "Belum ada pengeluaran di bulan ini.");
    return;
  }
  listEl.innerHTML = entries.slice(0, 8).map(([name, val], i) => {
    const cs = categoryStyle(name);
    const pct = total > 0 ? (val / total) * 100 : 0;
    return `
      <div class="cat-row">
        <span class="emo" style="--c:${cs.c};--cbg:${cs.bg}" aria-hidden="true">${cs.emoji}</span>
        <div><div class="name">${esc(name)}</div><div class="bar"><span style="width:${pct.toFixed(1)}%;background:${PALETTE[i % PALETTE.length]}"></span></div></div>
        <div class="val">${esc(fmtRp(val))}<small>${pct.toFixed(0)}%</small></div>
      </div>`;
  }).join("");
  if (!chartReady()) { canvas.parentElement.classList.add("hidden"); return; }
  canvas.parentElement.classList.remove("hidden");
  const data = {
    labels: entries.slice(0, 8).map((e) => e[0]),
    datasets: [{ data: entries.slice(0, 8).map((e) => e[1]), backgroundColor: PALETTE, borderWidth: 3, borderColor: cssVar("--surface"), hoverOffset: 6 }],
  };
  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "62%",
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.label}: ${fmtRp(c.raw)}` } } },
  };
  if (categoryChart) { categoryChart.data = data; categoryChart.options = opts; categoryChart.update(); }
  else categoryChart = new window.Chart(canvas, { type: "doughnut", data, options: opts });
}

function renderStatsWallets() {
  const el = document.getElementById("statsWallets");
  if (!el) return;
  const by = new Map();
  monthTx(state.month).filter((t) => isExpense(t) && !isTransfer(t)).forEach((t) => {
    const k = String(t.akun || "Tunai").trim() || "Tunai";
    const cur = by.get(k) || { akun: k, total: 0, count: 0 };
    cur.total += t.jumlah;
    cur.count += 1;
    by.set(k, cur);
  });
  const list = [...by.values()].sort((a, b) => b.total - a.total);
  const sum = list.reduce((a, x) => a + x.total, 0);
  if (list.length === 0) {
    el.innerHTML = emptyState("👛", "Belum ada pengeluaran tercatat di dompet bulan ini.");
    return;
  }
  el.innerHTML = list.slice(0, 8).map((w) => {
    const st = accountStyle(w.akun);
    const pct = sum > 0 ? (w.total / sum) * 100 : 0;
    return `
      <div class="cat-row">
        <span class="emo" style="--c:${st.c};--cbg:${st.bg}" aria-hidden="true">${st.emoji}</span>
        <div>
          <div class="name">${esc(w.akun)} <small class="muted" style="font-weight:700">· ${w.count}×</small></div>
          <div class="bar"><span style="width:${pct.toFixed(1)}%;background:${st.from}"></span></div>
        </div>
        <div class="val">${esc(fmtRp(w.total))}<small>${pct.toFixed(0)}%</small></div>
      </div>`;
  }).join("");
}

function renderTopMerchants() {
  const el = document.getElementById("topMerchants");
  const by = new Map();
  monthTx(state.month).filter((t) => isExpense(t) && !isTransfer(t) && t.merchant.trim()).forEach((t) => {
    const k = t.merchant.trim().toLowerCase();
    const cur = by.get(k) || { name: t.merchant.trim(), total: 0, count: 0 };
    cur.total += t.jumlah;
    cur.count += 1;
    by.set(k, cur);
  });
  const top = [...by.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  el.innerHTML = top.length === 0
    ? emptyState("🏪", "Belum ada pengeluaran dengan nama merchant.")
    : top.map((m, i) => `
      <div class="rank-row">
        <span class="rank-no">${i + 1}</span>
        <div class="rank-main"><b>${esc(m.name)}</b><span>${m.count}× transaksi</span></div>
        <div class="rank-val amt-out">${esc(fmtRp(m.total))}</div>
      </div>`).join("");
}

function renderCompare() {
  const el = document.getElementById("compareList");
  const now = expenseByCategory(state.month);
  const prev = expenseByCategory(addMonths(state.month, -1));
  const keys = [...new Set([...Object.keys(now), ...Object.keys(prev)])]
    .filter((k) => (now[k] || 0) > 0 || (prev[k] || 0) > 0)
    .sort((a, b) => (now[b] || 0) - (now[a] || 0));
  if (keys.length === 0) { el.innerHTML = emptyState("📈", "Belum ada pengeluaran untuk dibandingkan."); return; }
  el.innerHTML = keys.slice(0, 8).map((k) => {
    const a = prev[k] || 0;
    const b = now[k] || 0;
    let change;
    if (a === 0) change = `<small class="badge badge-info">Baru</small>`;
    else {
      const pct = ((b - a) / a) * 100;
      const up = pct > 0;
      change = `<small class="${up ? "amt-out" : "amt-in"}">${up ? "▲" : pct < 0 ? "▼" : "•"} ${Math.abs(pct).toFixed(1)}%</small>`;
    }
    const cs = categoryStyle(k);
    return `
      <div class="rank-row">
        <span class="rank-no cat" style="--c:${cs.c};--cbg:${cs.bg}" aria-hidden="true">${cs.emoji}</span>
        <div class="rank-main"><b>${esc(k)}</b><span>Bulan lalu ${esc(fmtRp(a))}</span></div>
        <div class="rank-val">${esc(fmtRp(b))}${change}</div>
      </div>`;
  }).join("");
}

function renderStatsProgress() {
  const el = document.getElementById("statsProgress");
  if (!el) return;
  const budgets = state.budgets.filter((b) => b.bulan === state.month && b.enabled !== false).map(budgetView).sort((a, b) => b.pct - a.pct);
  const goals = state.goals.filter((g) => g.enabled !== false).map(goalView);
  if (budgets.length === 0 && goals.length === 0) {
    el.innerHTML = emptyState("🎯", "Belum ada budget atau goal aktif di bulan ini.");
    return;
  }
  const budgetHtml = budgets.slice(0, 4).map((v) => `
    <div class="stats-prog-mini">
      <div class="stats-prog-top"><span>${categoryStyle(v.b.kategori).emoji} Budget ${esc(v.b.kategori)}</span><span style="color:${STATUS_COLOR[v.status]}">${Math.round(v.pct)}%</span></div>
      <div class="bar"><span style="width:${clamp(v.pct, 0, 100).toFixed(1)}%;background:${STATUS_COLOR[v.status]}"></span></div>
      <div class="stats-prog-sub"><span>${esc(fmtRp(v.spent))} / ${esc(fmtRp(v.limit))}</span><span>Sisa ${esc(fmtRp(Math.max(0, v.sisa)))}</span></div>
    </div>`).join("");
  const goalHtml = goals.slice(0, 4).map((v) => {
    const color = v.status === "done" ? "#10B981" : "linear-gradient(90deg,#EC4899,#A04FD6)";
    return `
      <div class="stats-prog-mini">
        <div class="stats-prog-top"><span>${v.status === "done" ? "🏆" : "🎯"} Goal ${esc(v.g.name)}</span><span>${v.pct.toFixed(0)}%</span></div>
        <div class="bar"><span style="width:${clamp(v.pct, 0, 100).toFixed(1)}%;background:${color}"></span></div>
        <div class="stats-prog-sub"><span>${esc(fmtRp(v.saldo))} / ${esc(fmtRp(v.target))}</span><span>${GOAL_STATUS[v.status].label}</span></div>
      </div>`;
  }).join("");
  el.innerHTML = `<div class="stats-prog-sec">${budgetHtml}${goalHtml}</div>`;
}

function openStatsConfigSheet() {
  const draw = (body) => {
    const p = sanitizeStatsPrefs(state.statsPrefs);
    state.statsPrefs = p;
    const enabledSet = new Set(p.enabledSections);
    body.innerHTML = `
      <div class="field-label">Preset Cepat</div>
      <div class="preset-row">
        <button class="preset-btn" type="button" data-stats-preset="all"><b>✨ Semua Lengkap</b><span>9 widget aktif + Ring Hero</span></button>
        <button class="preset-btn" type="button" data-stats-preset="web"><b>🌐 Minimalis Web</b><span>Arus Kas, Donut, Merchant, MoM</span></button>
        <button class="preset-btn" type="button" data-stats-preset="health"><b>💚 Fokus Health</b><span>Tab 3 bagian + Ring + Insight</span></button>
        <button class="preset-btn" type="button" data-stats-preset="pro"><b>📊 Pro Analitik</b><span>Grafik batang + Kalender penuh</span></button>
      </div>
      <div class="field-label">Gaya Tampilan &amp; Grafik</div>
      <label class="switch-row">
        <div class="switch-text"><div class="switch-title">Mode 3 Tab Statistik</div><div class="switch-sub">Pisahkan jadi tab Arus Kas, Kategori &amp; Target</div></div>
        <span class="switch"><input type="checkbox" id="cfgStatsTabs" ${p.useTabs ? "checked" : ""} /><span class="track"></span></span>
      </label>
      <label class="switch-row">
        <div class="switch-text"><div class="switch-title">Grafik Batang Arus Kas</div><div class="switch-sub">Matikan untuk grafik garis / area lembut</div></div>
        <span class="switch"><input type="checkbox" id="cfgStatsBar" ${p.useBarChart ? "checked" : ""} /><span class="track"></span></span>
      </label>
      <label class="switch-row">
        <div class="switch-text"><div class="switch-title">Cincin Rasio Tabungan di Hero</div><div class="switch-sub">Tampilkan % tabungan &amp; tren bulan lalu di header</div></div>
        <span class="switch"><input type="checkbox" id="cfgStatsRing" ${p.showHeroSavingsRing ? "checked" : ""} /><span class="track"></span></span>
      </label>
      <div class="field-label" style="margin-top:12px">Aktifkan &amp; Urutkan Widget (${p.enabledSections.length}/${p.sectionOrder.length})</div>
      <div>
        ${p.sectionOrder.map((id, idx) => {
          const meta = STATS_SECTIONS_META[id] || { emoji: "📊", title: id, desc: "" };
          const on = enabledSet.has(id);
          return `
            <div class="stats-cfg-row">
              <span class="emo" aria-hidden="true">${meta.emoji}</span>
              <div class="meta"><b>${esc(meta.title)}</b><span>${esc(meta.desc)}</span></div>
              <div class="stats-cfg-arrows">
                <button class="icon-btn icon-btn-sm" type="button" data-stats-move="${idx}:-1" ${idx === 0 ? "disabled" : ""} aria-label="Naikkan">▲</button>
                <button class="icon-btn icon-btn-sm" type="button" data-stats-move="${idx}:1" ${idx === p.sectionOrder.length - 1 ? "disabled" : ""} aria-label="Turunkan">▼</button>
              </div>
              <span class="switch"><input type="checkbox" data-stats-sec-toggle="${id}" ${on ? "checked" : ""} /><span class="track"></span></span>
            </div>`;
        }).join("")}
      </div>
      <div class="form-actions" style="margin-top:14px">
        <button class="btn btn-ghost" type="button" id="cfgStatsReset">↺ Default</button>
        <button class="btn btn-primary" type="button" data-sheet-close>Selesai</button>
      </div>`;

    body.querySelectorAll("[data-stats-preset]").forEach((btn) => btn.addEventListener("click", () => {
      applyStatsPreset(btn.dataset.statsPreset);
      renderStats();
      draw(body);
      toast("Preset Statistik diterapkan ✨");
    }));
    body.querySelector("#cfgStatsTabs").addEventListener("change", (e) => {
      state.statsPrefs.useTabs = e.target.checked;
      saveStatsPrefs();
      renderStats();
    });
    body.querySelector("#cfgStatsBar").addEventListener("change", (e) => {
      state.statsPrefs.useBarChart = e.target.checked;
      saveStatsPrefs();
      renderStats();
    });
    body.querySelector("#cfgStatsRing").addEventListener("change", (e) => {
      state.statsPrefs.showHeroSavingsRing = e.target.checked;
      saveStatsPrefs();
      renderStats();
    });
    body.querySelectorAll("[data-stats-sec-toggle]").forEach((chk) => chk.addEventListener("change", () => {
      const id = chk.dataset.statsSecToggle;
      const cur = new Set(state.statsPrefs.enabledSections);
      if (chk.checked) cur.add(id);
      else if (cur.size > 1) cur.delete(id);
      else {
        chk.checked = true;
        return toast("Minimal 1 widget statistik harus aktif.", "error");
      }
      state.statsPrefs.enabledSections = [...cur];
      saveStatsPrefs();
      renderStats();
      draw(body);
    }));
    body.querySelectorAll("[data-stats-move]").forEach((btn) => btn.addEventListener("click", () => {
      const [idxStr, deltaStr] = btn.dataset.statsMove.split(":");
      const idx = Number(idxStr);
      const target = idx + Number(deltaStr);
      const arr = state.statsPrefs.sectionOrder.slice();
      if (target < 0 || target >= arr.length) return;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      state.statsPrefs.sectionOrder = arr;
      saveStatsPrefs();
      renderStats();
      draw(body);
    }));
    body.querySelector("#cfgStatsReset").addEventListener("click", () => {
      applyStatsPreset("all");
      renderStats();
      draw(body);
      toast("Pengaturan Statistik dikembalikan ke default ↺");
    });
  };
  openSheet("Atur Tampilan Statistik ⚙️", "<div></div>", draw);
}

// ---------------- Money: hutang, budget, goal, berulang ----------------
function renderMoney() {
  renderDebts();
  renderBudgets();
  renderGoals();
  renderRecurring();
}

function paymentsForDebt(debtId) {
  return state.debtPayments
    .filter((p) => p.debtId === debtId)
    .slice()
    .sort((a, b) => (b.tanggal + (b.jam || "")).localeCompare(a.tanggal + (a.jam || "")));
}

function renderDebts() {
  const tilesEl = document.getElementById("debtSummaryTiles");
  const ctrlEl = document.getElementById("debtControls");
  const listEl = document.getElementById("debtList");
  if (!tilesEl || !ctrlEl || !listEl) return;

  const activeHutang = state.debts.filter((d) => !d.settled && d.tipe === "HUTANG");
  const activePiutang = state.debts.filter((d) => !d.settled && d.tipe === "PIUTANG");
  const sumHutang = activeHutang.reduce((s, d) => s + Math.max(0, d.amount - d.paidAmount), 0);
  const sumPiutang = activePiutang.reduce((s, d) => s + Math.max(0, d.amount - d.paidAmount), 0);

  tilesEl.innerHTML = `
    <button type="button" class="debt-tile hutang ${state.debtTab === "HUTANG" ? "active" : ""}" data-debt-tab="HUTANG">
      <div class="lbl">Hutang Saya</div>
      <div class="val">${esc(fmtRp(sumHutang))}</div>
      <div class="sub">${activeHutang.length} belum lunas</div>
    </button>
    <button type="button" class="debt-tile piutang ${state.debtTab === "PIUTANG" ? "active" : ""}" data-debt-tab="PIUTANG">
      <div class="lbl">Hutang Orang ke Kita</div>
      <div class="val">${esc(fmtRp(sumPiutang))}</div>
      <div class="sub">${activePiutang.length} belum lunas</div>
    </button>`;

  ctrlEl.innerHTML = `
    <div class="seg seg-sm">
      <button type="button" class="seg-btn ${state.debtTab === "HUTANG" ? "active" : ""}" data-debt-tab="HUTANG">Hutang Saya</button>
      <button type="button" class="seg-btn ${state.debtTab === "PIUTANG" ? "active" : ""}" data-debt-tab="PIUTANG">Hutang Orang</button>
    </div>
    <div class="chips" style="margin:0;padding:0">
      ${[["ALL", "Semua"], ["ACTIVE", "Belum Lunas"], ["SETTLED", "Lunas"]].map(([k, lbl]) => `
        <button type="button" class="chip ${state.debtFilter === k ? "active" : ""}" data-debt-filter="${k}">${lbl}</button>
      `).join("")}
    </div>`;

  const shown = state.debts
    .filter((d) => d.tipe === state.debtTab)
    .filter((d) => state.debtFilter === "ALL" ? true : state.debtFilter === "ACTIVE" ? !d.settled : d.settled)
    .slice()
    .sort((a, b) => Number(a.settled) - Number(b.settled) || String(b.tanggal || "").localeCompare(String(a.tanggal || "")));

  if (shown.length === 0) {
    listEl.innerHTML = emptyState("🤝", state.debtTab === "HUTANG" ? "Belum ada catatan hutang kamu." : "Belum ada catatan hutang orang ke kamu.");
    return;
  }

  listEl.innerHTML = shown.map((d) => {
    const isH = d.tipe === "HUTANG";
    const rem = Math.max(0, d.amount - d.paidAmount);
    const pct = d.amount > 0 ? clamp((d.paidAmount / d.amount) * 100, 0, 100) : 0;
    const overdue = !d.settled && !!d.dueDate && d.dueDate < todayIso();
    const payments = paymentsForDebt(d.id);
    const latest = payments[0] || null;
    const accent = d.settled || !isH ? "#047857" : "#E11D48";
    const badgeCls = d.settled ? "badge-ok" : overdue ? "badge-bad" : d.paidAmount > 0 ? "badge-warn" : "badge-muted";
    const badgeLbl = d.settled ? "Lunas" : overdue ? "Jatuh tempo lewat" : d.paidAmount > 0 ? `Dicicil ${Math.round(pct)}%` : "Belum lunas";

    return `
      <div class="debt-card">
        <div class="debt-head">
          <span class="emo" style="background:${d.settled || !isH ? "var(--income-soft)" : "var(--expense-soft)"};color:${accent}" aria-hidden="true">👤</span>
          <div class="debt-meta">
            <div><b>${esc(d.personName)}</b><span class="badge ${badgeCls}">${badgeLbl}</span></div>
            <small>${esc(dateLabel(d.tanggal, true))}${d.dueDate ? " · Tempo " + esc(dateLabel(d.dueDate, true)) : ""}</small>
          </div>
          <button class="icon-btn icon-btn-sm" type="button" data-debt-edit="${esc(d.id)}" aria-label="Edit ${esc(d.personName)}" title="Edit"><svg class="ico"><use href="#i-edit"/></svg></button>
          <button class="icon-btn icon-btn-sm" type="button" data-debt-del="${esc(d.id)}" style="color:var(--expense)" aria-label="Hapus ${esc(d.personName)}" title="Hapus"><svg class="ico"><use href="#i-trash"/></svg></button>
        </div>
        <div class="debt-amt-row">
          <div>
            <div style="font-size:11.5px;color:var(--muted);font-weight:700">${d.settled ? "Total" : (isH ? "Sisa hutang" : "Sisa piutang")}</div>
            <div class="big" style="color:${accent}">${esc(fmtRp(d.settled ? d.amount : rem))}</div>
          </div>
          ${d.paidAmount > 0 && !d.settled ? `<div style="font-size:11.5px;color:var(--muted);font-weight:700">Terbayar ${esc(fmtRp(d.paidAmount))} / ${esc(fmtRp(d.amount))}</div>` : ""}
        </div>
        ${d.paidAmount > 0 || d.settled ? `<div class="bar"><span style="width:${pct.toFixed(1)}%;background:${d.settled ? "#10B981" : accent}"></span></div>` : ""}
        ${latest ? `<div style="margin-top:6px;font-size:11.5px;color:var(--muted);font-weight:700">${payments.length}x cicilan · Terakhir ${esc(dateLabel(latest.tanggal, true))} (${esc(fmtRp(latest.amount))})</div>` : ""}
        ${d.catatan ? `<div style="margin-top:6px;font-size:12px;color:var(--muted);font-weight:600">${esc(d.catatan)}</div>` : ""}
        <div class="debt-actions">
          <button class="btn btn-ghost" type="button" data-debt-history="${esc(d.id)}">🕒 Riwayat${payments.length ? ` (${payments.length})` : ""}</button>
          ${!d.settled ? `<button class="btn btn-primary" type="button" data-debt-pay="${esc(d.id)}" style="${isH ? "background:#E11D48" : "background:#047857"}">${isH ? "Bayar / Cicil" : "Terima Cicilan"}</button>` : ""}
        </div>
      </div>`;
  }).join("");
}

async function deleteDebtWithConfirm(debt, btn, { closeAfter = false, form = null } = {}) {
  if (!debt) return;
  const ok = await askConfirm(`Hapus catatan dengan "${debt.personName}" beserta riwayat cicilannya?`);
  if (!ok) return;
  const id = String(debt.id ?? "").trim();
  try {
    await withBusy(btn, closeAfter ? "Menghapus..." : "...", async () => { ensureOnline(); await api.debtDelete(id); });
    removeById(state.debts, id);
    state.debtPayments = state.debtPayments.filter((p) => String(p.debtId ?? "").trim() !== id);
    if (closeAfter) closeSheet();
    toast("Catatan dihapus 🗑️");
    commitLocal();
  } catch (err) {
    if (form) setFormError(form, err.message);
    else toast(err.message, "error");
  }
}

function openDebtForm(debt = null, defaultType = "HUTANG") {
  const isEdit = !!debt;
  const f = {
    id: debt ? debt.id : uuid(),
    tipe: debt ? debt.tipe : defaultType,
    akun: debt ? debt.akun : "Tunai",
    recordInitialTx: false,
  };
  const html = `
    <form class="form" id="debtForm" novalidate>
      <div class="type-toggle">
        <button type="button" class="type-btn out ${f.tipe === "HUTANG" ? "active" : ""}" data-dtipe="HUTANG">🔴 Hutang Saya</button>
        <button type="button" class="type-btn in ${f.tipe === "PIUTANG" ? "active" : ""}" data-dtipe="PIUTANG">🟢 Hutang Orang</button>
      </div>
      <label class="field"><span class="field-label" id="dPersonLbl">${f.tipe === "HUTANG" ? "Pinjam dari siapa?" : "Siapa yang berhutang?"}</span>
        <input id="dPerson" maxlength="60" placeholder="Nama orang / pihak" value="${esc(debt ? debt.personName : "")}" required /></label>
      ${amountFieldHtml("dAmount", debt ? debt.amount : 0)}
      <div class="row-2">
        <label class="field"><span class="field-label">Tanggal</span><input type="date" id="dDate" value="${esc(debt ? debt.tanggal : todayIso())}" required /></label>
        <label class="field"><span class="field-label">Jatuh tempo (opsional)</span><input type="date" id="dDue" value="${esc(debt ? debt.dueDate : "")}" /></label>
      </div>
      <div class="field"><span class="field-label">Akun</span>${pickGroup("dAkun", accountItems(), f.akun)}</div>
      <label class="field"><span class="field-label">Catatan (opsional)</span><input id="dNote" maxlength="160" placeholder="opsional" value="${esc(debt ? debt.catatan : "")}" /></label>
      ${!isEdit ? `
        <div class="switch-row">
          <div class="switch-text">
            <div class="switch-title">Catat ke transaksi &amp; saldo akun</div>
            <div class="switch-sub" id="dTxHint">${f.tipe === "HUTANG" ? "Menambah saldo akun (Pemasukan)." : "Mengurangi saldo akun (Pengeluaran)."}</div>
          </div>
          <label class="switch"><input type="checkbox" id="dRecordInit" /><span class="track"></span></label>
        </div>` : ""}
      <div class="form-error" role="alert"></div>
      <div class="form-actions">
        ${isEdit ? `<button type="button" class="btn btn-danger-soft" id="dDelete"><svg class="ico"><use href="#i-trash"/></svg>Hapus</button>` : ""}
        <button type="submit" class="btn btn-primary" id="dSave">${isEdit ? "Simpan perubahan" : "Simpan 🤝"}</button>
      </div>
    </form>`;

  openSheet(isEdit ? "Ubah Catatan Hutang" : "Catat Hutang / Piutang 🤝", html, (body) => {
    const form = body.querySelector("#debtForm");
    const amountEl = body.querySelector("#dAmount");
    bindAmountInput(amountEl);
    bindPickGroup(body, "dAkun", (v) => { f.akun = v; });

    body.querySelectorAll("[data-dtipe]").forEach((b) => b.addEventListener("click", () => {
      f.tipe = b.dataset.dtipe;
      body.querySelectorAll("[data-dtipe]").forEach((x) => x.classList.toggle("active", x === b));
      body.querySelector("#dPersonLbl").textContent = f.tipe === "HUTANG" ? "Pinjam dari siapa?" : "Siapa yang berhutang?";
      const hint = body.querySelector("#dTxHint");
      if (hint) hint.textContent = f.tipe === "HUTANG" ? "Menambah saldo akun (Pemasukan)." : "Mengurangi saldo akun (Pengeluaran).";
    }));

    if (isEdit) {
      body.querySelector("#dDelete").addEventListener("click", (e) => {
        const btn = e.currentTarget;
        return deleteDebtWithConfirm(debt, btn, { closeAfter: true, form });
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setFormError(form, "");
      const person = body.querySelector("#dPerson").value.trim();
      const amt = readAmount(amountEl);
      const tanggal = body.querySelector("#dDate").value || todayIso();
      const dueDate = body.querySelector("#dDue").value || "";
      const catatan = body.querySelector("#dNote").value.trim();
      if (!person) return setFormError(form, "Nama pihak wajib diisi");
      if (!(amt > 0)) return setFormError(form, "Jumlah harus lebih dari 0");
      if (isEdit && amt < debt.paidAmount) return setFormError(form, `Tidak boleh kurang dari yang sudah dibayar (${fmtRpRaw(debt.paidAmount)})`);

      const paidAmount = isEdit ? debt.paidAmount : 0;
      const entity = {
        id: f.id,
        tipe: f.tipe,
        personName: person,
        amount: amt,
        paidAmount,
        tanggal,
        dueDate,
        akun: f.akun || "Tunai",
        catatan,
        settled: paidAmount >= amt - 0.01,
      };
      const recordInit = !isEdit && !!body.querySelector("#dRecordInit")?.checked;
      try {
        await withBusy(body.querySelector("#dSave"), "Menyimpan...", async () => {
          ensureOnline();
          await api.debtUpsert(entity);
          if (recordInit) {
            const isH = entity.tipe === "HUTANG";
            const tx = {
              id: uuid(),
              tanggal: entity.tanggal,
              jam: nowHms(),
              tipe: isH ? "Pemasukan" : "Pengeluaran",
              kategori: isH ? "Hutang" : "Piutang",
              akun: entity.akun,
              merchant: isH ? `Pinjam dari ${entity.personName}` : `Pinjamkan ke ${entity.personName}`,
              deskripsi: entity.catatan || (isH ? "Terima pinjaman" : "Pemberian pinjaman"),
              jumlah: entity.amount,
              sumber: `debt:${entity.id}`,
            };
            await api.saveTx(tx);
            upsertById(state.transactions, normalizeTx(tx));
          }
        });
        upsertById(state.debts, normalizeDebt(entity));
        state.debtTab = entity.tipe;
        closeSheet();
        toast("Catatan tersimpan 🤝");
        commitLocal();
      } catch (err) { setFormError(form, err.message); }
    });
  });
}

function openPayDebtForm(debt) {
  const isH = debt.tipe === "HUTANG";
  const rem = Math.max(0, debt.amount - debt.paidAmount);
  if (rem <= 0) return toast("Hutang ini sudah lunas!");
  const remLong = Math.max(1, Math.round(rem));
  const f = { akun: debt.akun || "Tunai" };
  const quick = [
    ...(Math.floor(remLong / 4) >= 1 && Math.floor(remLong / 4) < remLong ? [["25%", Math.floor(remLong / 4)]] : []),
    ...(Math.floor(remLong / 2) >= 1 && Math.floor(remLong / 2) < remLong ? [["50%", Math.floor(remLong / 2)]] : []),
    ["Lunas", remLong],
  ];

  const html = `
    <form class="form" id="dpForm" novalidate>
      <div class="form-note">💡 <span>Sisa saat ini: <b>${esc(fmtRpRaw(rem))}</b></span></div>
      ${amountFieldHtml("dpAmount", remLong, "Nominal cicilan / bayar")}
      <div class="quick-chips">
        ${quick.map(([lbl, val]) => `<button type="button" class="quick-chip" data-quick-amt="${val}">${lbl}</button>`).join("")}
      </div>
      <div id="dpAfterHint" style="font-size:12px;font-weight:700;color:var(--muted);margin:-4px 0 12px">Status setelah ini: Lunas</div>
      <label class="field"><span class="field-label">Tanggal pembayaran</span><input type="date" id="dpDate" value="${todayIso()}" required /></label>
      <div class="field"><span class="field-label">${isH ? "Bayar pakai akun" : "Masuk ke akun"}</span>${pickGroup("dpAkun", accountItems(), f.akun)}</div>
      <label class="field"><span class="field-label">Catatan cicilan (opsional)</span><input id="dpNote" maxlength="140" placeholder="Mis. Cicilan ke-1, via transfer" /></label>
      <div class="switch-row">
        <div class="switch-text">
          <div class="switch-title">Catat ke transaksi &amp; saldo akun</div>
          <div class="switch-sub" id="dpSaldoHint">${isH ? `Saldo ${esc(f.akun)} berkurang otomatis.` : `Saldo ${esc(f.akun)} bertambah otomatis.`}</div>
        </div>
        <label class="switch"><input type="checkbox" id="dpRecordTx" checked /><span class="track"></span></label>
      </div>
      <div class="form-error" role="alert"></div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" id="dpSave">${isH ? "Catat Cicilan" : "Catat Terima"}</button>
      </div>
    </form>`;

  openSheet(isH ? `Bayar / Cicil ke ${debt.personName}` : `Terima Cicilan dari ${debt.personName}`, html, (body) => {
    const form = body.querySelector("#dpForm");
    const amtInput = body.querySelector("#dpAmount");
    const afterHint = body.querySelector("#dpAfterHint");
    bindAmountInput(amtInput);

    const updateAfter = () => {
      const v = readAmount(amtInput);
      const after = Math.max(0, rem - v);
      afterHint.textContent = v > 0
        ? (after < 1 ? "Status setelah ini: Lunas ✅" : `Sisa setelah cicilan ini: ${fmtRpRaw(after)}`)
        : `Sisa saat ini: ${fmtRpRaw(rem)}`;
    };
    amtInput.addEventListener("input", updateAfter);
    body.querySelectorAll("[data-quick-amt]").forEach((b) => b.addEventListener("click", () => {
      amtInput.value = formatAmountText(Number(b.dataset.quickAmt));
      updateAfter();
    }));
    bindPickGroup(body, "dpAkun", (v) => {
      f.akun = v;
      body.querySelector("#dpSaldoHint").textContent = isH ? `Saldo ${v} berkurang otomatis.` : `Saldo ${v} bertambah otomatis.`;
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setFormError(form, "");
      const payAmt = readAmount(amtInput);
      const payDate = body.querySelector("#dpDate").value || todayIso();
      const note = body.querySelector("#dpNote").value.trim();
      const recordTx = !!body.querySelector("#dpRecordTx").checked;
      if (!(payAmt > 0)) return setFormError(form, "Nominal harus lebih dari 0");
      if (payAmt > rem + 0.01) return setFormError(form, `Melebihi sisa (${fmtRpRaw(rem)})`);

      const effective = Math.min(payAmt, rem);
      const newPaid = Math.min(debt.amount, debt.paidAmount + effective);
      const isNowSettled = newPaid >= debt.amount - 0.01;
      const payTime = nowHms();
      const payNote = note || (isNowSettled ? `Pelunasan ${isH ? "Hutang Saya" : "Hutang Orang"}` : `Cicilan ${isH ? "Hutang Saya" : "Hutang Orang"}`);

      const updatedDebt = { ...debt, paidAmount: isNowSettled ? debt.amount : newPaid, settled: isNowSettled };
      const linkedTxId = recordTx ? uuid() : null;
      const payment = {
        id: uuid(),
        debtId: debt.id,
        tipe: debt.tipe,
        personName: debt.personName,
        amount: effective,
        tanggal: payDate,
        jam: payTime.slice(0, 5),
        akun: f.akun || "Tunai",
        catatan: payNote,
        linkedTxId,
      };
      const tx = recordTx ? {
        id: linkedTxId,
        tanggal: payDate,
        jam: payTime,
        tipe: isH ? "Pengeluaran" : "Pemasukan",
        kategori: isH ? "Hutang" : "Piutang",
        akun: f.akun || "Tunai",
        merchant: isH ? `Bayar hutang ke ${debt.personName}` : `Terima piutang dari ${debt.personName}`,
        deskripsi: payNote,
        jumlah: effective,
        sumber: `debt:${debt.id}`,
      } : null;

      try {
        await withBusy(body.querySelector("#dpSave"), "Menyimpan...", async () => {
          ensureOnline();
          await api.debtUpsert(updatedDebt);
          await api.debtPaymentUpsert(payment);
          if (tx) await api.saveTx(tx);
        });
        upsertById(state.debts, normalizeDebt(updatedDebt));
        upsertById(state.debtPayments, normalizeDebtPayment(payment));
        if (tx) upsertById(state.transactions, normalizeTx(tx));
        closeSheet();
        toast(isNowSettled ? "Hutang lunas! 🎉" : "Cicilan tercatat ✅");
        commitLocal();
      } catch (err) { setFormError(form, err.message); }
    });
  });
}

function openDebtHistorySheet(debtId) {
  const draw = (body) => {
    const debt = state.debts.find((d) => d.id === debtId);
    if (!debt) return closeSheet();
    const isH = debt.tipe === "HUTANG";
    const rem = Math.max(0, debt.amount - debt.paidAmount);
    const pct = debt.amount > 0 ? clamp((debt.paidAmount / debt.amount) * 100, 0, 100) : 0;
    const payments = paymentsForDebt(debt.id);
    const accent = debt.settled || !isH ? "#047857" : "#E11D48";

    body.innerHTML = `
      <div class="card" style="background:var(--surface-2);margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <b>${esc(debt.personName)}</b>
          <span class="badge ${debt.settled ? "badge-ok" : "badge-warn"}">${debt.settled ? "Lunas" : `Dicicil ${Math.round(pct)}%`}</span>
        </div>
        <div class="summary3" style="margin-bottom:8px">
          <div class="sum-card"><div class="lbl">Total</div><div class="val">${esc(fmtRp(debt.amount))}</div></div>
          <div class="sum-card"><div class="lbl">Terbayar</div><div class="val amt-in">${esc(fmtRp(debt.paidAmount))}</div></div>
          <div class="sum-card"><div class="lbl">Sisa</div><div class="val" style="color:${accent}">${esc(fmtRp(rem))}</div></div>
        </div>
        <div class="bar"><span style="width:${pct.toFixed(1)}%;background:${debt.settled ? "#10B981" : accent}"></span></div>
      </div>
      <div style="font-size:13px;font-weight:800;margin-bottom:8px">Daftar Pembayaran (${payments.length})</div>
      ${payments.length === 0
        ? `<div class="empty">${debt.paidAmount > 0 ? `Sudah dibayar ${esc(fmtRpRaw(debt.paidAmount))} sebelumnya.` : "Belum ada riwayat cicilan / pembayaran."}</div>`
        : payments.map((p, idx) => `
          <div class="debt-hist-item">
            <span class="debt-hist-idx" style="background:${isH ? "var(--expense-soft)" : "var(--income-soft)"};color:${accent}">#${payments.length - idx}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:900;font-size:14px">${esc(fmtRp(p.amount))} <span style="font-weight:700;color:var(--muted);font-size:12px">· ${esc(p.akun)}</span></div>
              <div style="font-size:11.5px;color:var(--muted);font-weight:600">${esc(dateLabel(p.tanggal, true))}${p.jam ? " · " + esc(p.jam.slice(0, 5)) : ""}</div>
              ${p.catatan ? `<div style="font-size:12px;color:var(--muted);margin-top:2px">${esc(p.catatan)}</div>` : ""}
              ${p.linkedTxId ? `<div style="font-size:11px;color:var(--income);font-weight:700;margin-top:2px">✓ Tercatat di transaksi &amp; saldo</div>` : ""}
            </div>
            <button class="icon-btn icon-btn-sm" type="button" data-del-payment="${esc(p.id)}" aria-label="Hapus cicilan"><svg class="ico"><use href="#i-trash"/></svg></button>
          </div>`).join("")}
      ${!debt.settled ? `
        <div class="form-actions" style="margin-top:12px">
          <button class="btn btn-primary" type="button" id="dhAddBtn">${isH ? "Tambah Cicilan / Bayar" : "Catat Cicilan Diterima"}</button>
        </div>` : ""}`;

    const addBtn = body.querySelector("#dhAddBtn");
    if (addBtn) addBtn.addEventListener("click", () => openPayDebtForm(debt));
    body.querySelectorAll("[data-del-payment]").forEach((b) => b.addEventListener("click", async () => {
      const p = payments.find((x) => x.id === b.dataset.delPayment);
      if (!p) return;
      const ok = await askConfirm(`Hapus pembayaran ${fmtRpRaw(p.amount)} pada ${dateLabel(p.tanggal, true)}?${p.linkedTxId ? ` Transaksi di akun ${p.akun} juga akan dihapus.` : ""}`);
      if (!ok) return;
      try {
        await withBusy(b, "...", async () => {
          ensureOnline();
          await api.debtPaymentDelete(p.id);
          if (p.linkedTxId) {
            await safe(() => api.deleteTx(p.linkedTxId), null);
            removeById(state.transactions, p.linkedTxId);
          }
          const newPaid = Math.max(0, debt.paidAmount - p.amount);
          const cleanPaid = newPaid < 0.01 ? 0 : newPaid;
          const updatedDebt = { ...debt, paidAmount: cleanPaid, settled: debt.amount > 0 && cleanPaid >= debt.amount - 0.01 };
          await api.debtUpsert(updatedDebt);
          upsertById(state.debts, normalizeDebt(updatedDebt));
          removeById(state.debtPayments, p.id);
        });
        toast("Riwayat pembayaran dihapus 🗑️");
        draw(body);
        commitLocal();
      } catch (err) { toast(err.message, "error"); }
    }));
  };
  openSheet("Riwayat Cicilan 🕒", "<div></div>", draw);
}

function budgetBadge(v) {
  if (v.status === "off") return `<span class="badge badge-muted">Nonaktif</span>`;
  if (v.status === "over") return `<span class="badge badge-bad">Terlewati ${esc(fmtRp(-v.sisa))}</span>`;
  if (v.status === "warn") return `<span class="badge badge-warn">Hampir habis</span>`;
  return `<span class="badge badge-ok">Sisa ${esc(fmtRp(v.sisa))}</span>`;
}
const STATUS_COLOR = { ok: "#10B981", warn: "#F59E0B", over: "#F43F5E", off: "#B9A3B4" };

function renderBudgets() {
  document.getElementById("budgetMonthLabel").textContent = monthLabel(state.budgetMonth);
  const el = document.getElementById("budgetList");
  const views = state.budgets.filter((b) => b.bulan === state.budgetMonth).map(budgetView).sort((a, b) => b.pct - a.pct);
  el.innerHTML = views.length === 0
    ? emptyState("🧮", `Belum ada budget untuk ${monthLabel(state.budgetMonth)}.`)
    : views.map((v) => {
      const cs = categoryStyle(v.b.kategori);
      return `
        <button class="prog-item" type="button" data-budget="${esc(v.b.id)}">
          <div class="prog-top">
            <span class="emo" style="--c:${cs.c};--cbg:${cs.bg}" aria-hidden="true">${cs.emoji}</span>
            <span class="prog-name">${esc(v.b.kategori)}</span>
            <span class="prog-pct" style="color:${STATUS_COLOR[v.status]}">${Math.round(v.pct)}%</span>
          </div>
          <div class="bar"><span style="width:${clamp(v.pct, 0, 100).toFixed(1)}%;background:${STATUS_COLOR[v.status]}"></span></div>
          <div class="prog-sub"><span>${esc(fmtRp(v.spent))} / ${esc(fmtRp(v.limit))}</span>${budgetBadge(v)}</div>
        </button>`;
    }).join("");

  const prevMonth = addMonths(state.budgetMonth, -1);
  const copyable = copyableBudgets(prevMonth, state.budgetMonth);
  document.getElementById("budgetCopy").innerHTML = copyable.length > 0
    ? `<div class="copy-box"><span>📋 Ada ${copyable.length} budget di ${esc(monthLabel(prevMonth))} yang belum ada di bulan ini.</span>
        <button class="btn btn-soft btn-sm" type="button" data-action="copy-budgets"><svg class="ico"><use href="#i-copy"/></svg>Salin</button></div>`
    : "";
}

function copyableBudgets(fromYm, toYm) {
  const existing = state.budgets.filter((b) => b.bulan === toYm);
  return state.budgets.filter((b) => b.bulan === fromYm && b.enabled !== false &&
    !existing.some((e) => sameText(e.kategori, b.kategori)));
}

const GOAL_STATUS = {
  done: { cls: "badge-ok", label: "Tercapai 🎉" },
  ontrack: { cls: "badge-ok", label: "On-track" },
  behind: { cls: "badge-warn", label: "Behind" },
  manual: { cls: "badge-info", label: "Manual" },
  overdue: { cls: "badge-bad", label: "Deadline lewat" },
};

function renderGoals() {
  const el = document.getElementById("goalList");
  const goals = state.goals.slice().sort((a, b) => (a.enabled === false) - (b.enabled === false) || String(a.deadline || "9999").localeCompare(String(b.deadline || "9999")));
  if (goals.length === 0) {
    el.innerHTML = emptyState("🎯", "Belum ada goal. Yuk mulai menabung untuk impianmu!");
    return;
  }
  el.innerHTML = goals.map((g) => {
    const v = goalView(g);
    const st = GOAL_STATUS[v.status];
    const color = v.status === "done" ? "#10B981" : "linear-gradient(90deg,#EC4899,#A04FD6)";
    const meta = [
      `<span class="badge ${st.cls}">${st.label}</span>`,
      g.deadline ? `<span class="badge badge-muted">⏰ ${esc(dateLabel(g.deadline, true))}</span>` : "",
      v.status === "behind" ? `<span class="badge badge-warn">butuh +${esc(fmtRp(v.required - Number(g.monthlyAllocation || 0)))}/bln</span>` : "",
      v.months > 0 && v.remaining > 0 && v.status !== "overdue" ? `<span class="badge badge-muted">${esc(fmtRp(v.required))}/bln × ${v.months} bln</span>` : "",
      g.autoDebit && Number(g.monthlyAllocation) > 0 ? `<span class="badge badge-info">🔄 Auto ${esc(fmtRp(g.monthlyAllocation))}/bln dari ${esc(g.sourceAkun || "Tunai")}</span>` : "",
      g.enabled === false ? `<span class="badge badge-muted">Nonaktif</span>` : "",
    ].filter(Boolean).join("");
    return `
      <div class="goal-card ${g.enabled === false ? "disabled" : ""}">
        <div class="goal-head">
          <span class="emo" aria-hidden="true">${v.status === "done" ? "🏆" : "🎯"}</span>
          <div class="goal-title"><b>${esc(g.name)}</b><span>Akun: ${esc(g.goalAkun || "-")}</span></div>
          <button class="icon-btn icon-btn-sm" type="button" data-goal-edit="${esc(g.id)}" aria-label="Ubah goal ${esc(g.name)}"><svg class="ico"><use href="#i-edit"/></svg></button>
        </div>
        <div class="bar"><span style="width:${clamp(v.pct, 0, 100).toFixed(1)}%;background:${color}"></span></div>
        <div class="goal-nums"><span><span class="big">${esc(fmtRp(v.saldo))}</span> / ${esc(fmtRp(v.target))}</span><span>${v.pct.toFixed(1)}%</span></div>
        <div class="goal-meta">${meta}</div>
        <div class="goal-actions">
          <button class="btn btn-primary btn-sm" type="button" data-goal-tabung="${esc(g.id)}" ${g.enabled === false ? "disabled" : ""}>${JAR_ICON}Tabung</button>
        </div>
      </div>`;
  }).join("");
}

function renderRecurring() {
  const el = document.getElementById("recurringList");
  const rules = state.recurring.slice().sort((a, b) => (a.enabled === false) - (b.enabled === false) || String(upcomingRun(a) || "9999").localeCompare(String(upcomingRun(b) || "9999")));
  if (rules.length === 0) {
    el.innerHTML = emptyState("🔁", "Belum ada transaksi berulang. Cocok untuk gaji, langganan, dan tagihan.");
    return;
  }
  el.innerHTML = rules.map((r) => {
    const inc = sameText(r.tipe, "Pemasukan");
    const cs = categoryStyle(r.kategori);
    const next = upcomingRun(r);
    return `
      <div class="rec-item ${r.enabled === false ? "disabled" : ""}">
        <span class="tx-ico" style="--c:${cs.c};--cbg:${cs.bg}" aria-hidden="true">${cs.emoji}</span>
        <div class="rec-main" data-recurring="${esc(r.id)}" role="button" tabindex="0" aria-label="Ubah ${esc(r.merchant || r.kategori)}">
          <div class="rec-title">${esc(r.merchant || r.kategori || "Transaksi berulang")}</div>
          <div class="rec-sub">${esc(describeSchedule(r))} · ${esc(r.akun || "Tunai")}</div>
          <div class="rec-sub">${r.enabled === false ? "⏸️ Dijeda" : next ? "Berikutnya: " + esc(dateLabel(next, true)) : "Selesai"}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          <span class="rec-amt ${inc ? "amt-in" : "amt-out"}">${inc ? "+" : "−"} ${esc(fmtRp(r.jumlah))}</span>
          <label class="switch" title="${r.enabled === false ? "Aktifkan" : "Jeda"}">
            <input type="checkbox" data-recurring-toggle="${esc(r.id)}" ${r.enabled === false ? "" : "checked"} aria-label="Aktif: ${esc(r.merchant || r.kategori)}" />
            <span class="track"></span>
          </label>
        </div>
      </div>`;
  }).join("");
}

// ---------------- Pengaturan ----------------
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function maskUrl(url) {
  const m = /\/macros\/s\/([^/]+)\//.exec(url || "");
  if (!m) return url || "-";
  const id = m[1];
  return url.replace(id, id.slice(0, 6) + "…" + id.slice(-4));
}

function renderSettings() {
  const el = document.getElementById("settingsBody");
  let installHtml;
  if (isStandalone()) installHtml = `<span class="badge badge-ok">Terpasang ✓</span>`;
  else if (deferredInstallPrompt) installHtml = `<button class="btn btn-primary btn-sm" type="button" data-action="install">Pasang</button>`;
  else installHtml = "";
  const installSub = isStandalone()
    ? "Kamu sedang memakai versi terpasang."
    : deferredInstallPrompt
      ? "Pasang ke layar utama HP atau laptop supaya bisa dibuka seperti aplikasi."
      : isIos()
        ? "Di Safari: ketuk tombol Bagikan lalu pilih “Tambahkan ke Layar Utama”."
        : "Buka lewat Chrome/Edge, lalu pilih menu ⋮ → “Instal aplikasi” / “Tambahkan ke layar utama”.";
  const tgSub = state.telegram
    ? "Memakai bot Telegram dari file konfigurasi."
    : "Memakai bot yang terdaftar di Apps Script (kalau sudah diaktifkan dari aplikasi HP).";

  el.innerHTML = `
    <section class="card set-group">
      <h3>🎨 Tampilan</h3>
      <p class="set-desc">Tema lucu &amp; lembut, bisa terang atau gelap.</p>
      <div class="seg seg-full" id="themeSeg">
        <button class="seg-btn ${state.theme === "system" ? "active" : ""}" type="button" data-theme-pick="system">🌗 Otomatis</button>
        <button class="seg-btn ${state.theme === "light" ? "active" : ""}" type="button" data-theme-pick="light">🌸 Terang</button>
        <button class="seg-btn ${state.theme === "dark" ? "active" : ""}" type="button" data-theme-pick="dark">🌙 Gelap</button>
      </div>
      <div class="switch-row">
        <div class="switch-text"><div class="switch-title">Sembunyikan saldo</div><div class="switch-sub">Nominal diganti ••• di semua halaman.</div></div>
        <label class="switch"><input type="checkbox" data-setting="hide" ${state.hide ? "checked" : ""} aria-label="Sembunyikan saldo" /><span class="track"></span></label>
      </div>
    </section>

    <section class="card set-group">
      <h3>📲 Aplikasi</h3>
      <div class="set-row">
        <span class="set-ico"><svg class="ico"><use href="#i-phone"/></svg></span>
        <div class="set-text"><div class="set-title">Pasang di perangkat</div><div class="set-sub">${esc(installSub)}</div></div>
        ${installHtml}
      </div>
      ${document.fullscreenEnabled ? `
      <div class="set-row">
        <span class="set-ico"><svg class="ico"><use href="#${document.fullscreenElement ? "i-shrink" : "i-expand"}"/></svg></span>
        <div class="set-text"><div class="set-title">Layar penuh</div><div class="set-sub">Sembunyikan bilah browser &amp; taskbar. Tekan <kbd>F</kbd> atau <kbd>Esc</kbd> untuk keluar.</div></div>
        <button class="btn btn-soft btn-sm" type="button" data-action="fullscreen">${document.fullscreenElement ? "Keluar" : "Aktifkan"}</button>
      </div>` : ""}
      <div class="set-row">
        <span class="set-ico"><svg class="ico"><use href="#i-refresh"/></svg></span>
        <div class="set-text"><div class="set-title">Sinkronkan sekarang</div><div class="set-sub">${state.loadedAt ? "Terakhir: " + esc(new Date(state.loadedAt).toLocaleString("id-ID")) : "Belum pernah tersinkron"}</div></div>
        <button class="btn btn-soft btn-sm" type="button" data-action="refresh">Sync</button>
      </div>
    </section>

    <section class="card set-group">
      <h3>🔔 Notifikasi Telegram</h3>
      <div class="switch-row">
        <div class="switch-text"><div class="switch-title">Kirim notifikasi untuk transaksi dari web</div><div class="switch-sub">${esc(tgSub)}</div></div>
        <label class="switch"><input type="checkbox" data-setting="notify" ${state.notify ? "checked" : ""} aria-label="Kirim notifikasi Telegram" /><span class="track"></span></label>
      </div>
    </section>

    <section class="card set-group">
      <h3>📄 Laporan Bulanan</h3>
      <p class="set-desc">Unduh ringkasan &amp; daftar transaksi bulan ${esc(monthLabel(state.month))}.</p>
      <div class="set-actions">
        <button class="btn btn-soft btn-sm" type="button" data-download="pdf">📄 PDF</button>
        <button class="btn btn-soft btn-sm" type="button" data-download="csv">📊 CSV</button>
        <button class="btn btn-ghost btn-sm" type="button" data-goto="history">Pilih bulan lain</button>
      </div>
    </section>

    <section class="card set-group">
      <h3>🔗 Koneksi</h3>
      <div class="set-row">
        <span class="set-ico"><svg class="ico"><use href="#i-wallet"/></svg></span>
        <div class="set-text"><div class="set-title">Apps Script Web App</div><div class="set-sub">${esc(maskUrl(state.url))}</div></div>
      </div>
      <div class="set-row">
        <span class="set-ico"><svg class="ico"><use href="#i-logout"/></svg></span>
        <div class="set-text"><div class="set-title">Putuskan koneksi</div><div class="set-sub">Hapus konfigurasi &amp; data tersimpan dari browser ini.</div></div>
        <button class="btn btn-danger-soft btn-sm" type="button" data-action="disconnect">Putuskan</button>
      </div>
    </section>

    <p class="foot">Catalyst Web v${APP_VERSION} · data sinkron dengan aplikasi HP lewat Apps Script.<br>
      Scan foto struk kamera tetap tersedia di aplikasi HP.</p>`;
}

// ---------------- UI: sheet, toast, konfirmasi ----------------
let sheetOpen = false;
let lastFocus = null;

function openSheet(title, html, onMount, { wide = false } = {}) {
  const root = document.getElementById("sheet");
  root.querySelector(".sheet").classList.toggle("sheet-wide", wide);
  document.getElementById("sheetTitle").textContent = title;
  const body = document.getElementById("sheetBody");
  body.innerHTML = html;
  if (!sheetOpen) {
    lastFocus = document.activeElement;
    history.pushState({ ckSheet: true }, "");
  }
  sheetOpen = true;
  root.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  root.querySelector(".sheet").scrollTop = 0;
  if (onMount) onMount(body);
  const first = body.querySelector("[autofocus]") || body.querySelector("input, select, textarea, button");
  if (first && window.matchMedia("(pointer: fine)").matches) setTimeout(() => first.focus(), 30);
}

function hideSheet() {
  sheetOpen = false;
  document.getElementById("sheet").classList.add("hidden");
  document.getElementById("sheetBody").innerHTML = "";
  document.body.style.overflow = "";
  if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
}

function closeSheet() {
  if (!sheetOpen) return;
  if (history.state && history.state.ckSheet) history.back(); // popstate → hideSheet
  else hideSheet();
}

let toastTimer = null;
function toast(msg, type = "ok") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (type === "error" ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), type === "error" ? 5200 : 2600);
}

function askConfirm(message, { yes = "Ya, hapus", emoji = "🗑️" } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById("confirm");
    document.getElementById("confirmText").textContent = message;
    document.getElementById("confirmEmoji").textContent = emoji;
    const yesBtn = document.getElementById("confirmYes");
    const noBtn = document.getElementById("confirmNo");
    yesBtn.textContent = yes;
    root.classList.remove("hidden");
    const done = (val) => {
      root.classList.add("hidden");
      yesBtn.onclick = null;
      noBtn.onclick = null;
      root.onclick = null;
      document.removeEventListener("keydown", onKey, true);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    yesBtn.onclick = () => done(true);
    noBtn.onclick = () => done(false);
    root.onclick = (e) => { if (e.target === root) done(false); };
    document.addEventListener("keydown", onKey, true);
    noBtn.focus();
  });
}

async function withBusy(btn, label, fn) {
  if (!btn) return fn();
  const original = btn.innerHTML;
  const form = btn.closest("form") || btn.closest(".sheet-body");
  const buttons = form ? [...form.querySelectorAll("button")] : [btn];
  buttons.forEach((b) => { b.disabled = true; });
  btn.innerHTML = `<span class="spinner" style="width:16px;height:16px;border-width:3px"></span> ${esc(label)}`;
  try {
    return await fn();
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
    btn.innerHTML = original;
  }
}

function setFormError(root, msg) {
  const el = root.querySelector(".form-error");
  if (el) el.textContent = msg || "";
}

// ---------------- Input nominal ----------------
function formatAmountText(n) { return n > 0 ? Math.round(n).toLocaleString("id-ID") : ""; }
function bindAmountInput(input) {
  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 13);
    input.value = digits ? Number(digits).toLocaleString("id-ID") : "";
  });
}
function readAmount(input) {
  const d = input.value.replace(/\D/g, "");
  return d ? Number(d) : 0;
}
function amountFieldHtml(id, value, label = "Jumlah", extraClass = "") {
  return `
    <label class="field ${extraClass}">
      <span class="field-label">${esc(label)}</span>
      <span class="amount-wrap"><span>Rp</span><input id="${id}" inputmode="numeric" autocomplete="off" placeholder="0" value="${esc(formatAmountText(value))}" aria-label="${esc(label)} dalam rupiah" /></span>
    </label>`;
}

function pickGroup(id, items, selected) {
  return `<div class="chip-grid" id="${id}" role="radiogroup">${items.map((it) => `
    <button type="button" class="pick ${sameText(it.value, selected) ? "active" : ""}" data-value="${esc(it.value)}" role="radio" aria-checked="${sameText(it.value, selected)}">
      ${it.emoji ? `<span class="emo" aria-hidden="true">${it.emoji}</span>` : ""}${it.dot ? `<span class="dot" style="background:${it.dot}"></span>` : ""}${esc(it.label || it.value)}
    </button>`).join("")}</div>`;
}
function bindPickGroup(root, id, onChange) {
  const group = root.querySelector("#" + id);
  group.addEventListener("click", (e) => {
    const btn = e.target.closest(".pick");
    if (!btn || btn.disabled) return;
    group.querySelectorAll(".pick").forEach((b) => { b.classList.toggle("active", b === btn); b.setAttribute("aria-checked", String(b === btn)); });
    onChange(btn.dataset.value);
  });
}
function categoryItems() { return CATEGORY_LIST.map((c) => ({ value: c, emoji: categoryStyle(c).emoji })); }
function accountItems(names = allAccountNames()) {
  return names.map((a) => ({ value: a, dot: accountStyle(a).from }));
}

function merchantDatalist() {
  const seen = new Map();
  sortTxDesc(state.transactions.filter((t) => !isTransfer(t) && t.merchant.trim())).forEach((t) => {
    const k = t.merchant.trim().toLowerCase();
    if (!seen.has(k)) seen.set(k, t);
  });
  return seen;
}

// ---------------- Menu tambah (FAB) & Suara AI ----------------
function openAddMenu() {
  openSheet("Tambah apa hari ini? ✨", `
    <div class="action-list">
      <button class="action-row" type="button" data-add="voice"><span class="emo" style="--cbg:#D1FAE5" aria-hidden="true">🎙️</span><div><b>Catat Suara AI / Cepat</b><span>Bicara atau ketik kalimat transaksi otomatis</span></div></button>
      <button class="action-row" type="button" data-add="Pengeluaran"><span class="emo" style="--cbg:#FFE4E6" aria-hidden="true">🛍️</span><div><b>Catat Pengeluaran</b><span>Belanja, makan, tagihan, dll.</span></div></button>
      <button class="action-row" type="button" data-add="Pemasukan"><span class="emo" style="--cbg:#D1FAE5" aria-hidden="true">💰</span><div><b>Catat Pemasukan</b><span>Gaji, bonus, uang masuk lainnya</span></div></button>
      <button class="action-row" type="button" data-add="transfer"><span class="emo" style="--cbg:#EFE4FF" aria-hidden="true">🔁</span><div><b>Pindah Saldo</b><span>Transfer antar akun / dompet</span></div></button>
    </div>
    <p class="sheet-foot-note">📷 Scan struk kamera &amp; Gemini AI tersedia lengkap di aplikasi Android.</p>`);
}

function matchWalletWeb(text) {
  const clean = String(text || "").trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  if (lower.includes("dana")) return "DANA";
  if (lower.includes("gopay") || lower.includes("go-pay") || lower.includes("gojek")) return "GoPay";
  if (/\bovo\b/i.test(lower)) return "OVO";
  if (lower.includes("shopeepay") || lower.includes("shopee pay")) return "ShopeePay";
  if (lower.includes("kartu kredit") || lower.includes("credit card")) return "Kartu Kredit";
  if (lower.includes("bca") || lower.includes("mybca")) return "BCA";
  if (lower.includes("mandiri") || lower.includes("livin")) return "Mandiri";
  if (/\bbri\b|brimo/i.test(lower)) return "BRI";
  if (/\bbni\b|wondr/i.test(lower)) return "BNI";
  if (lower.includes("tunai") || /\bcash\b/i.test(lower)) return "Tunai";
  if (/(seabank|jago|bsi|cimb|octo|permata|jenius|neobank|flip|btn|danamon|ocbc|panin|maybank|allobank|linkaja|lainnya)/i.test(lower)) return "Lainnya";
  return null;
}

function parseSpokenAmountWeb(lower) {
  if (lower.includes("setengah juta")) return 500000;
  let m = /(\d+(?:[.,]\d+)?)\s*(?:jt|juta)\b/.exec(lower);
  if (m) return Math.round(Number(m[1].replace(",", ".")) * 1000000);
  m = /(\d+(?:[.,]\d+)?)\s*(?:rb|ribu|k)\b/.exec(lower);
  if (m) return Math.round(Number(m[1].replace(",", ".")) * 1000);
  const words = { satu: 1, se: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9 };
  let total = 0, cur = 0, hit = false;
  for (const tok of lower.replace(/-/g, " ").split(/\s+/)) {
    if (tok === "seribu") { cur += 1000; hit = true; }
    else if (tok === "seratus") { cur += 100; hit = true; }
    else if (tok === "sepuluh") { cur += 10; hit = true; }
    else if (tok === "sebelas") { cur += 11; hit = true; }
    else if (tok === "belas") { cur += 10; hit = true; }
    else if (tok === "puluh") { cur = (cur || 1) * 10; hit = true; }
    else if (tok === "ratus") { cur = (cur || 1) * 100; hit = true; }
    else if (tok === "ribu" || tok === "rb") { total += (cur || 1) * 1000; cur = 0; hit = true; }
    else if (tok === "juta" || tok === "jt") { total += (cur || 1) * 1000000; cur = 0; hit = true; }
    else if (tok in words) { cur += words[tok]; hit = true; }
  }
  if (hit && total + cur >= 100) return Math.round(total + cur);
  if (lower.includes("gocap") || lower.includes("goban")) return 50000;
  if (lower.includes("ceban")) return 10000;
  if (lower.includes("goceng")) return 5000;
  if (lower.includes("seceng")) return 1000;
  m = /(?:rp\.?\s*)?(\d[\d.,]*)/i.exec(lower);
  if (m) {
    const n = Number(m[1].replace(/[.,]/g, ""));
    if (n > 0) return n;
  }
  return 0;
}

function parseVoiceCommandWeb(raw) {
  const text = String(raw || "").trim();
  const lower = text.toLowerCase();
  const amount = parseSpokenAmountWeb(lower);
  const isInc = /(gaji|terima|dapat|pemasukan|bonus|masuk|refund|jual)/.test(lower);
  const tipe = isInc ? "Pemasukan" : "Pengeluaran";
  const tanggal = lower.includes("kemarin") ? addDaysIso(todayIso(), -1) : todayIso();
  const akun = matchWalletWeb(text) || "Tunai";
  const catRules = [
    ["Makanan", /(makan|kopi|resto|cafe|warung|nasi|mie|ayam|bakso|minum|gofood|grabfood|shopeefood)/],
    ["Transportasi", /(bensin|bbm|parkir|tol|ojek|gojek|grab|kereta|bus|transport)/],
    ["Tagihan", /(listrik|pln|air|pdam|wifi|internet|pulsa|paket data|bpjs|tagihan|cicilan)/],
    ["Belanja", /(belanja|indomaret|alfamart|supermarket|tokopedia|shopee|toko)/],
    ["Kesehatan", /(obat|apotek|dokter|klinik|rumah sakit|sehat)/],
    ["Hiburan", /(nonton|bioskop|netflix|spotify|game|hiburan|tiket)/],
    ["Gaji", /\bgaji\b/],
    ["Bonus", /(bonus|thr|insentif|cashback|hadiah)/],
  ];
  const matchedCat = catRules.find(([, re]) => re.test(lower));
  const kategori = matchedCat ? matchedCat[0] : (isInc ? "Gaji" : "Lainnya");
  const cleanMerchant = text
    .replace(/\b(tadi|kemarin|hari ini|barusan|beli|bayar|jajan|terima|dapat|masuk|pakai|pake|via|lewat|menggunakan|dari|ke|uang|saldo|rp)\b/gi, " ")
    .replace(/\d+(?:[.,]\d+)?\s*(?:rb|ribu|k|jt|juta)?/gi, " ")
    .replace(/\b(dana|gopay|ovo|shopeepay|bca|mandiri|bri|bni|tunai|cash|kartu kredit)\b/gi, " ")
    .replace(/\s+/g, " ").trim().slice(0, 40);
  const merchant = cleanMerchant
    ? cleanMerchant.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
    : kategori;
  return { id: uuid(), tipe, kategori, akun, merchant, deskripsi: text.slice(0, 140), jumlah: amount, tanggal, jam: nowHms(), sumber: "voice-ai" };
}

function openVoiceForm() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let listening = false;
  let parsed = null;

  const samples = [
    "Beli kopi kenangan 28rb pakai DANA",
    "Makan siang 35 ribu tunai",
    "Bayar listrik 350rb lewat BCA",
    "Terima gaji 8 juta masuk Mandiri",
  ];

  const html = `
    <div class="voice-stage">
      <button type="button" class="voice-mic-btn" id="vMicBtn" aria-label="Rekam suara">🎙️</button>
      <div id="vHint" style="font-size:13px;color:var(--muted);font-weight:700">
        ${SpeechRec ? 'Tap mikrofon lalu ucapkan transaksi kamu (Bahasa Indonesia)' : 'Browser ini belum mendukung mikrofon langsung; ketik atau pilih contoh kalimat di bawah'}
      </div>
    </div>
    <label class="field">
      <span class="field-label">Kalimat Transaksi</span>
      <textarea id="vText" rows="2" placeholder="Mis. Beli kopi 28rb pakai DANA" style="min-height:66px;margin-bottom:8px"></textarea>
    </label>
    <div class="voice-samples">
      ${samples.map((s) => `<button type="button" class="voice-sample" data-vsample="${esc(s)}">“${esc(s)}”</button>`).join("")}
    </div>
    <div id="vPreviewWrap"></div>`;

  openSheet("Catat Suara AI / Cepat 🎙️", html, (body) => {
    const micBtn = body.querySelector("#vMicBtn");
    const hintEl = body.querySelector("#vHint");
    const textEl = body.querySelector("#vText");
    const previewWrap = body.querySelector("#vPreviewWrap");

    const renderPreview = () => {
      const val = textEl.value.trim();
      if (!val) { previewWrap.innerHTML = ""; parsed = null; return; }
      parsed = parseVoiceCommandWeb(val);
      const cs = categoryStyle(parsed.kategori);
      const inc = parsed.tipe === "Pemasukan";
      previewWrap.innerHTML = `
        <div class="voice-preview">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="badge badge-info">✨ Hasil Analisis Otomatis</span>
            <span class="acct-tag" style="${acctVars(parsed.akun)}">${esc(parsed.akun)}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="tx-ico" style="--c:${cs.c};--cbg:${cs.bg}">${cs.emoji}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:900;font-size:15px">${esc(parsed.merchant)}</div>
              <div style="font-size:12px;color:var(--muted);font-weight:700">${esc(parsed.kategori)} · ${esc(dateLabel(parsed.tanggal, true))}</div>
            </div>
            <div class="tx-amt ${inc ? "amt-in" : "amt-out"}" style="font-size:17px">${inc ? "+" : "−"} ${esc(fmtRpRaw(parsed.jumlah))}</div>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" id="vEditBtn">Edit Lengkap</button>
            <button type="button" class="btn btn-primary" id="vSaveBtn" ${parsed.jumlah > 0 ? "" : "disabled"}>Simpan Langsung ✓</button>
          </div>
        </div>`;
      previewWrap.querySelector("#vEditBtn").addEventListener("click", () => {
        openTxForm({ prefill: parsed });
      });
      previewWrap.querySelector("#vSaveBtn").addEventListener("click", async (e) => {
        try {
          await withBusy(e.currentTarget, "Menyimpan...", async () => { ensureOnline(); await api.saveTx(parsed); });
          upsertById(state.transactions, normalizeTx(parsed));
          closeSheet();
          toast("Catat suara tersimpan ✨");
          commitLocal();
        } catch (err) { toast(err.message, "error"); }
      });
    };

    textEl.addEventListener("input", renderPreview);
    body.querySelectorAll("[data-vsample]").forEach((b) => b.addEventListener("click", () => {
      textEl.value = b.dataset.vsample;
      renderPreview();
    }));

    if (SpeechRec) {
      micBtn.addEventListener("click", () => {
        if (listening && rec) { rec.stop(); return; }
        rec = new SpeechRec();
        rec.lang = "id-ID";
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        listening = true;
        micBtn.classList.add("listening");
        micBtn.textContent = "⏹";
        hintEl.textContent = "Mendengarkan… ucapkan transaksi & nama dompetnya";
        rec.onresult = (ev) => {
          const spoken = Array.from(ev.results).map((r) => r[0].transcript).join(" ").trim();
          textEl.value = spoken;
          renderPreview();
        };
        rec.onerror = (ev) => {
          hintEl.textContent = "Gagal menangkap suara (" + ev.error + "). Coba lagi atau ketik di bawah.";
        };
        rec.onend = () => {
          listening = false;
          micBtn.classList.remove("listening");
          micBtn.textContent = "🎙️";
          if (textEl.value.trim()) hintEl.textContent = "Selesai mendengarkan. Cek hasil di bawah atau ketuk Simpan.";
        };
        try { rec.start(); } catch (err) { hintEl.textContent = "Tidak bisa mengakses mikrofon."; }
      });
    } else {
      micBtn.addEventListener("click", () => textEl.focus());
    }
  });
}

// ---------------- Form transaksi ----------------
function openTxForm({ tx = null, tipe = "Pengeluaran", prefill = null, akun = null } = {}) {
  const isEdit = !!tx;
  const orig = tx ? { ...tx } : null;
  const seed = tx || prefill;
  const f = {
    id: tx ? tx.id : (prefill && prefill.id ? prefill.id : uuid()), // id dibuat sekali → simpan ulang setelah gagal tetap idempoten
    tipe: seed ? (sameText(seed.tipe, "Pemasukan") ? "Pemasukan" : "Pengeluaran") : tipe,
    kategori: seed ? categoryKey(seed.kategori) : (tipe === "Pemasukan" ? "Gaji" : "Makanan"),
    akun: seed ? seed.akun : (akun || sortAccounts(Object.keys(accountBalances()).filter((a) => balanceOf(a) > 0))[0] || "Tunai"),
    kategoriTouched: !!seed,
  };
  const openedAt = nowHms();
  const initialDate = seed ? seed.tanggal : todayIso();
  const initialTime = seed ? (seed.jam || "").slice(0, 5) : openedAt.slice(0, 5);
  const merchants = merchantDatalist();

  const html = `
    <form class="form" id="txForm" novalidate>
      <div class="type-toggle f-type" role="radiogroup" aria-label="Tipe transaksi">
        <button type="button" class="type-btn out ${f.tipe === "Pengeluaran" ? "active" : ""}" data-tipe="Pengeluaran">🔻 Pengeluaran</button>
        <button type="button" class="type-btn in ${f.tipe === "Pemasukan" ? "active" : ""}" data-tipe="Pemasukan">🔺 Pemasukan</button>
      </div>
      ${amountFieldHtml("fAmount", seed ? seed.jumlah : 0, "Jumlah", "f-amount")}
      <div class="field f-cat"><span class="field-label">Kategori</span>${pickGroup("fCat", categoryItems(), f.kategori)}</div>
      <div class="field f-acct"><span class="field-label">Akun</span>${pickGroup("fAkun", accountItems(), f.akun)}<div class="hint" id="fSaldo"></div></div>
      <label class="field f-merchant"><span class="field-label">Nama / Merchant</span>
        <input id="fMerchant" list="fMerchantList" maxlength="80" placeholder="mis. Warung Bu Siti" value="${esc(seed ? (seed.merchant || "") : "")}" autocomplete="off" /></label>
      <datalist id="fMerchantList">${[...merchants.values()].slice(0, 60).map((t) => `<option value="${esc(t.merchant.trim())}"></option>`).join("")}</datalist>
      <label class="field f-desc"><span class="field-label">Catatan</span>
        <input id="fDesc" maxlength="200" placeholder="opsional, bisa pakai #tag" value="${esc(seed ? (seed.deskripsi || "") : "")}" autocomplete="off" /></label>
      <div class="row-2 f-dt">
        <label class="field"><span class="field-label">Tanggal</span><input type="date" id="fDate" value="${esc(initialDate)}" required /></label>
        <label class="field"><span class="field-label">Jam</span><input type="time" id="fTime" value="${esc(initialTime)}" /></label>
      </div>
      <div class="form-error" role="alert"></div>
      <div class="form-actions">
        ${isEdit ? `<button type="button" class="btn btn-danger-soft" id="fDelete"><svg class="ico"><use href="#i-trash"/></svg>Hapus</button>` : ""}
        <button type="submit" class="btn btn-primary" id="fSave">${isEdit ? "Simpan perubahan" : "Simpan ✨"}</button>
      </div>
    </form>`;

  openSheet(isEdit ? "Ubah transaksi ✏️" : (f.tipe === "Pemasukan" ? "Catat pemasukan 💰" : "Catat pengeluaran 🛍️"), html, (body) => {
    const form = body.querySelector("#txForm");
    const amount = body.querySelector("#fAmount");
    const merchantInput = body.querySelector("#fMerchant");
    const initialAmountText = amount.value;
    bindAmountInput(amount);
    if (!isEdit) amount.setAttribute("autofocus", "");

    const updateSaldo = () => {
      const saldo = balanceOf(f.akun);
      body.querySelector("#fSaldo").innerHTML = `Saldo ${esc(f.akun)}: <b>${esc(fmtRp(saldo))}</b>`;
    };
    updateSaldo();

    body.querySelectorAll(".type-btn").forEach((b) => b.addEventListener("click", () => {
      f.tipe = b.dataset.tipe;
      body.querySelectorAll(".type-btn").forEach((x) => x.classList.toggle("active", x === b));
      if (!f.kategoriTouched) {
        f.kategori = f.tipe === "Pemasukan" ? "Gaji" : "Makanan";
        body.querySelectorAll("#fCat .pick").forEach((x) => x.classList.toggle("active", x.dataset.value === f.kategori));
      }
      document.getElementById("sheetTitle").textContent = isEdit ? "Ubah transaksi ✏️" : (f.tipe === "Pemasukan" ? "Catat pemasukan 💰" : "Catat pengeluaran 🛍️");
    }));
    bindPickGroup(body, "fCat", (v) => { f.kategori = v; f.kategoriTouched = true; });
    bindPickGroup(body, "fAkun", (v) => { f.akun = v; updateSaldo(); });

    // Saran otomatis seperti app: merchant yang pernah dipakai → isi kategori & akun terakhirnya
    merchantInput.addEventListener("change", () => {
      const hit = merchants.get(merchantInput.value.trim().toLowerCase());
      if (!hit || f.kategoriTouched) return;
      f.kategori = categoryKey(hit.kategori);
      body.querySelectorAll("#fCat .pick").forEach((x) => x.classList.toggle("active", sameText(x.dataset.value, f.kategori)));
    });

    if (isEdit) {
      body.querySelector("#fDelete").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const ok = await askConfirm(`Hapus transaksi "${orig.merchant || orig.kategori || "ini"}" (${fmtRpRaw(orig.jumlah)})?`);
        if (!ok) return;
        try {
          await withBusy(btn, "Menghapus...", async () => { ensureOnline(); await api.deleteTx(orig.id); });
          removeById(state.transactions, orig.id);
          closeSheet();
          toast("Transaksi dihapus 🗑️");
          commitLocal();
        } catch (err) { setFormError(form, err.message); }
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setFormError(form, "");
      const amountChanged = amount.value !== initialAmountText;
      const jumlah = isEdit && !amountChanged ? orig.jumlah : readAmount(amount);
      const tanggal = body.querySelector("#fDate").value;
      const timeVal = body.querySelector("#fTime").value;
      if (!(jumlah > 0)) return setFormError(form, "Jumlah harus lebih dari 0");
      if (!parseIso(tanggal)) return setFormError(form, "Tanggal wajib diisi");

      // Validasi saldo sama seperti aplikasi: pengeluaran tidak boleh melebihi saldo akun
      if (f.tipe === "Pengeluaran") {
        const current = balanceOf(f.akun);
        const giveBack = isEdit && isExpense(orig) && sameText(orig.akun, f.akun) ? orig.jumlah : 0;
        const available = current + giveBack;
        if (available <= 0) return setFormError(form, `Saldo ${f.akun} kosong, tidak bisa menambah pengeluaran.`);
        if (jumlah > available) return setFormError(form, `Saldo ${f.akun} tidak cukup. Sisa: ${fmtRpRaw(available)}`);
      }

      let jam;
      if (timeVal === initialTime) jam = isEdit ? orig.jam : openedAt;
      else jam = timeVal ? timeVal + ":00" : "";

      const record = {
        id: f.id,
        tanggal,
        jam,
        tipe: f.tipe,
        kategori: f.kategori || "Lainnya",
        merchant: merchantInput.value.trim(),
        deskripsi: body.querySelector("#fDesc").value.trim(),
        jumlah,
        sumber: isEdit ? (orig.sumber || "manual") : (prefill && prefill.sumber ? prefill.sumber : "web"),
        akun: f.akun || "Tunai",
      };
      try {
        await withBusy(body.querySelector("#fSave"), "Menyimpan...", async () => {
          ensureOnline();
          if (isEdit) await api.updateTx(record); else await api.saveTx(record);
        });
        upsertById(state.transactions, normalizeTx(record));
        closeSheet();
        toast(isEdit ? "Perubahan tersimpan ✅" : (f.tipe === "Pemasukan" ? "Pemasukan tercatat 💰" : "Pengeluaran tercatat ✨"));
        commitLocal();
      } catch (err) {
        setFormError(form, err.message);
      }
    });
  }, { wide: true });
}

// ---------------- Form transfer ----------------
function openTransferForm(pair = null, initialFromAkun = null) {
  const isEdit = !!pair;
  const accounts = allAccountNames();
  const positive = sortAccounts(Object.keys(accountBalances()).filter((a) => balanceOf(a) > 0));
  const defaultFrom = initialFromAkun || positive[0] || "Tunai";
  const f = {
    from: isEdit ? pair.out.akun : defaultFrom,
    to: isEdit ? pair.inn.akun : (accounts.find((a) => !sameText(a, defaultFrom)) || "DANA"),
  };
  const base = isEdit ? pair.out : null;
  const openedAt = nowHms();
  const initialTime = base ? (base.jam || "").slice(0, 5) : openedAt.slice(0, 5);

  const html = `
    <form class="form" id="trForm" novalidate>
      ${amountFieldHtml("tAmount", base ? base.jumlah : 0)}
      <div class="field"><span class="field-label">Dari akun</span>${pickGroup("tFrom", accountItems(accounts), f.from)}<div class="hint" id="tFromSaldo"></div></div>
      <div class="field"><span class="field-label">Ke akun</span>${pickGroup("tTo", accountItems(accounts), f.to)}</div>
      <label class="field"><span class="field-label">Catatan</span><input id="tDesc" maxlength="200" placeholder="opsional" value="${esc(base ? base.deskripsi : "")}" autocomplete="off" /></label>
      <div class="row-2">
        <label class="field"><span class="field-label">Tanggal</span><input type="date" id="tDate" value="${esc(base ? base.tanggal : todayIso())}" required /></label>
        <label class="field"><span class="field-label">Jam</span><input type="time" id="tTime" value="${esc(initialTime)}" /></label>
      </div>
      <div class="form-error" role="alert"></div>
      <div class="form-actions">
        ${isEdit ? `<button type="button" class="btn btn-danger-soft" id="tDelete"><svg class="ico"><use href="#i-trash"/></svg>Hapus</button>` : ""}
        <button type="submit" class="btn btn-primary" id="tSave">${isEdit ? "Simpan perubahan" : "Pindahkan 🔁"}</button>
      </div>
    </form>`;

  openSheet(isEdit ? "Ubah pindah saldo 🔁" : "Pindah saldo 🔁", html, (body) => {
    const form = body.querySelector("#trForm");
    const amount = body.querySelector("#tAmount");
    const initialAmountText = amount.value;
    bindAmountInput(amount);
    if (!isEdit) amount.setAttribute("autofocus", "");
    const updateSaldo = () => {
      body.querySelector("#tFromSaldo").innerHTML = `Saldo ${esc(f.from)}: <b>${esc(fmtRp(balanceOf(f.from)))}</b>`;
    };
    updateSaldo();
    bindPickGroup(body, "tFrom", (v) => { f.from = v; updateSaldo(); });
    bindPickGroup(body, "tTo", (v) => { f.to = v; });

    if (isEdit) {
      body.querySelector("#tDelete").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const ok = await askConfirm(`Hapus pindah saldo ${pair.out.akun} → ${pair.inn.akun} (${fmtRpRaw(pair.out.jumlah)})? Kedua catatannya ikut terhapus.`);
        if (!ok) return;
        try {
          await withBusy(btn, "Menghapus...", async () => {
            ensureOnline();
            await api.deleteTx(pair.out.id);
            removeById(state.transactions, pair.out.id);
            await api.deleteTx(pair.inn.id);
            removeById(state.transactions, pair.inn.id);
          });
          closeSheet();
          toast("Pindah saldo dihapus 🗑️");
          commitLocal();
        } catch (err) {
          setFormError(form, err.message);
          commitLocal();
        }
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setFormError(form, "");
      const amountChanged = amount.value !== initialAmountText;
      const jumlah = isEdit && !amountChanged ? base.jumlah : readAmount(amount);
      const tanggal = body.querySelector("#tDate").value;
      const timeVal = body.querySelector("#tTime").value;
      const deskripsi = body.querySelector("#tDesc").value.trim();
      if (sameText(f.from, f.to)) return setFormError(form, "Akun asal dan tujuan harus berbeda");
      if (!(jumlah > 0)) return setFormError(form, "Jumlah harus lebih dari 0");
      if (!parseIso(tanggal)) return setFormError(form, "Tanggal wajib diisi");
      const giveBack = isEdit && sameText(base.akun, f.from) ? base.jumlah : 0;
      const available = balanceOf(f.from) + giveBack;
      if (available <= 0) return setFormError(form, `Saldo ${f.from} kosong, tidak bisa dipindahkan.`);
      if (jumlah > available) return setFormError(form, `Saldo ${f.from} tidak cukup. Sisa: ${fmtRpRaw(available)}`);

      let jam;
      if (timeVal === initialTime) jam = isEdit ? (base.jam || openedAt) : openedAt;
      else jam = timeVal ? timeVal + ":00" : openedAt;

      try {
        if (!isEdit) {
          const t = { fromAkun: f.from, toAkun: f.to, jumlah, tanggal, jam, deskripsi, outId: f.outId || uuid(), inId: f.inId || uuid() };
          f.outId = t.outId; f.inId = t.inId; // tetap sama kalau user menekan simpan lagi setelah gagal
          await withBusy(body.querySelector("#tSave"), "Memindahkan...", async () => { ensureOnline(); await api.transfer(t); });
          transferLegs(t).forEach((leg) => upsertById(state.transactions, leg));
          toast("Saldo berhasil dipindah 🔁");
        } else {
          const t = { fromAkun: f.from, toAkun: f.to, jumlah, tanggal, jam, deskripsi, outId: pair.out.id, inId: pair.inn.id };
          const [outLeg, inLeg] = transferLegs(t, pair.out.sumber || "transfer", pair.inn.sumber || "transfer");
          await withBusy(body.querySelector("#tSave"), "Menyimpan...", async () => {
            ensureOnline();
            await api.updateTx(outLeg);
            upsertById(state.transactions, outLeg);
            await api.updateTx(inLeg);
            upsertById(state.transactions, inLeg);
          });
          toast("Perubahan tersimpan ✅");
        }
        closeSheet();
        commitLocal();
      } catch (err) {
        setFormError(form, err.message);
        if (isEdit) commitLocal();
      }
    });
  });
}

/** Bentuk dua baris transaksi transfer persis seperti yang ditulis Apps Script & aplikasi. */
function transferLegs(t, outSumber = "transfer", inSumber = "transfer") {
  return [
    normalizeTx({ id: t.outId, tanggal: t.tanggal, jam: t.jam, tipe: "Pengeluaran", kategori: "Transfer", merchant: "Transfer ke " + t.toAkun, deskripsi: t.deskripsi, jumlah: t.jumlah, sumber: outSumber, akun: t.fromAkun }),
    normalizeTx({ id: t.inId, tanggal: t.tanggal, jam: t.jam, tipe: "Pemasukan", kategori: "Transfer", merchant: "Transfer dari " + t.fromAkun, deskripsi: t.deskripsi, jumlah: t.jumlah, sumber: inSumber, akun: t.toAkun }),
  ];
}

function openTxById(id) {
  const tx = state.transactions.find((t) => t.id === id);
  if (!tx) return;
  if (isTransfer(tx)) {
    const pair = findTransferPair(tx);
    if (pair && pair.out && pair.inn) return openTransferForm(pair);
  }
  openTxForm({ tx });
}

// ---------------- Form budget ----------------
function openBudgetForm(budget = null) {
  const isEdit = !!budget;
  const bulanDefault = isEdit ? budget.bulan : state.budgetMonth;
  const used = (ym) => state.budgets.filter((b) => b.bulan === ym && (!isEdit || b.id !== budget.id));
  const free = CATEGORY_LIST.filter((c) => !used(bulanDefault).some((b) => sameText(b.kategori, c)));
  const f = { kategori: isEdit ? budget.kategori : (free[0] || CATEGORY_LIST[0]) };
  const html = `
    <form class="form" id="bForm" novalidate>
      ${isEdit
        ? `<div class="form-note">🧮 <span>Budget <b>${esc(budget.kategori)}</b> untuk <b>${esc(monthLabel(budget.bulan))}</b>. Kategori &amp; bulan tidak bisa diubah (sama seperti di aplikasi).</span></div>`
        : `<div class="field"><span class="field-label">Kategori</span>${pickGroup("bCat", categoryItems(), f.kategori)}</div>
           <label class="field"><span class="field-label">Bulan</span><input type="month" id="bMonth" value="${esc(bulanDefault)}" required /></label>`}
      ${amountFieldHtml("bLimit", isEdit ? budget.limitAmount : 0, "Batas pengeluaran per bulan")}
      ${isEdit ? `<div class="hint">Terpakai: <b>${esc(fmtRp(budgetView(budget).spent))}</b></div>` : ""}
      <div class="form-error" role="alert"></div>
      <div class="form-actions">
        ${isEdit ? `<button type="button" class="btn btn-danger-soft" id="bDelete"><svg class="ico"><use href="#i-trash"/></svg>Hapus</button>` : ""}
        <button type="submit" class="btn btn-primary" id="bSave">${isEdit ? "Simpan perubahan" : "Simpan budget ✨"}</button>
      </div>
    </form>`;
  openSheet(isEdit ? "Ubah budget ✏️" : "Budget baru 🧮", html, (body) => {
    const form = body.querySelector("#bForm");
    const limitInput = body.querySelector("#bLimit");
    bindAmountInput(limitInput);
    if (!isEdit) bindPickGroup(body, "bCat", (v) => { f.kategori = v; });

    if (isEdit) {
      body.querySelector("#bDelete").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const ok = await askConfirm(`Hapus budget ${budget.kategori} ${monthLabel(budget.bulan)}? Transaksinya tidak ikut terhapus.`);
        if (!ok) return;
        try {
          await withBusy(btn, "Menghapus...", async () => { ensureOnline(); await api.budgetDelete(budget.id); });
          removeById(state.budgets, budget.id);
          closeSheet();
          toast("Budget dihapus 🗑️");
          commitLocal();
        } catch (err) { setFormError(form, err.message); }
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setFormError(form, "");
      const limitAmount = readAmount(limitInput);
      const bulan = isEdit ? budget.bulan : body.querySelector("#bMonth").value;
      if (!/^\d{4}-\d{2}$/.test(bulan || "")) return setFormError(form, "Bulan wajib diisi");
      if (!(limitAmount > 0)) return setFormError(form, "Limit harus lebih dari 0");
      if (!isEdit && used(bulan).some((b) => sameText(b.kategori, f.kategori)))
        return setFormError(form, "Budget untuk kategori ini di bulan tersebut sudah ada");
      const record = isEdit
        ? { ...budget, limitAmount, enabled: budget.enabled !== false }
        : { id: f.id || (f.id = uuid()), kategori: f.kategori, bulan, limitAmount, enabled: true };
      try {
        await withBusy(body.querySelector("#bSave"), "Menyimpan...", async () => { ensureOnline(); await api.budgetUpsert(record); });
        upsertById(state.budgets, record);
        state.budgetMonth = bulan;
        closeSheet();
        toast(isEdit ? "Budget diperbarui ✅" : "Budget tersimpan ✨");
        commitLocal();
      } catch (err) { setFormError(form, err.message); }
    });
  });
}

async function copyBudgetsFromPrevMonth() {
  const target = state.budgetMonth;
  const source = addMonths(target, -1);
  const list = copyableBudgets(source, target);
  if (list.length === 0) return;
  const ok = await askConfirm(`Salin ${list.length} budget dari ${monthLabel(source)} ke ${monthLabel(target)}?`, { yes: "Ya, salin", emoji: "📋" });
  if (!ok) return;
  let done = 0;
  try {
    ensureOnline();
    showLoader(true);
    for (const b of list) {
      const record = { id: uuid(), kategori: b.kategori, bulan: target, limitAmount: Number(b.limitAmount) || 0, enabled: true };
      await api.budgetUpsert(record);
      state.budgets.push(record);
      done++;
    }
    toast(`${done} budget tersalin 📋`);
  } catch (err) {
    toast(`${done} tersalin, sisanya gagal: ${err.message}`, "error");
  } finally {
    showLoader(false);
    commitLocal();
  }
}

// ---------------- Form goal ----------------
function openGoalForm(goal = null) {
  const isEdit = !!goal;
  const f = { sourceAkun: isEdit ? (goal.sourceAkun || "Tunai") : "Tunai", autoDebit: isEdit ? !!goal.autoDebit : false };
  const sources = allAccountNames().filter((a) => !/^tabungan\b/i.test(a));
  const html = `
    <form class="form" id="gForm" novalidate>
      <label class="field"><span class="field-label">Nama goal</span><input id="gName" maxlength="60" placeholder="mis. Liburan ke Bali 🏝️" value="${esc(isEdit ? goal.name : "")}" autocomplete="off" required /></label>
      ${amountFieldHtml("gTarget", isEdit ? goal.targetAmount : 0, "Target")}
      <label class="field"><span class="field-label">Deadline</span><input type="date" id="gDeadline" value="${esc(isEdit ? goal.deadline : "")}" min="${esc(todayIso())}" required /></label>
      <div class="field"><span class="field-label">Akun sumber tabungan</span>${pickGroup("gSource", accountItems(sources), f.sourceAkun)}</div>
      ${amountFieldHtml("gAlloc", isEdit ? goal.monthlyAllocation : 0, "Alokasi per bulan (opsional)")}
      <div class="switch-row">
        <div class="switch-text"><div class="switch-title">Auto-debit tiap bulan</div><div class="switch-sub">Aplikasi HP otomatis memindahkan alokasi dari akun sumber tiap tanggal 1.</div></div>
        <label class="switch"><input type="checkbox" id="gAuto" ${f.autoDebit ? "checked" : ""} aria-label="Auto-debit tiap bulan" /><span class="track"></span></label>
      </div>
      ${isEdit ? `<div class="hint">Akun tabungan: <b>${esc(goal.goalAkun || "-")}</b> (tidak berubah walau nama goal diganti)</div>` : `<div class="hint">Saldo goal disimpan di akun <b>Tabungan &lt;nama goal&gt;</b>.</div>`}
      <div class="form-error" role="alert"></div>
      <div class="form-actions">
        ${isEdit ? `<button type="button" class="btn btn-danger-soft" id="gDelete"><svg class="ico"><use href="#i-trash"/></svg>Hapus</button>` : ""}
        <button type="submit" class="btn btn-primary" id="gSave">${isEdit ? "Simpan perubahan" : "Buat goal 🎯"}</button>
      </div>
    </form>`;
  openSheet(isEdit ? "Ubah goal ✏️" : "Goal tabungan baru 🎯", html, (body) => {
    const form = body.querySelector("#gForm");
    const target = body.querySelector("#gTarget");
    const alloc = body.querySelector("#gAlloc");
    bindAmountInput(target);
    bindAmountInput(alloc);
    bindPickGroup(body, "gSource", (v) => { f.sourceAkun = v; });

    if (isEdit) {
      body.querySelector("#gDelete").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const ok = await askConfirm(`Hapus goal "${goal.name}"? Riwayat transfer tabungannya tetap ada.`);
        if (!ok) return;
        try {
          await withBusy(btn, "Menghapus...", async () => { ensureOnline(); await api.goalDelete(goal.id); });
          removeById(state.goals, goal.id);
          closeSheet();
          toast("Goal dihapus 🗑️");
          commitLocal();
        } catch (err) { setFormError(form, err.message); }
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setFormError(form, "");
      const name = body.querySelector("#gName").value.trim();
      const targetAmount = readAmount(target);
      const deadline = body.querySelector("#gDeadline").value;
      const monthlyAllocation = readAmount(alloc);
      const autoDebit = body.querySelector("#gAuto").checked;
      if (!name) return setFormError(form, "Nama goal wajib diisi");
      if (!(targetAmount > 0)) return setFormError(form, "Target harus lebih dari 0");
      if (!parseIso(deadline)) return setFormError(form, "Deadline wajib diisi");
      if (deadline < todayIso()) return setFormError(form, "Deadline tidak boleh sebelum hari ini");
      if (autoDebit && !(monthlyAllocation > 0)) return setFormError(form, "Isi alokasi per bulan untuk auto-debit");
      const record = {
        id: isEdit ? goal.id : (f.id || (f.id = uuid())),
        name,
        targetAmount,
        deadline,
        monthlyAllocation,
        autoDebit,
        currentAmount: isEdit ? (Number(goal.currentAmount) || 0) : 0,
        sourceAkun: f.sourceAkun || "Tunai",
        goalAkun: isEdit && goal.goalAkun ? goal.goalAkun : ("Tabungan " + name).slice(0, 40),
        enabled: isEdit ? goal.enabled !== false : true,
      };
      if (sameText(record.sourceAkun, record.goalAkun)) return setFormError(form, "Akun sumber dan akun goal tidak boleh sama");
      try {
        await withBusy(body.querySelector("#gSave"), "Menyimpan...", async () => { ensureOnline(); await api.goalUpsert(record); });
        upsertById(state.goals, record);
        closeSheet();
        toast(isEdit ? "Goal diperbarui ✅" : "Goal dibuat 🎯 Semangat nabung!");
        commitLocal();
      } catch (err) { setFormError(form, err.message); }
    });
  });
}

function openTabungForm(goal) {
  const v = goalView(goal);
  const html = `
    <form class="form" id="tbForm" novalidate>
      <div class="form-note">🎯 <span><b>${esc(goal.name)}</b> — terkumpul ${esc(fmtRp(v.saldo))} dari ${esc(fmtRp(v.target))}${v.remaining > 0 ? ` (kurang ${esc(fmtRp(v.remaining))})` : " 🎉"}</span></div>
      ${amountFieldHtml("tbAmount", 0, "Jumlah yang ditabung")}
      <div class="hint">Dipindahkan dari <b>${esc(goal.sourceAkun || "Tunai")}</b> (saldo ${esc(fmtRp(balanceOf(goal.sourceAkun || "Tunai")))}) ke <b>${esc(goal.goalAkun || "-")}</b>.</div>
      <div class="form-error" role="alert" style="margin-top:10px"></div>
      <div class="form-actions"><button type="submit" class="btn btn-primary" id="tbSave">${JAR_ICON}Tabung sekarang</button></div>
    </form>`;
  openSheet("Tabung ke goal 💰", html, (body) => {
    const form = body.querySelector("#tbForm");
    const amount = body.querySelector("#tbAmount");
    bindAmountInput(amount);
    amount.setAttribute("autofocus", "");
    const ids = { outId: uuid(), inId: uuid() };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setFormError(form, "");
      const jumlah = readAmount(amount);
      const src = goal.sourceAkun || "Tunai";
      if (!(jumlah > 0)) return setFormError(form, "Jumlah harus lebih dari 0");
      if (!goal.goalAkun) return setFormError(form, "Akun goal belum diset");
      if (sameText(src, goal.goalAkun)) return setFormError(form, "Akun sumber dan akun goal tidak boleh sama");
      const saldo = balanceOf(src);
      if (saldo <= 0) return setFormError(form, `Saldo ${src} kosong, tidak bisa menabung.`);
      if (jumlah > saldo) return setFormError(form, `Saldo ${src} tidak cukup. Sisa: ${fmtRpRaw(saldo)}`);
      const t = { fromAkun: src, toAkun: goal.goalAkun, jumlah, tanggal: todayIso(), jam: nowHms(), deskripsi: `Tabung untuk: ${goal.name} #goal`, ...ids };
      try {
        await withBusy(body.querySelector("#tbSave"), "Menabung...", async () => { ensureOnline(); await api.transfer(t); });
        transferLegs(t).forEach((leg) => upsertById(state.transactions, leg));
        closeSheet();
        const after = goalView(goal);
        toast(after.saldo >= after.target ? "Goal tercapai! 🎉🏆" : `Tersimpan! ${after.pct.toFixed(0)}% menuju target 🎯`);
        commitLocal();
      } catch (err) { setFormError(form, err.message); }
    });
  });
}

// ---------------- Form transaksi berulang ----------------
function openRecurringForm(rule = null) {
  const isEdit = !!rule;
  const f = {
    tipe: isEdit ? (sameText(rule.tipe, "Pemasukan") ? "Pemasukan" : "Pengeluaran") : "Pengeluaran",
    kategori: isEdit ? categoryKey(rule.kategori) : "Tagihan",
    akun: isEdit ? (rule.akun || "Tunai") : "Tunai",
    freq: isEdit ? String(rule.frequency || "MONTHLY").toUpperCase() : "MONTHLY",
    dayOfMonth: isEdit ? Number(rule.dayOfMonth) || 1 : new Date().getDate(),
    dayOfWeek: isEdit ? weekdayOf(rule.startDate) : weekdayOf(todayIso()),
    monthOfYear: isEdit ? Number(rule.monthOfYear) || 1 : new Date().getMonth() + 1,
    startTouched: isEdit,
  };
  const startInit = isEdit ? rule.startDate : suggestStartDate(f.freq, f.dayOfMonth, f.dayOfWeek, f.monthOfYear);
  const freqSeg = Object.entries(FREQ_LABEL).map(([k, label]) =>
    `<button type="button" class="seg-btn ${f.freq === k ? "active" : ""}" data-freq="${k}">${label}</button>`).join("");
  const html = `
    <form class="form" id="rForm" novalidate>
      <div class="form-note">🔁 <span>Transaksi dibuat otomatis oleh <b>aplikasi HP</b> sesuai jadwal (jam 09:00), lalu tersinkron ke sini.</span></div>
      <div class="type-toggle" role="radiogroup" aria-label="Tipe transaksi">
        <button type="button" class="type-btn out ${f.tipe === "Pengeluaran" ? "active" : ""}" data-tipe="Pengeluaran">🔻 Pengeluaran</button>
        <button type="button" class="type-btn in ${f.tipe === "Pemasukan" ? "active" : ""}" data-tipe="Pemasukan">🔺 Pemasukan</button>
      </div>
      ${amountFieldHtml("rAmount", isEdit ? rule.jumlah : 0)}
      <label class="field"><span class="field-label">Nama</span><input id="rMerchant" maxlength="80" placeholder="mis. Gaji, Netflix, Listrik PLN" value="${esc(isEdit ? rule.merchant : "")}" autocomplete="off" /></label>
      <div class="field"><span class="field-label">Kategori</span>${pickGroup("rCat", categoryItems(), f.kategori)}</div>
      <div class="field"><span class="field-label">Akun</span>${pickGroup("rAkun", accountItems(), f.akun)}</div>
      ${isEdit ? `<div class="form-note">📅 <span>Jadwal: <b>${esc(describeSchedule(rule))}</b>${upcomingRun(rule) ? ` · berikutnya <b>${esc(dateLabel(upcomingRun(rule), true))}</b>` : ""}.
        Untuk mengganti jadwal, hapus lalu buat jadwal baru (HP menyimpan urutan jadwalnya sendiri).</span></div>` : ""}
      <div id="rSchedule" class="${isEdit ? "hidden" : ""}">
        <div class="field"><span class="field-label">Frekuensi</span><div class="seg seg-full" id="rFreq">${freqSeg}</div></div>
        <div class="field" id="rWeekly"><span class="field-label">Hari</span>${pickGroup("rDow", WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d.slice(0, 3) })), String(f.dayOfWeek))}</div>
        <div class="row-2" id="rDayRow">
          <label class="field" id="rMonthOfYearField"><span class="field-label">Bulan</span>
            <select id="rMonthOfYear">${MONTHS.map((m, i) => `<option value="${i + 1}" ${f.monthOfYear === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select></label>
          <label class="field"><span class="field-label">Tanggal (1–31)</span><input type="number" id="rDom" min="1" max="31" inputmode="numeric" value="${f.dayOfMonth}" /></label>
        </div>
        <label class="field"><span class="field-label">Mulai</span><input type="date" id="rStart" value="${esc(startInit)}" min="${esc(todayIso())}" required /></label>
        <div class="hint" id="rPreview" style="margin:-4px 0 14px"></div>
      </div>
      <label class="field"><span class="field-label">Catatan</span><input id="rDesc" maxlength="200" placeholder="opsional" value="${esc(isEdit ? rule.deskripsi : "")}" autocomplete="off" /></label>
      <div class="form-error" role="alert" style="margin-top:10px"></div>
      <div class="form-actions">
        ${isEdit ? `<button type="button" class="btn btn-danger-soft" id="rDelete"><svg class="ico"><use href="#i-trash"/></svg>Hapus</button>` : ""}
        <button type="submit" class="btn btn-primary" id="rSave">${isEdit ? "Simpan perubahan" : "Simpan jadwal 🔁"}</button>
      </div>
    </form>`;

  openSheet(isEdit ? "Ubah transaksi berulang ✏️" : "Transaksi berulang baru 🔁", html, (body) => {
    const form = body.querySelector("#rForm");
    const amount = body.querySelector("#rAmount");
    const startInput = body.querySelector("#rStart");
    const domInput = body.querySelector("#rDom");
    const moySelect = body.querySelector("#rMonthOfYear");
    bindAmountInput(amount);

    const sync = () => {
      body.querySelector("#rWeekly").classList.toggle("hidden", f.freq !== "WEEKLY");
      body.querySelector("#rDayRow").classList.toggle("hidden", !(f.freq === "MONTHLY" || f.freq === "YEARLY"));
      body.querySelector("#rMonthOfYearField").classList.toggle("hidden", f.freq !== "YEARLY");
      if (!f.startTouched) startInput.value = suggestStartDate(f.freq, f.dayOfMonth, f.dayOfWeek, f.monthOfYear);
      const start = startInput.value;
      if (parseIso(start)) {
        const preview = { frequency: f.freq, dayOfMonth: f.dayOfMonth, monthOfYear: f.monthOfYear };
        const dates = [start];
        for (let i = 0; i < 2; i++) dates.push(nextRunAfter(dates[dates.length - 1], preview));
        body.querySelector("#rPreview").innerHTML = `📅 Jadwal: <b>${dates.map((d) => esc(dateLabel(d, true))).join(" → ")}</b> …`;
      } else body.querySelector("#rPreview").textContent = "";
    };
    sync();

    body.querySelectorAll(".type-btn").forEach((b) => b.addEventListener("click", () => {
      f.tipe = b.dataset.tipe;
      body.querySelectorAll(".type-btn").forEach((x) => x.classList.toggle("active", x === b));
    }));
    bindPickGroup(body, "rCat", (v) => { f.kategori = v; });
    bindPickGroup(body, "rAkun", (v) => { f.akun = v; });
    bindPickGroup(body, "rDow", (v) => {
      // Mingguan dijadwalkan dari hari tanggal mulai, jadi pilih hari = geser tanggal mulai
      f.dayOfWeek = Number(v);
      startInput.value = suggestStartDate("WEEKLY", f.dayOfMonth, f.dayOfWeek, f.monthOfYear);
      sync();
    });
    body.querySelector("#rFreq").addEventListener("click", (e) => {
      const b = e.target.closest("[data-freq]");
      if (!b) return;
      f.freq = b.dataset.freq;
      body.querySelectorAll("#rFreq .seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      sync();
    });
    domInput.addEventListener("input", () => { f.dayOfMonth = clamp(Number(domInput.value) || 1, 1, 31); sync(); });
    moySelect.addEventListener("change", () => { f.monthOfYear = Number(moySelect.value) || 1; sync(); });
    startInput.addEventListener("change", () => {
      f.startTouched = true;
      if (f.freq === "WEEKLY" && parseIso(startInput.value)) {
        // Aplikasi menjadwalkan mingguan berdasarkan hari dari tanggal mulai
        f.dayOfWeek = weekdayOf(startInput.value);
        body.querySelectorAll("#rDow .pick").forEach((x) => x.classList.toggle("active", Number(x.dataset.value) === f.dayOfWeek));
      }
      sync();
    });

    if (isEdit) {
      body.querySelector("#rDelete").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const ok = await askConfirm(`Hapus jadwal "${rule.merchant || rule.kategori}"? Transaksi yang sudah tercatat tidak ikut terhapus.`);
        if (!ok) return;
        try {
          await withBusy(btn, "Menghapus...", async () => { ensureOnline(); await api.recurringDelete(rule.id); });
          removeById(state.recurring, rule.id);
          closeSheet();
          toast("Jadwal dihapus 🗑️");
          commitLocal();
        } catch (err) { setFormError(form, err.message); }
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setFormError(form, "");
      const jumlah = readAmount(amount);
      if (!(jumlah > 0)) return setFormError(form, "Jumlah harus lebih dari 0");
      const common = {
        tipe: f.tipe,
        kategori: f.kategori || "Lainnya",
        merchant: body.querySelector("#rMerchant").value.trim(),
        deskripsi: body.querySelector("#rDesc").value.trim(),
        jumlah,
        akun: f.akun || "Tunai",
      };
      let record;
      if (isEdit) {
        // Jadwal (frekuensi, tanggal, mulai, nextRunDate) dipertahankan apa adanya
        record = { ...rule, ...common, endDate: rule.endDate || null, enabled: rule.enabled !== false };
      } else {
        const startDate = startInput.value;
        const dom = Number(domInput.value);
        if (!parseIso(startDate)) return setFormError(form, "Tanggal mulai wajib diisi");
        if (startDate < todayIso()) return setFormError(form, "Tanggal mulai tidak boleh sebelum hari ini");
        if ((f.freq === "MONTHLY" || f.freq === "YEARLY") && !(dom >= 1 && dom <= 31)) return setFormError(form, "Tanggal harus 1–31");
        record = {
          id: f.id || (f.id = uuid()),
          ...common,
          frequency: f.freq,
          dayOfMonth: f.freq === "MONTHLY" || f.freq === "YEARLY" ? dom : 1,
          dayOfWeek: f.freq === "WEEKLY" ? weekdayOf(startDate) : 1,
          monthOfYear: f.freq === "YEARLY" ? f.monthOfYear : 1,
          startDate,
          endDate: null,
          enabled: true,
          nextRunDate: startDate,
        };
      }
      try {
        await withBusy(body.querySelector("#rSave"), "Menyimpan...", async () => { ensureOnline(); await api.recurringUpsert(record); });
        upsertById(state.recurring, record);
        closeSheet();
        toast(isEdit ? "Jadwal diperbarui ✅" : "Jadwal tersimpan 🔁");
        commitLocal();
      } catch (err) { setFormError(form, err.message); }
    });
  });
}

async function toggleRecurring(id, enabled, input) {
  const rule = state.recurring.find((r) => r.id === id);
  if (!rule) return;
  const record = { ...rule, enabled };
  input.disabled = true;
  try {
    ensureOnline();
    await api.recurringUpsert(record);
    upsertById(state.recurring, record);
    toast(enabled ? "Jadwal diaktifkan ▶️" : "Jadwal dijeda ⏸️");
    commitLocal();
  } catch (err) {
    input.checked = !enabled;
    toast(err.message, "error");
  } finally {
    input.disabled = false;
  }
}

// ---------------- Laporan bulanan (PDF/CSV) ----------------
function settlementRows() {
  return monthTx(state.month).slice().sort((a, b) => (a.tanggal + (a.jam || "")).localeCompare(b.tanggal + (b.jam || "")));
}

function settlementSummary() {
  const rows = settlementRows();
  const totals = monthTotals(state.month);
  const balances = accountBalances();
  const accountDelta = {};
  rows.forEach((t) => {
    const delta = isIncome(t) ? t.jumlah : isExpense(t) ? -t.jumlah : 0;
    accountDelta[t.akun] = (accountDelta[t.akun] || 0) + delta;
  });
  return {
    rows,
    income: totals.income,
    expense: totals.expense,
    net: totals.net,
    balance: totalBalance(),
    accountBalances: sortAccounts(Object.keys(balances)).filter((n) => Math.round(balances[n]) !== 0).map((n) => [n, balances[n]]),
    accountDelta: Object.entries(accountDelta).sort((a, b) => b[1] - a[1]),
    categoryExpense: Object.entries(expenseByCategory(state.month)).sort((a, b) => b[1] - a[1]),
  };
}

function csvCell(value) {
  let text = String(value ?? "");
  // Cegah formula injection saat CSV dibuka di Excel/Sheets
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadSettlementCsv() {
  const sum = settlementSummary();
  const lines = [
    ["Laporan Bulanan", monthLabel(state.month)],
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
    ...sum.rows.map((t) => [t.tanggal, (t.jam || "").slice(0, 5), t.tipe, t.kategori, t.akun, t.merchant, t.deskripsi, Math.round(t.jumlah || 0)]),
  ];
  const csv = lines.map((row) => row.map(csvCell).join(";")).join("\n");
  downloadBlob(`laporan-${state.month}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");
  toast("CSV diunduh 📊");
}

function downloadSettlementPdf() {
  const lib = window.jspdf;
  if (!lib || !lib.jsPDF) {
    toast("Library PDF belum termuat. Coba lagi saat online.", "error");
    return;
  }
  const doc = new lib.jsPDF({ unit: "mm", format: "a4" });
  const sum = settlementSummary();
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 44;

  const drawMotif = () => {
    doc.setFillColor(255, 247, 250);
    doc.rect(0, 0, pageWidth, pageHeight, "F");
    doc.setFillColor(214, 63, 134);
    doc.rect(0, 0, pageWidth, 34, "F");
    doc.setFillColor(160, 79, 214);
    doc.circle(pageWidth - 10, -8, 38, "F");
    doc.setFillColor(111, 91, 234);
    doc.circle(pageWidth - 42, 24, 16, "F");
    doc.setFillColor(255, 224, 138);
    doc.circle(pageWidth - 70, 9, 1.6, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text("Laporan Bulanan", margin, 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(monthLabel(state.month), margin, 23);
    doc.text("Catalyst", pageWidth - margin, 15, { align: "right" });
    doc.text(new Date().toLocaleDateString("id-ID"), pageWidth - margin, 23, { align: "right" });
    doc.setTextColor(61, 42, 63);
  };
  const addPage = () => { doc.addPage(); drawMotif(); y = 44; };
  const ensureSpace = (h) => { if (y + h > pageHeight - 16) addPage(); };
  const addLine = (text, size = 10) => {
    ensureSpace(8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(61, 42, 63);
    doc.text(String(text), margin, y);
    y += 6;
  };
  const sectionTitle = (title) => {
    ensureSpace(13);
    y += 2;
    doc.setFillColor(255, 227, 240);
    doc.roundedRect(margin, y - 5, pageWidth - margin * 2, 10, 3, 3, "F");
    doc.setTextColor(201, 54, 122);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title, margin + 4, y + 1.5);
    doc.setTextColor(61, 42, 63);
    y += 13;
  };
  const summaryCard = (x, yPos, label, value, color) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(240, 220, 231);
    doc.roundedRect(x, yPos, 88, 24, 4, 4, "FD");
    doc.setFillColor(color[0], color[1], color[2]);
    doc.roundedRect(x, yPos, 3, 24, 2, 2, "F");
    doc.setTextColor(122, 92, 114);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(label, x + 8, yPos + 8);
    doc.setTextColor(61, 42, 63);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(value, x + 8, yPos + 17);
  };
  const addKeyValueRows = (rows, emptyText) => {
    if (rows.length === 0) { addLine(emptyText, 9); return; }
    rows.forEach(([name, val]) => {
      ensureSpace(7);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(61, 42, 63);
      doc.text(String(name), margin + 2, y);
      doc.setFont("helvetica", "bold");
      doc.text(fmtRpRaw(val), pageWidth - margin - 2, y, { align: "right" });
      y += 6;
    });
  };

  drawMotif();
  ensureSpace(55);
  summaryCard(margin, y, "Saldo Total", fmtRpRaw(sum.balance), [201, 54, 122]);
  summaryCard(margin + 94, y, "Pemasukan", fmtRpRaw(sum.income), [16, 185, 129]);
  y += 30;
  summaryCard(margin, y, "Pengeluaran", fmtRpRaw(sum.expense), [244, 63, 94]);
  summaryCard(margin + 94, y, "Selisih", fmtRpRaw(sum.net), [142, 91, 216]);
  y += 32;

  sectionTitle("Saldo per Akun");
  addKeyValueRows(sum.accountBalances, "Tidak ada saldo akun.");
  sectionTitle("Mutasi Akun Bulan Ini");
  addKeyValueRows(sum.accountDelta, "Tidak ada mutasi.");
  sectionTitle("Pengeluaran per Kategori");
  addKeyValueRows(sum.categoryExpense.slice(0, 12), "Tidak ada pengeluaran.");

  sectionTitle(`Daftar Transaksi (${sum.rows.length})`);
  sum.rows.forEach((t, idx) => {
    ensureSpace(13);
    const sign = isIncome(t) ? "+" : isExpense(t) ? "-" : "";
    const left = `${t.tanggal} ${(t.jam || "").slice(0, 5)}  ${t.tipe}  ${t.kategori}  ${t.akun}`;
    const merchant = t.merchant || t.deskripsi || "-";
    if (idx % 2 === 0) {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin, y - 4, pageWidth - margin * 2, 10, 2, 2, "F");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(61, 42, 63);
    doc.text(doc.splitTextToSize(left, 118), margin, y);
    doc.setTextColor(122, 92, 114);
    doc.text(doc.splitTextToSize(merchant, 70), margin, y + 4);
    doc.setFont("helvetica", "bold");
    if (isIncome(t)) doc.setTextColor(5, 150, 105);
    else if (isExpense(t)) doc.setTextColor(190, 18, 60);
    else doc.setTextColor(122, 92, 114);
    doc.text(`${sign} ${fmtRpRaw(t.jumlah || 0)}`, pageWidth - margin, y, { align: "right" });
    doc.setTextColor(61, 42, 63);
    y += 11;
  });
  doc.save(`laporan-${state.month}.pdf`);
  toast("PDF diunduh 📄");
}

// ---------------- Tema ----------------
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function resolvedTheme() {
  return state.theme === "dark" || (state.theme === "system" && darkQuery.matches) ? "dark" : "light";
}
function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.setAttribute("data-theme", theme);
  document.getElementById("metaThemeColor").setAttribute("content", theme === "dark" ? "#B8336F" : "#D63F86");
}
function setTheme(pref) {
  state.theme = pref;
  localStorage.setItem(LS_THEME, pref);
  applyTheme();
  renderSettings();
  if (state.page === "stats") renderStats(); // warna grafik mengikuti tema
}

// ---------------- Install (PWA) ----------------
function updateInstallBanner() {
  const banner = document.getElementById("installBanner");
  const dismissed = localStorage.getItem(LS_INSTALL_DISMISS) === "1";
  banner.classList.toggle("hidden", !deferredInstallPrompt || dismissed || isStandalone());
}
async function promptInstall() {
  if (!deferredInstallPrompt) {
    toast(isIos() ? "Di Safari: Bagikan → Tambahkan ke Layar Utama 📲" : "Pakai menu browser → Instal aplikasi 📲");
    return;
  }
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  updateInstallBanner();
  renderSettings();
  if (choice && choice.outcome === "accepted") toast("Yay, Catalyst terpasang! 🎉");
}

// ---------------- Status & loader ----------------
function showLoader(b) { document.getElementById("loader").classList.toggle("hidden", !b); }
function setStatus(s) {
  document.getElementById("status").textContent = s;
  const side = document.getElementById("sideStatus");
  if (side) side.textContent = s;
}
function setSyncing(b) {
  document.getElementById("refreshBtn").classList.toggle("spin", b);
  const side = document.getElementById("sideRefreshBtn");
  if (side) side.classList.toggle("spin", b);
}

function toggleHide() {
  state.hide = !state.hide;
  localStorage.setItem(LS_HIDE, state.hide ? "1" : "0");
  render();
}

// ---------------- Layar penuh (PC) ----------------
function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => toast("Browser menolak layar penuh. Coba tekan F11.", "error"));
  } else {
    toast("Tekan F11 untuk layar penuh.");
  }
}
function updateFullscreenBtn() {
  const on = !!document.fullscreenElement;
  const btn = document.getElementById("fullscreenBtn");
  if (btn) {
    btn.innerHTML = `<svg class="ico"><use href="#${on ? "i-shrink" : "i-expand"}"/></svg>`;
    btn.title = on ? "Keluar layar penuh (F)" : "Layar penuh (F)";
    btn.setAttribute("aria-label", btn.title);
  }
  if (state.page === "settings") renderSettings();
}

// ---------------- Pintasan keyboard (PC) ----------------
function handleKeyboardShortcut(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (sheetOpen || !document.getElementById("confirm").classList.contains("hidden")) return;
  if (!state.url || document.getElementById("app").classList.contains("hidden")) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  const k = e.key.toLowerCase();
  const pages = ["home", "history", "stats", "money", "settings"];
  if (k === "n") { e.preventDefault(); openAddMenu(); }
  else if (k === "r") { e.preventDefault(); loadAll(); }
  else if (k === "f") { e.preventDefault(); toggleFullscreen(); }
  else if (k === "/") {
    e.preventDefault();
    if (state.page !== "home" && state.page !== "history") goTo("history");
    setTimeout(() => {
      const input = document.getElementById(state.page === "home" ? "homeSearch" : "histSearch");
      if (input) input.focus();
    }, 60);
  } else if (/^[1-5]$/.test(k)) { e.preventDefault(); goTo(pages[Number(k) - 1]); }
}
function updateOnline() {
  document.getElementById("offlineBar").classList.toggle("hidden", navigator.onLine !== false);
}

// ---------------- Koneksi / setup ----------------
function connect(url, secret, telegram = null) {
  const cleanUrl = (url || "").trim().replace(/\s/g, "");
  const cleanSecret = (secret || "").trim();
  if (!cleanUrl.startsWith("https://") || !cleanUrl.includes("script.google.com")) {
    return setupMsg("URL harus URL Web App Apps Script (diawali https://script.google.com dan diakhiri /exec).", true);
  }
  if (!cleanSecret) return setupMsg("Secret tidak boleh kosong.", true);
  state.url = cleanUrl;
  state.secret = cleanSecret;
  state.telegram = telegram;
  localStorage.setItem(LS_KEY, JSON.stringify({ url: state.url, secret: state.secret, telegram: state.telegram }));
  state.loadedAt = 0;
  showApp();
  loadAll();
}

function disconnect() {
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(LS_CACHE);
  Object.assign(state, { url: "", secret: "", telegram: null, transactions: [], budgets: [], goals: [], recurring: [], debts: [], debtPayments: [], loadedAt: 0 });
  showSetup();
  setupMsg("Koneksi diputus. Data di browser ini sudah dihapus.", false);
}

function setupMsg(msg, err) {
  const el = document.getElementById("setupMsg");
  el.textContent = msg;
  el.className = "setup-msg " + (err ? "err" : "ok");
}

function showApp() {
  document.getElementById("setup").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  goTo(pageFromHash(), { replace: true });
}
function showSetup() {
  document.getElementById("app").classList.add("hidden");
  document.getElementById("setup").classList.remove("hidden");
}

function parseConfig(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return null; }
  if (!obj || typeof obj !== "object") return null;
  const url = obj.webhookUrl || obj.url || "";
  const secret = obj.webhookSecret || obj.secret || "";
  if (!url) return null;
  const token = String(obj.telegramToken || "").trim();
  const chatId = String(obj.telegramChatId || "").trim();
  return { url, secret, telegram: token && chatId ? { token, chatId } : null };
}

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const cfg = parseConfig(reader.result);
    if (!cfg) return setupMsg("File config tidak valid.", true);
    connect(cfg.url, cfg.secret, cfg.telegram);
  };
  reader.readAsText(file);
}

// ---------------- Navigasi ----------------
const PAGES = ["home", "history", "stats", "money", "settings"];
function pageFromHash() {
  const h = (location.hash || "").replace("#", "");
  return PAGES.includes(h) ? h : "home";
}
function goTo(page, { replace = false } = {}) {
  if (!PAGES.includes(page)) page = "home";
  if (location.hash.replace("#", "") !== page) {
    if (!replace) {
      location.hash = page; // → hashchange → showPage (tombol Back HP/browser ikut berfungsi)
      return;
    }
    history.replaceState(history.state, "", "#" + page);
  }
  showPage(page);
}
function showPage(page) {
  state.page = page;
  document.querySelectorAll(".page").forEach((p) => p.classList.toggle("hidden", p.dataset.page !== page));
  const tab = page === "history" ? "home" : page;
  document.querySelectorAll(".nav-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  // Sidebar PC punya menu Riwayat sendiri, jadi cocokkan persis dengan halaman
  document.querySelectorAll(".side-link").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === page);
    if (b.dataset.tab === page) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  document.getElementById("downloadMenu").classList.add("hidden");
  window.scrollTo(0, 0);
  renderPage(page);
}

function changeMonth(delta) {
  state.month = addMonths(state.month, delta);
  renderPage(state.page);
}

function handleShortcut() {
  const params = new URLSearchParams(location.search);
  const aksi = params.get("aksi");
  if (!aksi && !params.has("sumber")) return;
  history.replaceState(history.state, "", location.pathname + location.hash);
  if (aksi === "suara") openVoiceForm();
  else if (aksi === "keluar") openTxForm({ tipe: "Pengeluaran" });
  else if (aksi === "masuk") openTxForm({ tipe: "Pemasukan" });
  else if (aksi === "transfer") openTransferForm();
}

// ---------------- Event (delegasi) ----------------
function bindEvents() {
  // Setup
  document.querySelectorAll("[data-setup-tab]").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll("[data-setup-tab]").forEach((x) => x.classList.toggle("active", x === t));
      document.querySelectorAll(".setup-tab").forEach((b) => b.classList.add("hidden"));
      document.getElementById("setup-" + t.dataset.setupTab).classList.remove("hidden");
    });
  });
  const dz = document.getElementById("dropzone");
  document.getElementById("fileInput").addEventListener("change", (e) => handleFile(e.target.files[0]));
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  document.getElementById("pasteBtn").addEventListener("click", () => {
    const cfg = parseConfig(document.getElementById("pasteArea").value);
    if (!cfg) return setupMsg("JSON tidak valid / tidak ada webhookUrl.", true);
    connect(cfg.url, cfg.secret, cfg.telegram);
  });
  document.getElementById("manualBtn").addEventListener("click", () => {
    connect(document.getElementById("manualUrl").value, document.getElementById("manualSecret").value);
  });

  // Header & navigasi
  document.getElementById("refreshBtn").addEventListener("click", () => loadAll());
  document.getElementById("hideBtn").addEventListener("click", toggleHide);
  const openWalletsBtn = document.getElementById("openWalletsBtn");
  if (openWalletsBtn) openWalletsBtn.addEventListener("click", () => openWalletSheet());
  const statsConfigBtn = document.getElementById("statsConfigBtn");
  if (statsConfigBtn) statsConfigBtn.addEventListener("click", () => openStatsConfigSheet());
  const heatmapClearBtn = document.getElementById("heatmapClearBtn");
  if (heatmapClearBtn) heatmapClearBtn.addEventListener("click", () => { state.statsSelectedDay = null; renderStatsHeatmap(); });
  document.getElementById("fabAdd").addEventListener("click", openAddMenu);
  document.getElementById("downloadBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("downloadMenu").classList.toggle("hidden");
  });
  document.getElementById("homeSearch").addEventListener("input", (e) => { state.home.q = e.target.value; renderHome(); });
  document.getElementById("histSearch").addEventListener("input", (e) => { state.hist.q = e.target.value; renderHistory(); });

  document.addEventListener("click", (e) => {
    const target = e.target;
    if (!target.closest("#downloadMenu") && !target.closest("#downloadBtn")) {
      document.getElementById("downloadMenu").classList.add("hidden");
    }
    const el = target.closest("[data-tab],[data-goto],[data-tx],[data-open-wallet],[data-debt-tab],[data-debt-filter],[data-debt-pay],[data-debt-history],[data-debt-edit],[data-debt-del],[data-filter-kind],[data-month],[data-budget-month],[data-budget],[data-goal-edit],[data-goal-tabung],[data-recurring],[data-download],[data-theme-pick],[data-action],[data-sheet-close],[data-gran],[data-stats-tab],[data-chart-type],[data-cat-kind],[data-heat-day],[data-add]");
    if (!el) return;
    const d = el.dataset;
    if (d.sheetClose !== undefined) return closeSheet();
    if (d.add) {
      if (d.add === "voice") return openVoiceForm();
      if (d.add === "transfer") return openTransferForm();
      return openTxForm({ tipe: d.add });
    }
    if (d.openWallet !== undefined) return openWalletSheet(d.openWallet);
    if (d.debtTab) { state.debtTab = d.debtTab; return renderDebts(); }
    if (d.debtFilter) { state.debtFilter = d.debtFilter; return renderDebts(); }
    if (d.debtPay) { const item = state.debts.find((x) => x.id === d.debtPay); return item && openPayDebtForm(item); }
    if (d.debtHistory) return openDebtHistorySheet(d.debtHistory);
    if (d.debtEdit) { const item = state.debts.find((x) => x.id === d.debtEdit); return item && openDebtForm(item); }
    if (d.debtDel) { const item = state.debts.find((x) => String(x.id ?? "").trim() === String(d.debtDel).trim()); return item && deleteDebtWithConfirm(item, el); }
    if (d.tab) return goTo(d.tab);
    if (d.goto) return goTo(d.goto);
    if (d.tx) return openTxById(d.tx);
    if (d.filterKind) {
      const scope = el.closest("#histFilters") ? state.hist : state.home;
      if (d.filterKind === "tipe") scope.tipe = scope.tipe === d.filterValue ? null : d.filterValue;
      else scope.akun = sameText(scope.akun, d.filterValue) ? null : d.filterValue;
      return el.closest("#histFilters") ? renderHistory() : renderHome();
    }
    if (d.month) return changeMonth(Number(d.month));
    if (d.budgetMonth) { state.budgetMonth = addMonths(state.budgetMonth, Number(d.budgetMonth)); return renderBudgets(); }
    if (d.budget) { const b = state.budgets.find((x) => x.id === d.budget); return b && openBudgetForm(b); }
    if (d.goalEdit) { const g = state.goals.find((x) => x.id === d.goalEdit); return g && openGoalForm(g); }
    if (d.goalTabung) { const g = state.goals.find((x) => x.id === d.goalTabung); return g && openTabungForm(g); }
    if (d.recurring) { const r = state.recurring.find((x) => x.id === d.recurring); return r && openRecurringForm(r); }
    if (d.download) {
      document.getElementById("downloadMenu").classList.add("hidden");
      return d.download === "pdf" ? downloadSettlementPdf() : downloadSettlementCsv();
    }
    if (d.themePick) return setTheme(d.themePick);
    if (d.gran) { state.gran = d.gran; return renderStats(); }
    if (d.statsTab) { state.statsTab = d.statsTab; return renderStats(); }
    if (d.chartType) { state.statsPrefs.useBarChart = d.chartType === "bar"; saveStatsPrefs(); return renderStats(); }
    if (d.catKind) { state.statsCatType = d.catKind; return renderStats(); }
    if (d.heatDay) { state.statsSelectedDay = state.statsSelectedDay === d.heatDay ? null : d.heatDay; return renderStatsHeatmap(); }
    switch (d.action) {
      case "add": return openAddMenu();
      case "add-debt": return openDebtForm(null, state.debtTab);
      case "add-budget": return openBudgetForm();
      case "add-goal": return openGoalForm();
      case "add-recurring": return openRecurringForm();
      case "copy-budgets": return copyBudgetsFromPrevMonth();
      case "install": return promptInstall();
      case "dismiss-install":
        localStorage.setItem(LS_INSTALL_DISMISS, "1");
        return updateInstallBanner();
      case "refresh": return loadAll();
      case "toggle-hide": return toggleHide();
      case "fullscreen": return toggleFullscreen();
      case "history-latest": {
        const last = latestTx();
        if (last) state.month = ymOf(last.tanggal);
        return goTo("history");
      }
      case "disconnect":
        return askConfirm("Putuskan koneksi & hapus konfigurasi dari browser ini?", { yes: "Ya, putuskan", emoji: "🔌" })
          .then((ok) => { if (ok) disconnect(); });
      default: return undefined;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheetOpen && document.getElementById("confirm").classList.contains("hidden")) closeSheet();
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-recurring][role=button], tr[data-tx]")) {
      e.preventDefault();
      e.target.click();
      return;
    }
    handleKeyboardShortcut(e);
  });
  document.addEventListener("fullscreenchange", updateFullscreenBtn);
  // Pindah antara tampilan HP ↔ PC (mis. jendela diperbesar) → gambar ulang tata letak
  const onLayoutChange = () => { if (state.url) render(); };
  if (desktopQuery.addEventListener) desktopQuery.addEventListener("change", onLayoutChange);
  else if (desktopQuery.addListener) desktopQuery.addListener(onLayoutChange);

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.recurringToggle) return toggleRecurring(t.dataset.recurringToggle, t.checked, t);
    if (t.dataset && t.dataset.setting === "hide") {
      state.hide = t.checked;
      localStorage.setItem(LS_HIDE, state.hide ? "1" : "0");
      return render();
    }
    if (t.dataset && t.dataset.setting === "notify") {
      state.notify = t.checked;
      localStorage.setItem(LS_NOTIFY, state.notify ? "1" : "0");
      return toast(state.notify ? "Notifikasi Telegram aktif 🔔" : "Notifikasi Telegram dimatikan 🔕");
    }
    return undefined;
  });

  window.addEventListener("hashchange", () => showPage(pageFromHash()));
  window.addEventListener("popstate", () => { if (sheetOpen) hideSheet(); });
  window.addEventListener("online", () => { updateOnline(); if (state.url) loadAll({ silent: true }); });
  window.addEventListener("offline", updateOnline);
  document.addEventListener("visibilitychange", () => {
    // Seperti aplikasi: saat kembali dibuka, sinkron ulang diam-diam (maks tiap 1 menit)
    if (document.visibilityState === "visible" && state.url && Date.now() - state.loadedAt > 60000) loadAll({ silent: true });
  });
  if (darkQuery.addEventListener) darkQuery.addEventListener("change", () => { if (state.theme === "system") { applyTheme(); if (state.page === "stats") renderStats(); } });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    updateInstallBanner();
    if (state.page === "settings") renderSettings();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    updateInstallBanner();
    toast("Catalyst terpasang 🎉");
  });
}

// ---------------- Init ----------------
function init() {
  applyTheme();
  bindEvents();
  updateOnline();

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* tanpa SW aplikasi tetap jalan */ });
  }

  const saved = localStorage.getItem(LS_KEY);
  if (!saved) { showSetup(); return; }
  try {
    const cfg = JSON.parse(saved);
    if (!cfg || !cfg.url) throw new Error("config kosong");
    state.url = cfg.url;
    state.secret = cfg.secret || "";
    state.telegram = cfg.telegram && cfg.telegram.token && cfg.telegram.chatId ? cfg.telegram : null;
  } catch (e) {
    showSetup();
    return;
  }

  const cache = loadCache();
  if (cache) {
    applyData(cache);
    state.loadedAt = cache.at || 0;
    setStatus("Data tersimpan • " + new Date(cache.at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));
  }
  showApp();
  render();
  updateInstallBanner();
  const loading = loadAll({ silent: !!cache });
  // Shortcut ikon (Catat Pengeluaran, dll): tunggu data kalau belum ada cache, supaya saldo akurat
  if (cache) handleShortcut(); else loading.then(handleShortcut);
}

document.addEventListener("DOMContentLoaded", init);
