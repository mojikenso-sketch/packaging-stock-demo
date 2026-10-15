/* ═══ Packaging Stock Control — app.js (DEMO · GitHub Pages + Google Apps Script) ═══
 * บริษัท ตัวอย่าง อินดัสทรี จำกัด (Demo Co., Ltd.)
 * Data comes from the Apps Script Web App set in docs/config.js. */
'use strict';

function normalizePayload(payload) {
  if (Array.isArray(payload.dailyLedgers)) payload.dailyLedgers = {};
  if (!payload.dailyReady || typeof payload.dailyReady !== 'object') payload.dailyReady = {};
  if (!payload.masterLists || typeof payload.masterLists !== 'object') payload.masterLists = {};
  const shelfRows = Array.isArray(payload.masterLists.supplierShelfLives) ? payload.masterLists.supplierShelfLives : [];
  const normalizedShelfRows = [];
  const shelfNames = new Set();
  for (const row of shelfRows) {
    const supplier = String(row?.supplier || row?.name || '').trim();
    if (!supplier || shelfNames.has(supplier)) continue;
    shelfNames.add(supplier);
    normalizedShelfRows.push({supplier, shelfLife: String(row?.shelfLife || '').trim()});
  }
  for (const value of (Array.isArray(payload.masterLists.suppliers) ? payload.masterLists.suppliers : [])) {
    const supplier = String(value || '').trim();
    if (!supplier || shelfNames.has(supplier)) continue;
    shelfNames.add(supplier);
    normalizedShelfRows.push({supplier, shelfLife: ''});
  }
  payload.masterLists.supplierShelfLives = normalizedShelfRows;
  payload.masterLists.suppliers = normalizedShelfRows.map(row => row.supplier);
  payload.masterLists.units = [...new Set((Array.isArray(payload.masterLists.units) ? payload.masterLists.units : ['ใบ']).map(v => String(v || '').trim()).filter(Boolean))];
  // Keep the item/unit values from the Settings source before the latest
  // daily-ledger rows replace payload.items for the operational screens.
  if (!Array.isArray(payload.settingsItems)) {
    payload.settingsItems = Array.isArray(payload.items)
      ? payload.items.map(item => ({...item}))
      : [];
  }

  // ตารางรายวันเป็นข้อมูลหลักของทุกหน้า
  const dates = Object.keys(payload.dailyLedgers || {}).sort();
  const payloadToday = String(payload.today || '').trim();
  // Do not let a future/prepared ledger replace today's rows. The dashboard
  // resolves its data date using the same rule in latestDailyDate().
  const latest = payloadToday
    ? (dates.includes(payloadToday) ? payloadToday : dates.filter(date => date <= payloadToday).at(-1))
    : dates.at(-1);
  const rows = latest ? (payload.dailyLedgers[latest]?.rows || []) : [];
  if (rows.some(row => row.kind === 'item')) {
    payload.items = rows.filter(row => row.kind === 'item' && !row.legacyAggregate).map(row => ({
      ledgerId: String(row.id || ''),
      code: String(row.code || ''),
      name: String(row.name || ''),
      lot: String(row.lot || ''),
      locator: String(row.locator || ''),
      unit: String(row.unit || ''),
      supplier: String(row.supplier || ''),
      stock: Number(row.remaining || 0),
      min: Number(row.min || 0),
      max: Number(row.max || 0),
      safety: Number(row.safety || 0),
      stockNote: String(row.stockNote || ''),
    }));
  }
  return payload;
}

function emptyPayload() {
  const d = new Date();
  const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return {
    items: [], transactions: [], deliveries: [], deliveriesTotal: 0,
    config: {leadTimeDays: 7, usageWindowDays: 30, lowStockDays: 7},
    dailyLedgers: {}, dailyReady: {}, areas: [], masterLists: {}, today,
  };
}
// Loaded from the Apps Script API in boot() — {items, transactions, deliveries, config, today, demo}
let S = normalizePayload(emptyPayload());
let BOOTED = false;

function masterList(kind) {
  return Array.isArray(S.masterLists?.[kind]) ? S.masterLists[kind] : [];
}

/* ─── Utilities ─────────────────────────────────────────────────────────── */
const $  = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Safe to drop into a single-quoted inline handler attribute: escape JS string
// metacharacters first (code can come from item_add — arbitrary text), then
// HTML-escape the result since that's what the browser attribute parser sees.
const escJs = s => esc(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const fmt = n => Number(n || 0).toLocaleString('en-US');
// จำนวนรวมของการเบิกแสดงเป็นจำนวนชิ้นเต็ม โดยไม่แก้ค่าดิบในประวัติ
const fmtQtyTotal = n => Math.round(Number(n || 0)).toLocaleString('en-US');
const fmt1 = n => Number(n || 0).toLocaleString('en-US', {maximumFractionDigits: 1});

const TH_DAYS  = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
const TH_DAYS_S= ['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'];
const TH_MONTHS_S = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

function dateObj(iso) { const [y,m,d] = iso.split('-').map(Number); return new Date(y, m-1, d); }
function isoDate(d)   { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function addDays(iso, n) { const d = dateObj(iso); d.setDate(d.getDate()+n); return isoDate(d); }
function thDate(iso, withDay = false) {
  if (!iso) return '-';
  const d = dateObj(iso);
  const s = d.getDate() + ' ' + TH_MONTHS_S[d.getMonth()] + ' ' + (d.getFullYear()+543).toString().slice(-2);
  return withDay ? TH_DAYS_S[d.getDay()] + ' ' + s : s;
}

// Dates are stored as ISO (YYYY-MM-DD), but are shown to users as
// day/month/year. Native date controls follow the browser locale, which can
// show month/day/year, so the visible field is text and the hidden picker
// remains ISO-only for the application logic.
function dateInputDisplay(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(iso || '').trim();
}

function parseDateInput(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
      ? text : '';
  }
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(text);
  if (!match) return '';
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (match[3].length === 2) year += 2000;
  if (year >= 2400 && year <= 2700) year -= 543;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return isoDate(date);
}

function dateInputError(value, label, required = false) {
  const text = String(value || '').trim();
  if (!text) return required ? `${label} ไม่ถูกต้อง — กรุณากรอก วว/ดด/ค.ศ.` : '';
  const iso = parseDateInput(text);
  if (!iso) return `${label} ไม่ถูกต้อง — ใช้รูปแบบ วว/ดด/ค.ศ. เช่น 01/09/2026`;
  return dateFieldError(iso, label);
}

function dateInputHtml(id, iso, inputClass = '', extra = '', pickerExtra = '') {
  const normalized = parseDateInput(iso);
  const idAttr = id ? ` id="${esc(id)}"` : '';
  return `<div class="date-input-wrap">
    <input${idAttr} type="text" class="date-text-input ${esc(inputClass)}"
      value="${esc(dateInputDisplay(normalized))}" placeholder="วว/ดด/ค.ศ."
      inputmode="numeric" autocomplete="off" ${extra}>
    <input type="date" class="date-picker-native" lang="en-GB" value="${esc(normalized)}"
      tabindex="-1" aria-hidden="true" ${pickerExtra}>
    <button type="button" class="date-picker-btn" aria-label="เปิดปฏิทินเลือกวันที่" title="เลือกวันที่">📅</button>
  </div>`;
}

function bindDateInputPickers(root = document) {
  $$('.date-input-wrap', root).forEach(wrap => {
    if (wrap.dataset.datePickerBound === '1') return;
    wrap.dataset.datePickerBound = '1';
    const visible = $('.date-text-input', wrap);
    const picker = $('.date-picker-native', wrap);
    const button = $('.date-picker-btn', wrap);
    if (!visible || !picker) return;
    visible.addEventListener('input', () => {
      const iso = parseDateInput(visible.value);
      picker.value = iso;
    });
    picker.addEventListener('change', () => {
      visible.value = dateInputDisplay(picker.value);
      visible.dispatchEvent(new Event('input', {bubbles: true}));
      visible.dispatchEvent(new Event('change', {bubbles: false}));
    });
    button?.addEventListener('click', () => {
      if (typeof picker.showPicker === 'function') picker.showPicker();
      else picker.focus();
    });
  });
}
const TXN_LABEL = {withdraw: 'เบิกจ่าย', receive: 'รับเข้า', return: 'คืนของ', adjust: 'ปรับยอด'};
const TXN_SIGN  = {withdraw: -1, receive: 1, return: 1, adjust: 1};
const LEDGER_MOVEMENTS = [
  {field: 'receive',          type: 'receive',  label: 'รับเข้า'},
  {field: 'returnPackaging',  type: 'return',   label: 'รับคืนบรรจุ'},
  {field: 'returnSupplier',   type: 'return',   label: 'รับคืน Supplier'},
  {field: 'qaIssue',          type: 'withdraw', label: 'จ่าย QA/ตัวอย่าง'},
  {field: 'sendBackSupplier', type: 'withdraw', label: 'ส่งคืน Supplier'},
  {field: 'issuePackaging',   type: 'withdraw', label: 'จ่ายบรรจุ'},
];

/* ─── API ───────────────────────────────────────────────────────────────── */
// Google Apps Script Web App: GET for reads, POST with a text/plain JSON body
// for writes (a "simple" request — no CORS preflight, which GAS cannot answer).
const API_URL = String(window.DEMO_CONFIG?.API_URL || '').trim();
const API_READY = /^https:\/\/script\.google(usercontent)?\.com\//.test(API_URL) && !API_URL.includes('PASTE_DEPLOYED');

async function apiCall(action, data = {}, method = 'POST') {
  if (!API_READY) throw new Error('ยังไม่ได้ตั้งค่า API');
  let res;
  try {
    if (method === 'GET') {
      const qs = new URLSearchParams({action, ...data, _: String(Date.now())});
      res = await fetch(`${API_URL}?${qs}`, {method: 'GET', cache: 'no-store', redirect: 'follow'});
    } else {
      res = await fetch(API_URL, {
        method: 'POST', redirect: 'follow',
        headers: {'Content-Type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({action, ...data}),
      });
    }
  } catch (e) {
    return {ok: false, error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่'};
  }
  return res.json().catch(() => ({ok: false, error: 'การเชื่อมต่อผิดพลาด'}));
}

async function api(action, data = {}) {
  const j = await apiCall(action, data, 'POST');
  if (!j.ok) throw new Error(j.error || 'เกิดข้อผิดพลาด');
  if (j.payload) {
    S = normalizePayload(j.payload);
    window.DemoBanner?.update(j.payload.demo);
  }
  return j;
}

function toast(msg, cls = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + cls;
  t.innerHTML = (cls === 'err' ? '⚠️ ' : cls === 'ok-t' ? '✅ ' : 'ℹ️ ') + esc(msg);
  $('#toast-zone').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); }, 3200);
}

/* ─── Demo: full-version (premium) features ─────────────────────────────── */
// Locked features keep their buttons visible with a 🔒 and open one small
// "มีในเวอร์ชันเต็ม" box. The Apps Script API refuses the same actions too.
const DEMO_LOCK = '🔒';
const DEMO_PREMIUM_MESSAGE = 'ฟีเจอร์นี้มีในเวอร์ชันเต็ม';
function demoContactText() {
  return String(window.DEMO_CONTACT || 'สนใจใช้งานจริง ติดต่อผู้ขาย');
}
function demoPremium(feature = '') {
  let box = document.getElementById('demo-premium');
  if (!box) {
    box = document.createElement('div');
    box.id = 'demo-premium';
    document.body.appendChild(box);
  }
  box.className = 'demo-premium';
  box.innerHTML = `<div class="demo-premium-card" role="dialog" aria-modal="true" aria-label="${esc(DEMO_PREMIUM_MESSAGE)}">
    <div class="demo-premium-ic">${DEMO_LOCK}</div>
    <b>${esc(DEMO_PREMIUM_MESSAGE)}</b>
    ${feature ? `<div class="demo-premium-feature">${esc(feature)}</div>` : ''}
    <div class="demo-premium-contact">— ${esc(demoContactText())}</div>
    <button type="button" class="btn btn-primary btn-sm" onclick="A.closePremium()">ตกลง</button>
  </div>`;
  box.hidden = false;
  box.onclick = e => { if (e.target === box) A.closePremium(); };
  return false;
}
// The demo works on today's table only (server rule: DEMO_TODAY_ONLY_ACTIONS).
function demoEditableDate(date = txnDate) {
  return Boolean(date) && date === String(S.today || '');
}
function dailyEditActive() {
  return dailyEditMode && demoEditableDate();
}

/* ─── Derived data ──────────────────────────────────────────────────────── */
function latestDailyDate() {
  const dates = Object.keys(S.dailyLedgers || {}).sort();
  const today = String(S.today || '');
  if (today && Object.prototype.hasOwnProperty.call(S.dailyLedgers || {}, today)) return today;
  const datesUpToToday = today ? dates.filter(date => date <= today) : dates;
  return datesUpToToday.at(-1) || dates.at(-1) || '';
}

function itemIdentity(item) {
  return String(item?.ledgerId || item?.code || '');
}

function itemBy(identity) {
  const key = String(identity || '');
  return S.items.find(i => String(i.ledgerId || '') === key) ||
    S.items.find(i => String(i.code || '') === key);
}

let _ledgerTxnCache = null, _ledgerTxnCacheFor = null;
function operationalTransactions() {
  if (_ledgerTxnCacheFor === S) return _ledgerTxnCache;

  const events = [];
  const ledgers = S.dailyLedgers || {};
  const dates = Object.keys(ledgers).sort();
  for (const date of dates) {
    for (const row of (ledgers[date]?.rows || [])) {
      if (row.kind !== 'item') continue;
      for (const movement of LEDGER_MOVEMENTS) {
        const qty = Number(row[movement.field] || 0);
        if (qty <= 0) continue;
        events.push({
          id: `ledger|${date}|${row.id}|${movement.field}`,
          source: 'daily-ledger',
          date,
          created: ledgers[date]?.updated || '',
          type: movement.type,
          label: movement.label,
          field: movement.field,
          itemId: String(row.id || ''),
          code: String(row.code || ''),
          itemName: String(row.name || ''),
          lot: String(row.lot || ''),
          unit: String(row.unit || ''),
          qty,
          remaining: Number(row.remaining || 0),
          person: '',
          dept: '',
          ref: '',
          note: 'บันทึกจากตารางรายวัน',
        });
      }
    }
  }

  // เก็บประวัติระบบเดิมเฉพาะก่อนวันเริ่มใช้ตารางรายวัน เพื่อไม่ให้นับซ้ำ
  const firstLedgerDate = dates[0] || '';
  for (const txn of (S.transactions || [])) {
    if (!firstLedgerDate || txn.date < firstLedgerDate) {
      events.push({...txn, source: 'legacy'});
    }
  }

  _ledgerTxnCacheFor = S;
  _ledgerTxnCache = events;
  return events;
}

function txnsOf(identity) {
  const item = itemBy(identity);
  if (!item) return [];
  const key = itemIdentity(item);
  return operationalTransactions().filter(t =>
    t.itemId ? t.itemId === key : t.code === item.code
  );
}

// อัตราการใช้: เฉลี่ยจากรายการเบิกย้อนหลัง N วัน
// One O(transactions) pass builds a per-code index, reused across every item
// on a render — usageStats() itself is then O(1). Cache keyed on the S
// reference so it rebuilds automatically whenever api() swaps in a new payload.
let _usageIdx = null, _usageIdxFor = null;
function buildUsageIndex() {
  const win = S.config.usageWindowDays;
  const asOf = latestDailyDate() || S.today;
  const from = addDays(asOf, -win + 1);
  const from7 = addDays(asOf, -6);
  const idx = new Map();
  for (const t of operationalTransactions()) {
    if (t.type !== 'withdraw') continue;
    const key = t.itemId || t.code;
    let e = idx.get(key);
    if (!e) { e = {total: 0, total7: 0, days: new Set()}; idx.set(key, e); }
    if (t.date >= from && t.date <= asOf) { e.total += t.qty; e.days.add(t.date); }
    if (t.date >= from7 && t.date <= asOf) e.total7 += t.qty;
  }
  return idx;
}
function usageStats(identity) {
  if (_usageIdxFor !== S) { _usageIdx = buildUsageIndex(); _usageIdxFor = S; }
  const it = itemBy(identity);
  const key = it ? itemIdentity(it) : String(identity || '');
  const e = _usageIdx.get(key);
  const win = S.config.usageWindowDays;
  const total = e ? e.total : 0, total7 = e ? e.total7 : 0;
  const avgDay  = total / win;
  const avgDay7 = total7 / 7;
  const stock = it ? it.stock : 0;
  const daysLeft = avgDay > 0 ? stock / avgDay : Infinity;
  return {total, total7, avgDay, avgDay7, daysLeft, activeDays: e ? e.days.size : 0};
}

// The dashboard can show stock per ITEM or per Lot. Keep every Lot identity so
// the combined view can aggregate stock and usage without losing Lot details.
function dashboardItemsByCode(items) {
  const grouped = new Map();
  for (const item of items) {
    const code = String(item.code || itemIdentity(item) || '');
    if (!code) continue;
    let group = grouped.get(code);
    if (!group) {
      group = {
        ...item,
        code,
        stock: 0,
        min: 0,
        max: 0,
        safety: 0,
        identities: [],
        lots: [],
        stockNotes: [],
        stockStatuses: [],
      };
      grouped.set(code, group);
    }
    group.stock += Number(item.stock || 0);
    // Min / Safety / Max belong to the ITEM, not to each Lot. Lots are
    // separate stock buckets, so never add these thresholds once per Lot.
    // Prefer the first configured value and ignore blank/zero duplicates.
    if (group.min <= 0 && Number(item.min || 0) > 0) group.min = Number(item.min);
    if (group.max <= 0 && Number(item.max || 0) > 0) group.max = Number(item.max);
    if (group.safety <= 0 && Number(item.safety || 0) > 0) group.safety = Number(item.safety);
    const identity = itemIdentity(item);
    if (identity && !group.identities.includes(identity)) group.identities.push(identity);
    const lot = String(item.lot || '').trim();
    if (lot && !group.lots.includes(lot)) group.lots.push(lot);
    const stockStatus = itemStatus(item).key;
    if (stockStatus && !group.stockStatuses.includes(stockStatus)) group.stockStatuses.push(stockStatus);
    const stockNote = String(item.stockNote || '').trim();
    if (stockNote && !group.stockNotes.includes(stockNote)) group.stockNotes.push(stockNote);
  }
  for (const group of grouped.values()) group.stockNote = group.stockNotes.join(' · ');
  return [...grouped.values()];
}

function usageStatsForDashboardGroup(group) {
  if (_usageIdxFor !== S) { _usageIdx = buildUsageIndex(); _usageIdxFor = S; }
  const keys = [...new Set([...(group.identities || []), String(group.code || '')].filter(Boolean))];
  const days = new Set();
  let total = 0;
  let total7 = 0;
  for (const key of keys) {
    const entry = _usageIdx.get(key);
    if (!entry) continue;
    total += entry.total;
    total7 += entry.total7;
    entry.days.forEach(day => days.add(day));
  }
  const win = S.config.usageWindowDays;
  const avgDay = total / win;
  return {
    total,
    total7,
    avgDay,
    avgDay7: total7 / 7,
    daysLeft: avgDay > 0 ? Number(group.stock || 0) / avgDay : Infinity,
    activeDays: days.size,
  };
}

// สถานะสต๊อก
function itemStatus(it) {
  if (it.max > 0 && it.stock > it.max)  return {key: 'over', label: 'เกิน Max',   cls: 'over'};
  if (it.stock <= 0)                    return {key: 'crit', label: 'หมดสต๊อก',  cls: 'crit'};
  if (it.min > 0 && it.stock < it.min)  return {key: 'low',  label: 'ต่ำกว่า Min', cls: 'low'};
  return {key: 'ok', label: 'ปกติ', cls: 'ok'};
}

// The dashboard status is evaluated at ITEM level, even when the table is
// displayed one Lot per row. This prevents a single Lot from being marked
// "ต่ำกว่า Min" while the total stock for that ITEM is actually sufficient.
function dashboardStockStatus(item, statusByCode) {
  const code = String(item?.code || itemIdentity(item) || '');
  return statusByCode?.get(code) || itemStatus(item);
}

function dashboardStockStatusRank(item, statusByCode) {
  const status = dashboardStockStatus(item, statusByCode);
  return ({crit: 0, low: 1, over: 2, ok: 3})[status.key] ?? 3;
}

function dashboardStockType(item) {
  const name = String(item?.name || '').trim().toLowerCase();
  const rules = [
    ['ฝา', /^(ฝา|cap\b)|จุก|ซีลฝา/],
    ['ขวด', /^ขวด/],
    ['กล่อง', /^กล่อง/],
    ['ลัง', /^ลัง/],
    ['ฉลาก', /^(ฉลาก|สติกเกอร์|บาร์โค๊ด)/],
    ['ถุง', /^ถุง/],
    ['ถัง', /^ถัง/],
    ['ม้วนฟิล์ม', /^ม้วนฟิล์ม/],
    ['พาเลต', /^พาเลต/],
    ['ไส้ร่อง', /^ไส้ร่อง/],
  ];
  return rules.find(([, pattern]) => pattern.test(name))?.[0] || 'อื่นๆ';
}

function deliveriesOf(code, from, to) {
  return S.deliveries.filter(d => d.code === code && d.date >= from && d.date <= to);
}

/* ─── Router ────────────────────────────────────────────────────────────── */
const VIEWS = {};
let currentView = 'dash';

function show(view) {
  if (!BOOTED) return;
  if (currentView === 'txn' && view !== 'txn' && dailyDirty.size) {
    toast('กำลังบันทึกอัตโนมัติ กรุณารอสักครู่', 'err');
    return;
  }
  currentView = view;
  $$('.nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  for (const v of Object.keys(VIEWS)) {
    const panel = $('#view-' + v);
    panel.style.display = v === view ? '' : 'none';
    // ตารางแต่ละแท็บมี DOM หลายพัน nodes; ไม่เก็บหน้าที่ซ่อนไว้เพื่อลดอาการหน่วง
    if (v !== view) panel.replaceChildren();
  }
  VIEWS[view]();
  const el = $('#view-' + view);
  el.classList.remove('view-anim'); void el.offsetWidth; el.classList.add('view-anim');
  window.scrollTo(0, 0);
}
function rerender() { VIEWS[currentView](); updateNavBadge(); }

function updateNavBadge() {
  const n = S.items.filter(i => { const s = itemStatus(i); return s.key === 'crit' || s.key === 'low' || s.key === 'over'; }).length;
  const el = $('#nav-alert-n');
  if (!el) return;
  el.style.display = n ? '' : 'none';
  el.textContent = n;

}

/* ─── Shared: item picker ───────────────────────────────────────────────── */
function pickerHTML(id, placeholder = 'พิมพ์รหัสหรือชื่อสินค้า…') {
  return `<div class="picker">
    <input type="text" id="${id}" placeholder="${placeholder}" autocomplete="off">
    <input type="hidden" id="${id}-code">
    <div class="drop" id="${id}-drop" style="display:none"></div>
  </div>`;
}
function bindPicker(id, onSelect) {
  const inp = $('#' + id), drop = $('#' + id + '-drop'), hid = $('#' + id + '-code');
  function search() {
    const q = inp.value.trim().toLowerCase();
    hid.value = '';
    if (q.length < 1) { drop.style.display = 'none'; return; }
    const hits = S.items.filter(i => i.code.includes(q) || i.name.toLowerCase().includes(q)).slice(0, 12);
    if (!hits.length) { drop.style.display = 'none'; return; }
    drop.innerHTML = hits.map(i =>
      `<div class="opt" data-key="${esc(itemIdentity(i))}"><div><b>${esc(i.name)}</b></div>
       <div class="o-stock"><span class="item-code">${esc(i.code)}</span> · คงเหลือ ${fmt(i.stock)} ${esc(i.unit)}</div></div>`).join('');
    drop.style.display = '';
    $$('.opt', drop).forEach(o => o.onclick = () => {
      const it = itemBy(o.dataset.key);
      inp.value = it.name;
      hid.value = it.code;
      drop.style.display = 'none';
      onSelect && onSelect(it);
    });
  }
  inp.oninput = search;
  inp.onfocus = search;
  inp.onblur = () => setTimeout(() => drop.style.display = 'none', 180);
}

// Searchable master-list input: a click or focus shows the available choices,
// while typing filters them.  The input remains editable so a genuinely new
// value can still be entered and saved with the product.
function bindMasterPicker(id, values) {
  const inp = $('#' + id), drop = $('#' + id + '-drop');
  if (!inp || !drop) return;
  const choices = [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
  const render = (showAll = false) => {
    const q = showAll ? '' : inp.value.trim().toLowerCase();
    const hits = choices.filter(value => !q || value.toLowerCase().includes(q)).slice(0, 30);
    if (!hits.length) {
      drop.innerHTML = choices.length ? '<div class="master-picker-empty">ไม่พบรายการที่ค้นหา — พิมพ์ค่าใหม่ได้</div>' : '<div class="master-picker-empty">ยังไม่มีรายการตั้งต้น — พิมพ์ค่าใหม่ได้</div>';
      drop.style.display = '';
      return;
    }
    drop.innerHTML = hits.map(value => `<button type="button" class="master-picker-option" data-value="${esc(value)}">${esc(value)}</button>`).join('');
    drop.style.display = '';
    $$('.master-picker-option', drop).forEach(option => option.onclick = () => {
      inp.value = option.dataset.value || '';
      drop.style.display = 'none';
      inp.dispatchEvent(new Event('change', {bubbles: true}));
    });
  };
  inp.oninput = () => render(false);
  inp.onfocus = () => render(true);
  inp.onblur = () => setTimeout(() => { drop.style.display = 'none'; }, 180);
}

function lvlBarHTML(it) {
  const cap = it.max > 0 ? it.max : Math.max(it.stock, it.min, 1) * 1.3;
  const pct = Math.min(100, Math.round(it.stock / cap * 100));
  const st = itemStatus(it);
  const color = {ok: 'var(--green)', low: 'var(--amber)', crit: 'var(--red)', over: 'var(--purple)'}[st.key];
  return `<div class="lvl"><div class="bar"><div class="fill" style="width:${Math.max(pct, it.stock > 0 ? 3 : 0)}%;background:${color}"></div></div>
    <div class="cap"><span>Min ${it.min ? fmt(it.min) : '-'}</span><span>Safety ${it.safety ? fmt(it.safety) : '-'}</span><span>Max ${it.max ? fmt(it.max) : '-'}</span></div></div>`;
}

const DASHBOARD_AREA = '1100-คลังบรรจุภัณฑ์'; // พื้นที่หลักที่ใช้คำนวณ KPI

function dashboardItemsForArea(items, date, areaName) {
  const ledger = S.dailyLedgers?.[date];
  if (!ledger) return [];
  const areaItemIds = new Set();
  let currentArea = '__main__';
  for (const row of ledger.rows || []) {
    if (row.kind === 'section') {
      currentArea = String(row.title || '').trim() || '__main__';
    } else if (row.kind === 'item' && currentArea === areaName && row.id) {
      areaItemIds.add(String(row.id));
    }
  }
  return (items || []).filter(item => areaItemIds.has(String(item.ledgerId || '')));
}

/* ═══ VIEW: Dashboard ═══════════════════════════════════════════════════ */
let dashFilter = {q: '', status: 'all'};
const DASH_PAGE = 150;
let dashShown = DASH_PAGE;
const dashNoteSaveTimers = new Map();
const dashNoteSaveVersions = new Map();

function queueDashboardStockNoteSave(ids, value, input, delay = 650) {
  const rowIds = [...new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean))];
  if (!rowIds.length) return;
  const key = rowIds.slice().sort().join('|');
  const version = (dashNoteSaveVersions.get(key) || 0) + 1;
  dashNoteSaveVersions.set(key, version);
  clearTimeout(dashNoteSaveTimers.get(key));
  dashNoteSaveTimers.set(key, setTimeout(async () => {
    dashNoteSaveTimers.delete(key);
    if (dashNoteSaveVersions.get(key) !== version) return;
    const date = latestDailyDate();
    if (!date) return;
    try {
      await api('daily_ledger_save', {
        date,
        rows: JSON.stringify(rowIds.map(id => ({id, stockNote: String(value || '').trim()}))),
      });
      if (dashNoteSaveVersions.get(key) !== version) return;
      input?.classList.remove('saving', 'save-error');
      input?.classList.add('saved');
      setTimeout(() => input?.classList.remove('saved'), 900);
    } catch (error) {
      if (dashNoteSaveVersions.get(key) !== version) return;
      input?.classList.remove('saving');
      input?.classList.add('save-error');
      toast(error.message || 'บันทึกหมายเหตุไม่สำเร็จ', 'err');
    }
  }, delay));
  input?.classList.add('saving');
  input?.classList.remove('save-error');
}

function dashScrollToStockCard() {
  setTimeout(() => {
    const target = $('#dash-stock-card');
    if (!target) return;
    const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - 12);
    window.scrollTo(0, top);
    document.documentElement.scrollTop = top;
    document.body.scrollTop = top;
  }, 250);
}
const DASH_EXPIRY_GROUPS = [
  {key: 'packaging_primary', label: 'คลังบรรจุภัณฑ์'},
  {key: 'packaging_secondary', label: 'คลังบรรจุ'},
  {key: 'all', label: 'รวมทั้ง 2 คลัง'},
];
let dashExpiryGroup = 'packaging_primary';
VIEWS.dash = function () {
  const dataDate = latestDailyDate() || S.today;
  const items = dashboardItemsForArea(S.items, dataDate, DASHBOARD_AREA);
  const aggregateItems = dashboardItemsByCode(items);
  const aggregateStatusByCode = new Map(aggregateItems.map(item => [String(item.code), itemStatus(item)]));
  const statusForItem = item => dashboardStockStatus(item, aggregateStatusByCode);
  const stats = {crit: 0, low: 0, over: 0, ok: 0};
  aggregateItems.forEach(i => stats[itemStatus(i).key]++);
  const totalItems = aggregateItems.length;

  // รับเข้าตามกำหนด 7 วันข้างหน้า
  const wkEnd = addDays(S.today, 6);
  const areaCodes = new Set(items.map(item => String(item.code || '')).filter(Boolean));
  const upcoming = S.deliveries.filter(d => d.date >= S.today && d.date <= wkEnd && areaCodes.has(String(d.code || '')));

  const q = dashFilter.q.toLowerCase();
  // Filter by the aggregate ITEM status before rendering one combined row per ITEM.
  const stockSourceItems = dashFilter.status === 'all'
    ? items
    : items.filter(i => statusForItem(i).key === dashFilter.status);
  // Always show one combined row per ITEM. Status filtering is also based on
  // the combined stock/min/max values, so an individual Lot cannot create a
  // false low/over/out-of-stock result.
  const stockItems = dashboardItemsByCode(stockSourceItems);
  const stockLots = item => Array.isArray(item.lots) ? item.lots : [];
  let list = stockItems.filter(i => {
    if (!q) return true;
    const lots = stockLots(i).join(' ').toLowerCase();
    return i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q) || lots.includes(q);
  });
  list = [...list].sort((a, b) => {
    const statusA = dashboardStockStatus(a, aggregateStatusByCode);
    const statusB = dashboardStockStatus(b, aggregateStatusByCode);
    const statusDiff = dashboardStockStatusRank(a, aggregateStatusByCode) - dashboardStockStatusRank(b, aggregateStatusByCode);
    if (statusDiff) return statusDiff;
    // Group product types inside the normal-stock section only.
    if (statusA.key === 'ok' && statusB.key === 'ok') {
      const typeDiff = dashboardStockType(a).localeCompare(dashboardStockType(b), 'th');
      if (typeDiff) return typeDiff;
    }
    return String(a.name || '').localeCompare(String(b.name || ''), 'th')
      || String(a.code || '').localeCompare(String(b.code || ''), 'en', {numeric: true})
      || String(a.lot || '').localeCompare(String(b.lot || ''), 'en', {numeric: true});
  });
  const shownItems = list.slice(0, dashShown);

  // โดนัทสถานะสต๊อก
  const R = 76, C = 2 * Math.PI * R;
  const segs = [
    {key: 'crit', color: 'var(--red)',    label: 'หมดสต๊อก',   val: stats.crit},
    {key: 'low',  color: 'var(--amber)',  label: 'ต่ำกว่า Min', val: stats.low},
    {key: 'over', color: 'var(--purple)', label: 'เกิน Max',    val: stats.over},
    {key: 'ok',   color: 'var(--green)',  label: 'ปกติ',        val: stats.ok},
  ];
  let cum = 0;
  const arcsHTML = segs.filter(s => s.val > 0).map(s => {
    const len = s.val / (totalItems || 1) * C;
    const percent = totalItems ? s.val / totalItems * 100 : 0;
    const tooltip = `${s.label} · ${fmt(s.val)} รายการ · ${fmt1(percent)}%`;
    const html = `<circle cx="84" cy="84" r="${R}" stroke="${s.color}" stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}" stroke-dashoffset="${(-cum).toFixed(1)}" aria-label="${esc(tooltip)}"><title>${esc(tooltip)}</title></circle>`;
    cum += len;
    return html;
  }).join('');
  const legendHTML = segs.map(s => `<button class="lg-item" onclick="A.dashStatus('${s.key}')">
    <span class="lg-dot" style="background:${s.color}"></span>${s.label}<b>${fmt(s.val)}</b></button>`).join('');

  // แนวโน้มเบิกจ่าย 7 วันล่าสุด (รวมทุกสินค้า) — ใช้วางแผนกำลังคนประจำสัปดาห์
  const days7 = Array.from({length: 7}, (_, i) => addDays(dataDate, i - 6));
  const allMovements = operationalTransactions();
  const areaItemIds = new Set(items.map(item => itemIdentity(item)).filter(Boolean));
  const dayBreakdowns = days7.map(d => {
    const grouped = new Map();
    for (const txn of allMovements) {
      if (txn.type !== 'withdraw' || txn.date !== d) continue;
      if (txn.itemId
        ? !areaItemIds.has(String(txn.itemId))
        : !areaCodes.has(String(txn.code || ''))) continue;
      const key = String(txn.code || txn.itemId || 'ไม่ระบุรายการ');
      const item = itemBy(txn.itemId || txn.code);
      let entry = grouped.get(key);
      if (!entry) {
        entry = {
          code: String(txn.code || ''),
          name: String(txn.itemName || item?.name || txn.code || 'ไม่ระบุรายการ'),
          unit: String(txn.unit || item?.unit || ''),
          qty: 0,
          lots: new Set(),
        };
        grouped.set(key, entry);
      }
      entry.qty += Number(txn.qty || 0);
      if (txn.lot) entry.lots.add(String(txn.lot));
    }
    return [...grouped.values()].sort((a, b) => b.qty - a.qty);
  });
  const dayTotals = dayBreakdowns.map(rows => rows.reduce((sum, row) => sum + row.qty, 0));

  // Top 3 ใกล้หมดสต๊อก — lowest stock compared with Min (ITEM level)
  const lowTop3 = aggregateItems
    .filter(item => Number(item.min || 0) > 0)
    .map(item => ({item, st: itemStatus(item), ratio: Number(item.stock || 0) / Number(item.min), u: usageStatsForDashboardGroup(item)}))
    .sort((a, b) => a.ratio - b.ratio || a.u.daysLeft - b.u.daysLeft)
    .slice(0, 3);
  const maxDay7 = Math.max(...dayTotals, 1);

  // Expiry records from the latest daily ledger. Duplicate rows for the same
  // ITEM + Lot + expiry date are combined so the dashboard shows every lot once.
  const expiryByKey = new Map();
  let expiryArea = '__main__';
  for (const row of (S.dailyLedgers?.[dataDate]?.rows || [])) {
    if (row.kind === 'section') { expiryArea = String(row.title || '__main__'); continue; }
    if (row.kind !== 'item' || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.expiryDate || ''))) continue;
    const key = `${row.code}|${row.lot || '-'}|${row.expiryDate}`;
    let entry = expiryByKey.get(key);
    if (!entry) {
      const daysLeft = Math.ceil((dateObj(row.expiryDate) - dateObj(dataDate)) / 86400000);
      entry = {code: String(row.code || ''), name: String(row.name || ''), lot: String(row.lot || ''), expiryDate: row.expiryDate, remaining: 0, daysLeft, area: expiryArea};
      expiryByKey.set(key, entry);
    }
    entry.remaining += Number(row.remaining || 0);
  }
  const expiryRowsAll = [...expiryByKey.values()].sort((a, b) =>
    a.daysLeft - b.daysLeft || a.expiryDate.localeCompare(b.expiryDate) || a.code.localeCompare(b.code)
  );
  const expiryRows = dashExpiryGroup === 'all'
    ? expiryRowsAll
    : expiryRowsAll.filter(row => dailyAreaGroupKey(row.area) === dashExpiryGroup);
  const expiryExpiredRows = expiryRows.filter(x => x.daysLeft < 0);
  const expiryTop3 = expiryExpiredRows.slice(0, 3);
  const expiryBuckets = [
    {label: 'หมดอายุแล้ว', color: 'red', items: expiryRows.filter(x => x.daysLeft < 0)},
    {label: 'ภายใน 0–30 วัน', color: 'amber', items: expiryRows.filter(x => x.daysLeft >= 0 && x.daysLeft <= 30)},
    {label: '31–90 วัน', color: 'orange', items: expiryRows.filter(x => x.daysLeft > 30 && x.daysLeft <= 90)},
    {label: '91–180 วัน', color: 'blue', items: expiryRows.filter(x => x.daysLeft > 90 && x.daysLeft <= 180)},
    {label: 'เกิน 180 วัน', color: 'green', items: expiryRows.filter(x => x.daysLeft > 180)},
  ];
  expiryBuckets.forEach(bucket => { bucket.count = bucket.items.length; });
  const expiryBucketMax = Math.max(...expiryBuckets.map(x => x.count), 1);
  const expiryGraphHTML = expiryBuckets.map(bucket => {
    const tooltipItems = bucket.items.map(item => `<div class="expiry-tooltip-item">
      <b>${esc(item.name)}</b><span>ITEM ${esc(item.code)} · Lot ${esc(item.lot || '-')} · หมดอายุ ${thDate(item.expiryDate)}${item.daysLeft < 0 ? ` · เกิน ${fmt(Math.abs(item.daysLeft))} วัน` : item.daysLeft === 0 ? ' · วันนี้' : ` · เหลือ ${fmt(item.daysLeft)} วัน`}</span>
    </div>`).join('');
    return `<div class="expiry-chart-row">
    <div class="expiry-chart-label">${esc(bucket.label)}</div>
    <div class="expiry-chart-track"><div class="expiry-chart-bar ${bucket.color}" style="width:${Math.max(bucket.count ? 4 : 0, bucket.count / expiryBucketMax * 100)}%"></div>
      <div class="expiry-chart-tooltip"><strong>${esc(bucket.label)} · ${fmt(bucket.count)} รายการ</strong>${tooltipItems || '<span class="expiry-tooltip-empty">ไม่มีรายการ</span>'}</div>
    </div>
    <b class="expiry-chart-count">${fmt(bucket.count)}</b>
  </div>`;
  }).join('');

  $('#view-dash').innerHTML = `
    <div class="page-head"><div><h1>แดชบอร์ด</h1><p>KPI และสต๊อกคงเหลือเฉพาะพื้นที่ ${esc(DASHBOARD_AREA)} · วันที่ ${thDate(dataDate, true)}</p></div>
      <button class="btn btn-primary" onclick="show('txn')">＋ บันทึกเบิก/รับ</button></div>

    <div class="kpi-grid">
      <div class="kpi clickable" role="button" tabindex="0" onclick="A.dashAll()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();A.dashAll();}">
        <div class="kic blue">📦</div><div><div class="kv">${fmt(totalItems)}</div><div class="kl">รายการทั้งหมด</div></div></div>
      <div class="kpi clickable ${stats.crit ? 'k-alert' : ''}" onclick="A.dashStatus('crit')"><div class="kic red">🚨</div><div><div class="kv">${fmt(stats.crit)}</div><div class="kl">หมดสต๊อก</div></div></div>
      <div class="kpi clickable" onclick="A.dashStatus('low')"><div class="kic amber">⚠️</div><div><div class="kv">${fmt(stats.low)}</div><div class="kl">ต่ำกว่า Min</div></div></div>
      <div class="kpi clickable" onclick="A.dashStatus('over')"><div class="kic purple">🟣</div><div><div class="kv">${fmt(stats.over)}</div><div class="kl">เกิน Max</div></div></div>
      <div class="kpi clickable" onclick="A.dashStatus('ok')"><div class="kic green">✅</div><div><div class="kv">${fmt(stats.ok)}</div><div class="kl">ปกติ</div></div></div>
    </div>

    <div class="dash-expiry-filter" id="dash-expiry-filter">
      <span class="dash-expiry-filter-label">เลือกกลุ่มข้อมูลวันหมดอายุ</span>
      <div class="dash-expiry-filter-buttons" role="group" aria-label="เลือกกลุ่มคลังสำหรับข้อมูลวันหมดอายุ">
        ${DASH_EXPIRY_GROUPS.map(group => `<button type="button" class="dash-expiry-group-btn ${dashExpiryGroup === group.key ? 'active' : ''}"
          aria-pressed="${dashExpiryGroup === group.key ? 'true' : 'false'}"
          onclick="A.dashSetExpiryGroup('${escJs(group.key)}')">${esc(group.label)}</button>`).join('')}
      </div>
    </div>

    <div class="dash-expiry-layout">
      <div class="card dash-expiry-card">
        <h2>⏰ Top 3 ใกล้หมดอายุ <span class="sub">${esc(DASH_EXPIRY_GROUPS.find(group => group.key === dashExpiryGroup)?.label || 'รวมทั้ง 2 คลัง')} · เฉพาะรายการที่หมดอายุแล้ว · ทั้งหมด ${fmt(expiryExpiredRows.length)} รายการ</span></h2>
        <div class="dash-expiry-sort-note">เรียงจากจำนวนวันที่หมดอายุเกินกำหนดมากที่สุดก่อน · ไฮไลท์ 3 อันดับแรก</div>
        <div class="dash-expiry-list">
          ${expiryExpiredRows.length ? expiryExpiredRows.map((x, i) => {
            const daysText = `หมดอายุแล้ว ${fmt(Math.abs(x.daysLeft))} วัน`;
            const rankClass = i < 3 ? 'top3' : '';
            return `<div class="expiry-record ${rankClass}" onclick="A.openItem('${escJs(x.code)}')">
              <div class="expiry-rank ${i < 3 ? 'top3-rank' : ''}">${i < 3 ? `TOP ${i + 1}` : i + 1}</div>
              <div class="expiry-info"><div class="item-name">${esc(x.name)}</div><div class="u-meta">ITEM ${esc(x.code)} · Lot ${esc(x.lot || '-')} · คงเหลือ ${fmt(x.remaining)} · หมดอายุ ${thDate(x.expiryDate)} · ${esc(x.area === '__main__' ? 'รายการทั่วไป' : x.area)}</div></div>
              <div class="expiry-days expired"><b>${daysText}</b><span>เกินกำหนด</span></div>
            </div>`;
          }).join('') : '<div class="empty"><span class="e-ic">⏰</span>ยังไม่มีรายการที่หมดอายุแล้ว</div>'}
        </div>
      </div>
      <div class="card dash-expiry-chart-card">
        <h2>📊 ภาพรวมวันหมดอายุ <span class="sub">${esc(DASH_EXPIRY_GROUPS.find(group => group.key === dashExpiryGroup)?.label || 'รวมทั้ง 2 คลัง')} · จำนวนรายการตามช่วงเวลา</span></h2>
        <div class="expiry-chart-summary"><b>${fmt(expiryRows.length)}</b><span>รายการที่มีวันหมดอายุ</span></div>
        <div class="expiry-chart">${expiryGraphHTML}</div>
        <div class="expiry-chart-legend"><span><i class="red"></i>หมดอายุแล้ว</span><span><i class="amber"></i>ใกล้หมดอายุ</span><span><i class="green"></i>ยังมีเวลา</span></div>
      </div>
    </div>

    <div class="dash-cols">
      <div class="card">
        <h2><span class="donut-title-icon">🍩</span>สัดส่วนสถานะสต๊อก</h2>
        <div class="donut-wrap">
          <div class="donut"><svg viewBox="0 0 168 168">
            <circle cx="84" cy="84" r="${R}" stroke="var(--track)"></circle>
            ${arcsHTML}
          </svg><div class="hole"><b>${fmt(totalItems)}</b><span>รายการ</span></div></div>
          <div class="donut-legend">${legendHTML}</div>
        </div>
      </div>
      <div class="card">
        <h2>📊 ยอดเบิกจ่ายรวม 7 วันล่าสุด <span class="sub">ใช้วางแผนกำลังคน/พื้นที่รายสัปดาห์</span></h2>
        ${dayTotals.some(v => v > 0) ? `<div class="mini-bars">${days7.map((d, i) => `
          <div class="mb-col ${d === S.today ? 'today' : ''}">
            <div class="mb-val">${dayTotals[i] ? fmt(dayTotals[i]) : ''}</div>
            <div class="mb-bar ${dayTotals[i] ? '' : 'zero'}" style="height:${Math.max(3, dayTotals[i] / maxDay7 * 100)}%" tabindex="0" aria-label="${esc(`${TH_DAYS_S[dateObj(d).getDay()]} ${thDate(d)} · เบิกจ่ายรวม ${fmt(dayTotals[i])} · ${dayBreakdowns[i].length} รายการ`)}">
              <div class="mb-tooltip" role="tooltip">
                <b>${esc(TH_DAYS_S[dateObj(d).getDay()])} ${esc(thDate(d))} · รวม ${fmt(dayTotals[i])}</b>
                <div class="mb-tooltip-items">${dayBreakdowns[i].map(row => `<div class="mb-tooltip-item"><b>${esc(row.name)}</b><span>${row.code ? `ITEM ${esc(row.code)} · ` : ''}${fmt(row.qty)}${row.unit ? ` ${esc(row.unit)}` : ''}${row.lots.size ? ` · ${row.lots.size === 1 ? `Lot ${esc([...row.lots][0])}` : `รวม ${row.lots.size} Lot`}` : ''}</span></div>`).join('') || '<span class="mb-tooltip-empty">ไม่มีรายการเบิกจ่าย</span>'}</div>
              </div>
            </div>
            <div class="mb-lbl">${TH_DAYS_S[dateObj(d).getDay()]}<br>${thDate(d)}</div>
          </div>`).join('')}</div>`
        : '<div class="empty"><span class="e-ic">📊</span>ยังไม่มีการเบิกจ่ายในช่วง 7 วันนี้</div>'}
      </div>
    </div>

    <div class="card dash-lowstock-card">
      <h2>🔻 Top 3 ใกล้หมดสต๊อก <span class="sub">เทียบคงเหลือกับจุดต่ำสุด (Min) · คาดการณ์จากอัตราเบิกเฉลี่ย</span></h2>
      ${lowTop3.length ? `<div class="lowstock-list">${lowTop3.map((x, i) => `
        <div class="lowstock-item ${x.st.cls}" role="button" tabindex="0" onclick="A.openItem('${escJs(x.item.identities?.[0] || x.item.code)}')">
          <div class="lowstock-rank">${i + 1}</div>
          <div class="lowstock-info">
            <div class="item-name">${esc(x.item.name)}</div>
            <div class="u-meta">ITEM ${esc(x.item.code)} · คงเหลือ <b>${fmt(x.item.stock)}</b> ${esc(x.item.unit)} · Min ${fmt(x.item.min)}</div>
            <div class="lowstock-bar"><span style="width:${Math.max(3, Math.min(100, x.ratio * 100))}%"></span></div>
          </div>
          <div class="lowstock-days"><span class="badge ${x.st.cls}">${x.st.label}</span>
            <small>${x.u.avgDay > 0 ? (x.u.daysLeft < 1 ? 'หมดแล้ว' : `พอใช้ ~${fmt1(x.u.daysLeft)} วัน`) : 'ไม่มีการเบิก'}</small></div>
        </div>`).join('')}</div>`
        : '<div class="empty"><span class="e-ic">✅</span>ยังไม่มีรายการที่ตั้งค่า Min</div>'}
    </div>

    ${upcoming.length ? `<div class="card"><h2>🚚 กำหนดรับของ 7 วันข้างหน้า <span class="sub">จากตารางกำหนดรับบรรจุภัณฑ์</span></h2>
      <div class="tbl-wrap"><table><thead><tr><th>วันที่</th><th>รหัส</th><th>สินค้า</th><th class="num">จำนวน</th><th>หมายเหตุ</th><th></th></tr></thead><tbody>
      ${upcoming.slice(0, 15).map(d => {
        const it = itemBy(d.code);
        const overWarn = it && it.max > 0 && (it.stock + d.qty > it.max);
        return `<tr><td><b>${thDate(d.date, true)}</b></td><td class="item-code">${esc(d.code)}</td><td>${esc(d.name)}</td>
          <td class="num"><b>${fmt(d.qty)}</b></td><td class="mut small">${esc(d.remark)}</td>
          <td>${overWarn ? '<span class="badge over">รับแล้วจะเกิน Max</span>' : ''}</td></tr>`;
      }).join('')}</tbody></table></div>${upcoming.length > 15 ? `<p class="mut small mt10">…และอีก ${upcoming.length - 15} รายการ (ดูทั้งหมดในหน้าวางแผน)</p>` : ''}</div>` : ''}

    <div class="card" id="dash-stock-card">
      <div class="dash-stock-head">
        <h2>📋 สต๊อกคงเหลือ <span class="sub">คลิกที่รายการเพื่อดูรายละเอียด</span></h2>
      </div>
      <div class="toolbar">
        <input class="search" id="dash-q" placeholder="🔍 ค้นหารหัส / ชื่อสินค้า…" value="${esc(dashFilter.q)}">
        <select id="dash-st">
          <option value="all">สถานะทั้งหมด</option>
          <option value="crit" ${dashFilter.status==='crit'?'selected':''}>หมดสต๊อก</option>
          <option value="low"  ${dashFilter.status==='low' ?'selected':''}>ต่ำกว่า Min</option>
          <option value="over" ${dashFilter.status==='over'?'selected':''}>เกิน Max</option>
          <option value="ok"   ${dashFilter.status==='ok'  ?'selected':''}>ปกติ</option>
        </select>
        <span class="mut small">แสดง ${fmt(shownItems.length)} / ${fmt(list.length)} รายการ</span>
      </div>
      <div class="tbl-wrap tbl-scroll"><table>
        <thead><tr><th>สินค้า</th><th>Lot</th><th class="num">คงเหลือ</th><th>ระดับสต๊อก</th><th>สถานะ</th><th>หมายเหตุ</th></tr></thead>
        <tbody>${shownItems.map(i => {
          const st = dashboardStockStatus(i, aggregateStatusByCode);
          const lots = stockLots(i);
          const lotTitle = lots.join(', ');
          const lotLabel = lots.length > 3 ? `${lots.slice(0, 3).join(', ')} +อีก ${lots.length - 3} Lot` : (lotTitle || '-');
          const identity = i.identities?.[0] || i.code;
          const noteIds = i.identities || [identity];
          return `<tr style="cursor:pointer" onclick="A.openItem('${escJs(identity)}')">
            <td><div class="item-name">${esc(i.name)}</div><div class="item-code">${esc(i.code)}</div></td>
            <td class="dash-stock-lot" title="${esc(lotTitle)}">${esc(lotLabel)}</td>
            <td class="num"><b>${fmt(i.stock)}</b> <span class="mut small">${esc(i.unit)}</span></td>
            <td>${lvlBarHTML(i)}</td>
            <td><span class="badge ${st.cls}">${st.label}</span></td>
            <td class="dash-stock-note-cell">
              <input type="text" class="dash-stock-note-input ${i.stockNote ? 'has-note' : ''}" data-dash-note
                data-dash-note-ids="${esc(noteIds.join('|'))}" value="${esc(i.stockNote || '')}" maxlength="250"
                placeholder="กรอกหมายเหตุ" aria-label="หมายเหตุ ${esc(i.code)}" title="พิมพ์หมายเหตุ ระบบจะบันทึกอัตโนมัติ">
            </td></tr>`;
        }).join('') || '<tr><td colspan="6" class="empty">ไม่พบรายการ</td></tr>'}</tbody>
      </table></div>
      ${shownItems.length < list.length ? `<p class="mut small mt10"><button class="btn btn-ghost btn-sm" onclick="A.dashMore()">แสดงเพิ่มอีก ${fmt(Math.min(DASH_PAGE, list.length - shownItems.length))} รายการ</button></p>` : ''}
    </div>`;

  $('#dash-q').oninput = e => { dashFilter.q = e.target.value; dashShown = DASH_PAGE; VIEWS.dash(); const el = $('#dash-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); };
  $('#dash-st').onchange = e => { dashFilter.status = e.target.value; dashShown = DASH_PAGE; VIEWS.dash(); };
  $$('[data-dash-note]', $('#view-dash')).forEach(input => {
    input.addEventListener('click', event => event.stopPropagation());
    input.addEventListener('input', event => {
      event.stopPropagation();
      input.classList.toggle('has-note', Boolean(input.value.trim()));
      queueDashboardStockNoteSave((input.dataset.dashNoteIds || '').split('|'), input.value, input);
    });
    input.addEventListener('keydown', event => event.stopPropagation());
    input.addEventListener('blur', () => {
      const ids = (input.dataset.dashNoteIds || '').split('|');
      queueDashboardStockNoteSave(ids, input.value, input, 0);
    });
  });
};

/* ═══ VIEW: Daily spreadsheet ledger (รับเข้า/เบิกจ่าย) ══════════════════ */
const DAILY_FIELDS = [
  'lot', 'mfgDate', 'expiryDate',
  'receive', 'returnPackaging', 'returnSupplier',
  'qaIssue', 'sendBackSupplier', 'issuePackaging',
  'min', 'max', 'safety', 'unit',
];
// 'lot'    — one line per ledger row, i.e. per Lot (editable, the default)
// 'merged' — one line per ITEM code, every row with that code summed together (read-only)
let dailyGroupMode = 'lot';
let dailyEditMode = false;
// True whenever the currently rendered daily-ledger view must not mutate
// data. This also covers read-only summary tabs such as Oracle, Difference,
// Oracle-only (legacy), and the merged ITEM view.
let dailyViewReadOnly = true;
let dailyReadyPollTimer = null;
let dailyReadyReminderOpen = false;
let dailyEditPasswordOpen = false;
const dailyDirty = new Set();
const dailyDraftRows = new Map();
const dailyEditVersions = new Map();
let dailyAutosaveTimer = null;
let dailyAutosaveRunning = false;
let dailyAutosaveRetryTimer = null;
let dailyFilter = '';
// Default to the first warehouse group: คลังบรรจุภัณฑ์ → ทั้งหมด.
let dailyAreaFilter = '__packaging_all__';
// Start on the server's current date. Do not jump to a future ledger that may
// have been created accidentally; users can still choose any historical date.
let txnDate = S.today || Object.keys(S.dailyLedgers || {}).sort().pop() || '';
const oracleSnapshotCache = Object.create(null);
const oracleSnapshotLoading = new Set();
const oracleRealtimeLoading = new Set();
const oracleSnapshotSource = Object.create(null);
const dailyAutoCreateLoading = new Set();
const ORACLE_EXCLUDED_LOCATORS = new Set();

function oraclePart(value) {
  return String(value || '').trim().toUpperCase();
}

function oracleLocatorKey(value) {
  const text = oraclePart(value);
  const match = /^(\d+)/.exec(text);
  return match ? match[1] : text;
}

function oracleLocatorExcluded(value) {
  return ORACLE_EXCLUDED_LOCATORS.has(oracleLocatorKey(value));
}

const DAILY_FILTER_PACKAGING_ALL = '__packaging_all__';
const DAILY_FILTER_PACKAGING_ORACLE_ONLY = '__packaging_oracle_only__';
const DAILY_FILTER_PACKAGING_2100 = '__packaging_2100__';
const DAILY_FILTER_PACKAGING_2200 = '__packaging_2200__';
const DAILY_PRIMARY_AREA_ORDER = [
  '1100-คลังบรรจุภัณฑ์',
  '1300-รอคืน Supplier',
  '1400-จ้างผลิต',
  '1500-ฉลากส่ง Supplier',
  'HOLD',
  '1600-วัตถุดิบ จ้างผลิต',
];
const DAILY_PRIMARY_LOCATORS = new Set(['1100', '1300', '1400', '1500', '1600']);
const DAILY_SECONDARY_LOCATORS = new Set(['2100', '2200']);

function dailyAreaLocatorKey(areaKey) {
  const text = String(areaKey || '').trim();
  const temporary = /^__oracle_locator__(\d+)$/i.exec(text);
  return temporary ? temporary[1] : oracleLocatorKey(text);
}

function dailyAreaGroupKey(areaKey) {
  const text = String(areaKey || '').trim();
  const locator = dailyAreaLocatorKey(text);
  if (DAILY_SECONDARY_LOCATORS.has(locator)) return 'packaging_secondary';
  if (text === 'HOLD' || text === '__main__' || DAILY_PRIMARY_LOCATORS.has(locator)) return 'packaging_primary';
  return 'other';
}

function dailyFilterMatchesArea(areaKey, filter) {
  if (filter === 'all') return true;
  if (filter === DAILY_FILTER_PACKAGING_ALL) return dailyAreaGroupKey(areaKey) === 'packaging_primary';
  if (filter === DAILY_FILTER_PACKAGING_2100) return dailyAreaLocatorKey(areaKey) === '2100';
  if (filter === DAILY_FILTER_PACKAGING_2200) return dailyAreaLocatorKey(areaKey) === '2200';
  return String(areaKey || '') === String(filter || '');
}

function dailyRowsForFilter(rows, rowAreas, filter) {
  if (filter === 'all') return rows || [];
  return (rows || []).filter(row => dailyFilterMatchesArea(rowAreas.get(String(row.id || '')), filter));
}

function dailyLedgerRowsForFilter(rows, rowAreas, filter) {
  if (filter === 'all') return rows || [];
  if (filter === '__difference__' || filter === '__oracle__' || filter === '__oracle_only__'
      || filter === DAILY_FILTER_PACKAGING_ORACLE_ONLY) return [];
  const result = [];
  let currentArea = '__main__';
  for (const row of rows || []) {
    if (row.kind === 'section') {
      currentArea = String(row.title || '').trim() || '__main__';
      if (dailyFilterMatchesArea(currentArea, filter)) result.push(row);
    } else if (row.kind === 'item'
      && dailyFilterMatchesArea(rowAreas.get(String(row.id || '')), filter)) {
      result.push(row);
    }
  }
  return result;
}

function oracleKey(itemCode, lot, locator = '') {
  return `${oraclePart(itemCode)}|${oraclePart(lot)}|${oracleLocatorKey(locator)}`;
}

function oracleCompareKey(itemCode, lot, locator, snapshot) {
  // Older archived snapshots predate the Locator column. Keep those historical
  // dates comparable by falling back to the old ITEM + Lot key.
  return snapshot?.hasLocator === false
    ? oracleKey(itemCode, lot, '')
    : oracleKey(itemCode, lot, locator);
}

function oracleRecordCompareKey(record, snapshot) {
  return record?.legacyNoLocator
    ? oracleKey(record.itemCode, record.lot, '')
    : oracleCompareKey(record.itemCode, record.lot, record.locator, snapshot);
}

function dailyLedgerRowLocators(rows) {
  const result = new Map();
  let currentLocator = '';
  for (const row of rows || []) {
    if (row.kind === 'section') {
      currentLocator = String(row.title || '').trim();
    } else if (row.kind === 'item') {
      result.set(String(row.id || ''), String(row.locator || currentLocator || '').trim());
    }
  }
  return result;
}

function oracleEntry(row, snapshot, fallbackLocator = '') {
  if (!snapshot?.available || !oraclePart(row?.lot)) return null;
  const key = oracleCompareKey(row.code, row.lot, row.locator || fallbackLocator, snapshot);
  const direct = snapshot.records?.[key];
  if (direct) return direct;
  return Object.values(snapshot.records || {})
    .find(record => record?.legacyNoLocator
      && oracleKey(record.itemCode, record.lot, '') === oracleKey(row.code, row.lot, '')) || null;
}

// Oracle can contain a code + Lot that is not present in the daily balance
// table. Show that record in the selected day. It remains transient until the
// user edits a movement field, which promotes it into the daily ledger.
function buildOracleOnlyRows(ledgerRows, snapshot, date, rowLocators = new Map()) {
  if (!snapshot?.available) return [];
  const actualLocatorKeys = new Set();
  const actualLegacyKeys = new Set();
  for (const row of ledgerRows || []) {
    if (row.kind !== 'item') continue;
    const locator = row.locator || rowLocators.get(String(row.id || '')) || '';
    actualLocatorKeys.add(oracleCompareKey(row.code, row.lot, locator, snapshot));
    actualLegacyKeys.add(oracleKey(row.code, row.lot, ''));
  }
  return Object.values(snapshot.records || {})
    .filter(record => {
      if (oracleLocatorExcluded(record.locator)) return false;
      const key = oracleRecordCompareKey(record, snapshot);
      const isAlreadyInLedger = record?.legacyNoLocator
        ? actualLegacyKeys.has(key)
        : actualLocatorKeys.has(key);
      return oraclePart(record.itemCode) !== '' && oraclePart(record.lot) !== '' && !isAlreadyInLedger;
    })
    .sort((a, b) => oracleLocatorKey(a.locator).localeCompare(oracleLocatorKey(b.locator))
      || String(a.itemCode).localeCompare(String(b.itemCode))
      || String(a.lot).localeCompare(String(b.lot)))
    .map(record => {
      const token = `${date}-${record.itemCode}-${record.lot}-${record.locator || ''}`.replace(/[^a-zA-Z0-9_-]/g, '-');
      return {
        id: `oracle-only-${token}`,
        kind: 'item',
        code: String(record.itemCode || ''),
        name: String(record.description || ''),
        lot: String(record.lot || ''),
        locator: String(record.locator || ''),
        mfgDate: '',
        expiryDate: '',
        opening: 0,
        receive: 0,
        returnPackaging: 0,
        returnSupplier: 0,
        qaIssue: 0,
        sendBackSupplier: 0,
        issuePackaging: 0,
        remaining: 0,
        min: 0,
        max: 0,
        safety: 0,
        unit: String(record.uom || ''),
        unitComment: 'มีแต่ใน Oracle',
        oracleOnly: true,
        oracleImported: false,
        oracleQty: Number(record.qty || 0),
        oracleOrgs: Array.isArray(record.orgs) ? record.orgs : [],
        tone: 'oracle-only',
      };
    });
}

// Put Oracle-only rows beneath the daily section for the same Locator. If the
// Locator has no section in that day's ledger, create a temporary display-only
// section; neither the section nor its rows is saved to the ledger.
function buildDailyTableRows(ledgerRows, oracleOnlyRows) {
  const areaByLocator = new Map();
  for (const row of ledgerRows || []) {
    if (row.kind !== 'section') continue;
    const title = String(row.title || '').trim();
    const locator = oracleLocatorKey(title);
    if (locator && !areaByLocator.has(locator)) areaByLocator.set(locator, title);
  }

  const oracleRowsByArea = new Map();
  for (const row of oracleOnlyRows || []) {
    const locator = oracleLocatorKey(row.locator);
    const area = areaByLocator.get(locator) || (locator ? `__oracle_locator__${locator}` : '__oracle_only__');
    if (!oracleRowsByArea.has(area)) oracleRowsByArea.set(area, []);
    oracleRowsByArea.get(area).push(row);
  }

  const result = [];
  const emittedAreas = new Set();
  const appendOracleRows = area => {
    if (emittedAreas.has(area)) return;
    for (const row of oracleRowsByArea.get(area) || []) result.push(row);
    emittedAreas.add(area);
  };
  let currentArea = '__main__';
  for (const row of ledgerRows || []) {
    if (row.kind === 'section') {
      appendOracleRows(currentArea);
      result.push(row);
      currentArea = String(row.title || '').trim() || '__main__';
    } else {
      result.push(row);
    }
  }
  appendOracleRows(currentArea);

  for (const [area, rows] of oracleRowsByArea) {
    if (emittedAreas.has(area)) continue;
    const locator = String(rows[0]?.locator || '').trim();
    result.push({
      id: `oracle-display-section-${area}`,
      kind: 'section',
      title: area === '__oracle_only__' ? 'มีแต่ใน Oracle' : (locator || oracleLocatorKey(locator)),
      tone: 'normal',
      oracleDisplayArea: area,
    });
    result.push(...rows);
    emittedAreas.add(area);
  }
  return result;
}

function oracleComparison(row, snapshot, fallbackLocator = '') {
  if (!snapshot) return {state: 'loading', text: '…', diffText: '—'};
  if (!snapshot.available) return {state: 'unavailable', text: '—', diffText: '—'};
  if (!oraclePart(row.lot)) return {state: 'needs-lot', text: '—', diffText: '—'};
  const entry = oracleEntry(row, snapshot, fallbackLocator);
  if (!entry) return {state: 'not-found', text: 'ไม่พบ', diffText: '—'};
  const difference = Number(row.remaining || 0) - Number(entry.qty || 0);
  return {
    state: Math.abs(difference) < 0.000001 ? 'same' : (difference > 0 ? 'more' : 'less'),
    text: fmt1(entry.qty),
    diffText: `${difference > 0 ? '+' : ''}${fmt1(difference)}`,
    difference,
    entry,
  };
}

function oracleComparisonTitle(result, snapshot) {
  return result.entry
    ? `Oracle ${fmt1(result.entry.qty)} ${result.entry.uom || ''} · Locator ${result.entry.locator || '-'} · Org ${(result.entry.orgs || []).join(', ')}`
    : result.state === 'loading' ? 'กำลังโหลด Snapshot Oracle'
    : result.state === 'needs-lot' ? 'กรอกหรือเลือก Lot เพื่อเปรียบเทียบกับ Oracle'
    : result.state === 'not-found' ? 'ไม่พบ Itemcode + Lot + Locator นี้ใน Oracle'
    : (snapshot?.error || 'ไม่มีข้อมูลจากระบบ ERP ของวันที่นี้');
}

function oracleBalanceCell(row, snapshot, fallbackLocator = '') {
  const result = oracleComparison(row, snapshot, fallbackLocator);
  const title = oracleComparisonTitle(result, snapshot);
  return `<td class="num daily-oracle ${result.state}" title="${esc(title)}">${esc(result.text)}</td>
    <td class="num daily-difference ${result.state}" title="${esc(title)}">${esc(result.diffText)}</td>`;
}

function dailyLotCell(row, oracleLots) {
  if (!dailyEditActive() || row.oracleOnly) return dailyReadonlyCell(row.lot, 'trace lot', false);
  const listId = `oracle-lots-${String(row.id || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const options = (oracleLots || []).map(entry =>
    `<option value="${esc(entry.lot)}" label="Oracle ${fmt1(entry.qty)} ${esc(entry.uom || '')}"></option>`
  ).join('');
  return `<td class="daily-edit-col trace lot">
    <input class="daily-cell-input daily-text-input" type="text" maxlength="50"
      value="${esc(row.lot || '')}" placeholder="Lot"
      data-row="${esc(row.id)}" data-field="lot" data-value-type="text"
      ${options ? `list="${esc(listId)}"` : ''}
      aria-label="Lot ${esc(row.code)}" title="${options ? 'เลือก Lot จาก Oracle หรือกรอกเอง' : 'กรอก Lot'}">
    ${options ? `<datalist id="${esc(listId)}">${options}</datalist>` : ''}
  </td>`;
}

// <option> list of the Lots Oracle knows about for one item code, for the split dialog.
function oracleLotOptions(code) {
  const snapshot = oracleSnapshotCache[txnDate];
  if (!snapshot?.available) return '';
  const wanted = oraclePart(code);
  return Object.values(snapshot.records || {})
    .filter(record => oraclePart(record.itemCode) === wanted)
    .sort((a, b) => String(a.lot).localeCompare(String(b.lot)))
    .map(record => `<option value="${esc(record.lot)}" label="Oracle ${fmt1(record.qty)} ${esc(record.uom || '')}"></option>`)
    .join('');
}

/* ─── ใบกำกับพาเลต (pallet tag, form F-WH-001) ─────────────────────────────── */
const PALLET_FORM_CODE = 'F-WH-001 (01/01/69)';
const PALLET_FORM_REV = 'แก้ไข: 00';
const PALLET_MAX_PAGES = 200;
const LABEL_USAGE_FORM_CODE = 'F-WH-002 (01/01/69)';
const LABEL_USAGE_FORM_REV = 'แก้ไข : 01';
const LABEL_USAGE_DEFAULT_LOCATOR = '1500';
const LABEL_USAGE_DEFAULT_REASON = 'R-01';
let labelUsageDraftRows = [];
let labelUsageNextRowId = 1;
let labelUsagePickerActive = false;
const PALLET_NAME_COLORS = [
  {color: '#00b0f0', label: 'ฟ้าเดิม'},
  {color: '#fff3b0', label: 'เหลืองอ่อน'},
  {color: '#dff5d8', label: 'เขียวอ่อน'},
  {color: '#ffe0b2', label: 'ส้มอ่อน'},
  {color: '#ffe0eb', label: 'ชมพูอ่อน'},
  {color: '#eadcff', label: 'ม่วงอ่อน'},
  {color: '#eceff1', label: 'เทาอ่อน'},
  {color: '#ffffff', label: 'ขาว'},
];

// "2026-06-06" → "6/6/2569" (the พ.ศ. date printed at the top of the form)
function palletHeadDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}/${m}/${y + 543}`;
}

// "2026-04-29" → "29-04-26" (how มfg/expiry dates are written on the form)
function palletShortDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y.slice(-2)}`;
}

function palletInputDateToIso(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? text : '';
  }
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(text);
  if (!match) return '';
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  if (year >= 2400 && year <= 2700) year -= 543;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return isoDate(date);
}

function palletShelfLifeInfo(supplier) {
  const wanted = String(supplier || '').trim().toLowerCase();
  if (!wanted) return null;
  const row = (S.masterLists?.supplierShelfLives || []).find(item =>
    String(item?.supplier || '').trim().toLowerCase() === wanted
  );
  if (!row) return null;
  const values = String(row.shelfLife || '').match(/\d+(?:[.,]\d+)?/g) || [];
  const months = values.map(value => Number(value.replace(',', '.'))).filter(value => Number.isFinite(value) && value > 0);
  if (!months.length) return {shelfLife: String(row.shelfLife || '').trim(), months: 0};
  return {
    shelfLife: String(row.shelfLife || '').trim(),
    months: Math.min(...months),
    values: months,
  };
}

function palletExpiryFromShelfLife(mfgValue, supplier) {
  const mfgIso = palletInputDateToIso(mfgValue);
  const info = palletShelfLifeInfo(supplier);
  if (!mfgIso || !info?.months) return null;
  const base = dateObj(mfgIso);
  const day = base.getDate();
  const target = new Date(base.getFullYear(), base.getMonth() + info.months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return {iso: isoDate(target), ...info};
}

function labelUsageDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || '');
}

function labelUsageNewRow(seed = {}) {
  return {
    uid: labelUsageNextRowId++,
    item: String(seed.item || seed.code || ''),
    name: String(seed.name || ''),
    lot: String(seed.lot || ''),
    qty: seed.qty === undefined || seed.qty === null || seed.qty === '' ? '' : String(seed.qty),
    note: String(seed.note || ''),
  };
}

function labelUsageQtyForRow(row) {
  return ['qaIssue', 'sendBackSupplier', 'issuePackaging']
    .reduce((total, field) => total + (Number(row?.[field] || 0) || 0), 0);
}

function labelUsageFormHtml(row) {
  return `<section id="pallet-tab-label" class="pallet-tab-panel" hidden>
    <div class="label-usage-source split-source">
      <b>${esc(row.code)}</b> — ${esc(row.name)}
      <div class="mut small">จำนวนเริ่มต้นดึงจากผลรวม จ่าย QA/ตัวอย่าง + ส่งคืน Supplier + จ่ายบรรจุ · เอกสารนี้ใช้สำหรับพิมพ์บันทึกและไม่ตัดยอดสต๊อกอัตโนมัติ</div>
    </div>
    <form id="label-usage-form" onsubmit="event.preventDefault();A.labelUsagePrint()">
      <div class="label-usage-meta-grid">
        <div><label class="fl" for="lu-company">บริษัท</label>
          <input id="lu-company" value="บริษัท ตัวอย่าง อินดัสทรี จำกัด" maxlength="120"></div>
        <div><label class="fl" for="lu-date">วันที่</label>
          ${dateInputHtml('lu-date', txnDate, 'label-usage-date-input', 'required')}</div>
        <div><label class="fl" for="lu-locator">Locator</label>
          <input id="lu-locator" value="${LABEL_USAGE_DEFAULT_LOCATOR}" maxlength="30"></div>
        <div><label class="fl" for="lu-reason">Reason Code</label>
          <input id="lu-reason" value="${LABEL_USAGE_DEFAULT_REASON}" maxlength="30"></div>
      </div>
      <div class="label-usage-table-wrap">
        <table class="label-usage-entry-table">
          <thead><tr><th>NO.</th><th>Item</th><th>รายการ</th><th>LOT</th><th>จำนวน (Pcs.)</th><th>หมายเหตุ</th><th class="label-usage-manage-head">จัดการ</th></tr></thead>
          <tbody id="label-usage-rows"></tbody>
        </table>
        <button class="btn btn-green btn-sm mt10" type="button" onclick="A.labelUsageAddRow()">＋ เพิ่มรายการ</button>
      </div>
      <div class="label-usage-sign-grid">
        <div><label class="fl" for="lu-prepared">ผู้จัดทำ</label><input id="lu-prepared" placeholder="ชื่อผู้จัดทำ"></div>
        <div><label class="fl" for="lu-recorded">ผู้บันทึก</label><input id="lu-recorded" placeholder="ชื่อผู้บันทึก"></div>
        <div><label class="fl" for="lu-recorded-date">วันที่บันทึก</label>
          ${dateInputHtml('lu-recorded-date', '', 'label-usage-date-input')}</div>
        <div><label class="fl" for="lu-approved">ผู้อนุมัติ</label><input id="lu-approved" placeholder="ชื่อผู้อนุมัติ"></div>
      </div>
      <div class="label-usage-form-note">แบบฟอร์ม ${esc(LABEL_USAGE_FORM_CODE)} · ${esc(LABEL_USAGE_FORM_REV)}</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" onclick="A.closeModal()">ยกเลิก</button>
        <button class="btn btn-primary" type="submit">🖨️ พิมพ์ใบบันทึกการใช้ฉลาก</button>
      </div>
    </form>
  </section>`;
}

function labelUsagePrintHtml(fields, rows) {
  const printRows = [...rows];
  while (printRows.length < 4) printRows.push({item: '', name: '', lot: '', qty: '', note: ''});
  return `<div class="label-usage-sheet">
    <div class="label-usage-print-head">
      <div class="label-usage-company">${esc(fields.company)}</div>
      <div class="label-usage-print-title">ใบบันทึกการใช้ฉลาก</div>
    </div>
    <div class="label-usage-print-meta">
      <div>Locator : <b>${esc(fields.locator)}</b></div>
      <div class="label-usage-print-date"><span>วันที่</span><b>${esc(labelUsageDate(fields.date))}</b></div>
      <div>Reason Code : <b>${esc(fields.reason)}</b></div>
    </div>
    <table class="label-usage-print-table">
      <colgroup><col class="lu-no"><col class="lu-item"><col class="lu-name"><col class="lu-lot"><col class="lu-qty"><col class="lu-note"></colgroup>
      <thead><tr><th>NO.</th><th>Item</th><th>รายการ</th><th>LOT</th><th>จำนวน (Pcs.)</th><th>หมายเหตุ</th></tr></thead>
      <tbody>${printRows.map((item, index) => `<tr>
        <td class="lu-center">${item.item || item.name || item.lot || item.qty || item.note ? fmt(index + 1) : ''}</td>
        <td>${esc(item.item)}</td><td>${esc(item.name)}</td><td>${esc(item.lot)}</td>
        <td class="lu-right">${esc(item.qty)}</td><td>${esc(item.note)}</td>
      </tr>`).join('')}</tbody>
    </table>
    <div class="label-usage-print-note">หมายเหตุ : แนบสำเนาใบกำกับภาษีหรือใบส่งสินค้าชั่วคราว ทุกครั้ง</div>
    <div class="label-usage-print-signatures">
      <div class="label-usage-signature-prepared">
        <span>ผู้จัดทำ : ${esc(fields.prepared || '................................')}</span>
        <span>ผู้ช่วยเจ้าหน้าที่ขึ้นไป</span>
      </div>
      <div class="label-usage-signature-recorded">ผู้บันทึก : <span>${esc(fields.recorded || '................................')}</span> (${esc(fields.recordedDate ? labelUsageDate(fields.recordedDate) : '____/__/____')})</div>
      <div class="label-usage-signature-approved">
        <span>ผู้อนุมัติ : ${esc(fields.approved || '................................')}</span>
        <span>ผจก.แผนกขึ้นไปขึ้นไป</span>
      </div>
    </div>
    <div class="label-usage-print-foot"><span>${esc(LABEL_USAGE_FORM_CODE)}</span><span>${esc(LABEL_USAGE_FORM_REV)}</span></div>
  </div>`;
}

// Per-item memory for the fields the ledger cannot know (supplier, big label,
// units per pallet) — the same product almost always repeats them.
function palletMemory(code) {
  try { return JSON.parse(localStorage.getItem('demo_pkg_pallet_' + code) || '{}'); }
  catch (e) { return {}; }
}
function savePalletMemory(code, data) {
  try { localStorage.setItem('demo_pkg_pallet_' + code, JSON.stringify(data)); } catch (e) {}
}

function palletNameColor(value) {
  const color = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : PALLET_NAME_COLORS[0].color;
}

function palletNameColorOptions(selected) {
  const current = palletNameColor(selected);
  return PALLET_NAME_COLORS.map(option => `
    <button type="button" class="pallet-color-option ${current === option.color ? 'selected' : ''}"
      data-color="${option.color}" style="--pallet-option-color:${option.color}"
      title="${esc(option.label)}" aria-label="${esc(option.label)}"
      aria-pressed="${current === option.color ? 'true' : 'false'}"
      onclick="A.palletSetNameColor('${option.color}')"></button>`).join('');
}

function syncPalletNameColorOptions(value) {
  const current = palletNameColor(value);
  $$('.pallet-color-option', $('#pallet-form') || document).forEach(button => {
    const selected = String(button.dataset.color || '').toLowerCase() === current;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
}

// Product names here run up to ~80 characters. At full size a long one wraps
// to several lines and grows that one tag taller than its neighbors on the
// sheet, so the name cell steps down a size as it gets longer.
function palletNameClass(text) {
  const n = String(text || '').length;
  if (n <= 26) return 'pt-name-l';
  if (n <= 44) return 'pt-name-m';
  return 'pt-name-s';
}

// Geometry below is measured straight off the original form PDF (612x792pt,
// content x 45.6→555.2). Column widths, which cells carry a rule, and the
// full-width rule *under* the footer all mirror that file exactly.
function palletTagHtml(f, index, total) {
  const qtyText = `${fmt1(f.qty)}${f.unit ? ' ' + f.unit : ''}`;
  const perText = f.perPallet > 0
    ? `${fmt1(f.perPallet)}${f.unit ? ' ' + esc(f.unit) : ''}` : '';
  return `<div class="pallet-page">
    <div class="pt-head">
      ${f.bigLabel ? `<div class="pt-big">${esc(f.bigLabel)}</div>` : ''}
      <div class="pt-title">ใบกำกับพาเลต</div>
      <div class="pt-date"><span class="pt-datelbl">วันที่</span><span class="pt-dateval">${esc(f.docDate)}</span></div>
    </div>
    <table class="pallet-tag"><colgroup>
      <col style="width:16.15%"><col style="width:33.09%"><col style="width:17.16%"><col style="width:33.60%">
    </colgroup><tbody>
      <tr><td class="pt-lbl">ชื่อสินค้า</td>
          <td class="pt-val pt-hl pt-fit ${palletNameClass(f.productName)}" style="background-color:${esc(palletNameColor(f.nameColor))}">${esc(f.productName)}</td>
          <td class="pt-lbl">ITEM</td><td class="pt-val pt-left">${esc(f.code)}</td></tr>
      <tr><td class="pt-lbl">ชื่อบริษัทผู้ส่ง</td>
          <td class="pt-val pt-fit ${palletNameClass(f.supplier)}">${esc(f.supplier)}</td>
          <td class="pt-lbl">LOT</td><td class="pt-val pt-left pt-lot">${esc(f.lot)}</td></tr>
      <tr><td class="pt-lbl">เลขที่บิลส่ง</td><td class="pt-val">${esc(f.billNo)}</td>
          <td class="pt-lbl">วันที่ผลิต</td><td class="pt-val">${esc(f.mfgDate)}</td></tr>
      <tr><td class="pt-lbl">จำนวนส่ง</td><td class="pt-val">${esc(qtyText)}</td>
          <td class="pt-lbl">วันที่หมดอายุ</td><td class="pt-val">${esc(f.expiryDate)}</td></tr>
      <tr><td class="pt-lbl">จำนวนเลต</td><td class="pt-val">${fmt(total)} พาเลต</td>
          <td class="pt-seq" colspan="2">พาเลตที่ ${fmt(index)}/${fmt(total)}</td></tr>
      <tr class="pt-last"><td class="pt-lbl">ผู้รับสินค้า</td><td class="pt-val">${esc(f.receiver)}</td>
          <td class="pt-note" colspan="2">${perText}</td></tr>
    </tbody></table>
    <div class="pallet-foot"><span>${esc(PALLET_FORM_CODE)}</span><span>${esc(PALLET_FORM_REV)}</span></div>
  </div>`;
}

// Character counts are a poor proxy for rendered width (Thai combining marks,
// mixed Latin), so after the tags are in the DOM every .pt-fit cell is measured
// and stepped down until it truly fits its column on one line. This is what
// keeps each tag exactly 229.7pt tall — and therefore 3 tags to a sheet.
const PALLET_FIT_MIN_PT = 7;
function palletFitCells(host) {
  for (const cell of host.querySelectorAll('.pt-fit')) {
    cell.style.whiteSpace = 'nowrap';
    let size = parseFloat(getComputedStyle(cell).fontSize) * 72 / 96;
    // guard against a zero-width (un-rendered) container
    if (!cell.clientWidth) continue;
    let guard = 0;
    while (cell.scrollWidth > cell.clientWidth && size > PALLET_FIT_MIN_PT && guard++ < 60) {
      size -= 0.4;
      cell.style.fontSize = size.toFixed(2) + 'pt';
    }
  }
}

// Render the tags off-screen at true print width so palletFitCells() measures
// the same geometry the printer will use, then hand back the prepared host.
function palletPrepare(host, html) {
  host.className = 'pallet-metrics';
  host.style.cssText = 'display:block;position:fixed;left:-10000px;top:0;width:179.8mm;';
  host.innerHTML = html;
  palletFitCells(host);
  host.style.cssText = '';
  return host;
}

// Collapse ledger rows onto one line per ITEM code. Every numeric column is summed,
// so the merged remaining is the true total held for that code no matter how many
// Lots or areas it is spread across.
const MERGE_SUM_FIELDS = [
  'opening', 'receive', 'returnPackaging', 'returnSupplier',
  'qaIssue', 'sendBackSupplier', 'issuePackaging', 'remaining',
  'min', 'max', 'safety',
];

function mergeRowsByCode(rows, areaLabels, rowAreas) {
  const byCode = new Map();
  for (const row of rows) {
    const code = String(row.code || '');
    let merged = byCode.get(code);
    if (!merged) {
      merged = {
        code, name: String(row.name || ''), unit: String(row.unit || ''),
        unitComment: String(row.unitComment || ''),
        kind: 'item', id: `merged-${code}`, tone: row.tone || 'normal',
        rowCount: 0, lots: [], areas: [], hold: false,
      };
      for (const field of MERGE_SUM_FIELDS) merged[field] = 0;
      byCode.set(code, merged);
    }
    for (const field of MERGE_SUM_FIELDS) merged[field] += Number(row[field] || 0);
    merged.rowCount++;
    merged.unit ||= String(row.unit || '');
    const unitComment = String(row.unitComment || '').trim();
    if (unitComment && !merged.unitComment.split(' / ').includes(unitComment)) {
      merged.unitComment = merged.unitComment ? `${merged.unitComment} / ${unitComment}` : unitComment;
    }
    const lot = String(row.lot || '').trim();
    if (lot && !merged.lots.includes(lot)) merged.lots.push(lot);
    const areaKey = rowAreas?.get(row.id);
    const areaText = areaLabels?.get(areaKey) || areaKey;
    if (areaText && areaText !== '__main__' && !merged.areas.includes(areaText)) {
      merged.areas.push(areaText);
    }
    if (row.tone === 'hold') merged.hold = true;
  }
  return [...byCode.values()].sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

// Print view for the daily ledger: keep the paper copy focused on the three
// fields people use to identify and count stock, while retaining the area
// sections from the source ledger.
function dailyPrintHtml(ledger) {
  const groups = new Map();
  let areaTitle = 'ไม่ระบุพื้นที่';
  for (const row of ledger.rows || []) {
    if (row.kind === 'section') {
      areaTitle = String(row.title || '').trim() || 'ไม่ระบุพื้นที่';
      continue;
    }
    if (row.kind !== 'item') continue;
    if (!groups.has(areaTitle)) groups.set(areaTitle, []);
    groups.get(areaTitle).push(row);
  }

  const sections = [...groups.entries()].map(([area, rows]) => `
    <section class="daily-print-area">
      <h2>${esc(area)}</h2>
      <table class="daily-print-table">
        <thead><tr><th>ITEM</th><th>รายการ</th><th class="num">คงเหลือ</th></tr></thead>
        <tbody>${rows.map(row => `<tr>
          <td>${esc(row.code)}</td>
          <td>${esc(row.name)}</td>
          <td class="num">${fmt1(row.remaining)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </section>`).join('');

  return `<div class="daily-print-sheet">
    <div class="daily-print-title">ตารางรับเข้า / เบิกจ่ายรายวัน</div>
    <div class="daily-print-date">วันที่ ${esc(thDate(txnDate, true))}</div>
    ${sections || '<p class="daily-print-empty">ไม่พบรายการ</p>'}
  </div>`;
}

// The full system compares the daily table with an ERP stock snapshot. The
// demo has no ERP connection, so every date reports "no snapshot" and the
// ERP comparison tabs / columns are hidden.
const DEMO_NO_ERP_SNAPSHOT = Object.freeze({
  available: false, records: {}, error: 'เวอร์ชันเดโมไม่ได้เชื่อมต่อระบบ ERP',
});
function loadOracleSnapshot(date) {
  oracleSnapshotCache[date] = {...DEMO_NO_ERP_SNAPSHOT, date};
}
async function loadOracleRealtime() {
  throw new Error('การ Sync ข้อมูลจากระบบ ERP ปิดไว้ในเวอร์ชันเดโม');
}

async function ensureDailyLedger(date) {
  if (!date || S.dailyLedgers?.[date] || dailyAutoCreateLoading.has(date)) return;
  if (!demoEditableDate(date)) return; // demo: only today's table can be created
  dailyAutoCreateLoading.add(date);
  try {
    const result = await api('daily_ledger_create', {date});
    const createdDates = Array.isArray(result.createdDates) ? result.createdDates : [];
    if (currentView === 'txn' && txnDate === date) {
      if (createdDates.length) {
        toast(`คัดลอกตารางจากวันก่อนต่อเนื่องถึง ${thDate(date, true)} แล้ว`, 'ok-t');
      }
      VIEWS.txn();
    }
  } catch (e) {
    if (currentView === 'txn' && txnDate === date) toast(e.message, 'err');
  } finally {
    dailyAutoCreateLoading.delete(date);
  }
}

async function openDailyDate(date) {
  const previousArea = dailyAreaFilter;
  txnDate = date;
  // Keep the search term while moving between dates. The new day's rows are
  // rendered below and filterDailyRows(dailyFilter) reapplies the same query.
  // Changing the date must not reset the selected group/area filter.
  dailyAreaFilter = previousArea || DAILY_FILTER_PACKAGING_ALL;
  if (!S.dailyLedgers?.[date]) void ensureDailyLedger(date);
  VIEWS.txn();
}

function dailyReadyStatus(date = txnDate) {
  return S.dailyReady?.[date] || null;
}

function dailyReadyReminderToday() {
  return isoDate(new Date());
}

function dailyReadyReminderSnoozeUntil(date) {
  try {
    const raw = JSON.parse(localStorage.getItem('demo_pkg_daily_ready_reminder') || '{}');
    return raw.date === date ? Number(raw.until || 0) : 0;
  } catch (e) { return 0; }
}

function saveDailyReadyReminderSnooze(date, minutes = 10) {
  try {
    localStorage.setItem('demo_pkg_daily_ready_reminder', JSON.stringify({
      date,
      until: Date.now() + minutes * 60 * 1000,
    }));
  } catch (e) {}
}

function closeDailyReadyReminder() {
  if (!dailyReadyReminderOpen) return;
  dailyReadyReminderOpen = false;
  $('#modal').classList.remove('open', 'modal-wide', 'daily-ready-reminder', 'daily-edit-password');
  $('#modal').innerHTML = '';
  if (!$('#drawer').classList.contains('open')) $('#overlay').classList.remove('open');
}

function showDailyEditPassword() {
  if (dailyEditPasswordOpen || $('#modal').classList.contains('open') || $('#drawer').classList.contains('open')) return;
  dailyEditPasswordOpen = true;
  $('#modal').innerHTML = `
    <button class="modal-close" type="button" onclick="A.closeModal()" aria-label="ปิด">✕</button>
    <div class="daily-edit-password-icon">🔐</div>
    <h3>ยืนยันโหมดแก้ไข</h3>
    <p class="mut small">กรอกรหัสผ่านเพื่อเปิดช่องแก้ไขข้อมูลในตารางรายวัน</p>
    <div class="demo-account-hint">🔑 บัญชีทดลอง: ${window.DemoBanner?.accountsHtml() || ''}</div>
    <label class="fl" for="daily-edit-password">รหัสผ่าน</label>
    <input id="daily-edit-password" class="input" type="password" autocomplete="off"
      inputmode="numeric" placeholder="กรอกรหัสผ่าน" aria-label="รหัสผ่านโหมดแก้ไข">
    <div class="modal-actions">
      <button class="btn btn-ghost" type="button" onclick="A.closeModal()">ยกเลิก</button>
      <button class="btn" type="button" onclick="A.dailyEditPasswordSubmit()">ยืนยัน</button>
    </div>`;
  $('#overlay').classList.add('open');
  $('#modal').classList.add('open', 'daily-edit-password');
  const input = $('#daily-edit-password');
  input?.focus();
  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter') A.dailyEditPasswordSubmit();
  });
}

function showDailyReadyReminder() {
  const date = dailyReadyReminderToday();
  if (dailyViewReadOnly || dailyReadyReminderOpen || !S.dailyLedgers?.[date] || dailyReadyStatus(date)?.ready) return;
  if ($('#modal').classList.contains('open') || $('#drawer').classList.contains('open')) return;

  dailyReadyReminderOpen = true;
  $('#modal').innerHTML = `
    <div class="daily-ready-reminder-icon">⏰</div>
    <h3>ข้อมูลวันนี้พร้อมใช้งานหรือยัง?</h3>
    <p class="daily-ready-reminder-text">
      ขณะนี้เกินเวลา <b>08:30 น.</b> แล้ว แต่ยังไม่มีการกดยืนยันข้อมูลของวันที่
      <b>${esc(thDate(date, true))}</b>
    </p>
    <p class="mut small">เมื่อยืนยันแล้ว ผู้ใช้งานคนอื่นจะเห็นสถานะว่า “พร้อมใช้งานแล้ว” ทันที</p>
    <div class="modal-actions daily-ready-reminder-actions">
      <button type="button" class="btn gray" onclick="A.dailyReadyReminderSnooze()">เลื่อนแจ้งเตือนอีก 10 นาที</button>
      <button type="button" class="btn" onclick="A.dailyReadyReminderConfirm()">✓ ยืนยันพร้อมใช้งาน</button>
    </div>`;
  $('#overlay').classList.add('open');
  $('#modal').classList.add('open', 'daily-ready-reminder');
}

function checkDailyReadyReminder() {
  if (currentView !== 'txn' || !txnDate) return;
  if (dailyViewReadOnly) {
    closeDailyReadyReminder();
    return;
  }
  const date = dailyReadyReminderToday();
  if (txnDate !== date || !S.dailyLedgers?.[date] || dailyReadyStatus(date)?.ready) {
    closeDailyReadyReminder();
    return;
  }

  const now = new Date();
  const deadline = new Date(now);
  deadline.setHours(8, 30, 0, 0);
  if (now < deadline || Date.now() < dailyReadyReminderSnoozeUntil(date)) return;
  showDailyReadyReminder();
}

function updateDailyReadyUi(date = txnDate) {
  const button = $('#daily-ready-btn');
  const meta = $('#daily-ready-meta');
  if (!button || date !== txnDate) return;
  const status = dailyReadyStatus(date);
  const ready = Boolean(status?.ready);
  button.disabled = dailyViewReadOnly;
  button.setAttribute('aria-disabled', dailyViewReadOnly ? 'true' : 'false');
  button.classList.toggle('ready', ready);
  button.setAttribute('aria-pressed', ready ? 'true' : 'false');
  button.textContent = ready ? '✓ พร้อมใช้งานแล้ว' : '○ พร้อมใช้งาน';
  button.title = ready ? 'ข้อมูลวันนี้พร้อมใช้งานแล้ว' : 'กดเมื่อข้อมูลของวันนี้พร้อมให้ใช้งาน';
  if (meta) meta.textContent = ready ? `บันทึกเมื่อ ${status.at || '-'}` : 'ยังไม่ได้กดปุ่ม';
}

async function pollDailyReady() {
  if (currentView !== 'txn' || !txnDate) return;
  const date = txnDate;
  if (document.hidden) return;
  try {
    const result = await apiCall('daily_ready_get', {date}, 'GET');
    if (!result.ok) return;
    if (result.demo) window.DemoBanner?.update(result.demo);
    if (!S.dailyReady || typeof S.dailyReady !== 'object') S.dailyReady = {};
    S.dailyReady[date] = result.dailyReady;
    updateDailyReadyUi(date);
    checkDailyReadyReminder();
  } catch (error) {
    // A temporary network error should not interrupt editing or hide the page.
  }
}

function startDailyReadyPolling() {
  clearInterval(dailyReadyPollTimer);
  // Fetch once immediately, then keep all open browsers in sync (every 30 s
  // in the demo to stay well inside the Apps Script quota).
  // The server is the single source of truth; a ready status received here
  // also closes a reminder that another machine may already have displayed.
  void pollDailyReady();
  dailyReadyPollTimer = setInterval(() => {
    void pollDailyReady();
  }, 30000);
}

function dailyBalance(row) {
  return Number(row.opening || 0) +
    Number(row.receive || 0) +
    Number(row.returnPackaging || 0) +
    Number(row.returnSupplier || 0) -
    Number(row.qaIssue || 0) -
    Number(row.sendBackSupplier || 0) -
    Number(row.issuePackaging || 0);
}

function dailyBalanceClass(row) {
  const balance = Number(row.remaining || 0);
  if (balance < 0) return 'neg';
  if (Number(row.max || 0) > 0 && balance > Number(row.max)) return 'over';
  if (Number(row.min || 0) > 0 && balance < Number(row.min)) return 'low';
  return 'ok';
}

// Min / Max / Safety / unit in edit mode: master data → full version only.
function dailyLockedCell(text, kind = '') {
  return `<td class="daily-edit-col ${kind} daily-readonly-cell demo-locked-cell" title="${DEMO_LOCK} ${esc(DEMO_PREMIUM_MESSAGE)}"
    onclick="A.premium('แก้ไข Min / Max / Safety / หน่วยนับ')">${DEMO_LOCK} ${esc(text)}</td>`;
}

function dailyReadonlyCell(value, kind = '', numeric = false) {
  const text = numeric
    ? fmt1(value)
    : kind.includes('date')
    ? (dateInputDisplay(value) || '-')
    : (String(value || '').trim() || '-');
  return `<td class="daily-edit-col ${kind} daily-readonly-cell">${esc(text)}</td>`;
}

const DAILY_ORACLE_EDIT_FIELDS = new Set([
  'receive', 'returnPackaging', 'returnSupplier',
  'qaIssue', 'sendBackSupplier', 'issuePackaging',
]);

// Evaluate the small calculator syntax accepted in daily numeric cells without
// using eval: numbers, parentheses, +, -, *, and /. The final value must be
// finite and non-negative because these are stock quantities.
function evaluateDailyNumber(raw) {
  const text = String(raw ?? '').replace(/,/g, '').trim();
  if (text === '') return 0;
  if (!/^[0-9+\-*/().\s]+$/.test(text)) return null;
  let pos = 0;
  const skip = () => { while (/\s/.test(text[pos] || '')) pos++; };
  const factor = () => {
    skip();
    if (text[pos] === '+') { pos++; return factor(); }
    if (text[pos] === '-') { pos++; const value = factor(); return value === null ? null : -value; }
    if (text[pos] === '(') {
      pos++;
      const value = expression();
      skip();
      if (text[pos] !== ')') return null;
      pos++;
      return value;
    }
    const start = pos;
    while (/[0-9.]/.test(text[pos] || '')) pos++;
    const token = text.slice(start, pos);
    if (!token || token === '.' || (token.match(/\./g) || []).length > 1) return null;
    const value = Number(token);
    return Number.isFinite(value) ? value : null;
  };
  const term = () => {
    let value = factor();
    if (value === null) return null;
    while (true) {
      skip();
      const operator = text[pos];
      if (operator !== '*' && operator !== '/') break;
      pos++;
      const right = factor();
      if (right === null || (operator === '/' && right === 0)) return null;
      value = operator === '*' ? value * right : value / right;
      if (!Number.isFinite(value)) return null;
    }
    return value;
  };
  function expression() {
    let value = term();
    if (value === null) return null;
    while (true) {
      skip();
      const operator = text[pos];
      if (operator !== '+' && operator !== '-') break;
      pos++;
      const right = term();
      if (right === null) return null;
      value = operator === '+' ? value + right : value - right;
      if (!Number.isFinite(value)) return null;
    }
    return value;
  }
  const result = expression();
  skip();
  return result !== null && pos === text.length && Number.isFinite(result) && result >= 0 ? result : null;
}

function commitDailyNumber(input, notify = false) {
  const value = evaluateDailyNumber(input.value);
  if (value === null) {
    input.classList.add('calc-error');
    input.title = 'กรอกตัวเลขหรือสูตร เช่น 1+5, (10-2)*3';
    if (notify) toast('สูตรตัวเลขไม่ถูกต้อง หรือผลลัพธ์ติดลบ', 'err');
    return false;
  }
  input.classList.remove('calc-error');
  input.title = 'กรอกตัวเลขหรือสูตรได้ เช่น 1+5';
  input.value = value === 0 ? '' : String(Number(value.toFixed(10)));
  return true;
}

function dailyCell(row, field, label, kind) {
  const value = Number(row[field] || 0);
  const canEditOracleMovement = row.oracleOnly && DAILY_ORACLE_EDIT_FIELDS.has(field);
  if (!dailyEditActive() || (row.oracleOnly && !canEditOracleMovement)) return dailyReadonlyCell(value, kind, true);
  if (kind === 'setting') return dailyLockedCell(fmt1(value), kind);
  return `<td class="daily-edit-col ${kind}">
    <input class="daily-cell-input" type="text" min="0" step="any" inputmode="decimal" autocomplete="off"
      value="${value || ''}" placeholder="0"
      data-row="${esc(row.id)}" data-field="${field}"
      aria-label="${esc(label)} ${esc(row.code)}" title="กรอกตัวเลขหรือสูตรได้ เช่น 1+5">
  </td>`;
}

function dailyTextCell(row, field, label, kind, placeholder = 'หน่วย', maxLength = 50) {
  if (!dailyEditActive() || row.oracleOnly) return dailyReadonlyCell(row[field], kind, false);
  if (field === 'unit') return dailyLockedCell(String(row[field] || '').trim() || '-', kind);
  const inputClass = kind === 'comment' ? 'daily-comment-input' : 'daily-text-input';
  return `<td class="daily-edit-col ${kind}">
    <input class="daily-cell-input ${inputClass}" type="text" maxlength="${maxLength}"
      value="${esc(row[field] || '')}" placeholder="${esc(placeholder)}"
      data-row="${esc(row.id)}" data-field="${field}" data-value-type="text"
      aria-label="${esc(label)} ${esc(row.code)}" title="คลิกแล้วกรอกข้อความได้เลย">
  </td>`;
}

// Date text fields accept day/month/year for display, while the parser keeps
// the ledger's ISO ค.ศ. value and still accepts a พ.ศ. year such as 2569.
const DATE_MIN = '2000-01-01';
const DATE_MAX = '2100-12-31';

// Returns a Thai error message, or '' when the value is acceptable (empty is allowed).
function dateFieldError(value, label) {
  const text = String(value || '').trim();
  if (text === '') return '';
  const match = /^(\d+)-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return `${label} ไม่ถูกต้อง`;
  const year = Number(match[1]);
  if (match[1].length > 4) return `${label}: ปี ${match[1]} มี ${match[1].length} หลัก — พิมพ์เลขเกินมา กรุณาแก้ให้เหลือ 4 หลัก`;
  if (year > 2100) return `${label}: ปี ${year} เกินช่วงที่ใช้ได้ — ระบบใช้ ค.ศ. (พ.ศ. ${year} = ค.ศ. ${year - 543})`;
  if (year < 2000) return `${label}: ปี ${year} เก่าเกินไป กรุณาตรวจสอบ`;
  return '';
}

function dailyDateCell(row, field, label) {
  if (!dailyEditActive() || row.oracleOnly) return dailyReadonlyCell(row[field], 'trace date', false);
  return `<td class="daily-edit-col trace date">
    ${dateInputHtml('', row[field], 'daily-cell-input daily-date-input', `
      data-row="${esc(row.id)}" data-field="${field}" data-value-type="date"
      data-date-label="${esc(label)}"
      aria-label="${esc(label)} ${esc(row.code)}" title="กรอกวันที่รูปแบบ วว/ดด/ค.ศ. เช่น 01/09/2026"`, `min="${DATE_MIN}" max="${DATE_MAX}"`)}
  </td>`;
}

function updateDailySaveState() {
  const count = $('#daily-dirty-count');
  if (!count) return;
  count.classList.toggle('saving', dailyAutosaveRunning);
  count.classList.toggle('error', false);
  count.textContent = dailyAutosaveRunning
    ? `กำลังบันทึกอัตโนมัติ ${fmt(dailyDirty.size)} แถว…`
    : dailyDirty.size
      ? `${fmt(dailyDirty.size)} แถวรอบันทึกอัตโนมัติ`
      : 'บันทึกอัตโนมัติแล้ว';
}

function dailyOraclePromotionArea(row) {
  let area = String(row.oracleArea || '').trim();
  const temporaryLocator = /^__oracle_locator__(\d+)$/i.exec(area);
  if (temporaryLocator) area = temporaryLocator[1];
  return area || oracleLocatorKey(row.locator) || '__main__';
}

function dailyRowPayload(row) {
  const payload = {
    id: row.id,
    receive: Number(row.receive || 0),
    returnPackaging: Number(row.returnPackaging || 0),
    returnSupplier: Number(row.returnSupplier || 0),
    qaIssue: Number(row.qaIssue || 0),
    sendBackSupplier: Number(row.sendBackSupplier || 0),
    issuePackaging: Number(row.issuePackaging || 0),
    lot: String(row.lot || ''),
    mfgDate: String(row.mfgDate || ''),
    expiryDate: String(row.expiryDate || ''),
    min: Number(row.min || 0),
    max: Number(row.max || 0),
    safety: Number(row.safety || 0),
    unit: String(row.unit || ''),
    supplier: String(row.supplier || ''),
    unitComment: String(row.unitComment || ''),
  };
  if (row.oracleOnly) {
    payload.createFromOracle = true;
    payload.code = String(row.code || '');
    payload.name = String(row.name || '');
    payload.area = dailyOraclePromotionArea(row);
    payload.locator = String(row.locator || '');
  }
  return payload;
}

function resetDailyAutosaveState() {
  clearTimeout(dailyAutosaveTimer);
  clearTimeout(dailyAutosaveRetryTimer);
  dailyAutosaveTimer = null;
  dailyAutosaveRetryTimer = null;
  dailyAutosaveRunning = false;
  dailyDirty.clear();
  dailyDraftRows.clear();
  dailyEditVersions.clear();
}

function queueDailyAutosave(delay = 650) {
  clearTimeout(dailyAutosaveTimer);
  dailyAutosaveTimer = setTimeout(() => void flushDailyAutosave(), delay);
  updateDailySaveState();
}

async function flushDailyAutosave() {
  clearTimeout(dailyAutosaveTimer);
  dailyAutosaveTimer = null;
  if (dailyAutosaveRunning || dailyDirty.size === 0) return;

  const saveDate = txnDate;
  const ids = [...dailyDirty];
  const versions = new Map(ids.map(id => [id, dailyEditVersions.get(id) || 0]));
  const rows = ids.map(id => dailyDraftRows.get(id)).filter(Boolean).map(dailyRowPayload);
  if (!rows.length) return;

  dailyAutosaveRunning = true;
  updateDailySaveState();
  try {
    const result = await api('daily_ledger_save', {date: saveDate, rows: JSON.stringify(rows)});
    for (const id of ids) {
      if ((dailyEditVersions.get(id) || 0) !== versions.get(id)) continue;
      dailyDirty.delete(id);
      dailyDraftRows.delete(id);
      const tr = $$('.daily-item-row', $('#view-txn')).find(el => el.dataset.row === id);
      tr?.classList.remove('dirty-row');
      $$('.daily-cell-input', tr || document.createElement('div')).forEach(input => input.classList.remove('dirty'));
    }
    clearTimeout(dailyAutosaveRetryTimer);
    dailyAutosaveRetryTimer = null;
    if (result.createdRows?.length && currentView === 'txn' && txnDate === saveDate && dailyDirty.size === 0) {
      VIEWS.txn();
    }
  } catch (error) {
    const count = $('#daily-dirty-count');
    if (count) {
      count.textContent = 'บันทึกไม่สำเร็จ — กำลังลองใหม่';
      count.classList.add('error');
    }
    toast(error.message || 'บันทึกอัตโนมัติไม่สำเร็จ', 'err');
    clearTimeout(dailyAutosaveRetryTimer);
    dailyAutosaveRetryTimer = setTimeout(() => void flushDailyAutosave(), 3000);
  } finally {
    dailyAutosaveRunning = false;
    updateDailySaveState();
    if (dailyDirty.size && !dailyAutosaveRetryTimer) queueDailyAutosave(250);
  }
}

function filterDailyRows(value) {
  const q = String(value || '').trim().toLowerCase();
  dailyFilter = value;
  let visible = 0;
  $$('.daily-item-row', $('#view-txn')).forEach(row => {
    const showRow = !q || (row.dataset.search || '').includes(q);
    row.hidden = !showRow;
    if (showRow) visible++;
  });
  $$('.daily-section-row', $('#view-txn')).forEach(row => { row.hidden = Boolean(q); });
  const count = $('#daily-visible');
  if (count) count.textContent = `${fmt(visible)} รายการ${count.dataset.area ? ` · ${count.dataset.area}` : ''}`;
}

VIEWS.txn = function () {
  const ledgers = S.dailyLedgers || {};
  const dates = Object.keys(ledgers).sort();
  if (!txnDate) txnDate = dates.at(-1) || S.today;
  const ledger = ledgers[txnDate];
  // A missing selected day is prepared from the immediately preceding day,
  // including when the page is opened in read-only mode. This is the agreed
  // daily-table bootstrap, not a user edit action.
  if (!ledger) void ensureDailyLedger(txnDate);
  const ledgerItemRows = ledger ? ledger.rows.filter(r => r.kind === 'item') : [];
  const ledgerRowLocators = ledger ? dailyLedgerRowLocators(ledger.rows) : new Map();
  if (!Object.prototype.hasOwnProperty.call(oracleSnapshotCache, txnDate)) loadOracleSnapshot(txnDate);
  const oracleSnapshot = oracleSnapshotCache[txnDate];
  const oracleOnlyRows = buildOracleOnlyRows(ledgerItemRows, oracleSnapshot, txnDate, ledgerRowLocators);
  const allItemRows = [...ledgerItemRows, ...oracleOnlyRows];
  const oracleLotsByItem = new Map();
  for (const record of Object.values(oracleSnapshot?.records || {})
    .filter(record => !oracleLocatorExcluded(record.locator))) {
    const code = oraclePart(record.itemCode);
    if (!oracleLotsByItem.has(code)) oracleLotsByItem.set(code, []);
    oracleLotsByItem.get(code).push(record);
  }
  for (const records of oracleLotsByItem.values()) {
    records.sort((a, b) => String(a.lot).localeCompare(String(b.lot)));
  }
  const areaCounts = new Map();
  const areaLabels = new Map([['__main__', 'รายการทั่วไป']]);
  const rowAreas = new Map();
  let scannedArea = '__main__';
  for (const row of ledger?.rows || []) {
    if (row.kind === 'section') {
      scannedArea = String(row.title || 'พื้นที่อื่น');
      if (!areaCounts.has(scannedArea)) areaCounts.set(scannedArea, 0);
      areaLabels.set(scannedArea, scannedArea);
    } else if (row.kind === 'item') {
      rowAreas.set(row.id, scannedArea);
      areaCounts.set(scannedArea, (areaCounts.get(scannedArea) || 0) + 1);
    }
  }
  const areaByLocator = new Map();
  for (const area of areaLabels.keys()) {
    const locator = oracleLocatorKey(area);
    if (locator && !areaByLocator.has(locator)) areaByLocator.set(locator, area);
  }
  for (const row of oracleOnlyRows) {
    const locator = oracleLocatorKey(row.locator);
    let areaKey = areaByLocator.get(locator) || '';
    if (!areaKey && locator) {
      areaKey = `__oracle_locator__${locator}`;
      if (!areaLabels.has(areaKey)) areaLabels.set(areaKey, String(row.locator || locator));
    }
    if (!areaKey) areaKey = '__oracle_only__';
    rowAreas.set(row.id, areaKey);
    if (areaKey === '__oracle_only__') continue;
    areaCounts.set(areaKey, (areaCounts.get(areaKey) || 0) + 1);
    row.oracleArea = areaKey;
  }
  if (oracleOnlyRows.some(row => rowAreas.get(row.id) === '__oracle_only__')) {
    areaLabels.set('__oracle_only__', 'มีแต่ใน Oracle');
  }
  const packagingRows = dailyRowsForFilter(allItemRows, rowAreas, DAILY_FILTER_PACKAGING_ALL);
  const packagingOracleOnlyRows = oracleOnlyRows.filter(row =>
    dailyAreaGroupKey(rowAreas.get(String(row.id || ''))) === 'packaging_primary'
  );
  const packagingSecondaryRows = allItemRows.filter(row =>
    dailyAreaGroupKey(rowAreas.get(String(row.id || ''))) === 'packaging_secondary'
  );
  const packaging2100Rows = dailyRowsForFilter(allItemRows, rowAreas, DAILY_FILTER_PACKAGING_2100);
  const packaging2200Rows = dailyRowsForFilter(allItemRows, rowAreas, DAILY_FILTER_PACKAGING_2200);
  const packagingSecondaryOracleOnlyRows = oracleOnlyRows.filter(row =>
    dailyAreaGroupKey(rowAreas.get(String(row.id || ''))) === 'packaging_secondary'
  );
  const validSpecialFilters = new Set([
    '__oracle__', '__difference__', '__oracle_only__',
    DAILY_FILTER_PACKAGING_ALL, DAILY_FILTER_PACKAGING_ORACLE_ONLY,
    DAILY_FILTER_PACKAGING_2100, DAILY_FILTER_PACKAGING_2200,
  ]);
  const validAreaFilters = new Set([
    ...validSpecialFilters,
    ...DAILY_PRIMARY_AREA_ORDER,
    '2100', '2200',
    ...areaLabels.keys(),
  ]);
  if (dailyAreaFilter !== 'all' && !validAreaFilters.has(dailyAreaFilter)) dailyAreaFilter = DAILY_FILTER_PACKAGING_ALL;
  const isOracleView = dailyAreaFilter === '__oracle__';
  const isDifferenceView = dailyAreaFilter === '__difference__';
  const isLegacyOracleOnlyView = dailyAreaFilter === '__oracle_only__';
  const isOracleOnlyView = isLegacyOracleOnlyView
    || dailyAreaFilter === DAILY_FILTER_PACKAGING_ORACLE_ONLY;
  // Merged totals are a summary of many rows at once, so they are never editable.
  const isMergedView = dailyGroupMode === 'merged' && !isOracleView && !isDifferenceView && !isOracleOnlyView;
  // The grouped "มีแต่ใน Oracle" tab is editable for movement fields. Keep the
  // old generic filter read-only for compatibility with older links/bookmarks.
  const isReadOnlyView = !dailyEditActive() || isOracleView || isDifferenceView || isLegacyOracleOnlyView || isMergedView;
  dailyViewReadOnly = isReadOnlyView;
  if (isReadOnlyView) labelUsagePickerActive = false;
  const oracleRecords = Object.values(oracleSnapshot?.records || {})
    .filter(record => !oracleLocatorExcluded(record.locator))
    .sort((a, b) => oracleLocatorKey(a.locator).localeCompare(oracleLocatorKey(b.locator))
      || String(a.itemCode).localeCompare(String(b.itemCode))
      || String(a.lot).localeCompare(String(b.lot)));
  const oracleTotalQty = oracleRecords.reduce((sum, record) => sum + Number(record.qty || 0), 0);
  const reconciliationByKey = new Map();
  const actualMatchesByOracleKey = new Map();
  const preferredAreaByCode = new Map();
  for (const row of allItemRows) {
    const code = oraclePart(row.code);
    const lot = oraclePart(row.lot);
    if (!code) continue;
    const rowLocator = row.locator || ledgerRowLocators.get(String(row.id || '')) || '';
    const compareKey = oracleCompareKey(code, lot, rowLocator, oracleSnapshot);
    const areaKey = rowAreas.get(row.id) || '__main__';
    const preferredKey = `${code}|${oracleLocatorKey(rowLocator)}`;
    if (!preferredAreaByCode.has(preferredKey) || row.oracleImported) preferredAreaByCode.set(preferredKey, areaKey);
    const groupKey = `${areaKey}||${compareKey}`;
    if (!reconciliationByKey.has(groupKey)) {
      const created = {
        key: groupKey, compareKey, areaKey,
        areaText: areaLabels.get(areaKey) || areaKey || 'รายการทั่วไป',
        itemCode: code, lot: String(row.lot || ''),
        locator: String(rowLocator || ''),
        description: String(row.name || ''), actualQty: 0, oracleQty: 0,
        unit: String(row.unit || ''), hasOracleImported: false,
      };
      reconciliationByKey.set(groupKey, created);
    }
    const item = reconciliationByKey.get(groupKey);
    const matchKeys = new Set([compareKey, oracleKey(code, lot, '')]);
    for (const matchKey of matchKeys) {
      if (!actualMatchesByOracleKey.has(matchKey)) actualMatchesByOracleKey.set(matchKey, []);
      const matches = actualMatchesByOracleKey.get(matchKey);
      if (!matches.includes(item)) matches.push(item);
    }
    item.actualQty += Number(row.remaining || 0);
    item.description ||= String(row.name || '');
    item.unit ||= String(row.unit || '');
    item.hasOracleImported ||= Boolean(row.oracleImported);
  }
  for (const record of oracleRecords) {
    const code = oraclePart(record.itemCode);
    const lot = oraclePart(record.lot);
    const recordLocator = String(record.locator || '');
    const locatorKey = oracleLocatorKey(recordLocator);
    const compareKey = oracleRecordCompareKey(record, oracleSnapshot);
    const matches = actualMatchesByOracleKey.get(compareKey) || [];
    let item = matches.find(candidate => candidate.hasOracleImported);
    if (!item && matches.length === 1) item = matches[0];
    if (!item) {
      const fallbackArea = preferredAreaByCode.get(`${code}|${locatorKey}`)
        || areaByLocator.get(locatorKey)
        || (locatorKey ? `__oracle_locator__${locatorKey}` : '__unassigned__');
      if (locatorKey && !areaLabels.has(fallbackArea)) areaLabels.set(fallbackArea, recordLocator || locatorKey);
      const groupKey = `${fallbackArea}||${compareKey}`;
      item = reconciliationByKey.get(groupKey);
      if (!item) {
        item = {
          key: groupKey, compareKey, areaKey: fallbackArea,
          areaText: areaLabels.get(fallbackArea) || 'ไม่ระบุพื้นที่',
          itemCode: code, lot: String(record.lot || ''),
          locator: recordLocator,
          description: String(record.description || ''), actualQty: 0, oracleQty: 0,
          unit: String(record.uom || ''), hasOracleImported: false,
        };
        reconciliationByKey.set(groupKey, item);
      }
    }
    item.oracleQty += Number(record.qty || 0);
    item.description ||= String(record.description || '');
    item.unit ||= String(record.uom || '');
  }
  const differenceAreaOrder = new Map(
    [...areaCounts.keys()].map((areaKey, index) => [areaKey, index])
  );
  differenceAreaOrder.set('__unassigned__', differenceAreaOrder.size);
  const differenceRows = oracleSnapshot?.available
    ? [...reconciliationByKey.values()]
      .map(item => ({
        ...item,
        difference: Number(item.actualQty || 0) - Number(item.oracleQty || 0),
      }))
      .filter(item => Math.abs(item.difference) >= 0.000001)
      .sort((a, b) => {
        const byArea = (differenceAreaOrder.get(a.areaKey) ?? 9999) - (differenceAreaOrder.get(b.areaKey) ?? 9999);
        return byArea || String(a.itemCode).localeCompare(String(b.itemCode)) || String(a.lot).localeCompare(String(b.lot));
      })
    : [];
  const packagingDifferenceRows = differenceRows.filter(item =>
    dailyAreaGroupKey(item.areaKey) === 'packaging_primary'
  );
  const visibleDifferenceRows = isDifferenceView ? packagingDifferenceRows : differenceRows;
  const totalDifference = visibleDifferenceRows.reduce((sum, item) => sum + item.difference, 0);
  const itemRows = dailyAreaFilter === 'all'
    ? allItemRows
    : dailyAreaFilter === DAILY_FILTER_PACKAGING_ALL
    ? packagingRows
    : dailyAreaFilter === DAILY_FILTER_PACKAGING_ORACLE_ONLY
    ? packagingOracleOnlyRows
    : dailyAreaFilter === DAILY_FILTER_PACKAGING_2100
    ? packaging2100Rows
    : dailyAreaFilter === DAILY_FILTER_PACKAGING_2200
    ? packaging2200Rows
    : isOracleOnlyView ? oracleOnlyRows
    : (isOracleView || isDifferenceView) ? []
    : allItemRows.filter(row => rowAreas.get(row.id) === dailyAreaFilter);
  const mergedRows = isMergedView ? mergeRowsByCode(itemRows, areaLabels, rowAreas) : [];
  const mergedMultiRows = mergedRows.filter(row => row.rowCount > 1);
  const mergedTotalRemaining = mergedRows.reduce((sum, r) => sum + Number(r.remaining || 0), 0);
  const selectedAreaLabel = isDifferenceView
    ? 'คลังบรรจุภัณฑ์ · สรุปผลต่าง'
    : isOracleView
    ? 'ข้อมูลจากระบบ ERP'
    : isOracleOnlyView
    ? (dailyAreaFilter === DAILY_FILTER_PACKAGING_ORACLE_ONLY ? 'คลังบรรจุภัณฑ์ · มีแต่ใน Oracle' : 'มีแต่ใน Oracle')
    : dailyAreaFilter === DAILY_FILTER_PACKAGING_ALL
    ? 'คลังบรรจุภัณฑ์ · ทั้งหมด'
    : dailyAreaFilter === DAILY_FILTER_PACKAGING_2100
    ? 'คลังบรรจุ · 2100 ไลน์ 1'
    : dailyAreaFilter === DAILY_FILTER_PACKAGING_2200
    ? 'คลังบรรจุ · 2200 ไลน์ 2'
    : dailyAreaFilter === 'all'
    ? 'รวมทั้ง 2 คลัง · ทั้งหมด'
    : (areaLabels.get(dailyAreaFilter) || dailyAreaFilter);
  const primaryAreaTabs = DAILY_PRIMARY_AREA_ORDER.map(key => ({
    key,
    label: areaLabels.get(key) || key,
    count: areaCounts.get(key) || 0,
  }));
  const extraPrimaryAreaTabs = [...areaCounts]
    .filter(([key]) => dailyAreaGroupKey(key) === 'packaging_primary' && !DAILY_PRIMARY_AREA_ORDER.includes(key))
    .map(([key, count]) => ({key, label: areaLabels.get(key) || key, count}));
  const areaGroups = ledger ? [
    {
      key: 'packaging-primary',
      title: '1. คลังบรรจุภัณฑ์',
      tabs: [
        {key: DAILY_FILTER_PACKAGING_ALL, label: 'ทั้งหมด', count: packagingRows.length},
        ...primaryAreaTabs,
        ...extraPrimaryAreaTabs,
      ],
    },
    {
      key: 'packaging-secondary',
      title: '2. คลังบรรจุ',
      tabs: [
        {key: DAILY_FILTER_PACKAGING_2100, label: '2100 · ไลน์ 1', count: packaging2100Rows.length},
        {key: DAILY_FILTER_PACKAGING_2200, label: '2200 · ไลน์ 2', count: packaging2200Rows.length},
      ],
    },
    {
      key: 'packaging-combined',
      title: '3. รวมทั้ง 2 คลัง',
      tabs: [{key: 'all', label: 'ทั้งหมด', count: allItemRows.length}],
    },
  ] : [];
  const totalIn = itemRows.reduce((sum, r) => sum + Number(r.receive || 0) + Number(r.returnPackaging || 0) + Number(r.returnSupplier || 0), 0);
  const totalOut = itemRows.reduce((sum, r) => sum + Number(r.qaIssue || 0) + Number(r.sendBackSupplier || 0) + Number(r.issuePackaging || 0), 0);
  const negativeRows = itemRows.filter(r => Number(r.remaining || 0) < 0);
  const oracleMatchedRows = itemRows.filter(row =>
    oracleEntry(row, oracleSnapshot, ledgerRowLocators.get(String(row.id || '')))
  );
  const oracleDifferentRows = oracleMatchedRows.filter(row =>
    Math.abs(Number(row.remaining || 0) - Number(oracleEntry(row, oracleSnapshot, ledgerRowLocators.get(String(row.id || '')))?.qty || 0)) >= 0.000001
  );
  const oracleUnmatchedRows = oracleSnapshot?.available
    ? itemRows.filter(row => oraclePart(row.lot) && !oracleEntry(row, oracleSnapshot, ledgerRowLocators.get(String(row.id || ''))))
    : [];
  const codeCounts = new Map();
  const unitCommentByCode = new Map();
  for (const row of allItemRows) {
    codeCounts.set(row.code, (codeCounts.get(row.code) || 0) + 1);
    const comment = String(row.unitComment || '').trim();
    if (comment && !unitCommentByCode.has(String(row.code))) unitCommentByCode.set(String(row.code), comment);
  }
  let renderedSection = '';
  let renderedArea = '__main__';
  let renderedDifferenceArea = '';
  const selectedLedgerRows = dailyLedgerRowsForFilter(ledger?.rows || [], rowAreas, dailyAreaFilter);
  const selectedOracleOnlyRows = dailyAreaFilter === DAILY_FILTER_PACKAGING_ORACLE_ONLY
    ? packagingOracleOnlyRows
    : dailyAreaFilter === '__oracle_only__'
    ? oracleOnlyRows
    : dailyAreaFilter === 'all'
    ? oracleOnlyRows
    : oracleOnlyRows.filter(row => dailyFilterMatchesArea(rowAreas.get(String(row.id || '')), dailyAreaFilter));
  const tableRows = isOracleOnlyView
    ? [{id: 'oracle-only-section', kind: 'section', title: selectedAreaLabel, tone: 'normal', oracleDisplayArea: '__oracle_only__'}, ...selectedOracleOnlyRows]
    : buildDailyTableRows(selectedLedgerRows, selectedOracleOnlyRows);

  $('#view-txn').innerHTML = `
    <div class="page-head daily-page-head">
      <div>
        <div class="daily-heading-line">
          <h1>ตารางรับเข้า / เบิกจ่ายรายวัน</h1>
          ${ledger ? `<div class="daily-heading-controls">
            <div class="daily-edit-switch" role="group" aria-label="สิทธิ์การแก้ไขตาราง">
              <button type="button" class="daily-edit-mode-btn ${isReadOnlyView ? 'active' : ''}" aria-pressed="${isReadOnlyView ? 'true' : 'false'}" onclick="A.dailySetEditMode(false)">ดูอย่างเดียว</button>
              <button type="button" class="daily-edit-mode-btn ${!isReadOnlyView && dailyEditMode ? 'active' : ''}" aria-pressed="${!isReadOnlyView && dailyEditMode ? 'true' : 'false'}" onclick="A.dailySetEditMode(true)">แก้ไข</button>
            </div>
            <div class="daily-ready-control">
              <button type="button" id="daily-ready-btn" class="daily-ready-btn" onclick="A.dailyMarkReady()" ${isReadOnlyView ? 'disabled aria-disabled="true"' : ''}>○ พร้อมใช้งาน</button>
              <span id="daily-ready-meta" class="daily-ready-meta">ยังไม่ได้กดปุ่ม</span>
            </div>
          </div>` : ''}
        </div>
        <p>${isReadOnlyView ? 'โหมดดูอย่างเดียว: ดูข้อมูลและเลือกคลุมเพื่อคัดลอกได้ ไม่สามารถแก้ไขข้อมูล' : 'โหมดแก้ไข: คลิกช่องตัวเลข กรอก แล้วระบบบันทึกอัตโนมัติ'}</p>
        ${dailyEditMode && !demoEditableDate() ? `<p class="demo-locked-note">${DEMO_LOCK} เวอร์ชันทดลองแก้ไขได้เฉพาะตารางของวันนี้ — การแก้ไขย้อนหลังมีในเวอร์ชันเต็ม</p>` : ''}
        ${!isReadOnlyView ? `<p class="demo-locked-note">${DEMO_LOCK} เวอร์ชันทดลอง: กรอกรับเข้า / เบิกจ่าย / Lot / วันที่ / หมายเหตุ ได้ · Min / Max / Safety / หน่วย, ใบพาเลต, แยก Lot, ลบ, Export และพิมพ์ มีในเวอร์ชันเต็ม</p>` : ''}
        ${labelUsagePickerActive && !isReadOnlyView ? `<div class="label-usage-picker-banner">
          <span>📝 โหมดเลือกใบบันทึกการใช้ฉลาก: กด <b>＋ เลือกฉลาก</b> ที่แถวที่ต้องการ</span>
          <button type="button" class="btn btn-ghost btn-sm" onclick="A.labelUsageCancelPick()">ยกเลิกการเลือก</button>
        </div>` : ''}
        <div class="daily-print-meta">วันที่ ${thDate(txnDate, true)} · พื้นที่ ${esc(selectedAreaLabel)} · ${fmt(isDifferenceView ? visibleDifferenceRows.length : isOracleView ? oracleRecords.length : itemRows.length)} รายการ${isDifferenceView ? ` · ผลต่างสุทธิ ${totalDifference > 0 ? '+' : ''}${fmt1(totalDifference)}` : isOracleView ? ` · คงเหลือ Oracle รวม ${fmt1(oracleTotalQty)}` : ` · รับรวม ${fmt1(totalIn)} · จ่ายรวม ${fmt1(totalOut)}`}</div>
      </div>
      ${ledger ? `<div class="daily-area-tabs daily-area-groups" role="tablist" aria-label="เลือกกลุ่มคลังและพื้นที่จัดเก็บ">
        ${areaGroups.map(group => `<section class="daily-area-group daily-area-group-${esc(group.key)}">
          <div class="daily-area-group-title">${esc(group.title)}</div>
          <div class="daily-area-group-tabs">
            ${group.tabs.map(area => `<button type="button" role="tab"
              class="daily-area-tab ${area.oracle ? 'oracle-tab' : ''} ${area.difference ? 'difference-tab' : ''} ${dailyAreaFilter === area.key ? 'active' : ''}"
              aria-selected="${dailyAreaFilter === area.key ? 'true' : 'false'}"
              onclick="A.dailySetArea('${escJs(area.key)}')">
              <span>${esc(area.label)}</span><b>${fmt(area.count)}</b>
            </button>`).join('')}
          </div>
        </section>`).join('')}
      </div>` : ''}
    </div>

    <div class="card daily-toolbar">
      <div class="daily-date-nav">
        <button class="btn btn-ghost btn-sm" onclick="A.dailyShiftDate(-1)" aria-label="วันก่อนหน้า">‹</button>
        <div><label class="fl">วันที่ทำรายการ</label>
          ${dateInputHtml('daily-date', txnDate, 'daily-toolbar-date', 'data-testid="daily-date"')}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="A.dailyShiftDate(1)" aria-label="วันถัดไป">›</button>
      </div>
      ${ledger && !isOracleView && !isDifferenceView && !isOracleOnlyView ? `
        <div class="daily-mode-switch" role="group" aria-label="รูปแบบการแสดงข้อมูล">
          <button type="button" class="daily-mode-btn ${dailyGroupMode === 'lot' ? 'active' : ''}"
            aria-pressed="${dailyGroupMode === 'lot' ? 'true' : 'false'}"
            onclick="A.dailySetGroupMode('lot')"
            title="แสดงทีละบรรทัดตาม Lot — แก้ไขตัวเลขได้">🧾 ข้อมูลแยก Lot</button>
          <button type="button" class="daily-mode-btn ${dailyGroupMode === 'merged' ? 'active' : ''}"
            aria-pressed="${dailyGroupMode === 'merged' ? 'true' : 'false'}"
            onclick="A.dailySetGroupMode('merged')"
            title="รวมทุกบรรทัดที่มีเลข ITEM เดียวกันเป็นบรรทัดเดียว">📦 ข้อมูลรวม</button>
        </div>` : ''}
      ${ledger ? `
        <div class="daily-actions">
          ${!isReadOnlyView ? '<span id="daily-dirty-count" class="daily-save-state">บันทึกอัตโนมัติแล้ว</span>' : ''}
          ${!isReadOnlyView ? '<button class="btn btn-green" type="button" onclick="A.dailyOpenAddRow()">＋ เพิ่มรายการ</button>' : ''}
          <button class="btn btn-ghost btn-excel demo-locked" type="button" onclick="A.exportDailyExcel()" title="${DEMO_PREMIUM_MESSAGE}">${DEMO_LOCK} EXPORT EXCEL</button>
          <button class="btn btn-ghost demo-locked" type="button" onclick="A.dailyPrint()" title="${DEMO_PREMIUM_MESSAGE}">${DEMO_LOCK} พิมพ์เอกสาร</button>
        </div>` : ''}
    </div>

    ${!ledger ? `
      <div class="card daily-empty">
        <span class="e-ic">📅</span>
        <h2>ยังไม่มีตารางวันที่ ${thDate(txnDate, true)}</h2>
        <p>${dailyAutoCreateLoading.has(txnDate)
          ? 'กำลังคัดลอกตารางจากวันก่อนมาเป็น “ยกมา” …'
          : 'ระบบจะคัดลอกตารางจากวันก่อนมาเป็น “ยกมา” อัตโนมัติ'}</p>
        ${dailyAutoCreateLoading.has(txnDate) || isReadOnlyView
          ? '<p class="daily-readonly-note">โหมดดูอย่างเดียว — ระบบกำลังเตรียมตารางของวันที่เลือก</p>'
          : '<button class="btn btn-primary" data-testid="daily-create" onclick="A.dailyCreate()">＋ สร้างตารางวันนี้</button>'}
      </div>` : `
      <div class="card daily-grid-card">
        <div class="daily-grid-tools">
          <div class="search daily-search">
            <input id="daily-q" value="${esc(dailyFilter)}" placeholder="🔍 ค้นหารหัสหรือชื่อรายการ…" autocomplete="off">
          </div>
          <span id="daily-visible" class="mut" data-area="${esc(selectedAreaLabel)}">${fmt(isDifferenceView ? visibleDifferenceRows.length : isOracleView ? oracleRecords.length : isMergedView ? mergedRows.length : itemRows.length)} รายการ · ${esc(selectedAreaLabel)}</span>
          ${isMergedView ? `<span class="daily-hint">รวมทุกบรรทัดที่มีเลข ITEM เดียวกันเข้าด้วยกัน · ตัวเลขทุกช่องเป็นผลรวม · มุมมองนี้ดูอย่างเดียว แก้ไขได้ที่ 🧾 ข้อมูลแยก Lot</span>` : `
          <span class="daily-hint">${oracleSnapshot?.available
            ? `${esc(oracleSnapshot.warehouse)} · ${esc(oracleSnapshot.mode)}${oracleSnapshot.refreshedAt ? ` · อัปเดต ${esc(oracleSnapshot.refreshedAt)}` : ''}${oracleSnapshot.holdFiltered ? ' · HOLD: เฉพาะ Secondary Qty = 0 และ Secondary UOM ว่าง' : ''} · ${isDifferenceView ? 'แสดงเฉพาะผลต่างที่ไม่เท่ากับ 0' : isOracleView ? 'แยกรายการตาม Itemcode + Lot + Locator แล้ว' : 'เลือก Lot เพื่อเทียบยอดตาม Locator'} · พิมพ์สูตรได้ เช่น 1+5`
            : 'ช่องสีเขียว = รับเข้า · ช่องสีชมพู = เบิก/จ่าย · พิมพ์สูตรได้ เช่น 1+5 · กด Enter เพื่อไปแถวถัดไป'}</span>`}
        </div>
        <div class="daily-grid-shell">
          ${isMergedView ? `
          <table class="daily-table merged-table" id="daily-table" data-testid="daily-merged-table">
            <thead><tr>
              <th>ITEM</th><th>รายการ</th>
              <th class="num">ยกมา</th>
              <th class="num receive-head">รับเข้า</th>
              <th class="num receive-head">รับคืน<br>บรรจุ</th>
              <th class="num receive-head">รับคืน<br>Sup.</th>
              <th class="num issue-head">จ่าย QA/<br>ตัวอย่าง</th>
              <th class="num issue-head">ส่งคืน<br>Sup.</th>
              <th class="num issue-head">จ่าย<br>บรรจุ</th>
              <th class="num">คงเหลือ</th>
              <th class="num">จำนวน Lot</th>
              <th>Lot</th>
              <th class="num">จุดต่ำสุด</th>
              <th class="num">จุดสูงสุด</th><th class="num">Safety</th><th>หน่วยนับ</th><th class="daily-comment-head">หมายเหตุ / คอมเม้น</th>
            </tr></thead>
            <tbody>${mergedRows.map(row => {
              const search = `${row.code} ${row.name} ${row.lots.join(' ')} ${row.areas.join(' ')}`.toLowerCase();
              return `<tr class="daily-item-row merged-row ${row.hold ? 'hold-row' : ''}"
                  data-row="${esc(row.id)}" data-search="${esc(search)}">
                <td class="daily-code">${esc(row.code)}</td>
                <td class="daily-name" title="${esc(row.name)}">${esc(row.name)}
                  ${row.areas.length ? `<span class="daily-row-group">${esc(row.areas.join(' · '))}</span>` : ''}
                  ${Number(row.remaining || 0) < 0 ? '<span class="daily-negative-tag">ติดลบ</span>' : ''}
                </td>
                <td class="num opening">${fmt1(row.opening)}</td>
                <td class="num merged-num receive">${fmt1(row.receive)}</td>
                <td class="num merged-num receive">${fmt1(row.returnPackaging)}</td>
                <td class="num merged-num receive">${fmt1(row.returnSupplier)}</td>
                <td class="num merged-num issue">${fmt1(row.qaIssue)}</td>
                <td class="num merged-num issue">${fmt1(row.sendBackSupplier)}</td>
                <td class="num merged-num issue">${fmt1(row.issuePackaging)}</td>
                <td class="num daily-balance ${dailyBalanceClass(row)}">${fmt1(row.remaining)}</td>
                <td class="num merged-count">${row.rowCount > 1
                  ? `<span class="merged-count-tag">${fmt(row.rowCount)}</span>`
                  : '<span class="mut">1</span>'}</td>
                <td class="merged-lots">${row.lots.length
                  ? esc(row.lots.join(', '))
                  : '<span class="mut">ไม่ระบุ Lot</span>'}</td>
                <td class="num merged-num">${fmt1(row.min)}</td>
                <td class="num merged-num">${fmt1(row.max)}</td>
                <td class="num merged-num">${fmt1(row.safety)}</td>
                <td class="merged-unit">${esc(row.unit || '-')}</td>
                <td class="daily-comment" title="${esc(row.unitComment || '')}">${esc(row.unitComment || '-')}</td>
              </tr>`;
            }).join('') || '<tr><td colspan="17" class="empty">ไม่พบรายการ</td></tr>'}</tbody>
          </table>
          ` : isDifferenceView ? `
          <table class="difference-summary-table" id="daily-table" data-testid="difference-summary-table">
            <thead><tr>
              <th>ITEM</th>
              <th>รายการ</th>
              <th>Lot</th>
              <th>Locator</th>
              <th class="num">ยอดจริง</th>
              <th class="num oracle-head">ยอด Oracle</th>
              <th class="num difference-head">ผลต่าง</th>
              <th>หน่วยนับ</th><th class="daily-comment-head">หมายเหตุ / คอมเม้น</th>
            </tr></thead>
            <tbody>${visibleDifferenceRows.map(item => {
              const search = `${item.itemCode} ${item.description} ${item.lot} ${item.locator} ${item.areaText} ${item.unit}`.toLowerCase();
              const state = item.difference > 0 ? 'more' : 'less';
              const areaHeading = item.areaKey !== renderedDifferenceArea
                ? `<tr class="daily-section-row ${item.areaText.includes('HOLD') ? 'hold' : ''}">
                    <td colspan="9">${esc(item.areaText)}</td>
                  </tr>`
                : '';
              renderedDifferenceArea = item.areaKey;
              return `${areaHeading}<tr class="daily-item-row difference-summary-row ${item.areaText.includes('HOLD') ? 'hold-row' : ''}" data-search="${esc(search)}">
                <td class="daily-code">${esc(item.itemCode)}</td>
                <td class="oracle-description">${esc(item.description || '-')}</td>
                <td class="oracle-lot">${esc(item.lot || 'ไม่ระบุ Lot')}</td>
                <td class="oracle-locator">${esc(item.locator || '-')}</td>
                <td class="num difference-actual">${fmt1(item.actualQty)}</td>
                <td class="num oracle-qty">${fmt1(item.oracleQty)}</td>
                <td class="num daily-difference ${state}">${item.difference > 0 ? '+' : ''}${fmt1(item.difference)}</td>
                <td class="oracle-uom">${esc(item.unit || '-')}</td>
                <td class="daily-comment" title="${esc(unitCommentByCode.get(item.itemCode) || '')}">${esc(unitCommentByCode.get(item.itemCode) || '-')}</td>
              </tr>`;
            }).join('') || '<tr><td colspan="9" class="empty">ไม่พบรายการที่มียอดต่าง</td></tr>'}</tbody>
          </table>
          ` : isOracleView ? `
          <table class="oracle-stock-table" id="daily-table" data-testid="oracle-stock-table">
            <thead><tr>
              <th>ITEM</th>
              <th>รายการจาก Oracle</th>
              <th>Lot</th>
              <th>Locator</th>
              <th>Org</th>
              <th class="num oracle-head">คงเหลือ Oracle</th>
              <th>หน่วยนับ</th><th class="daily-comment-head">หมายเหตุ / คอมเม้น</th>
            </tr></thead>
            <tbody>${oracleRecords.map(record => {
              const search = `${record.itemCode} ${record.description || ''} ${record.lot} ${record.locator || ''} ${(record.orgs || []).join(' ')} ${record.uom || ''}`.toLowerCase();
              return `<tr class="daily-item-row oracle-stock-row" data-search="${esc(search)}">
                <td class="daily-code">${esc(record.itemCode)}</td>
                <td class="oracle-description">${esc(record.description || '-')}</td>
                <td class="oracle-lot">${esc(record.lot)}</td>
                <td class="oracle-locator">${esc(record.locator || '-')}</td>
                <td class="oracle-org">${esc((record.orgs || []).join(', ') || '-')}</td>
                <td class="num oracle-qty">${fmt1(record.qty)}</td>
                <td class="oracle-uom">${esc(record.uom || '-')}</td>
                <td class="daily-comment" title="${esc(unitCommentByCode.get(record.itemCode) || '')}">${esc(unitCommentByCode.get(record.itemCode) || '-')}</td>
              </tr>`;
            }).join('') || `<tr><td colspan="8" class="empty">${esc(oracleSnapshot?.error || 'กำลังโหลดข้อมูล Oracle...')}</td></tr>`}</tbody>
          </table>
          ` : `
          <table class="daily-table" id="daily-table" data-testid="daily-table">
            <thead><tr>
              <th class="daily-pallet-head">🧾 ใบพาเลต</th>
              <th>ITEM</th><th>รายการ</th>
              <th>Lot</th>
              <th class="num">ยกมา</th>
              <th class="num receive-head">รับเข้า</th>
              <th class="num receive-head">รับคืน<br>บรรจุ</th>
              <th class="num receive-head">รับคืน<br>Sup.</th>
              <th class="num issue-head">จ่าย QA/<br>ตัวอย่าง</th>
              <th class="num issue-head">ส่งคืน<br>Sup.</th>
              <th class="num issue-head">จ่าย<br>บรรจุ</th>
              <th class="num">คงเหลือ</th>
              <th>วันที่ผลิต</th><th>วันหมดอายุ</th>
              <th class="num">จุดต่ำสุด</th>
              <th class="num">จุดสูงสุด</th><th class="num">Safety</th><th>หน่วยนับ</th><th class="daily-comment-head">หมายเหตุ / คอมเม้น</th>
              <th class="daily-delete-head">จัดการ</th>
            </tr></thead>
            <tbody>${tableRows.map(row => {
              if (row.kind === 'section') {
                renderedSection = row.title || '';
                renderedArea = row.oracleDisplayArea || String(row.title || 'พื้นที่อื่น');
                return `<tr class="daily-section-row ${row.tone === 'hold' ? 'hold' : ''}">
                  <td colspan="20">${esc(row.title)}</td></tr>`;
              }
              const group = row.oracleOnly ? 'มีแต่ใน Oracle' : renderedSection;
              const duplicate = (codeCounts.get(row.code) || 0) > 1;
              const rowLocator = row.locator || ledgerRowLocators.get(String(row.id || '')) || renderedArea;
              const search = `${row.code} ${row.name} ${row.lot || ''} ${rowLocator} ${row.mfgDate || ''} ${row.expiryDate || ''} ${group}`.toLowerCase();
              const comment = row.oracleOnly ? 'มีแต่ใน Oracle' : (row.unitComment || '-');
              return `<tr class="daily-item-row ${row.tone === 'hold' ? 'hold-row' : ''} ${row.splitFrom ? 'split-row' : ''} ${row.oracleOnly ? 'oracle-only-row' : ''}"
                  data-row="${esc(row.id)}" data-locator="${esc(rowLocator)}" data-search="${esc(search)}">
                <td class="daily-pallet-cell">
                  ${isReadOnlyView ? '<span class="daily-readonly-note">ดูอย่างเดียว</span>' : `<button type="button" class="daily-pallet-btn"
                    onclick="A.dailyOpenPallet('${escJs(row.id)}')"
                    aria-label="พิมพ์ใบกำกับพาเลตของ ${esc(row.code)}"
                    title="${DEMO_PREMIUM_MESSAGE}">${DEMO_LOCK} ใบพาเลต</button>`}
                  ${labelUsagePickerActive && !isReadOnlyView ? `<button type="button" class="daily-label-pick-btn"
                    onclick="A.labelUsagePickRow('${escJs(row.id)}')"
                    aria-label="เลือก ${esc(row.code)} ลงใบบันทึกการใช้ฉลาก"
                    title="เลือกรายการนี้ลงใบบันทึกการใช้ฉลาก">＋ เลือกฉลาก</button>` : ''}
                </td>
                <td class="daily-code">${esc(row.code)}</td>
                <td class="daily-name" title="${esc(group ? `${row.name} · ${group}` : row.name)}">${esc(row.name)}
                  ${duplicate && group ? `<span class="daily-row-group">${esc(group)}</span>` : ''}
                  ${Number(row.remaining || 0) < 0 ? '<span class="daily-negative-tag">ติดลบ</span>' : ''}
                  ${row.legacyAggregate ? '<span class="daily-unassigned-tag">ยอดเดิมยังไม่แยก Lot</span>' : ''}
                  ${row.splitFrom ? `<span class="daily-split-tag">แยก Lot${row.lot ? ` ${esc(row.lot)}` : ''}</span>` : ''}
                </td>
                ${dailyLotCell(row, oracleLotsByItem.get(oraclePart(row.code)) || [])}
                <td class="num opening">${fmt1(row.opening)}</td>
                ${dailyCell(row, 'receive', 'รับเข้า', 'receive')}
                ${dailyCell(row, 'returnPackaging', 'รับคืนบรรจุ', 'receive')}
                ${dailyCell(row, 'returnSupplier', 'รับคืน Supplier', 'receive')}
                ${dailyCell(row, 'qaIssue', 'จ่าย QA หรือตัวอย่าง', 'issue')}
                ${dailyCell(row, 'sendBackSupplier', 'ส่งคืน Supplier', 'issue')}
                ${dailyCell(row, 'issuePackaging', 'จ่ายบรรจุ', 'issue')}
                <td class="num daily-balance ${dailyBalanceClass(row)}">${fmt1(row.remaining)}</td>
                ${dailyDateCell(row, 'mfgDate', 'วันที่ผลิต')}
                ${dailyDateCell(row, 'expiryDate', 'วันหมดอายุ')}
                ${dailyCell(row, 'min', 'จุดต่ำสุด', 'setting')}
                ${dailyCell(row, 'max', 'จุดสูงสุด', 'setting')}
                ${dailyCell(row, 'safety', 'Safety', 'setting')}
                ${dailyTextCell(row, 'unit', 'หน่วยนับ', 'unit')}
                ${dailyTextCell(row, 'unitComment', 'หมายเหตุ / คอมเม้น', 'comment', 'พิมพ์หมายเหตุ / คอมเม้น', 250)}
                <td class="daily-delete-cell">
                  ${isReadOnlyView || row.oracleOnly ? '<span class="daily-readonly-note">ดูอย่างเดียว</span>' : `
                  <button type="button" class="daily-split-btn"
                    onclick="A.dailyOpenSplitLot('${escJs(row.id)}')"
                    aria-label="แยก Lot ของ ${esc(row.code)}"
                    title="${DEMO_PREMIUM_MESSAGE}">${DEMO_LOCK} แยก LOT</button>
                  <button type="button" class="daily-delete-btn"
                    onclick="A.dailyDeleteRow('${escJs(row.id)}')"
                    aria-label="ลบรายการ ${esc(row.code)}" title="${DEMO_PREMIUM_MESSAGE}">${DEMO_LOCK} ลบ</button>
                  `}
                </td>
              </tr>`;
            }).join('')}</tbody>
          </table>`}
        </div>
      </div>`}`;

  bindDateInputPickers($('#view-txn'));
  updateDailyReadyUi(txnDate);
  checkDailyReadyReminder();

  $('#daily-date').onchange = async e => {
    if (dailyDirty.size) {
      toast('กำลังบันทึกอัตโนมัติ กรุณารอสักครู่', 'err');
      e.target.value = dateInputDisplay(txnDate);
      return;
    }
    const nextDate = parseDateInput(e.target.value);
    const problem = dateInputError(e.target.value, 'วันที่ทำรายการ', true);
    if (problem) {
      e.target.classList.add('bad-date');
      e.target.value = dateInputDisplay(txnDate);
      return toast(problem, 'err');
    }
    e.target.classList.remove('bad-date');
    e.target.value = dateInputDisplay(nextDate);
    await openDailyDate(nextDate, dailyEditMode && !isReadOnlyView);
  };

  if (!ledger) return;

  $('#daily-q').oninput = e => filterDailyRows(e.target.value);
  filterDailyRows(dailyFilter);
  if (isReadOnlyView) return;

  $('#daily-table').oninput = e => {
    const input = e.target.closest('.daily-cell-input');
    if (!input) return;
    const row = ledger.rows.find(r => r.id === input.dataset.row)
      || oracleOnlyRows.find(r => r.id === input.dataset.row);
    if (!row) return;
    if (input.dataset.dateLabel) {
      const problem = dateInputError(input.value, input.dataset.dateLabel);
      input.classList.toggle('bad-date', !!problem);
      input.title = problem || `กรอก${input.dataset.dateLabel}รูปแบบ วว/ดด/ค.ศ.`;
      if (problem) {
        // Hold the bad value on screen so it can be corrected, but never save it.
        dailyDirty.delete(row.id);
        dailyDraftRows.delete(row.id);
        toast(problem, 'err');
        return;
      }
    }
    if (input.dataset.dateLabel) {
      row[input.dataset.field] = parseDateInput(input.value);
    } else if (input.dataset.valueType === 'text') {
      row[input.dataset.field] = input.value;
    } else {
      const value = evaluateDailyNumber(input.value);
      if (value === null) {
        input.classList.add('calc-error');
        input.title = 'กรอกตัวเลขหรือสูตร เช่น 1+5 (ห้ามติดลบ)';
        return;
      }
      input.classList.remove('calc-error');
      row[input.dataset.field] = value;
    }
    row.remaining = dailyBalance(row);
    dailyDirty.add(row.id);
    dailyDraftRows.set(row.id, row);
    dailyEditVersions.set(row.id, (dailyEditVersions.get(row.id) || 0) + 1);
    input.classList.add('dirty');
    const tr = input.closest('tr');
    tr.classList.add('dirty-row');
    const balance = $('.daily-balance', tr);
    balance.textContent = fmt1(row.remaining);
    balance.className = `num daily-balance ${dailyBalanceClass(row)}`;
    const oracleResult = oracleComparison(row, oracleSnapshot, tr.dataset.locator || '');
    const oracleTitle = oracleComparisonTitle(oracleResult, oracleSnapshot);
    const oracleCell = $('.daily-oracle', tr);
    const differenceCell = $('.daily-difference', tr);
    if (oracleCell) {
      oracleCell.textContent = oracleResult.text;
      oracleCell.className = `num daily-oracle ${oracleResult.state}`;
      oracleCell.title = oracleTitle;
    }
    if (differenceCell) {
      differenceCell.textContent = oracleResult.diffText;
      differenceCell.className = `num daily-difference ${oracleResult.state}`;
      differenceCell.title = oracleTitle;
    }
    queueDailyAutosave();
  };

  $('#daily-table').onkeydown = e => {
    const input = e.target.closest('.daily-cell-input');
    if (!input || e.key !== 'Enter') return;
    if (!input.dataset.valueType && !commitDailyNumber(input, true)) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    queueDailyAutosave(0);
    const sameColumn = $$(`.daily-cell-input[data-field="${input.dataset.field}"]`, $('#daily-table'))
      .filter(el => !el.closest('tr').hidden);
    const index = sameColumn.indexOf(input);
    const next = sameColumn[index + 1];
    if (next) { next.focus(); next.select(); }
  };
  $('#daily-table').onfocusout = e => {
    const input = e.target.closest('.daily-cell-input');
    if (!input) return;
    if (!input.dataset.valueType && !commitDailyNumber(input, true)) return;
    if (dailyDirty.size) queueDailyAutosave(0);
  };
  updateDailySaveState();
};

/* ═══ VIEW: History ═════════════════════════════════════════════════════ */
let histFilter = {from: '', to: '', type: 'all', q: ''};
const HIST_PAGE = 200;
let histShown = HIST_PAGE;

VIEWS.history = function () {
  let list = [...operationalTransactions()].sort((a, b) =>
    (b.date + (b.created || '')).localeCompare(a.date + (a.created || ''))
  );
  const f = histFilter;
  if (f.from) list = list.filter(t => t.date >= f.from);
  if (f.to)   list = list.filter(t => t.date <= f.to);
  if (f.type !== 'all') list = list.filter(t => t.type === f.type);
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter(t => {
      const it = itemBy(t.itemId || t.code);
      const name = t.itemName || it?.name || '';
      return t.code.toLowerCase().includes(q) || name.toLowerCase().includes(q) ||
        (t.person || '').toLowerCase().includes(q) || (t.dept || '').toLowerCase().includes(q);
    });
  }
  const sumOut = list.filter(t => t.type === 'withdraw').reduce((s, t) => s + t.qty, 0);
  const sumIn  = list.filter(t => t.type === 'receive' || t.type === 'return').reduce((s, t) => s + t.qty, 0);
  const shown = list.slice(0, histShown);

  $('#view-history').innerHTML = `
    <div class="page-head"><div><h1>ประวัติรายการ</h1><p>สร้างจากค่ารับเข้า รับคืน และเบิกจ่ายที่บันทึกในตารางรายวัน</p></div>
      <button class="btn btn-ghost demo-locked" onclick="A.exportCSV()" title="${DEMO_PREMIUM_MESSAGE}">${DEMO_LOCK} Export CSV</button></div>
    <div class="card">
      <div class="toolbar">
        <div><label class="fl">จากวันที่</label>${dateInputHtml('h-from', f.from, 'history-date-input')}</div>
        <div><label class="fl">ถึงวันที่</label>${dateInputHtml('h-to', f.to, 'history-date-input')}</div>
        <div><label class="fl">ประเภท</label><select id="h-type">
          <option value="all">ทั้งหมด</option>
          <option value="withdraw" ${f.type==='withdraw'?'selected':''}>เบิกจ่าย</option>
          <option value="receive"  ${f.type==='receive' ?'selected':''}>รับเข้า</option>
          <option value="return"   ${f.type==='return'  ?'selected':''}>คืนของ</option>
          <option value="adjust"   ${f.type==='adjust'  ?'selected':''}>ปรับยอด</option>
        </select></div>
        <div class="search"><label class="fl">ค้นหา</label><input id="h-q" placeholder="สินค้า / ผู้เบิก / แผนก…" value="${esc(f.q)}"></div>
      </div>
      <div class="toolbar" style="margin:4px 0 12px">
        <span class="badge plain">${fmt(list.length)} รายการ${list.length > shown.length ? ` (แสดง ${fmt(shown.length)})` : ''}</span>
        <span class="badge crit">เบิกรวม −${fmt(sumOut)}</span>
        <span class="badge ok">รับรวม +${fmt(sumIn)}</span>
      </div>
      <div class="tbl-wrap tbl-scroll" style="max-height:600px"><table>
        <thead><tr><th>วันที่</th><th>ประเภท</th><th>สินค้า</th><th>เลข LOT</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th>แผนก/Supplier</th><th>อ้างอิง</th><th>หมายเหตุ</th><th></th></tr></thead>
        <tbody>${shown.map(t => {
          const it = itemBy(t.itemId || t.code);
          const name = t.itemName || it?.name || t.code;
          return `<tr><td style="white-space:nowrap">${thDate(t.date, true)}</td>
            <td class="t-${t.type}">${esc(t.label || TXN_LABEL[t.type] || t.type)}</td>
            <td><div class="item-name small">${esc(name)}</div><div class="item-code">${esc(t.code)}</div></td>
            <td class="small mut">${esc(t.lot || '-')}</td>
            <td class="num t-${t.type}">${t.type==='withdraw'?'−':(t.qty<0?'':'+')}${fmt(t.qty)}</td>
            <td class="num">${t.remaining === undefined || t.remaining === null ? '-' : `${fmt(t.remaining)}${t.unit ? ` ${esc(t.unit)}` : ''}`}</td>
            <td class="small">${esc(t.dept || '-')}</td>
            <td class="small mut">${esc(t.ref || '-')}</td><td class="small mut">${esc(t.note || '-')}</td>
            <td>${t.source === 'daily-ledger'
              ? `<button class="btn btn-ghost btn-sm" onclick="A.historyOpen('${t.date}','${escJs(t.code)}')">ดูตาราง</button>`
              : `<button class="btn-danger-ghost demo-locked" onclick="A.txnDelete('${escJs(t.id)}')" title="${DEMO_PREMIUM_MESSAGE}">${DEMO_LOCK} ลบ</button>`}</td></tr>`;
        }).join('') || '<tr><td colspan="10" class="empty"><span class="e-ic">📭</span>ไม่พบรายการตามเงื่อนไข</td></tr>'}</tbody>
      </table></div>
      ${list.length > shown.length ? `<p class="mut small mt10"><button class="btn btn-ghost btn-sm" onclick="A.histMore()">แสดงเพิ่มอีก ${fmt(Math.min(HIST_PAGE, list.length - shown.length))} รายการ</button></p>` : ''}
    </div>`;

  bindDateInputPickers($('#view-history'));
  const updateHistoryDate = (key, input, label) => {
    const problem = dateInputError(input.value, label);
    if (problem) {
      input.classList.add('bad-date');
      input.value = dateInputDisplay(histFilter[key]);
      return toast(problem, 'err');
    }
    input.classList.remove('bad-date');
    histFilter[key] = parseDateInput(input.value);
    input.value = dateInputDisplay(histFilter[key]);
    histShown = HIST_PAGE;
    VIEWS.history();
  };
  $('#h-from').onchange = e => updateHistoryDate('from', e.target, 'จากวันที่');
  $('#h-to').onchange   = e => updateHistoryDate('to', e.target, 'ถึงวันที่');
  $('#h-type').onchange = e => { histFilter.type = e.target.value; histShown = HIST_PAGE; VIEWS.history(); };
  let hQTimer;
  $('#h-q').oninput = e => {
    const val = e.target.value;
    clearTimeout(hQTimer);
    hQTimer = setTimeout(() => {
      histFilter.q = val; histShown = HIST_PAGE; VIEWS.history();
      const el = $('#h-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
    }, 220);
  };
};

/* ═══ VIEW: แจ้งเตือนสต๊อก & ติดตาม Lot / วันหมดอายุ ═══════════════════════ */
let lotFilter = {q: '', expiry: 'all', area: 'all'};
const LOT_EXPIRY_BUCKETS = [
  {key: 'all', label: 'ทั้งหมด', cls: 'plain'},
  {key: 'expired', label: 'หมดอายุแล้ว', cls: 'crit'},
  {key: 'd30', label: 'ภายใน 30 วัน', cls: 'low'},
  {key: 'd90', label: '31–90 วัน', cls: 'over'},
  {key: 'later', label: 'เกิน 90 วัน', cls: 'ok'},
  {key: 'none', label: 'ไม่ระบุวันหมดอายุ', cls: 'plain'},
];

function lotExpiryBucket(lot) {
  if (lot.daysLeft === null) return 'none';
  if (lot.daysLeft < 0) return 'expired';
  if (lot.daysLeft <= 30) return 'd30';
  if (lot.daysLeft <= 90) return 'd90';
  return 'later';
}

VIEWS.pkg = function () {
  const dataDate = latestDailyDate() || S.today;
  const ledger = S.dailyLedgers?.[dataDate];
  const areaItems = dashboardItemsForArea(S.items, dataDate, DASHBOARD_AREA);
  const groups = dashboardItemsByCode(areaItems).map(item => ({item, st: itemStatus(item), u: usageStatsForDashboardGroup(item)}));
  const lowList = groups.filter(x => x.st.key === 'crit' || x.st.key === 'low')
    .sort((a, b) => a.item.stock / (a.item.min || 1) - b.item.stock / (b.item.min || 1));
  const overList = groups.filter(x => x.st.key === 'over')
    .sort((a, b) => (b.item.stock - b.item.max) / (b.item.max || 1) - (a.item.stock - a.item.max) / (a.item.max || 1));

  const lots = [];
  let area = '__main__';
  for (const row of ledger?.rows || []) {
    if (row.kind === 'section') { area = String(row.title || '').trim() || '__main__'; continue; }
    if (row.kind !== 'item') continue;
    const exp = /^\d{4}-\d{2}-\d{2}$/.test(String(row.expiryDate || '')) ? row.expiryDate : '';
    const daysLeft = exp ? Math.ceil((dateObj(exp) - dateObj(dataDate)) / 86400000) : null;
    lots.push({row, area, exp, daysLeft});
  }
  const counts = {};
  LOT_EXPIRY_BUCKETS.forEach(b => {
    counts[b.key] = b.key === 'all' ? lots.length : lots.filter(l => lotExpiryBucket(l) === b.key).length;
  });
  const areas = [...new Set(lots.map(l => l.area))];
  if (lotFilter.area !== 'all' && !areas.includes(lotFilter.area)) lotFilter.area = 'all';
  const q = lotFilter.q.trim().toLowerCase();
  const shownLots = lots
    .filter(l => (lotFilter.expiry === 'all' || lotExpiryBucket(l) === lotFilter.expiry)
      && (lotFilter.area === 'all' || l.area === lotFilter.area)
      && (!q || `${l.row.code} ${l.row.name} ${l.row.lot || ''}`.toLowerCase().includes(q)))
    .sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9)
      || String(a.row.code).localeCompare(String(b.row.code))
      || String(a.row.lot || '').localeCompare(String(b.row.lot || '')));

  const alertRow = (x, kind) => {
    const it = x.item;
    const identity = it.identities?.[0] || it.code;
    const detail = kind === 'low'
      ? `ขาดจาก Min ${fmt(Math.max(0, it.min - it.stock))} ${esc(it.unit)} · แนะนำสั่งเพิ่ม ~${fmt(Math.max(0, (it.max || it.min * 2) - it.stock))} ${esc(it.unit)}`
      : `เกิน Max ${fmt(it.stock - it.max)} ${esc(it.unit)} · ควรชะลอการรับเข้า / ย้ายพื้นที่`;
    const usage = x.u.avgDay > 0 ? ` · ใช้เฉลี่ย ${fmt1(x.u.avgDay)}/วัน` : '';
    return `<div class="stock-alert-row ${x.st.cls}" role="button" tabindex="0" onclick="A.openItem('${escJs(identity)}')"
        onkeydown="if(event.key==='Enter'){A.openItem('${escJs(identity)}')}">
      <div class="stock-alert-main">
        <div class="item-name">${esc(it.name)}</div>
        <div class="u-meta">ITEM ${esc(it.code)} · คงเหลือ <b>${fmt(it.stock)}</b> ${esc(it.unit)}${usage}</div>
        <div class="u-meta">${detail}</div>
      </div>
      <div class="stock-alert-lvl">${lvlBarHTML(it)}<span class="badge ${x.st.cls}">${x.st.label}</span></div>
    </div>`;
  };

  $('#view-pkg').innerHTML = `
    <div class="page-head"><div><h1>แจ้งเตือน &amp; ติดตาม Lot</h1>
      <p>แจ้งเตือนต่ำกว่า Min / เกิน Max ของพื้นที่ ${esc(DASHBOARD_AREA)} และติดตาม Lot · วันหมดอายุทุกพื้นที่ · ข้อมูลวันที่ ${thDate(dataDate, true)}</p></div>
      <button class="btn btn-primary" onclick="show('txn')">＋ บันทึกรับเข้า/เบิกจ่าย</button></div>

    <div class="stock-alert-grid">
      <div class="card stock-alert-card">
        <h2>🔔 ต่ำกว่า Min / หมดสต๊อก <span class="sub">${fmt(lowList.length)} รายการ · เรียงจากวิกฤตที่สุด</span></h2>
        ${lowList.map(x => alertRow(x, 'low')).join('') || '<div class="empty"><span class="e-ic">✅</span>ไม่มีรายการต่ำกว่า Min</div>'}
      </div>
      <div class="card stock-alert-card">
        <h2>🟣 เกิน Max <span class="sub">${fmt(overList.length)} รายการ · เกินความจุจัดเก็บ</span></h2>
        ${overList.map(x => alertRow(x, 'over')).join('') || '<div class="empty"><span class="e-ic">✅</span>ไม่มีรายการเกิน Max</div>'}
      </div>
    </div>

    <div class="card" id="lot-track-card">
      <h2>🏷️ ติดตาม Lot และวันหมดอายุ <span class="sub">ทุก Lot ในตารางรายวันล่าสุด · เรียงตามวันหมดอายุ</span></h2>
      <div class="lot-chip-row" role="group" aria-label="กรองตามวันหมดอายุ">
        ${LOT_EXPIRY_BUCKETS.map(b => `<button type="button" class="lot-chip ${b.cls} ${lotFilter.expiry === b.key ? 'active' : ''}"
          aria-pressed="${lotFilter.expiry === b.key ? 'true' : 'false'}" data-lot-expiry="${b.key}">${esc(b.label)} <b>${fmt(counts[b.key])}</b></button>`).join('')}
      </div>
      <div class="toolbar">
        <input class="search" id="lot-q" placeholder="🔍 ค้นหา ITEM / ชื่อ / Lot…" value="${esc(lotFilter.q)}">
        <select id="lot-area" aria-label="เลือกพื้นที่">
          <option value="all">ทุกพื้นที่</option>
          ${areas.map(a => `<option value="${esc(a)}" ${lotFilter.area === a ? 'selected' : ''}>${esc(a === '__main__' ? 'รายการทั่วไป' : a)}</option>`).join('')}
        </select>
        <span class="mut small">แสดง ${fmt(shownLots.length)} / ${fmt(lots.length)} Lot</span>
      </div>
      <div class="tbl-wrap tbl-scroll" style="max-height:620px"><table class="lot-track-table">
        <thead><tr><th>ITEM</th><th>รายการ</th><th>Lot</th><th>พื้นที่</th><th>วันที่ผลิต</th><th>วันหมดอายุ</th><th>อายุคงเหลือ</th><th class="num">คงเหลือ</th></tr></thead>
        <tbody>${shownLots.map(l => {
          const bucket = LOT_EXPIRY_BUCKETS.find(b => b.key === lotExpiryBucket(l));
          const daysText = l.daysLeft === null ? '-'
            : l.daysLeft < 0 ? `หมดอายุแล้ว ${fmt(Math.abs(l.daysLeft))} วัน`
            : l.daysLeft === 0 ? 'หมดอายุวันนี้' : `อีก ${fmt(l.daysLeft)} วัน`;
          return `<tr style="cursor:pointer" onclick="A.openItem('${escJs(l.row.id)}')">
            <td class="item-code">${esc(l.row.code)}</td>
            <td><div class="item-name small">${esc(l.row.name)}</div>${l.row.stockNote ? `<div class="u-meta">📝 ${esc(l.row.stockNote)}</div>` : ''}</td>
            <td class="dash-stock-lot">${esc(l.row.lot || '-')}</td>
            <td class="small">${esc(l.area === '__main__' ? 'รายการทั่วไป' : l.area)}</td>
            <td class="small">${thDate(l.row.mfgDate)}</td>
            <td class="small"><b>${thDate(l.exp)}</b></td>
            <td><span class="badge ${bucket.cls}">${daysText}</span></td>
            <td class="num"><b>${fmt1(l.row.remaining)}</b> <span class="mut small">${esc(l.row.unit || '')}</span></td>
          </tr>`;
        }).join('') || '<tr><td colspan="8" class="empty">ไม่พบ Lot ตามเงื่อนไข</td></tr>'}</tbody>
      </table></div>
    </div>`;

  $$('[data-lot-expiry]', $('#view-pkg')).forEach(button => {
    button.onclick = () => { lotFilter.expiry = button.dataset.lotExpiry; VIEWS.pkg(); };
  });
  $('#lot-area').onchange = e => { lotFilter.area = e.target.value; VIEWS.pkg(); };
  let lotTimer;
  $('#lot-q').oninput = e => {
    const value = e.target.value;
    clearTimeout(lotTimer);
    lotTimer = setTimeout(() => {
      lotFilter.q = value;
      VIEWS.pkg();
      const el = $('#lot-q');
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 200);
  };
};

/* ═══ VIEW: Stats (อัตราการใช้งาน) ══════════════════════════════════════ */
let statsPeriod = 'all';
let statsProductCode = '';
let statsUsageYear = '';

function statsDaysBetween(from, to) {
  return Math.max(1, Math.round((dateObj(to) - dateObj(from)) / 86400000) + 1);
}

function statsMonthLabel(key) {
  const [year, month] = key.split('-').map(Number);
  return `${TH_MONTHS_S[month - 1]} ${(year + 543).toString().slice(-2)}`;
}

function statsMonthKeys(from, to) {
  const out = [];
  const cursor = dateObj(from.slice(0, 7) + '-01');
  const end = dateObj(to.slice(0, 7) + '-01');
  while (cursor <= end) {
    out.push(isoDate(cursor).slice(0, 7));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out.reverse();
}

function statsRange(period, asOf, firstUsageDate) {
  const first = firstUsageDate || asOf;
  if (period === 'today') {
    return {from: asOf, to: asOf, days: 1, label: `วันนี้ · ${thDate(asOf)}`};
  }
  if (period === '7d') {
    const from = addDays(asOf, -6);
    return {from, to: asOf, days: 7, label: `7 วันย้อนหลัง · ${thDate(from)} – ${thDate(asOf)}`};
  }
  if (period.startsWith('month:')) {
    const key = period.slice(6);
    const [year, month] = key.split('-').map(Number);
    if (year && month >= 1 && month <= 12) {
      const from = `${year}-${String(month).padStart(2, '0')}-01`;
      const last = isoDate(new Date(year, month, 0));
      const to = key === asOf.slice(0, 7) ? asOf : last;
      return {from, to, days: statsDaysBetween(from, to), label: `เดือน ${statsMonthLabel(key)} · ${thDate(from)} – ${thDate(to)}`};
    }
  }
  return {from: first, to: asOf, days: statsDaysBetween(first, asOf), label: `ทั้งหมด · ${thDate(first)} – ${thDate(asOf)}`};
}

function buildStatsUsageIndex(range) {
  const byCode = new Map();
  for (const txn of operationalTransactions()) {
    if (txn.type !== 'withdraw' || !txn.date || txn.date < range.from || txn.date > range.to) continue;
    const key = String(txn.code || txn.itemId || '');
    if (!key) continue;
    let entry = byCode.get(key);
    if (!entry) {
      entry = {
        total: 0,
        days: new Set(),
        code: String(txn.code || ''),
        name: String(txn.itemName || txn.name || ''),
        unit: String(txn.unit || ''),
      };
      byCode.set(key, entry);
    }
    entry.total += Number(txn.qty || 0);
    entry.days.add(txn.date);
  }
  return {byCode};
}

function statsItemsByCode(index) {
  const grouped = new Map();
  const configuredUnitVotes = new Map();
  const configuredItems = Array.isArray(S.settingsItems) && S.settingsItems.length
    ? S.settingsItems
    : S.items;
  for (const item of configuredItems) {
    const code = String(item.code || itemIdentity(item) || '');
    const unit = String(item.unit || '').trim();
    if (!code || !unit) continue;
    const votes = configuredUnitVotes.get(code) || new Map();
    votes.set(unit, (votes.get(unit) || 0) + 1);
    configuredUnitVotes.set(code, votes);
  }
  const preferredUnit = (code, fallback = '') => {
    const votes = configuredUnitVotes.get(String(code));
    if (!votes?.size) return String(fallback || '');
    return [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  for (const item of S.items) {
    const code = String(item.code || itemIdentity(item) || '');
    if (!code) continue;
    let group = grouped.get(code);
    if (!group) {
      group = {
        code,
        name: String(item.name || ''),
        unit: preferredUnit(code, item.unit),
        stock: 0,
        min: 0,
        max: 0,
        safety: 0,
        identities: [],
        lotCount: 0,
      };
      grouped.set(code, group);
    }
    group.stock += Number(item.stock || 0);
    group.min += Number(item.min || 0);
    group.max += Number(item.max || 0);
    group.safety += Number(item.safety || 0);
    group.identities.push(itemIdentity(item));
    group.lotCount += 1;
  }
  const addHistoricalCode = (code, entry) => {
    if (!code || grouped.has(code) || !entry || entry.total <= 0) return;
    grouped.set(code, {
      code,
      name: entry.name || code,
      unit: preferredUnit(code, entry.unit),
      stock: 0,
      min: 0,
      max: 0,
      safety: 0,
      identities: [],
      lotCount: 0,
      historicalOnly: true,
    });
  };
  for (const [code, entry] of index.byCode) addHistoricalCode(String(code), entry);
  return [...grouped.values()];
}

function statsUsage(item, index, range) {
  const entries = [index.byCode.get(String(item.code || ''))].filter(Boolean);
  const days = new Set();
  let total = 0;
  for (const entry of entries) {
    total += entry.total;
    entry.days.forEach(day => days.add(day));
  }
  const avgDay = total / range.days;
  return {
    total,
    avgDay,
    activeDays: days.size,
    daysLeft: avgDay > 0 ? Number(item.stock || 0) / avgDay : Infinity,
  };
}

function statsMonthlyUsage(code, year) {
  const totals = Array(12).fill(0);
  const activeDays = Array(12).fill(0).map(() => new Set());
  const prefix = `${year}-`;
  for (const txn of operationalTransactions()) {
    if (txn.type !== 'withdraw' || String(txn.code || txn.itemId || '') !== String(code) || !txn.date || !txn.date.startsWith(prefix)) continue;
    const month = Number(txn.date.slice(5, 7)) - 1;
    if (month < 0 || month > 11) continue;
    totals[month] += Number(txn.qty || 0);
    activeDays[month].add(txn.date);
  }
  return {totals, activeDays: activeDays.map(days => days.size)};
}

function statsMonthlyAverage(total, year, monthIndex) {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  return daysInMonth ? Number(total || 0) / daysInMonth * 30 : 0;
}

VIEWS.stats = function () {
  const lead = S.config.leadTimeDays;
  const dataDate = latestDailyDate() || S.today;
  const withdraws = operationalTransactions().filter(t => t.type === 'withdraw' && t.date);
  const firstUsageDate = withdraws.map(t => t.date).sort()[0] || dataDate;
  const monthKeys = statsMonthKeys(firstUsageDate, dataDate);
  const periodOptions = [
    {key: 'today', label: 'วันนี้'},
    {key: '7d', label: '7 วันย้อนหลัง'},
    {key: 'all', label: 'ทั้งหมด'},
  ];
  const selectedMonthKey = statsPeriod.startsWith('month:') ? statsPeriod.slice(6) : '';
  if (!periodOptions.some(option => option.key === statsPeriod) && !monthKeys.includes(selectedMonthKey)) statsPeriod = 'all';
  const range = statsRange(statsPeriod, dataDate, firstUsageDate);
  const usageIndex = buildStatsUsageIndex(range);
  const allRange = statsRange('all', dataDate, firstUsageDate);
  const allUsageIndex = buildStatsUsageIndex(allRange);
  const allItems = statsItemsByCode(allUsageIndex);
  const withUsage = allItems.map(item => ({item, u: statsUsage(item, usageIndex, range)}))
    .filter(x => x.u.total > 0)
    .sort((a, b) => b.u.total - a.u.total);
  const catalog = allItems.map(item => ({item, u: statsUsage(item, allUsageIndex, allRange)}))
    .filter(x => x.u.total > 0)
    .sort((a, b) => b.u.total - a.u.total);
  if (!catalog.some(x => x.item.code === statsProductCode)) statsProductCode = '';
  const selectedProduct = catalog.find(x => x.item.code === statsProductCode)?.item || null;
  const availableYears = [...new Set(withdraws.map(t => Number(t.date.slice(0, 4))).filter(Number.isFinite))].sort((a, b) => b - a);
  if (!availableYears.length) availableYears.push(Number(dataDate.slice(0, 4)));
  if (!availableYears.includes(Number(statsUsageYear))) statsUsageYear = String(availableYears[0]);
  const monthly = selectedProduct ? statsMonthlyUsage(selectedProduct.code, Number(statsUsageYear)) : {totals: Array(12).fill(0), activeDays: Array(12).fill(0)};
  const monthlyMax = Math.max(...monthly.totals, 1);
  const monthlyTotal = monthly.totals.reduce((sum, value) => sum + value, 0);
  const monthlyPeak = monthly.totals.indexOf(Math.max(...monthly.totals));
  const totalUsage = withUsage.reduce((sum, x) => sum + x.u.total, 0);
  const maxTotal = withUsage.length ? withUsage[0].u.total : 1;
  const activeDays = new Set(withdraws.filter(t => t.date >= range.from && t.date <= range.to).map(t => t.date)).size;
  const totalAvgDay = totalUsage / range.days;

  $('#view-stats').innerHTML = `
    <div class="page-head"><div><h1>อัตราการใช้งาน</h1>
      <p>เลือกช่วงข้อมูลเพื่อดูยอดเบิกและอัตราการใช้ · อ้างอิงถึงวันที่ ${thDate(dataDate)} · Lead time ${lead} วัน</p></div></div>

    <div class="card stats-period-card">
      <h2>🗓️ เลือกช่วงข้อมูล <span class="sub">กดปุ่มเพื่อเปลี่ยนช่วงที่ใช้คำนวณ</span></h2>
      <div class="stats-period-buttons">
        ${periodOptions.map(option => `<button type="button" class="stats-period-btn ${option.key === statsPeriod ? 'active' : ''}" data-stats-period="${esc(option.key)}">${esc(option.label)}</button>`).join('')}
        <label class="stats-period-select-wrap"><span>เดือน</span><select id="stats-month-select" class="stats-period-select" aria-label="เลือกเดือน">
          <option value="" ${selectedMonthKey ? '' : 'selected'} disabled>เลือกเดือน</option>
          ${monthKeys.map(key => `<option value="month:${esc(key)}" ${selectedMonthKey === key ? 'selected' : ''}>${esc(statsMonthLabel(key))}</option>`).join('')}
        </select></label>
      </div>
      <div class="stats-period-meta">ช่วงที่เลือก: <b>${esc(range.label)}</b> · ${fmt(range.days)} วัน · มีการเบิก ${fmt(activeDays)} วัน</div>
    </div>

    <div class="kpi-grid">
      <div class="kpi"><div class="kic blue">📦</div><div><div class="kv">${fmtQtyTotal(totalUsage)}</div><div class="kl">เบิกรวมช่วงที่เลือก</div></div></div>
      <div class="kpi"><div class="kic green">📈</div><div><div class="kv">${fmt1(totalAvgDay)}</div><div class="kl">เฉลี่ยรวมต่อวัน</div></div></div>
      <div class="kpi"><div class="kic amber">🧾</div><div><div class="kv">${fmt(withUsage.length)}</div><div class="kl">สินค้าที่มีการเบิก</div></div></div>
      <div class="kpi"><div class="kic purple">🗓️</div><div><div class="kv">${fmt(activeDays)}</div><div class="kl">วันที่มีการเบิก</div></div></div>
    </div>

    ${withUsage.length ? `
    <div class="card"><h2>🏆 Top 10 ใช้มากที่สุด <span class="sub">ยอดเบิกตามช่วงที่เลือก</span></h2>
      ${withUsage.slice(0, 10).map(x => `
        <div class="bar-row">
          <div class="br-name" title="${esc(x.item.name)}">${esc(x.item.name)}</div>
          <div class="br-track"><div class="br-fill" style="width:${Math.max(2, x.u.total / maxTotal * 100)}%"></div></div>
          <div class="br-val">${fmtQtyTotal(x.u.total)} ${esc(x.item.unit)}</div>
        </div>`).join('')}
    </div>

    `
    : `<div class="card"><div class="empty"><span class="e-ic">📊</span>
        ยังไม่มีข้อมูลการเบิกจ่ายในช่วง ${esc(range.label)}<br>
        ลองเลือกช่วง "7 วันย้อนหลัง", เดือนย้อนหลัง หรือ "ทั้งหมด" เพื่อดูข้อมูลประวัติการเบิกจ่าย<br><br>
        <button class="btn btn-primary" onclick="show('txn')">ไปหน้าบันทึกเบิกจ่าย</button></div></div>`}

    <div class="card stats-monthly-card">
      <div class="stats-monthly-head"><div><h2>📅 เปรียบเทียบการใช้รายเดือน <span class="sub">ดูสินค้าเดียวกันเทียบทั้งปี</span></h2>
        <div class="stats-monthly-selected">${selectedProduct ? `<b>${esc(selectedProduct.name)}</b> · ITEM ${esc(selectedProduct.code)}` : 'พิมพ์หรือเลือกสินค้าเพื่อแสดงข้อมูลรายเดือน'}</div></div>
        <div class="stats-monthly-controls">
          <label>สินค้า<input id="stats-product-input" list="stats-product-options" aria-label="เลือกสินค้า" autocomplete="off" placeholder="เลือกสินค้า" value="${selectedProduct ? esc(`${selectedProduct.code} · ${selectedProduct.name}`) : ''}">
            <datalist id="stats-product-options">${catalog.map(x => `<option value="${esc(`${x.item.code} · ${x.item.name}`)}"></option>`).join('')}</datalist>
          </label>
          <label>ปี<select id="stats-year-select" aria-label="เลือกปี">
            ${availableYears.map(year => `<option value="${year}" ${String(year) === String(statsUsageYear) ? 'selected' : ''}>${year + 543} (${year})</option>`).join('')}
          </select></label>
        </div>
      </div>
      ${selectedProduct ? `<div class="stats-monthly-summary"><span>ใช้รวมปี ${Number(statsUsageYear) + 543}: <b>${fmt(monthlyTotal)} ${esc(selectedProduct.unit)}</b></span><span>เฉลี่ยต่อเดือน: <b>${fmt1(monthlyTotal / 12)} ${esc(selectedProduct.unit)}</b></span><span>ใช้สูงสุด: <b>${TH_MONTHS_S[monthlyPeak]} · ${fmt(monthly.totals[monthlyPeak])}</b></span></div>
      <div class="stats-monthly-chart" aria-label="กราฟการใช้รายเดือน">
        ${monthly.totals.map((value, index) => `<div class="stats-month-col" title="${esc(TH_MONTHS_S[index])}: ${fmt(value)} ${esc(selectedProduct.unit)} · ${fmt(monthly.activeDays[index])} วัน"><div class="stats-month-value">${value ? fmt(value) : '–'}</div><div class="stats-month-track"><div class="stats-month-fill ${index === monthlyPeak && value > 0 ? 'peak' : ''}" style="height:${value ? Math.max(4, value / monthlyMax * 100) : 2}%"></div></div><div class="stats-month-label">${esc(TH_MONTHS_S[index])}</div></div>`).join('')}
      </div>
      <div class="tbl-wrap stats-monthly-table"><table><thead><tr><th>เดือน</th><th class="num">ใช้รวม</th><th class="num" title="คำนวณจากยอดใช้จริงของเดือนนั้นเทียบเป็น 30 วัน">เฉลี่ย/เดือน</th><th class="num">วันที่มีการใช้</th><th class="num">สัดส่วนทั้งปี</th></tr></thead><tbody>
        ${monthly.totals.map((value, index) => `<tr><td>${esc(TH_MONTHS_S[index])}</td><td class="num"><b>${fmt(value)}</b> ${esc(selectedProduct.unit)}</td><td class="num"><b>${fmt1(statsMonthlyAverage(value, Number(statsUsageYear), index))}</b> ${esc(selectedProduct.unit)}</td><td class="num">${fmt(monthly.activeDays[index])} วัน</td><td class="num">${monthlyTotal ? fmt1(value / monthlyTotal * 100) : '0'}%</td></tr>`).join('')}
      </tbody><tfoot><tr><td><b>เฉลี่ยทั้งปี</b></td><td class="num"><b>${fmt1(monthlyTotal / 12)}</b> ${esc(selectedProduct.unit)}</td><td class="num"><b>${fmt1(monthlyTotal / 12)}</b> ${esc(selectedProduct.unit)}</td><td class="num">จากข้อมูลทั้งปี</td><td class="num">100%</td></tr></tfoot></table></div>` : '<div class="empty">ยังไม่มีข้อมูลการเบิกจ่ายสำหรับแสดงรายเดือน</div>'}
    </div>`;

  $$('#view-stats [data-stats-period]').forEach(button => {
    button.onclick = () => { statsPeriod = button.dataset.statsPeriod; VIEWS.stats(); };
  });
  const monthSelect = $('#stats-month-select');
  if (monthSelect) monthSelect.onchange = event => { statsPeriod = event.target.value || 'all'; VIEWS.stats(); };
  const productInput = $('#stats-product-input');
  const normalizeStatsProductText = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const resolveProductInput = event => {
    const value = normalizeStatsProductText(event.target.value);
    const codeMatch = value.match(/^\d+/)?.[0] || '';
    const choice = catalog.find(x => codeMatch && String(x.item.code || '').toLowerCase() === codeMatch)
      || catalog.find(x => {
        const code = normalizeStatsProductText(x.item.code);
        const name = normalizeStatsProductText(x.item.name);
        return value === code || value === name || value === `${code} · ${name}`;
      });
    if (choice && choice.item.code !== statsProductCode) {
      statsProductCode = choice.item.code;
      VIEWS.stats();
    }
  };
  if (productInput) {
    // Selecting a new product should replace the previous value, not append
    // to it. This also makes the native datalist usable after a product is selected.
    productInput.onfocus = event => event.target.select();
    productInput.oninput = resolveProductInput;
    productInput.onchange = resolveProductInput;
  }
  const yearSelect = $('#stats-year-select');
  if (yearSelect) yearSelect.onchange = event => { statsUsageYear = event.target.value; VIEWS.stats(); };
};

/* ═══ VIEW: Settings ════════════════════════════════════════════════════ */
let setQ = '';
let setFilter = 'all';
const itemFieldSaveTimers = {};
function settingsItemsByCode(items) {
  const grouped = new Map();
  for (const item of items) {
    const code = String(item.code || itemIdentity(item) || '').trim();
    if (!code) continue;
    let group = grouped.get(code);
    if (!group) {
      group = {
        ...item,
        code,
        stock: 0,
        identities: [],
        _settingValues: {min: [], max: [], safety: [], unit: [], supplier: []},
        settingsUnset: false,
      };
      grouped.set(code, group);
    }
    group.stock += Number(item.stock || 0);
    const identity = itemIdentity(item);
    if (identity && !group.identities.includes(identity)) group.identities.push(identity);
    for (const field of ['min', 'max', 'safety', 'unit', 'supplier']) group._settingValues[field].push(item[field]);
  }
  for (const group of grouped.values()) {
    for (const field of ['min', 'max', 'safety', 'unit', 'supplier']) {
      const values = group._settingValues[field];
      const first = values[0] ?? '';
      const same = values.every(value => String(value ?? '') === String(first));
      group[field] = same ? first : '';
    }
    group.settingsUnset = ['min', 'max', 'safety'].some(field => group[field] === '' || group[field] == null || Number(group[field]) === 0);
    delete group._settingValues;
  }
  return [...grouped.values()];
}

VIEWS.settings = function () {
  const q = setQ.toLowerCase();
  const groupedItems = settingsItemsByCode(S.items);
  const filteredItems = groupedItems.filter(i => {
    const matchesSearch = !q || i.code.includes(q) || i.name.toLowerCase().includes(q);
    const matchesFilter = setFilter === 'unset' ? i.settingsUnset : setFilter === 'complete' ? !i.settingsUnset : true;
    return matchesSearch && matchesFilter;
  });
  const list = [...filteredItems].sort((a, b) => a.code.localeCompare(b.code, undefined, {numeric: true, sensitivity: 'base'})).slice(0, 80);
  const dataDate = latestDailyDate() || S.today;
  const suppliers = masterList('suppliers');
  const supplierShelfLives = (Array.isArray(S.masterLists?.supplierShelfLives) ? S.masterLists.supplierShelfLives : suppliers.map(supplier => ({supplier, shelfLife: ''})))
    .map(row => ({supplier: String(row.supplier || '').trim(), shelfLife: String(row.shelfLife || '').trim()}))
    .filter(row => row.supplier);
  const units = masterList('units');

  $('#view-settings').innerHTML = `
    <div class="page-head"><div><h1>สินค้า &amp; ตั้งค่า</h1><p>ข้อมูลสินค้าเดียวกับตารางรายวันล่าสุด วันที่ ${thDate(dataDate, true)} · ตั้งค่า <b>หน่วย</b> และ <b>ชื่อบริษัทผู้ส่ง</b> เพื่อใช้เป็นค่าเริ่มต้นในใบพาเลท</p>
      <p class="demo-locked-note">${DEMO_LOCK} เวอร์ชันทดลอง: หน้านี้ดูได้อย่างเดียว — การแก้ไขสินค้า, Min / Max, ผู้ส่ง, หน่วย และพื้นที่จัดเก็บ มีในเวอร์ชันเต็ม</p></div></div>

    <div class="grid-2">
      <div class="card grid-2-full">
        <div class="master-settings-grid master-settings-main-grid">
          <div class="master-settings-box">
            <h2>🏷️ ชื่อบริษัทผู้ส่ง และ Shelf Life</h2>
            <div class="master-add-row master-supplier-add-row"><input id="master-supplier-name" readonly maxlength="150" placeholder="ชื่อบริษัทผู้ส่ง" autocomplete="off">
              <input id="master-supplier-shelf-life" readonly maxlength="150" placeholder="เช่น 12 เดือน" autocomplete="off">
              <button class="btn btn-green" type="button" onclick="A.addMaster('supplier')">${DEMO_LOCK} เพิ่ม</button></div>
            ${supplierShelfLives.length ? `<div class="tbl-wrap master-supplier-table-wrap"><table class="master-supplier-table">
              <thead><tr><th>ชื่อบริษัทผู้ส่ง (SUP)</th><th>Shelf Life / อายุสินค้า</th><th>จัดการ</th></tr></thead>
              <tbody>${supplierShelfLives.map(row => `<tr><td>${esc(row.supplier)}</td><td>${esc(row.shelfLife || '-')}</td><td class="master-table-actions">
                <button type="button" class="master-chip-edit" onclick="A.renameMaster('supplier','${escJs(row.supplier)}')" aria-label="แก้ไข ${esc(row.supplier)}" title="${DEMO_PREMIUM_MESSAGE}">${DEMO_LOCK}✎</button>
                <button type="button" class="master-chip-del" onclick="A.deleteMaster('supplier','${escJs(row.supplier)}')" aria-label="ลบ ${esc(row.supplier)}" title="${DEMO_PREMIUM_MESSAGE}">${DEMO_LOCK}✕</button>
              </td></tr>`).join('')}</tbody>
            </table></div>` : '<p class="mut small mt10">ยังไม่มีชื่อบริษัทผู้ส่ง — เพิ่มรายการไว้ก่อนได้เลย</p>'}
          </div>
          <div class="master-settings-box"><h3>📏 หน่วย</h3>
            <div class="master-add-row"><input id="master-unit-name" readonly maxlength="150" placeholder="เช่น PCS, ใบ, กล่อง" autocomplete="off">
              <button class="btn btn-green" type="button" onclick="A.addMaster('unit')">${DEMO_LOCK} เพิ่ม</button></div>
            ${units.length ? `<div class="master-chip-list master-unit-list">${units.map(name => `<span class="master-chip">${esc(name)}
              <button type="button" class="master-chip-edit" onclick="A.renameMaster('unit','${escJs(name)}')" aria-label="เปลี่ยนชื่อ ${esc(name)}" title="${DEMO_PREMIUM_MESSAGE}">${DEMO_LOCK}✎</button>
              <button type="button" class="master-chip-del" onclick="A.deleteMaster('unit','${escJs(name)}')" aria-label="ลบ ${esc(name)}" title="${DEMO_PREMIUM_MESSAGE}">${DEMO_LOCK}✕</button>
            </span>`).join('')}</div>` : '<p class="mut small mt10">ยังไม่มีหน่วย — เพิ่มรายการไว้ก่อนได้เลย</p>'}
          </div>
          <div class="master-settings-box">
            <h2>📍 ตั้งค่าพื้นที่จัดเก็บ <span class="sub">เตรียมชื่อพื้นที่ไว้ล่วงหน้า จะได้เลือกได้เลยตอนเพิ่มรายการหรือเพิ่มสินค้า</span></h2>
            <div class="frm-grid">
              <div class="full"><label class="fl">ชื่อพื้นที่ใหม่</label>
                <div style="display:flex;gap:8px">
                  <input id="na-name" readonly placeholder="เช่น 1700-คลังสำรอง, คลัง HOLD" style="flex:1" autocomplete="off"
                    onkeydown="if(event.key==='Enter'){event.preventDefault();A.addArea();}">
                  <button class="btn btn-green" type="button" onclick="A.addArea()">${DEMO_LOCK} เพิ่มพื้นที่</button>
                </div>
              </div>
            </div>
            ${S.areas.length ? `
            <div class="area-chip-list area-settings-list mt10">
              ${S.areas.map(a => `<span class="area-chip">${esc(a)}
                <button type="button" class="area-chip-edit" onclick="A.renameArea('${escJs(a)}')"
                  aria-label="เปลี่ยนชื่อพื้นที่ ${esc(a)}" title="${DEMO_PREMIUM_MESSAGE}">${DEMO_LOCK}✎</button>
                <button type="button" class="area-chip-del" onclick="A.deleteArea('${escJs(a)}')"
                  aria-label="ลบพื้นที่ ${esc(a)}" title="${DEMO_PREMIUM_MESSAGE}">${DEMO_LOCK}✕</button>
              </span>`).join('')}
            </div>` : '<p class="mut small mt10">ยังไม่มีพื้นที่ในรายการ — เพิ่มไว้ก่อนได้เลย</p>'}
          </div>
        </div>
      </div>
    </div>

    <div class="card"><h2>📦 รายการสินค้า <span class="sub">รวมรหัส ITEM เดียวกัน · เรียงตามเลข ITEM · แก้ไขแล้วกด Enter หรือคลิกออกนอกช่องเพื่อบันทึกลงตารางวันที่ ${thDate(dataDate)}</span></h2>
      <div class="toolbar"><input class="search" id="set-q" placeholder="🔍 ค้นหา…" value="${esc(setQ)}">
        <select id="set-filter" class="search" style="max-width:300px">
          <option value="all" ${setFilter === 'all' ? 'selected' : ''}>แสดงทุกรายการ</option>
          <option value="unset" ${setFilter === 'unset' ? 'selected' : ''}>ยังไม่ได้ตั้งค่า Min / Max / Safety</option>
          <option value="complete" ${setFilter === 'complete' ? 'selected' : ''}>ตั้งค่า Min / Max / Safety ครบแล้ว</option>
        </select>
        <span class="mut small">แสดง ${list.length} / ${groupedItems.length} รายการ</span></div>
      <div class="tbl-wrap tbl-scroll" style="max-height:560px"><table>
        <thead><tr><th>สินค้า</th><th>ITEM</th><th style="width:105px">Min</th><th style="width:105px">Max</th><th style="width:105px">Safety</th><th style="width:110px">หน่วย</th><th style="width:220px">ชื่อบริษัทผู้ส่ง</th><th></th></tr></thead>
        <tbody>${list.map(i => `
          <tr><td><div class="item-name">${esc(i.name)}${i.identities.length > 1 ? ` <span class="sub">(รวม ${fmt(i.identities.length)} รายการ)</span>` : ''}</div></td><td class="item-code">${esc(i.code)}</td>
            <td><input class="settings-item-input" readonly title="${DEMO_LOCK} ${DEMO_PREMIUM_MESSAGE}" type="number" min="0" value="${i.min}" data-code="${esc(i.code)}" data-field="min"></td>
            <td><input class="settings-item-input" readonly title="${DEMO_LOCK} ${DEMO_PREMIUM_MESSAGE}" type="number" min="0" value="${i.max}" data-code="${esc(i.code)}" data-field="max"></td>
            <td><input class="settings-item-input" readonly title="${DEMO_LOCK} ${DEMO_PREMIUM_MESSAGE}" type="number" min="0" value="${i.safety}" data-code="${esc(i.code)}" data-field="safety"></td>
            <td><input class="settings-item-input" readonly title="${DEMO_LOCK} ${DEMO_PREMIUM_MESSAGE}" value="${esc(i.unit || '')}" placeholder="หน่วย" data-code="${esc(i.code)}" data-field="unit"></td>
            <td><input class="settings-item-input" readonly title="${DEMO_LOCK} ${DEMO_PREMIUM_MESSAGE}" value="${esc(i.supplier || '')}" placeholder="บริษัทผู้ส่ง" data-code="${esc(i.code)}" data-field="supplier"></td>
            <td><button class="btn btn-ghost btn-sm" onclick="A.editDailyItem('${escJs(i.identities?.[0] || i.code)}')">แก้ในตาราง</button></td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  $('#set-q').oninput = e => { setQ = e.target.value; VIEWS.settings(); const el = $('#set-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); };
  $('#set-filter').onchange = e => { setFilter = e.target.value; VIEWS.settings(); };
  $('#view-settings').onclick = e => {
    if (e.target.closest?.('.settings-item-input, #master-supplier-name, #master-supplier-shelf-life, #master-unit-name, #na-name')) {
      A.premium('แก้ไขข้อมูลสินค้า / ตั้งค่า');
    }
  };
  $('#view-settings').oninput = e => {
    const input = e.target.closest('.settings-item-input');
    if (!input) return;
    const key = `${input.dataset.code}|${input.dataset.field}`;
    clearTimeout(itemFieldSaveTimers[key]);
    itemFieldSaveTimers[key] = setTimeout(() => {
      A.updSettingsGroup(input.dataset.code, input.dataset.field, input.value);
    }, 500);
  };
};

/* ═══ Item drawer ═══════════════════════════════════════════════════════ */
function openItem(identity) {
  const it = itemBy(identity);
  if (!it) return;
  const key = itemIdentity(it);
  const dataDate = latestDailyDate() || S.today;
  const st = itemStatus(it), u = usageStats(key);
  const txns = txnsOf(key).sort((a, b) =>
    (b.date + (b.created || '')).localeCompare(a.date + (a.created || ''))
  ).slice(0, 30);
  const lead = S.config.leadTimeDays;

  // sparkline: ยอดเบิกรายวัน 30 วัน
  const days30 = Array.from({length: 30}, (_, i) => addDays(dataDate, i - 29));
  const daily = days30.map(d => txns.filter(t => t.type === 'withdraw' && t.date === d).reduce((s, t) => s + t.qty, 0));
  const maxD = Math.max(...daily, 1);
  const W = 500, H = 90;
  const pts = daily.map((v, i) => `${(i / 29 * (W - 10) + 5).toFixed(1)},${(H - 8 - v / maxD * (H - 20)).toFixed(1)}`);

  let orderAdvice = '';
  if (u.avgDay > 0) {
    const dMin = it.min > 0 ? Math.max(0, (it.stock - it.min) / u.avgDay) : u.daysLeft;
    const minDate = addDays(dataDate, Math.floor(dMin));
    const ordDate = addDays(minDate, -lead);
    orderAdvice = `<div class="alert-item ${ordDate <= dataDate ? 'a-red' : 'a-blue'} mt10"><span class="a-ic">${ordDate <= dataDate ? '🚨' : '💡'}</span>
      <div>ใช้เฉลี่ย <b>${fmt1(u.avgDay)} ${esc(it.unit)}/วัน</b> → คาดว่าจะถึง ${it.min > 0 ? 'Min' : 'ศูนย์'} วันที่ <b>${thDate(minDate)}</b><br>
      ควรสั่งซื้อภายใน <b>${thDate(ordDate)}</b> (Lead time ${lead} วัน)${ordDate <= dataDate ? ' — <b>ควรสั่งได้แล้ว!</b>' : ''}</div></div>`;
  }

  const upcoming = S.deliveries.filter(d => d.code === it.code && d.date >= dataDate).slice(0, 6);

  $('#drawer').innerHTML = `
    <button class="d-close" onclick="A.closeDrawer()">✕</button>
    <h2 style="font-size:18px;padding-right:40px">${esc(it.name)}</h2>
    <p class="mut small">${esc(it.code)} · <span class="badge ${st.cls}">${st.label}</span></p>

    <div class="kpi-grid mt16" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div><div class="kv">${fmt(it.stock)}</div><div class="kl">คงเหลือ (${esc(it.unit)})</div></div></div>
      <div class="kpi"><div><div class="kv">${u.avgDay > 0 ? fmt1(u.avgDay) : '-'}</div><div class="kl">ใช้เฉลี่ย/วัน</div></div></div>
      <div class="kpi"><div><div class="kv">${u.avgDay > 0 ? (u.daysLeft > 999 ? '999+' : fmt1(u.daysLeft)) : '-'}</div><div class="kl">พอใช้ (วัน)</div></div></div>
    </div>

    <div class="card">${lvlBarHTML(it)}
      <div class="frm-grid mt16" style="grid-template-columns:1fr 1fr">
        <div><label class="fl">Min</label><input class="drawer-item-input" readonly title="${DEMO_LOCK} ${DEMO_PREMIUM_MESSAGE}" type="number" min="0" value="${it.min}" data-item="${esc(key)}" data-field="min"></div>
        <div><label class="fl">Max (ความจุจัดเก็บ)</label><input class="drawer-item-input" readonly title="${DEMO_LOCK} ${DEMO_PREMIUM_MESSAGE}" type="number" min="0" value="${it.max}" data-item="${esc(key)}" data-field="max"></div>
        <div><label class="fl">Safety</label><input class="drawer-item-input" readonly title="${DEMO_LOCK} ${DEMO_PREMIUM_MESSAGE}" type="number" min="0" value="${it.safety}" data-item="${esc(key)}" data-field="safety"></div>
        <div><label class="fl">หน่วยนับ</label><input class="drawer-item-input" readonly title="${DEMO_LOCK} ${DEMO_PREMIUM_MESSAGE}" value="${esc(it.unit)}" data-item="${esc(key)}" data-field="unit"></div>
        <div class="full"><label class="fl">ชื่อบริษัทผู้ส่ง</label><input class="drawer-item-input" readonly title="${DEMO_LOCK} ${DEMO_PREMIUM_MESSAGE}" value="${esc(it.supplier || '')}" data-item="${esc(key)}" data-field="supplier" placeholder="เช่น บจก. กล่องไทย ตัวอย่าง"></div>
      </div>
      ${orderAdvice}
    </div>

    <div class="card"><h2>📉 ยอดเบิกรายวัน 30 วัน</h2>
      ${u.total > 0 ? `<svg class="chart-svg" viewBox="0 0 ${W} ${H}">
        <polyline points="${pts.join(' ')}" fill="none" stroke="var(--primary)" stroke-width="2"/>
        ${daily.map((v, i) => v > 0 ? `<circle cx="${(i / 29 * (W - 10) + 5).toFixed(1)}" cy="${(H - 8 - v / maxD * (H - 20)).toFixed(1)}" r="3" fill="var(--primary)"><title>${thDate(days30[i])}: ${fmt(v)}</title></circle>` : '').join('')}
      </svg><p class="mut small">รวม ${fmt(u.total)} ${esc(it.unit)} ใน ${S.config.usageWindowDays} วัน · สูงสุด ${fmt(maxD)}/วัน</p>`
      : '<p class="empty">ยังไม่มีการเบิกในช่วง 30 วัน</p>'}
    </div>

    ${upcoming.length ? `<div class="card"><h2>🚚 กำหนดรับที่จะมาถึง</h2>
      ${upcoming.map(d => `<div class="bar-row"><div class="br-name">${thDate(d.date, true)}</div>
        <div style="flex:1" class="small mut">${esc(d.remark || '')}</div><div class="br-val">+${fmt(d.qty)}</div></div>`).join('')}</div>` : ''}

    <div class="card"><h2>🕘 ประวัติล่าสุด</h2>
      <div class="tbl-wrap"><table><thead><tr><th>วันที่</th><th>ประเภท</th><th class="num">จำนวน</th><th>แหล่งข้อมูล</th></tr></thead>
      <tbody>${txns.map(t => `<tr><td>${thDate(t.date)}</td><td class="t-${t.type}">${esc(t.label || TXN_LABEL[t.type])}</td>
        <td class="num t-${t.type}">${t.type==='withdraw'?'−':'+'}${fmt(Math.abs(t.qty))}</td><td class="small">${t.source === 'daily-ledger' ? 'ตารางรายวัน' : esc(t.person || t.dept || '-')}</td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">ยังไม่มีประวัติ</td></tr>'}</tbody></table></div>
    </div>`;
  $('#overlay').classList.add('open');
  $('#drawer').classList.add('open');
  $('#drawer').onclick = e => {
    if (e.target.closest?.('.drawer-item-input')) A.premium('แก้ไข Min / Max / Safety / หน่วย / ผู้ส่ง');
  };
  $('#drawer').oninput = e => {
    const input = e.target.closest('.drawer-item-input');
    if (!input) return;
    const timerKey = `${input.dataset.item}|${input.dataset.field}`;
    clearTimeout(itemFieldSaveTimers[timerKey]);
    itemFieldSaveTimers[timerKey] = setTimeout(() => {
      A.updItem(input.dataset.item, input.dataset.field, input.value);
    }, 500);
  };
}

/* ═══ Global actions (A.*) ══════════════════════════════════════════════ */
window.A = {
  dashAll() {
    dashFilter = {q: '', status: 'all'};
    dashShown = DASH_PAGE;
    VIEWS.dash();
    dashScrollToStockCard();
  },
  dashStatus(s) {
    dashFilter = {q: '', status: s};
    dashShown = DASH_PAGE;
    VIEWS.dash();
    dashScrollToStockCard();
  },
  dashSetExpiryGroup(group) {
    const allowed = new Set(DASH_EXPIRY_GROUPS.map(item => item.key));
    dashExpiryGroup = allowed.has(String(group || '')) ? String(group) : 'all';
    VIEWS.dash();
  },
  dashMore() { dashShown += DASH_PAGE; VIEWS.dash(); },
  openItem,
  closeDrawer() {
    $('#drawer').classList.remove('open');
    if (!$('#modal').classList.contains('open')) $('#overlay').classList.remove('open');
  },
  closeModal() {
    dailyReadyReminderOpen = false;
    dailyEditPasswordOpen = false;
    $('#modal').classList.remove('open', 'modal-wide', 'daily-ready-reminder', 'daily-edit-password');
    $('#modal').innerHTML = '';
    if (!$('#drawer').classList.contains('open')) $('#overlay').classList.remove('open');
  },
  premium(feature = '') { return demoPremium(feature); },
  closePremium() {
    const box = document.getElementById('demo-premium');
    if (box) { box.hidden = true; box.innerHTML = ''; }
  },
  closeOverlays() {
    this.closePremium();
    if (dailyReadyReminderOpen) return;
    this.closeDrawer();
    this.closeModal();
  },
  histMore() { histShown += HIST_PAGE; VIEWS.history(); },
  historyOpen(date, code = '') {
    txnDate = date;
    dailyFilter = code;
    dailyAreaFilter = DAILY_FILTER_PACKAGING_ALL;
    show('txn');
  },
  editDailyItem(identity) {
    const item = itemBy(identity);
    txnDate = latestDailyDate() || S.today;
    dailyFilter = item?.code || '';
    dailyAreaFilter = DAILY_FILTER_PACKAGING_ALL;
    this.closeDrawer();
    show('txn');
  },

  dailySetEditMode(edit) {
    const next = Boolean(edit);
    if (dailyDirty.size && !next) return toast('กำลังบันทึกอัตโนมัติ กรุณารอสักครู่', 'err');
    if (next && !dailyEditMode) return showDailyEditPassword();
    dailyEditMode = next;
    if (dailyEditMode && dailyGroupMode === 'merged') dailyGroupMode = 'lot';
    VIEWS.txn();
  },

  async dailyEditPasswordSubmit() {
    const input = $('#daily-edit-password');
    if (!input || input.dataset.busy === '1') return;
    input.dataset.busy = '1';
    const result = await apiCall('auth_check', {password: input.value});
    input.dataset.busy = '';
    if (!result.ok) {
      input.value = '';
      input.focus();
      return toast(result.error || 'รหัสผ่านไม่ถูกต้อง', 'err');
    }
    dailyEditPasswordOpen = false;
    this.closeModal();
    dailyEditMode = true;
    if (dailyGroupMode === 'merged') dailyGroupMode = 'lot';
    VIEWS.txn();
    toast('เปิดโหมดแก้ไขแล้ว', 'ok-t');
  },

  async dailyMarkReady() {
    if (dailyViewReadOnly) return toast('ขณะนี้อยู่ในโหมดดูอย่างเดียว', 'err');
    if (!S.dailyLedgers?.[txnDate]) return toast('ไม่พบตารางรายวันของวันที่นี้', 'err');
    if (dailyReadyStatus(txnDate)?.ready) return;
    if (dailyDirty.size) return toast('กรุณารอให้บันทึกอัตโนมัติเสร็จก่อนกดพร้อมใช้งาน', 'err');
    try {
      await api('daily_ready_mark', {date: txnDate});
      updateDailyReadyUi(txnDate);
      closeDailyReadyReminder();
      toast(`บันทึกสถานะข้อมูลวันที่ ${thDate(txnDate, true)} ว่าพร้อมใช้งานแล้ว`, 'ok-t');
    } catch (e) { toast(e.message, 'err'); }
  },

  async dailyReadyReminderConfirm() {
    await this.dailyMarkReady();
  },

  dailyReadyReminderSnooze() {
    if (dailyViewReadOnly) {
      closeDailyReadyReminder();
      return;
    }
    const date = dailyReadyReminderToday();
    saveDailyReadyReminderSnooze(date, 10);
    closeDailyReadyReminder();
    toast('เลื่อนแจ้งเตือนออกไปอีก 10 นาทีแล้ว', 'ok-t');
  },

  dailySetGroupMode(mode) {
    const next = mode === 'merged' ? 'merged' : 'lot';
    if (next === dailyGroupMode) return;
    if (dailyDirty.size) return toast('กำลังบันทึกอัตโนมัติ กรุณารอสักครู่', 'err');
    dailyGroupMode = next;
    VIEWS.txn();
  },

  dailySetArea(area) {
    dailyAreaFilter = String(area || 'all');
    dailyFilter = '';
    VIEWS.txn();
  },

  dailyOpenAddRow() {
    if (dailyViewReadOnly) return toast('ขณะนี้อยู่ในโหมดดูอย่างเดียว', 'err');
    if (dailyDirty.size) return toast('กำลังบันทึกอัตโนมัติ กรุณารอสักครู่', 'err');
    const ledger = (S.dailyLedgers || {})[txnDate];
    if (!ledger) return toast('ไม่พบตารางของวันที่นี้', 'err');

    const areas = [];
    for (const row of ledger.rows || []) {
      if (row.kind !== 'section') continue;
      const title = String(row.title || '').trim();
      if (title && !areas.some(area => area.key === title)) areas.push({key: title, label: title});
    }
    // ตั้งค่า พื้นที่ — areas prepared in Settings that this day hasn't used yet;
    // choosing one creates its section automatically (see insertRowIntoArea_ in Ledger.gs).
    for (const title of S.areas || []) {
      if (title && !areas.some(area => area.key === title)) areas.push({key: title, label: title});
    }
    const selectedArea = areas.some(area => area.key === dailyAreaFilter) ? dailyAreaFilter : (areas[0]?.key || '__main__');
    const addItemChoices = [...new Map(S.items.map(item => [String(item.code || ''), {
      code: String(item.code || ''), name: String(item.name || ''), unit: String(item.unit || '')
    }])).values()].filter(item => item.code && item.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'th') || a.code.localeCompare(b.code));
    const addItemNames = [...new Map(addItemChoices.map(item => [item.name, item])).values()];
    const addCodeOptions = addItemChoices.map(item => `<option value="${esc(item.code)}"></option>`).join('');
    const addNameOptions = addItemNames.map(item => `<option value="${esc(item.name)}"></option>`).join('');
    const unitOptions = [...new Set([
      ...masterList('units'), 'ใบ', 'PCS', 'ชิ้น', 'กล่อง', 'ลัง', 'ขวด', 'ถัง', 'กก.', 'กรัม', 'ลิตร', 'ม้วน', 'แพ็ค', 'ชุด',
      ...addItemChoices.map(item => item.unit).filter(Boolean),
    ])].sort((a, b) => a.localeCompare(b, 'th'));
    const areaOptions = areas.length ? areas : [{key: '__main__', label: 'รายการทั่วไป'}];
    $('#modal').innerHTML = `
      <button class="modal-close" type="button" onclick="A.closeModal()" aria-label="ปิด">✕</button>
      <h3>＋ เพิ่มรายการในตารางวันที่ ${thDate(txnDate, true)}</h3>
      <form id="daily-add-row-form" onsubmit="event.preventDefault();A.dailyAddRow()">
        <div class="frm-grid">
          <div class="full"><label class="fl" for="daily-add-mode">รูปแบบรายการ</label>
            <select id="daily-add-mode">
              <option value="existing">เลือกจากรายการที่มี</option>
              <option value="new">สร้างรายการใหม่ (กรอกเอง)</option>
            </select>
            <div class="mut small mt10">เลือกจากรหัสหรือชื่อสินค้าได้ อีกช่องและหน่วยนับจะเติมให้อัตโนมัติ</div>
          </div>
          <div><label class="fl" for="daily-add-code">ITEM *</label>
            <input id="daily-add-code" list="daily-add-code-options" maxlength="40" required placeholder="เลือกหรือพิมพ์ ITEM" autocomplete="off">
            <datalist id="daily-add-code-options">${addCodeOptions}</datalist></div>
          <div><label class="fl" for="daily-add-unit">หน่วยนับ *</label>
            <select id="daily-add-unit" required>
              ${unitOptions.map(unit => `<option value="${esc(unit)}" ${unit === 'ใบ' ? 'selected' : ''}>${esc(unit)}</option>`).join('')}
              <option value="__custom__">อื่นๆ (กรอกเอง)</option>
            </select>
            <input id="daily-add-unit-custom" maxlength="150" placeholder="กรอกหน่วยนับ" style="display:none;margin-top:8px" disabled></div>
          <div class="full"><label class="fl" for="daily-add-name">รายการ *</label>
            <input id="daily-add-name" list="daily-add-name-options" maxlength="250" required placeholder="เลือกหรือพิมพ์ชื่อรายการ" autocomplete="off">
            <datalist id="daily-add-name-options">${addNameOptions}</datalist></div>
          <div><label class="fl" for="daily-add-receive">จำนวนรับเข้า</label>
            <input id="daily-add-receive" type="number" min="0" step="any" value="0" required></div>
          <div class="full"><label class="fl" for="daily-add-lot">Lot</label>
            <input id="daily-add-lot" maxlength="50" placeholder="เช่น 290126 (เว้นว่างได้ถ้ายังไม่ระบุ Lot)" autocomplete="off">
            <div class="mut small mt10">1 รายการมีได้หลาย Lot — เพิ่มอีกบรรทัดต่อ 1 Lot ได้เลย</div></div>
          <div class="full"><label class="fl" for="daily-add-area">พื้นที่ *</label>
            <select id="daily-add-area" required>
              ${areaOptions.map(area => `<option value="${esc(area.key)}" ${area.key === selectedArea ? 'selected' : ''}>${esc(area.label)}</option>`).join('')}
            </select></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" onclick="A.closeModal()">ยกเลิก</button>
          <button class="btn btn-green" type="submit">＋ เพิ่มรายการ</button>
        </div>
      </form>`;
    $('#overlay').classList.add('open');
    $('#modal').classList.add('open');
    const addMode = $('#daily-add-mode');
    const addCode = $('#daily-add-code');
    const addName = $('#daily-add-name');
    const addUnit = $('#daily-add-unit');
    const addUnitCustom = $('#daily-add-unit-custom');
    const choiceByCode = new Map(addItemChoices.map(item => [item.code, item]));
    const choiceByName = new Map(addItemNames.map(item => [item.name, item]));
    const setAddUnit = unit => {
      const value = String(unit || '').trim();
      const found = [...addUnit.options].find(option => option.value === value);
      if (found) {
        addUnit.value = value;
        addUnitCustom.value = '';
        addUnitCustom.style.display = 'none';
        addUnitCustom.disabled = true;
      } else if (value) {
        addUnit.value = '__custom__';
        addUnitCustom.value = value;
        addUnitCustom.style.display = '';
        addUnitCustom.disabled = false;
      }
    };
    const syncAddItem = source => {
      const choice = source === 'code' ? choiceByCode.get(addCode.value.trim()) : choiceByName.get(addName.value.trim());
      if (!choice) return;
      addCode.value = choice.code;
      addName.value = choice.name;
      setAddUnit(choice.unit || 'ใบ');
    };
    const setAddMode = () => {
      const manual = addMode.value === 'new';
      if (manual) {
        addCode.removeAttribute('list');
        addName.removeAttribute('list');
      } else {
        addCode.setAttribute('list', 'daily-add-code-options');
        addName.setAttribute('list', 'daily-add-name-options');
      }
    };
    addMode.onchange = setAddMode;
    addCode.oninput = () => syncAddItem('code');
    addName.oninput = () => syncAddItem('name');
    addUnit.onchange = () => {
      const custom = addUnit.value === '__custom__';
      addUnitCustom.style.display = custom ? '' : 'none';
      addUnitCustom.disabled = !custom;
      if (!custom) addUnitCustom.value = '';
    };
    setAddMode();
    requestAnimationFrame(() => $('#daily-add-code')?.focus());
  },

  async dailyAddRow() {
    if (dailyViewReadOnly) return toast('ขณะนี้อยู่ในโหมดดูอย่างเดียว', 'err');
    const code = String($('#daily-add-code')?.value || '').trim();
    const name = String($('#daily-add-name')?.value || '').trim();
    const unitSelect = String($('#daily-add-unit')?.value || '').trim();
    const unit = unitSelect === '__custom__'
      ? String($('#daily-add-unit-custom')?.value || '').trim()
      : unitSelect;
    const receive = Number($('#daily-add-receive')?.value || 0);
    const area = String($('#daily-add-area')?.value || S.areas?.[0] || '__main__');
    const lot = String($('#daily-add-lot')?.value || '').trim();
    if (!code || !name || !unit) return toast('กรุณากรอก ITEM รายการ และหน่วยนับให้ครบ', 'err');
    if (!Number.isFinite(receive) || receive < 0) return toast('จำนวนรับเข้าต้องเป็นตัวเลขไม่ติดลบ', 'err');
    try {
      await api('daily_ledger_add_row', {date: txnDate, code, name, unit, area, lot, receive});
      this.closeModal();
      dailyAreaFilter = area;
      dailyFilter = code;
      toast(`เพิ่ม ${code}${lot ? ` Lot ${lot}` : ''} ในพื้นที่ ${area === '__main__' ? 'รายการทั่วไป' : area} แล้ว`, 'ok-t');
      rerender();
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  dailyPalletTab(tab) {
    const active = tab === 'label' ? 'label' : 'pallet';
    document.querySelectorAll('[data-pallet-tab]').forEach(button => {
      const selected = button.dataset.palletTab === active;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    const palletPanel = $('#pallet-tab-pallet');
    const labelPanel = $('#pallet-tab-label');
    if (palletPanel) palletPanel.hidden = active !== 'pallet';
    if (labelPanel) labelPanel.hidden = active !== 'label';
    if (active === 'label') this.labelUsageRenderRows();
  },

  labelUsageRenderRows() {
    const body = $('#label-usage-rows');
    if (!body) return;
    body.innerHTML = labelUsageDraftRows.map((item, index) => `
      <tr>
        <td class="lu-row-no">${fmt(index + 1)}</td>
        <td><input class="label-usage-cell-input" data-usage-index="${index}" data-usage-field="item" value="${esc(item.item)}" maxlength="50" aria-label="Item แถว ${index + 1}"></td>
        <td><input class="label-usage-cell-input" data-usage-index="${index}" data-usage-field="name" value="${esc(item.name)}" maxlength="180" aria-label="รายการ แถว ${index + 1}"></td>
        <td><input class="label-usage-cell-input" data-usage-index="${index}" data-usage-field="lot" value="${esc(item.lot)}" maxlength="50" aria-label="LOT แถว ${index + 1}"></td>
        <td><input class="label-usage-cell-input lu-qty-input" data-usage-index="${index}" data-usage-field="qty" value="${esc(item.qty)}" maxlength="30" inputmode="decimal" aria-label="จำนวน แถว ${index + 1}"></td>
        <td><input class="label-usage-cell-input" data-usage-index="${index}" data-usage-field="note" value="${esc(item.note)}" maxlength="120" aria-label="หมายเหตุ แถว ${index + 1}"></td>
        <td class="label-usage-manage-cell"><button class="btn btn-danger-ghost btn-sm" type="button" onclick="A.labelUsageRemoveRow(${index})" aria-label="ลบแถว ${index + 1}">ลบ</button></td>
      </tr>`).join('');
    body.querySelectorAll('[data-usage-index]').forEach(input => input.addEventListener('input', event => {
      const target = event.currentTarget;
      const index = Number(target.dataset.usageIndex);
      const field = target.dataset.usageField;
      if (labelUsageDraftRows[index] && field) labelUsageDraftRows[index][field] = target.value;
    }));
  },

  labelUsageAddRow() {
    if (dailyViewReadOnly) return toast('ขณะนี้อยู่ในโหมดดูอย่างเดียว', 'err');
    labelUsagePickerActive = true;
    this.closeModal();
    show('txn');
    toast('เลือกแถวที่ต้องการเพิ่มจากตารางรายวัน แล้วระบบจะนำกลับมาใส่ในฟอร์ม', 'ok-t');
  },

  labelUsageCancelPick() {
    labelUsagePickerActive = false;
    VIEWS.txn();
  },

  labelUsagePickRow(id) {
    if (dailyViewReadOnly) return toast('ขณะนี้อยู่ในโหมดดูอย่างเดียว', 'err');
    const ledger = (S.dailyLedgers || {})[txnDate];
    const row = ledger?.rows?.find(item => item.kind === 'item' && String(item.id) === String(id));
    if (!row) return toast('ไม่พบรายการที่ต้องการเพิ่ม', 'err');
    const exists = labelUsageDraftRows.some(item =>
      item.item === String(row.code || '') && item.name === String(row.name || '') && item.lot === String(row.lot || '')
    );
    if (exists) return toast('รายการนี้ถูกเลือกไว้ในฟอร์มแล้ว', 'err');
    const qty = labelUsageQtyForRow(row);
    labelUsageDraftRows.push(labelUsageNewRow({
      code: row.code, name: row.name, lot: row.lot, qty: qty > 0 ? qty : '',
    }));
    labelUsagePickerActive = false;
    // Re-render the underlying daily table immediately so the temporary
    // “＋ เลือกฉลาก” controls disappear while the label form opens.
    VIEWS.txn();
    this.dailyOpenPallet(id, {preserveLabelRows: true, initialTab: 'label'});
  },

  labelUsageRemoveRow(index) {
    if (dailyViewReadOnly) return toast('ขณะนี้อยู่ในโหมดดูอย่างเดียว', 'err');
    if (labelUsageDraftRows.length <= 1) {
      return toast('ต้องมีอย่างน้อย 1 รายการในเอกสาร', 'err');
    }
    labelUsageDraftRows.splice(index, 1);
    this.labelUsageRenderRows();
  },

  labelUsagePrint() {
    if (dailyViewReadOnly) return toast('ขณะนี้อยู่ในโหมดดูอย่างเดียว', 'err');
    const value = id => String($(id)?.value || '').trim();
    const dateText = value('#lu-date');
    const recordedDateText = value('#lu-recorded-date');
    const dateProblem = dateInputError(dateText, 'วันที่', true)
      || dateInputError(recordedDateText, 'วันที่บันทึก');
    if (dateProblem) return toast(dateProblem, 'err');
    const fields = {
      company: value('#lu-company'), locator: value('#lu-locator'), reason: value('#lu-reason'), date: parseDateInput(dateText),
      prepared: value('#lu-prepared'), recorded: value('#lu-recorded'), recordedDate: parseDateInput(recordedDateText),
      approved: value('#lu-approved'),
    };
    if (!fields.company) return toast('กรุณากรอกชื่อบริษัท', 'err');
    if (!fields.date) return toast('กรุณาเลือกวันที่', 'err');
    const rows = labelUsageDraftRows.map(item => ({
      item: String(item.item || '').trim(), name: String(item.name || '').trim(), lot: String(item.lot || '').trim(),
      qty: String(item.qty || '').trim(), note: String(item.note || '').trim(),
    })).filter(item => item.item || item.name || item.lot || item.qty || item.note);
    if (!rows.length) return toast('กรุณากรอกข้อมูลรายการอย่างน้อย 1 แถว', 'err');

    let host = $('#label-usage-print');
    if (!host) {
      host = document.createElement('div');
      host.id = 'label-usage-print';
      document.body.appendChild(host);
    }
    host.innerHTML = labelUsagePrintHtml(fields, rows);
    // Keep the source form open underneath the browser print dialog. If the
    // user presses Cancel, removing the print layer will reveal this exact
    // form again instead of leaving the app on an empty page.
    document.body.classList.add('print-label-usage');
    const finish = () => {
      document.body.classList.remove('print-label-usage');
      host.innerHTML = '';
    };
    window.addEventListener('afterprint', finish, {once: true});
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  },

  dailyOpenPallet(id, options = {}) {
    if (dailyViewReadOnly) return toast('ขณะนี้อยู่ในโหมดดูอย่างเดียว', 'err');
    const preserveLabelRows = Boolean(options.preserveLabelRows);
    const initialTab = options.initialTab === 'label' ? 'label' : 'pallet';
    const ledger = (S.dailyLedgers || {})[txnDate];
    const row = ledger?.rows?.find(item => item.kind === 'item' && String(item.id) === String(id));
    if (!row) return toast('ไม่พบรายการที่ต้องการพิมพ์', 'err');

    const mem = palletMemory(row.code);
    const product = itemBy(row.id) || itemBy(row.code);
    const supplier = String(row.supplier || product?.supplier || mem.supplier || '');
    const unit = String(row.unit || product?.unit || '');
    const productSuppliers = S.items.map(item => String(item.supplier || '').trim()).filter(Boolean);
    const productUnits = S.items.map(item => String(item.unit || '').trim()).filter(Boolean);
    const palletSupplierChoices = [...new Set([...productSuppliers, ...masterList('suppliers')])];
    const palletUnitChoices = [...new Set([...productUnits, ...masterList('units')])];
    // จำนวนส่ง comes only from today's รับเข้า; if the table has no receive
    // entered, leave the field blank rather than guessing from the balance.
    const qty = Number(row.receive || 0) || 0;
    const perPallet = Number(mem.perPallet || 0);
    if (!preserveLabelRows) {
      const labelUsageQty = labelUsageQtyForRow(row);
      labelUsageDraftRows = [labelUsageNewRow({
        code: row.code,
        name: row.name,
        lot: row.lot,
        qty: labelUsageQty > 0 ? labelUsageQty : '',
      })];
    }

    $('#modal').innerHTML = `
      <button class="modal-close" type="button" onclick="A.closeModal()" aria-label="ปิด">✕</button>
      <h3>🧾 ใบพาเลต</h3>
      <div class="pallet-tabbar" role="tablist" aria-label="เลือกแบบฟอร์มใบพาเลต">
        <button type="button" class="pallet-tab active" data-pallet-tab="pallet" role="tab" aria-selected="true" onclick="A.dailyPalletTab('pallet')">1. พิมพ์ใบกำกับพาเลต</button>
        <button type="button" class="pallet-tab" data-pallet-tab="label" role="tab" aria-selected="false" onclick="A.dailyPalletTab('label')">2. ใบบันทึกการใช้ฉลาก</button>
      </div>
      <section id="pallet-tab-pallet" class="pallet-tab-panel">
        <div class="split-source">
          <b>${esc(row.code)}</b> — ${esc(row.name)}
          <div class="mut small">ตารางวันที่ ${thDate(txnDate, true)} · รับเข้าวันนี้ ${fmt1(row.receive)} ${esc(row.unit || '')} · คงเหลือ ${fmt1(row.remaining)} ${esc(row.unit || '')}</div>
        </div>
      <form id="pallet-form" onsubmit="event.preventDefault();A.dailyPrintPallet('${escJs(id)}')">
        <div class="frm-grid">
          <div><label class="fl" for="pl-big">ป้ายตัวใหญ่ (มุมบนซ้าย)</label>
            <input id="pl-big" maxlength="40" value="${esc(mem.bigLabel || '')}" placeholder="เช่น 20 ลิตร BIB" autocomplete="off"></div>
          <div><label class="fl" for="pl-date">วันที่บนเอกสาร</label>
            <input id="pl-date" maxlength="20" value="${esc(palletHeadDate(txnDate))}" autocomplete="off"></div>
          <div class="full"><label class="fl" for="pl-name">ชื่อสินค้า *</label>
            <input id="pl-name" maxlength="120" required value="${esc(row.name)}"></div>
          <div class="full"><label class="fl">สีพื้นช่องชื่อสินค้า</label>
            <div class="pallet-color-picker" role="group" aria-label="เลือกสีพื้นช่องชื่อสินค้า">
              <div class="pallet-color-options">${palletNameColorOptions(mem.nameColor)}</div>
              <input id="pl-name-color" type="color" value="${esc(palletNameColor(mem.nameColor))}"
                aria-label="เลือกสีเพิ่มเติม" title="เลือกสีเพิ่มเติม">
              <span class="mut small">เลือกสีอ่อนเพื่อให้ตัวหนังสือดำอ่านชัด</span>
            </div></div>
          <div><label class="fl" for="pl-code">ITEM *</label>
            <input id="pl-code" maxlength="40" required value="${esc(row.code)}"></div>
          <div><label class="fl" for="pl-lot">LOT</label>
            <input id="pl-lot" maxlength="50" value="${esc(row.lot || '')}" autocomplete="off"></div>
          <div><label class="fl" for="pl-supplier">ชื่อบริษัทผู้ส่ง</label>
            <div class="master-picker"><input id="pl-supplier" maxlength="150" value="${esc(supplier)}" placeholder="เลือกหรือพิมพ์ชื่อบริษัทผู้ส่ง" autocomplete="off"><div id="pl-supplier-drop" class="master-picker-drop" style="display:none"></div></div></div>
          <div><label class="fl" for="pl-bill">เลขที่บิลส่ง</label>
            <input id="pl-bill" maxlength="80" placeholder="เช่น INV-0001/INV-0002" autocomplete="off"></div>
          <div><label class="fl" for="pl-mfg">วันที่ผลิต</label>
            <input id="pl-mfg" maxlength="20" value="${esc(palletShortDate(row.mfgDate))}" placeholder="29-04-26" autocomplete="off"></div>
          <div><label class="fl" for="pl-exp">วันที่หมดอายุ <span class="mut">(คำนวณจาก Shelf Life)</span></label>
            <div class="pallet-expiry-entry"><input id="pl-exp" maxlength="20" value="${esc(palletShortDate(row.expiryDate))}" placeholder="29-10-26" autocomplete="off">
              <button type="button" class="btn btn-ghost btn-sm" onclick="A.palletAutoExpiry(true)" title="คำนวณใหม่จากบริษัทผู้ส่งและวันที่ผลิต">↻ คำนวณ</button></div>
            <div id="pl-expiry-hint" class="mut small"></div></div>
          <div><label class="fl" for="pl-qty">จำนวนส่ง *</label>
            <input id="pl-qty" type="number" min="0" step="any" required value="${qty || ''}" inputmode="decimal"
              oninput="A.palletRecalc()"></div>
          <div><label class="fl" for="pl-unit">หน่วย</label>
            <div class="master-picker"><input id="pl-unit" maxlength="150" value="${esc(unit)}" placeholder="เลือกหรือพิมพ์หน่วย" autocomplete="off"><div id="pl-unit-drop" class="master-picker-drop" style="display:none"></div></div></div>
          <div><label class="fl" for="pl-per">พาเลตละ (จำนวน/พาเลต)</label>
            <input id="pl-per" type="number" min="0" step="any" value="${perPallet || ''}" placeholder="เช่น 400"
              inputmode="decimal" oninput="A.palletRecalc()"></div>
          <div><label class="fl" for="pl-count">จำนวนพาเลต (จำนวนแผ่นที่พิมพ์) *</label>
            <input id="pl-count" type="number" min="1" max="${PALLET_MAX_PAGES}" step="1" required
              value="${perPallet > 0 && qty > 0 ? Math.ceil(qty / perPallet) : 1}" oninput="A.palletPreview()"></div>
          <div class="full"><label class="fl" for="pl-receiver">ผู้รับสินค้า <span class="mut">(เว้นว่างไว้เซ็นเองก็ได้)</span></label>
            <input id="pl-receiver" maxlength="80" autocomplete="off" oninput="A.palletPreview()"></div>
        </div>
        <div class="mut small mt10" id="pl-hint"></div>
        <div class="mt10"><label class="fl">ตัวอย่างก่อนพิมพ์ (แผ่นแรก)</label>
          <div class="pallet-preview" id="pl-preview"></div></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" onclick="A.closeModal()">ยกเลิก</button>
          <button class="btn btn-primary" type="submit" id="pl-submit">🖨️ พิมพ์</button>
        </div>
      </form>
      </section>
      ${labelUsageFormHtml(row)}`;
    bindDateInputPickers($('#modal'));
    $('#modal').classList.add('modal-wide');
    $('#overlay').classList.add('open');
    $('#modal').classList.add('open');
    bindMasterPicker('pl-supplier', palletSupplierChoices);
    bindMasterPicker('pl-unit', palletUnitChoices);
    // any edit refreshes the preview
    $('#pallet-form').addEventListener('input', () => this.palletPreview());
    const expiryInput = $('#pl-exp');
    const refreshPalletExpiry = () => {
      this.palletAutoExpiry();
      this.palletPreview();
    };
    $('#pl-supplier').addEventListener('input', refreshPalletExpiry);
    $('#pl-supplier').addEventListener('change', refreshPalletExpiry);
    $('#pl-mfg').addEventListener('input', refreshPalletExpiry);
    $('#pl-mfg').addEventListener('change', refreshPalletExpiry);
    expiryInput.dataset.auto = row.expiryDate ? 'source' : 'auto';
    expiryInput.addEventListener('input', () => {
      expiryInput.dataset.auto = 'false';
      this.palletPreview();
    });
    $('#pl-name-color').addEventListener('input', event => {
      syncPalletNameColorOptions(event.target.value);
      this.palletPreview();
    });
    if (row.expiryDate) {
      const sourceHint = $('#pl-expiry-hint');
      if (sourceHint) sourceHint.textContent = 'ใช้วันหมดอายุเดิมจากข้อมูลรายการ · เปลี่ยนบริษัทผู้ส่งหรือวันที่ผลิตเพื่อคำนวณใหม่จาก Shelf Life';
    } else {
      this.palletAutoExpiry();
    }
    this.palletRecalc();
    this.labelUsageRenderRows();
    if (initialTab === 'label') this.dailyPalletTab('label');
    requestAnimationFrame(() => $('#pl-big')?.focus());
  },

  // Units-per-pallet changed → suggest the matching page count (ceil, so a
  // partial last pallet still gets its own tag), then refresh the preview.
  palletRecalc() {
    const qty = Number($('#pl-qty')?.value || 0);
    const per = Number($('#pl-per')?.value || 0);
    if (qty > 0 && per > 0) {
      const n = Math.min(PALLET_MAX_PAGES, Math.max(1, Math.ceil(qty / per)));
      const field = $('#pl-count');
      if (field) field.value = n;
    }
    this.palletPreview();
  },

  palletAutoExpiry(force = false) {
    const supplier = String($('#pl-supplier')?.value || '').trim();
    const mfg = String($('#pl-mfg')?.value || '').trim();
    const expiry = $('#pl-exp');
    const hint = $('#pl-expiry-hint');
    if (!expiry) return;
    const result = palletExpiryFromShelfLife(mfg, supplier);
    const canAutoFill = force || expiry.dataset.auto === 'auto' || expiry.dataset.auto === 'source' || !expiry.value.trim();
    if (result && canAutoFill) {
      expiry.value = palletShortDate(result.iso);
      expiry.dataset.auto = 'true';
    } else if (!result && expiry.dataset.auto === 'true') {
      expiry.value = '';
    }
    if (!hint) return;
    if (result) {
      const detail = result.values?.length > 1
        ? `มีหลายค่า (${result.shelfLife}) ระบบใช้ค่าที่สั้นสุด ${result.months} เดือนเป็นค่าเริ่มต้น`
        : `คำนวณอัตโนมัติจาก Shelf Life ${result.shelfLife}`;
      hint.textContent = `${detail} · แก้ไขวันที่เองได้`;
    } else if (supplier && !palletShelfLifeInfo(supplier)) {
      hint.textContent = 'ไม่พบ Shelf Life ของบริษัทนี้ — กรุณากรอกวันหมดอายุเอง';
    } else if (supplier && !palletInputDateToIso(mfg)) {
      hint.textContent = 'กรอกวันที่ผลิตรูปแบบ วว-ดด-ปป เพื่อคำนวณวันหมดอายุ';
    } else {
      hint.textContent = '';
    }
  },

  palletFields() {
    const val = id => String($(id)?.value || '').trim();
    return {
      bigLabel: val('#pl-big'), docDate: val('#pl-date'), productName: val('#pl-name'),
      nameColor: palletNameColor($('#pl-name-color')?.value),
      code: val('#pl-code'), lot: val('#pl-lot'), supplier: val('#pl-supplier'),
      billNo: val('#pl-bill'), mfgDate: val('#pl-mfg'), expiryDate: val('#pl-exp'),
      qty: Number($('#pl-qty')?.value || 0), unit: val('#pl-unit'),
      perPallet: Number($('#pl-per')?.value || 0), receiver: val('#pl-receiver'),
      count: Math.round(Number($('#pl-count')?.value || 1)),
    };
  },

  palletPreview() {
    const box = $('#pl-preview');
    if (!box) return;
    const f = this.palletFields();
    const total = Math.min(PALLET_MAX_PAGES, Math.max(1, f.count || 1));
    box.innerHTML = palletTagHtml(f, 1, total);
    palletFitCells(box);
    const hint = $('#pl-hint');
    const submit = $('#pl-submit');
    if (submit) submit.textContent = `🖨️ พิมพ์ ${fmt(total)} แผ่น`;
    if (!hint) return;
    if (f.perPallet > 0 && f.qty > 0) {
      const full = Math.floor(f.qty / f.perPallet);
      const rest = f.qty - full * f.perPallet;
      hint.textContent = rest > 0
        ? `จะพิมพ์ ${fmt(total)} แผ่น (เลตที่ 1/${total} ถึง ${total}/${total}) · เต็มพาเลต ${fmt(full)} เลต และเศษอีก ${fmt1(rest)} ${f.unit}`
        : `จะพิมพ์ ${fmt(total)} แผ่น (เลตที่ 1/${total} ถึง ${total}/${total}) · เต็มพาเลตพอดีทุกเลต`;
    } else {
      hint.textContent = `จะพิมพ์ ${fmt(total)} แผ่น (เลตที่ 1/${total} ถึง ${total}/${total})`;
    }
  },

  palletSetNameColor(color) {
    const input = $('#pl-name-color');
    if (!input) return;
    input.value = palletNameColor(color);
    syncPalletNameColorOptions(input.value);
    this.palletPreview();
  },

  dailyPrintPallet(id) {
    if (dailyViewReadOnly) return toast('ขณะนี้อยู่ในโหมดดูอย่างเดียว', 'err');
    const f = this.palletFields();
    if (!f.productName) return toast('กรุณากรอกชื่อสินค้า', 'err');
    if (!f.code) return toast('กรุณากรอก ITEM', 'err');
    if (!(f.count >= 1)) return toast('จำนวนพาเลตต้องอย่างน้อย 1', 'err');
    if (f.count > PALLET_MAX_PAGES) {
      return toast(`พิมพ์ได้ครั้งละไม่เกิน ${PALLET_MAX_PAGES} แผ่น`, 'err');
    }

    savePalletMemory(f.code, {
      bigLabel: f.bigLabel, supplier: f.supplier, perPallet: f.perPallet, nameColor: f.nameColor,
    });

    let host = $('#pallet-print');
    if (!host) {
      host = document.createElement('div');
      host.id = 'pallet-print';
      document.body.appendChild(host);
    }
    let pages = '';
    for (let n = 1; n <= f.count; n++) pages += palletTagHtml(f, n, f.count);
    palletPrepare(host, pages);

    // Keep the pallet form open underneath the browser print dialog so both
    // Print and Cancel return to the form that was being edited.
    document.body.classList.add('print-pallet');
    const finish = () => {
      document.body.classList.remove('print-pallet');
      host.innerHTML = '';
    };
    window.addEventListener('afterprint', finish, {once: true});
    // Give the browser a frame to lay the pages out before opening the dialog.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  },

  dailyOpenSplitLot(id) {
    if (dailyViewReadOnly) return toast('ขณะนี้อยู่ในโหมดดูอย่างเดียว', 'err');
    if (dailyDirty.size) return toast('กำลังบันทึกอัตโนมัติ กรุณารอสักครู่', 'err');
    const ledger = (S.dailyLedgers || {})[txnDate];
    const row = ledger?.rows?.find(item => item.kind === 'item' && String(item.id) === String(id));
    if (!row) return toast('ไม่พบรายการที่ต้องการแยก Lot', 'err');

    const remaining = Number(row.remaining || 0);
    if (remaining <= 0) return toast('แถวนี้ไม่มียอดคงเหลือให้แยก', 'err');

    const oracleLots = oracleLotOptions(row.code);
    $('#modal').innerHTML = `
      <button class="modal-close" type="button" onclick="A.closeModal()" aria-label="ปิด">✕</button>
      <h3>⑂ แยก Lot ออกจากรายการ</h3>
      <div class="split-source">
        <b>${esc(row.code)}</b> — ${esc(row.name)}
        <div class="mut small">คงเหลือปัจจุบัน <b>${fmt1(remaining)}</b> ${esc(row.unit || '')}${row.lot ? ` · Lot เดิม ${esc(row.lot)}` : ''}</div>
      </div>
      <form id="daily-split-lot-form" onsubmit="event.preventDefault();A.dailySplitLot('${escJs(id)}')">
        <div class="frm-grid">
          <div><label class="fl" for="daily-split-qty">จำนวนที่แยกออก *</label>
            <input id="daily-split-qty" type="number" min="0" max="${remaining}" step="any"
              required placeholder="0" inputmode="decimal" autocomplete="off"></div>
          <div><label class="fl" for="daily-split-lot">Lot *</label>
            <input id="daily-split-lot" maxlength="50" required placeholder="เช่น 290126"
              autocomplete="off" ${oracleLots ? 'list="daily-split-lot-list"' : ''}>
            ${oracleLots ? `<datalist id="daily-split-lot-list">${oracleLots}</datalist>` : ''}</div>
          <div><label class="fl" for="daily-split-mfg">วันที่ผลิต</label>
            ${dateInputHtml('daily-split-mfg', '', 'daily-split-date-input', '', `min="${DATE_MIN}" max="${DATE_MAX}"`)}</div>
          <div><label class="fl" for="daily-split-exp">วันหมดอายุ</label>
            ${dateInputHtml('daily-split-exp', '', 'daily-split-date-input', '', `min="${DATE_MIN}" max="${DATE_MAX}"`)}</div>
        </div>
        <div class="mut small mt10">ปีใช้ ค.ศ. 4 หลัก (เช่น 2026 ไม่ใช่ 2569)</div>
        <div class="mut small mt10">
          ระบบจะสร้างบรรทัดใหม่ต่อจากรายการนี้ พร้อมยอดและ Lot ที่กรอก
          และหักยอดคงเหลือของบรรทัดเดิมลงเท่ากัน (ยอดรวมทั้งวันไม่เปลี่ยน)
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" onclick="A.closeModal()">ยกเลิก</button>
          <button class="btn btn-primary" type="submit">⑂ แยก Lot</button>
        </div>
      </form>`;
    $('#overlay').classList.add('open');
    $('#modal').classList.add('open');
    bindDateInputPickers($('#modal'));
    requestAnimationFrame(() => $('#daily-split-qty')?.focus());
  },

  async dailySplitLot(id) {
    if (dailyViewReadOnly) return toast('ขณะนี้อยู่ในโหมดดูอย่างเดียว', 'err');
    const qty = Number($('#daily-split-qty')?.value || 0);
    const lot = String($('#daily-split-lot')?.value || '').trim();
    const mfgText = String($('#daily-split-mfg')?.value || '').trim();
    const expiryText = String($('#daily-split-exp')?.value || '').trim();
    const mfgDate = parseDateInput(mfgText);
    const expiryDate = parseDateInput(expiryText);
    if (!(qty > 0)) return toast('กรุณากรอกจำนวนที่มากกว่า 0', 'err');
    if (!lot) return toast('กรุณากรอก Lot', 'err');
    const dateProblem = dateInputError(mfgText, 'วันที่ผลิต')
      || dateInputError(expiryText, 'วันหมดอายุ');
    if (dateProblem) {
      const field = dateProblem.startsWith('วันที่ผลิต') ? '#daily-split-mfg' : '#daily-split-exp';
      $(field)?.classList.add('bad-date');
      $(field)?.focus();
      return toast(dateProblem, 'err');
    }
    try {
      const result = await api('daily_ledger_split_lot',
        {date: txnDate, id, qty, lot, mfgDate, expiryDate});
      this.closeModal();
      const split = result.splitRow || {};
      dailyFilter = split.code || '';
      toast(`แยก ${fmt1(qty)} เป็น Lot ${lot} แล้ว · บรรทัดเดิมเหลือ ${fmt1(split.parentRemaining || 0)}`, 'ok-t');
      rerender();
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  async dailyShiftDate(days) {
    if (dailyDirty.size) return toast('กำลังบันทึกอัตโนมัติ กรุณารอสักครู่', 'err');
    await openDailyDate(addDays(txnDate, days));
  },

  async dailyCreate() {
    if (dailyViewReadOnly) return toast('ขณะนี้อยู่ในโหมดดูอย่างเดียว', 'err');
    try {
      await api('daily_ledger_create', {date: txnDate});
      resetDailyAutosaveState();
      toast(`สร้างตารางวันที่ ${thDate(txnDate, true)} แล้ว`, 'ok-t');
      rerender();
    } catch (e) { toast(e.message, 'err'); }
  },

  dailySyncOracle() {
    toast('การนำเข้าข้อมูลจากระบบ ERP ปิดไว้ในเวอร์ชันเดโม', 'err');
  },

  async oracleRealtimeSync() {
    if (dailyViewReadOnly) return toast('ขณะนี้อยู่ในโหมดดูอย่างเดียว', 'err');
    if (dailyDirty.size) return toast('กำลังบันทึกอัตโนมัติ กรุณารอสักครู่', 'err');
    if (!txnDate) return toast('ไม่พบวันที่ที่ต้องการ Sync Oracle', 'err');
    if (oracleRealtimeLoading.has(txnDate)) return;

    const date = txnDate;
    const button = $('#daily-oracle-sync-btn');
    if (button) {
      button.disabled = true;
      button.textContent = '⏳ กำลัง Sync...';
    }
    try {
      const snapshot = await loadOracleRealtime(date);
      toast(`Sync Oracle สำเร็จ · ${fmt(snapshot.itemCount || 0)} รายการ · อัปเดต ${snapshot.refreshedAt || '-'}`, 'ok-t');
      if (currentView === 'txn' && txnDate === date) VIEWS.txn();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      const currentButton = $('#daily-oracle-sync-btn');
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.textContent = '🔄 Sync Oracle';
      }
    }
  },

  async dailyDeleteRow(id) {
    if (dailyViewReadOnly) return toast('ขณะนี้อยู่ในโหมดดูอย่างเดียว', 'err');
    if (dailyDirty.size) {
      return toast('กำลังบันทึกอัตโนมัติ กรุณารอสักครู่', 'err');
    }
    const ledger = (S.dailyLedgers || {})[txnDate];
    const row = ledger?.rows?.find(item => item.kind === 'item' && String(item.id) === String(id));
    if (!row) return toast('ไม่พบรายการที่ต้องการลบ', 'err');
    const isSplit = !!row.splitFrom;
    const note = isSplit
      ? `\n\nยอด ${fmt1(row.remaining)} จะถูกคืนกลับไปรวมกับบรรทัดต้นทางที่แยกมา`
      : '';
    if (!confirm(`ลบ ${row.code} — ${row.name}${row.lot ? `\nLot ${row.lot}` : ''}\nออกจากตารางวันที่ ${thDate(txnDate, true)} ใช่หรือไม่?${note}`)) return;

    try {
      const result = await api('daily_ledger_delete_row', {date: txnDate, id});
      dailyDirty.delete(id);
      const returned = result.deletedRow?.returnedTo;
      toast(returned
        ? `ลบ ${row.code} Lot ${row.lot || '-'} แล้ว · คืนยอดให้บรรทัดต้นทางเป็น ${fmt1(returned.remaining)}`
        : `ลบ ${row.code} ออกจากตารางแล้ว`, 'ok-t');
      rerender();
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  dailyPrint() {
    if (dailyDirty.size) {
      return toast('กำลังบันทึกอัตโนมัติ กรุณารอสักครู่แล้วพิมพ์อีกครั้ง', 'err');
    }
    const ledger = (S.dailyLedgers || {})[txnDate];
    if (!ledger) return toast('ไม่พบข้อมูลของวันที่เลือก', 'err');

    let printHost = $('#daily-print');
    if (!printHost) {
      printHost = document.createElement('div');
      printHost.id = 'daily-print';
      document.body.appendChild(printHost);
    }
    printHost.innerHTML = dailyPrintHtml(ledger);
    document.body.classList.add('print-daily');
    const finish = () => {
      document.body.classList.remove('print-daily');
      printHost.innerHTML = '';
    };
    window.addEventListener('afterprint', finish, {once: true});
    window.print();
  },

  dailyExportDataset() {
    const ledger = (S.dailyLedgers || {})[txnDate];
    if (!ledger) return null;

    const allItemRows = (ledger.rows || []).filter(row => row.kind === 'item');
    const rowAreas = new Map();
    const areaLabels = new Map([['__main__', 'รายการทั่วไป']]);
    let area = '__main__';
    for (const row of ledger.rows || []) {
      if (row.kind === 'section') {
        area = String(row.title || '__main__');
        areaLabels.set(area, area);
      } else if (row.kind === 'item') {
        rowAreas.set(row.id, area);
      }
    }
    const rows = dailyAreaFilter === 'all'
      ? allItemRows
      : (dailyAreaFilter === '__oracle__' || dailyAreaFilter === '__difference__'
          || dailyAreaFilter === '__oracle_only__')
        ? allItemRows
        : dailyRowsForFilter(allItemRows, rowAreas, dailyAreaFilter);
    const headers = [
      'ITEM', 'รายการ', 'ยกมา', 'รับเข้า', 'รับคืน บรรจุ', 'รับคืน Sup.',
      'จ่ายQA/ตัวอย่าง', 'ส่งคืน Sup.', 'จ่ายบรรจุ', 'คงเหลือ',
      'จุดต่ำสุด', 'จุดสูงสุด', 'Safery', 'หน่วยนับ'
    ];
    const exportRow = row => [
      row.code, row.name, row.opening, row.receive, row.returnPackaging, row.returnSupplier,
      row.qaIssue, row.sendBackSupplier, row.issuePackaging, row.remaining,
      row.min, row.max, row.safety, row.unit
    ];

    if (dailyGroupMode === 'merged') {
      const mergedRows = mergeRowsByCode(rows, areaLabels, rowAreas);
      return {headers, data: mergedRows.map(exportRow), mode: 'merged'};
    }

    return {headers, data: rows.map(exportRow), mode: dailyAreaFilter === 'all' ? 'all' : 'area'};
  },

  exportDailyCsv() {
    const dataset = A.dailyExportDataset();
    if (!dataset) return toast('ไม่พบตารางของวันที่นี้', 'err');
    const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + [dataset.headers, ...dataset.data]
      .map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8;'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `daily_${txnDate}_${dataset.mode}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`ส่งออก CSV แล้ว ${fmt(dataset.data.length)} รายการ`, 'ok-t');
  },

  exportDailyExcel() {
    const dataset = A.dailyExportDataset();
    if (!dataset) return toast('ไม่พบตารางของวันที่นี้', 'err');
    const htmlCell = value => String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const widths = [120, 390, 95, 95, 125, 115, 135, 115, 105, 105, 105, 105, 85, 95];
    const colgroup = widths.map(width => `<col style="width:${width}px">`).join('');
    const head = dataset.headers.map(value => `<th>${htmlCell(value)}</th>`).join('');
    const body = dataset.data.map(row => `<tr>${row.map(value => `<td>${htmlCell(value)}</td>`).join('')}</tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      table{border-collapse:collapse;font-family:Arial,'Tahoma',sans-serif;font-size:11pt}
      th{background:#d9e8fb;font-weight:700;white-space:nowrap;text-align:center}
      th,td{border:1px solid #9aa8b8;padding:5px 8px;vertical-align:middle}
      td:nth-child(n+3){text-align:right} td:nth-child(2){text-align:left}
    </style></head><body><table><colgroup>${colgroup}</colgroup><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    const url = URL.createObjectURL(new Blob([html], {type: 'application/vnd.ms-excel;charset=utf-8;'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `daily_${txnDate}_${dataset.mode}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`ส่งออก Excel แล้ว ${fmt(dataset.data.length)} รายการ`, 'ok-t');
  },

  async txnDelete(id) {
    if (!confirm('ลบรายการนี้? ยอดสต๊อกจะถูกย้อนคืน')) return;
    try { await api('txn_delete', {id}); toast('ลบรายการและย้อนยอดแล้ว', 'ok-t'); rerender(); }
    catch (e) { toast(e.message, 'err'); }
  },

  async updItem(identity, field, value) {
    const item = itemBy(identity);
    const date = latestDailyDate();
    if (!item) return toast('ไม่พบรายการสินค้า', 'err');
    try {
      if (date && item.ledgerId) {
        const itemLevelField = field === 'unit' || field === 'supplier';
        const targets = itemLevelField
          ? S.items.filter(candidate => String(candidate.code) === String(item.code) && candidate.ledgerId)
          : [item];
        const rows = targets.map(candidate => ({
          id: candidate.ledgerId,
          [field]: itemLevelField ? String(value) : Number(value || 0)
        }));
        await api('daily_ledger_save', {date, rows: JSON.stringify(rows)});
      } else {
        await api('item_update', {code: item.code, [field]: value});
      }
      toast('บันทึกลงข้อมูลรายวันแล้ว', 'ok-t');
      rerender();
      if ($('#drawer').classList.contains('open')) openItem(identity);
    } catch (e) { toast(e.message, 'err'); }
  },

  async updSettingsGroup(code, field, value) {
    const targets = S.items.filter(item => String(item.code) === String(code) && item.ledgerId);
    const date = latestDailyDate();
    try {
      if (date && targets.length) {
        const normalized = field === 'unit' || field === 'supplier' ? String(value) : Number(value || 0);
        const rows = targets.map(item => ({id: item.ledgerId, [field]: normalized}));
        await api('daily_ledger_save', {date, rows: JSON.stringify(rows)});
      } else {
        await api('item_update', {code, [field]: value});
      }
      toast('บันทึกข้อมูลของ ITEM นี้ทุก Lot แล้ว', 'ok-t');
      rerender();
    } catch (e) { toast(e.message, 'err'); }
  },

  async addItem() {
    try {
      const manual = $('#ni-mode')?.value === 'new';
      const code = manual ? $('#ni-code').value : $('#ni-code-select').value;
      const name = manual ? $('#ni-name').value : $('#ni-name-select').value;
      if (!code || !name) return toast('กรุณาเลือกรายการ หรือเลือก "รายการใหม่" เพื่อกรอกเอง', 'err');
      await api('item_add', {code, name, unit: $('#ni-unit').value, supplier: $('#ni-supplier')?.value || '',
        area: $('#ni-area')?.value || '__main__',
        stock: $('#ni-stock').value, min: $('#ni-min').value, max: $('#ni-max').value, safety: $('#ni-safety').value});
      toast('เพิ่มสินค้าในตารางรายวันล่าสุดแล้ว', 'ok-t'); rerender();
    } catch (e) { toast(e.message, 'err'); }
  },

  async addArea() {
    const input = $('#na-name');
    const name = String(input?.value || '').trim();
    if (!name) return toast('กรุณากรอกชื่อพื้นที่', 'err');
    try {
      await api('area_add', {name});
      toast(`เพิ่มพื้นที่ "${name}" แล้ว`, 'ok-t');
      rerender();
    } catch (e) { toast(e.message, 'err'); }
  },

  async renameArea(name) {
    const oldName = String(name || '').trim();
    if (!oldName) return;
    const nextName = prompt(`เปลี่ยนชื่อพื้นที่ "${oldName}" เป็น:`, oldName);
    if (nextName === null) return;
    const newName = String(nextName).trim();
    if (!newName) return toast('กรุณากรอกชื่อพื้นที่ใหม่', 'err');
    if (newName === oldName) return;
    try {
      await api('area_rename', {oldName, newName});
      toast(`เปลี่ยนชื่อพื้นที่เป็น "${newName}" แล้ว`, 'ok-t');
      rerender();
    } catch (e) { toast(e.message, 'err'); }
  },

  async deleteArea(name) {
    if (!confirm(`ลบพื้นที่ "${name}" ออกจากรายการที่เตรียมไว้?\n(ไม่กระทบข้อมูลรายการที่บันทึกไปแล้ว)`)) return;
    try {
      await api('area_delete', {name});
      toast(`ลบพื้นที่ "${name}" แล้ว`, 'ok-t');
      rerender();
    } catch (e) { toast(e.message, 'err'); }
  },

  async addMaster(kind) {
    const isSupplier = kind === 'supplier';
    const input = $(isSupplier ? '#master-supplier-name' : '#master-unit-name');
    const name = String(input?.value || '').trim();
    if (!name) return toast(`กรุณากรอก${isSupplier ? 'ชื่อบริษัทผู้ส่ง' : 'หน่วย'}`, 'err');
    const shelfLife = isSupplier ? String($('#master-supplier-shelf-life')?.value || '').trim() : '';
    try {
      await api('master_add', {kind, name, shelfLife});
      toast(`เพิ่ม${isSupplier ? 'ชื่อบริษัทผู้ส่ง' : 'หน่วย'} "${name}" แล้ว`, 'ok-t');
      rerender();
    } catch (e) { toast(e.message, 'err'); }
  },

  async renameMaster(kind, oldName) {
    const label = kind === 'supplier' ? 'ชื่อบริษัทผู้ส่ง' : 'หน่วย';
    const nextName = prompt(`เปลี่ยน${label} "${oldName}" เป็น:`, oldName);
    if (nextName === null) return;
    const newName = String(nextName).trim();
    if (!newName) return toast(`กรุณากรอก${label}ใหม่`, 'err');
    let shelfLife = '';
    if (kind === 'supplier') {
      const current = (S.masterLists?.supplierShelfLives || []).find(row => row.supplier === oldName);
      const nextShelf = prompt(`Shelf Life ของ "${newName}"`, current?.shelfLife || '');
      if (nextShelf === null) return;
      shelfLife = String(nextShelf).trim();
    }
    if (newName === oldName && (kind !== 'supplier' || shelfLife === ((S.masterLists?.supplierShelfLives || []).find(row => row.supplier === oldName)?.shelfLife || ''))) return;
    try {
      await api('master_rename', {kind, oldName, newName, shelfLife});
      toast(`เปลี่ยน${label}เป็น "${newName}" แล้ว`, 'ok-t');
      rerender();
    } catch (e) { toast(e.message, 'err'); }
  },

  async deleteMaster(kind, name) {
    const label = kind === 'supplier' ? 'ชื่อบริษัทผู้ส่ง' : 'หน่วย';
    if (!confirm(`ลบ${label} "${name}" ออกจากรายการตั้งต้น?\n(ไม่ลบข้อมูลสินค้าที่บันทึกไปแล้ว)`)) return;
    try {
      await api('master_delete', {kind, name});
      toast(`ลบ${label} "${name}" แล้ว`, 'ok-t');
      rerender();
    } catch (e) { toast(e.message, 'err'); }
  },

  adjustStock(identity) {
    this.editDailyItem(identity);
  },

  exportCSV() {
    let list = [...operationalTransactions()].sort((a, b) =>
      (b.date + (b.created || '')).localeCompare(a.date + (a.created || ''))
    );
    const f = histFilter;
    if (f.from) list = list.filter(t => t.date >= f.from);
    if (f.to)   list = list.filter(t => t.date <= f.to);
    if (f.type !== 'all') list = list.filter(t => t.type === f.type);
    const rows = [['วันที่','ประเภท','รหัส','สินค้า','เลข LOT','จำนวน','คงเหลือ','แผนก/Supplier','อ้างอิง','หมายเหตุ','บันทึกเมื่อ']];
    for (const t of list) {
      const it = itemBy(t.itemId || t.code);
      rows.push([t.date, t.label || TXN_LABEL[t.type], t.code, t.itemName || it?.name || '', t.lot || '',
        (TXN_SIGN[t.type] < 0 ? -t.qty : t.qty), t.remaining ?? '', t.dept, t.ref, t.note, t.created]);
    }
    const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
    a.download = `history_${S.today}.csv`;
    a.click();
  },
};

/* ─── Theme (light/dark) ────────────────────────────────────────────────── */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('demo_pkg_theme', t); } catch (e) {}
  const ic = $('#theme-ic'), txt = $('#theme-txt');
  if (ic)  ic.textContent  = t === 'dark' ? '☀️' : '🌙';
  if (txt) txt.textContent = t === 'dark' ? 'โหมดสว่าง' : 'โหมดมืด';
}

/* ─── Init ──────────────────────────────────────────────────────────────── */
function applySidebar(state, persist = true) {
  const collapsed = state === 'collapsed';
  document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
  if (persist) {
    try { localStorage.setItem('demo_pkg_sidebar', collapsed ? 'collapsed' : 'expanded'); } catch (e) {}
  }
  const button = $('#sidebar-toggle');
  const icon = $('#sidebar-toggle-icon');
  const label = collapsed ? 'แสดงแถบเมนู' : 'ซ่อนแถบเมนู';
  if (button) {
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    button.title = label;
  }
  if (icon) icon.textContent = collapsed ? '›' : '‹';
}

$$('.nav button').forEach(b => b.onclick = () => show(b.dataset.view));
$('#overlay').onclick = () => A.closeOverlays();
applyTheme(document.documentElement.dataset.theme || 'light');
$('#theme-toggle').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
applySidebar(document.documentElement.dataset.sidebar || 'expanded', false);
$('#sidebar-toggle').onclick = () => applySidebar(
  document.documentElement.dataset.sidebar === 'collapsed' ? 'expanded' : 'collapsed'
);

function bootMessage(icon, title, detail, retry = false) {
  $('#view-dash').innerHTML = `<div class="card boot-card">
    <div class="boot-ic">${icon}</div><h2>${esc(title)}</h2><p class="mut">${detail}</p>
    ${retry ? '<button class="btn btn-primary mt16" type="button" onclick="boot()">↻ ลองใหม่</button>' : ''}
  </div>`;
}

// Full-version features: same buttons, one shared 🔒 box (see demoPremium).
const DEMO_PREMIUM_FEATURES = {
  exportDailyExcel: 'Export Excel', exportDailyCsv: 'Export CSV', exportCSV: 'Export CSV',
  dailyPrint: 'พิมพ์เอกสาร', dailyOpenPallet: 'พิมพ์ใบกำกับพาเลต / ใบบันทึกการใช้ฉลาก',
  dailyPrintPallet: 'พิมพ์ใบกำกับพาเลต', labelUsagePrint: 'พิมพ์ใบบันทึกการใช้ฉลาก',
  labelUsagePickRow: 'ใบบันทึกการใช้ฉลาก',
  dailyOpenSplitLot: 'แยก Lot', dailySplitLot: 'แยก Lot', dailyDeleteRow: 'ลบรายการ', txnDelete: 'ลบรายการ',
  updItem: 'แก้ไข Min / Max / Safety / หน่วย / ผู้ส่ง', updSettingsGroup: 'แก้ไข Min / Max / Safety / หน่วย / ผู้ส่ง',
  addItem: 'เพิ่มสินค้าใหม่', addArea: 'ตั้งค่าพื้นที่จัดเก็บ', renameArea: 'ตั้งค่าพื้นที่จัดเก็บ', deleteArea: 'ตั้งค่าพื้นที่จัดเก็บ',
  addMaster: 'ข้อมูลหลัก (ผู้ส่ง / หน่วย)', renameMaster: 'ข้อมูลหลัก (ผู้ส่ง / หน่วย)', deleteMaster: 'ข้อมูลหลัก (ผู้ส่ง / หน่วย)',
};
for (const [name, feature] of Object.entries(DEMO_PREMIUM_FEATURES)) {
  if (typeof A[name] === 'function') A[name] = () => demoPremium(feature);
}

async function boot() {
  if (!API_READY) {
    window.DemoBanner?.apiMissing();
    bootMessage('⚙️', 'ยังไม่ได้ตั้งค่า API',
      'กรุณาใส่ URL ของ Google Apps Script Web App (ลงท้ายด้วย <code>/exec</code>) ในไฟล์ <code>docs/config.js</code>');
    return;
  }
  bootMessage('⏳', 'กำลังโหลดข้อมูล…', 'เชื่อมต่อ Google Apps Script — ครั้งแรกอาจใช้เวลาสักครู่');
  const result = await apiCall('payload', {}, 'GET');
  if (!result.ok || !result.payload) {
    bootMessage('⚠️', 'โหลดข้อมูลไม่สำเร็จ', esc(result.error || 'ไม่ทราบสาเหตุ'), true);
    return;
  }
  S = normalizePayload(result.payload);
  window.DemoBanner?.update(result.payload.demo);
  txnDate = S.today || Object.keys(S.dailyLedgers || {}).sort().pop() || '';
  $('#foot-time').textContent = new Date().toLocaleString('th-TH');
  const firstBoot = !BOOTED;
  BOOTED = true;
  updateNavBadge();
  show(firstBoot ? 'dash' : currentView);
  if (firstBoot) startDailyReadyPolling();
}
window.boot = boot;
boot();
