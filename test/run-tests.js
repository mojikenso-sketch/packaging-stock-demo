/*
 * Packaging Stock DEMO — test suite (no dependencies)
 *
 *   node test/run-tests.js                    run everything
 *   node test/run-tests.js --update-snapshot  regenerate test/seed-snapshot.json
 *
 * 1. Backend: Apps Script files run in a vm with mocked SpreadsheetApp,
 *    PropertiesService, ScriptApp, ContentService, Utilities, LockService.
 * 2. Seed: plain-data snapshot + invariants (Min/Max, Lot/expiry, balances).
 * 3. Frontend: docs/config.js + assets/demo.js + assets/app.js run against a
 *    minimal DOM stub, with fetch() routed to the mocked doGet / doPost.
 * 4. Demo limits: full-version (🔒) actions are refused by the API and shown
 *    locked in the UI; per-visitor trial gate script is wired in.
 * 5. Branding: no real company / customer names anywhere in the demo folder.
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {createGas, ROOT} = require('./gas-mock');

const SNAPSHOT = path.join(__dirname, 'seed-snapshot.json');
const SNAPSHOT_DATE = '2026-01-15';
const SNAPSHOT_STAMP = '2026-01-15 09:00:00';
const MAIN_AREA = '1100-คลังบรรจุภัณฑ์';
const DAY = 24 * 3600e3;
const HOUR = 3600e3;
const PREMIUM = /ฟีเจอร์นี้มีในเวอร์ชันเต็ม/;

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failures.push(name);
    console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e).split('\n').slice(0, 4).join('\n      '));
  }
}

/* ─── helpers ───────────────────────────────────────────────────────────── */
function bkkNoon(iso) { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d, 5, 0, 0); } // 12:00 BKK
function call(ctx, action, params = {}, method = 'POST') {
  const out = method === 'GET'
    ? ctx.doGet({parameter: {action, ...params}})
    : ctx.doPost({postData: {contents: JSON.stringify({action, ...params})}, parameter: {}});
  assert.strictEqual(out.mime, 'application/json');
  return JSON.parse(out.getContent());
}
function ok(ctx, action, params, method) {
  const r = call(ctx, action, params, method);
  assert.ok(r.ok, `${action} failed: ${r.error}`);
  return r;
}
function err(ctx, action, params, pattern) {
  const r = call(ctx, action, params);
  assert.strictEqual(r.ok, false, `${action} should fail`);
  if (pattern) assert.match(r.error, pattern);
  return r;
}
function itemRows(ledger) { return ledger.rows.filter(r => r.kind === 'item'); }
function balance(r) {
  return r.opening + r.receive + r.returnPackaging + r.returnSupplier - r.qaIssue - r.sendBackSupplier - r.issuePackaging;
}
function statusOf(a) {
  if (a.max > 0 && a.stock > a.max) return 'over';
  if (a.stock <= 0) return 'crit';
  if (a.min > 0 && a.stock < a.min) return 'low';
  return 'ok';
}
function mainAreaStatus(ledger) {
  let area = '__main__';
  const agg = {};
  for (const r of ledger.rows) {
    if (r.kind === 'section') { area = r.title; continue; }
    if (area !== MAIN_AREA) continue;
    const a = agg[r.code] = agg[r.code] || {stock: 0, min: r.min, max: r.max};
    a.stock += r.remaining;
  }
  const counts = {crit: 0, low: 0, over: 0, ok: 0};
  const byCode = {};
  for (const [code, a] of Object.entries(agg)) { const s = statusOf(a); counts[s]++; byCode[code] = s; }
  return {counts, byCode, total: Object.keys(agg).length};
}
function setup(nowMs) {
  const gas = createGas({now: nowMs});
  gas.context.setupDemo();
  return gas;
}
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* ─── 1. Seed ───────────────────────────────────────────────────────────── */
async function seedTests() {
  console.log('\nSeed data');
  const {context} = createGas({now: bkkNoon(SNAPSHOT_DATE)});
  const seed = JSON.parse(JSON.stringify(context.buildDemoSeed_(SNAPSHOT_DATE, SNAPSHOT_STAMP)));

  if (process.argv.includes('--update-snapshot')) {
    fs.writeFileSync(SNAPSHOT, JSON.stringify(seed, null, 1) + '\n');
    console.log('  (snapshot written: ' + path.relative(ROOT, SNAPSHOT) + ')');
  }
  await test('seed equals the plain-data snapshot (test/seed-snapshot.json)', () => {
    assert.ok(fs.existsSync(SNAPSHOT), 'run with --update-snapshot first');
    assert.deepStrictEqual(seed, JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')));
  });

  const today = '2026-10-13';
  const live = JSON.parse(JSON.stringify(context.buildDemoSeed_(today, today + ' 10:00:00')));
  const dates = Object.keys(live.dailyLedgers).sort();
  await test('10 daily ledgers ending today, all dates relative to today', () => {
    assert.strictEqual(dates.length, 10);
    assert.strictEqual(dates[0], addDays(today, -9));
    assert.strictEqual(dates[9], today);
    // same structure for any "today": counts of rows per day are date independent
    const other = context.buildDemoSeed_('2027-03-02');
    const otherDates = Object.keys(other.dailyLedgers).sort();
    assert.strictEqual(otherDates[9], '2027-03-02');
  });
  await test('46 packaging items (40–60), fictional codes and names', () => {
    const codes = new Set(live.items.map(i => i.code));
    assert.strictEqual(codes.size, 46);
    for (const c of codes) assert.match(c, /^[A-Z]{2}-\d{4}$/);
  });
  await test('Min/Max statuses in the main area: 5 below Min, 4 above Max, 1 out of stock', () => {
    const st = mainAreaStatus(live.dailyLedgers[today]);
    assert.deepStrictEqual(st.counts, {crit: 1, low: 5, over: 4, ok: 36});
    assert.strictEqual(st.byCode['TP-8002'], 'crit');
  });
  await test('every row balances and each day opens with the previous closing balance', () => {
    for (let k = 0; k < dates.length; k++) {
      const rows = itemRows(live.dailyLedgers[dates[k]]);
      for (const r of rows) {
        assert.ok(Math.abs(balance(r) - r.remaining) < 1e-9, `${dates[k]} ${r.id}`);
        assert.ok(r.opening >= 0 && r.remaining >= 0, 'no negative stock');
      }
      if (k === 0) continue;
      const prev = new Map(itemRows(live.dailyLedgers[dates[k - 1]]).map(r => [r.id, r]));
      for (const r of rows) if (prev.has(r.id)) assert.strictEqual(r.opening, prev.get(r.id).remaining, r.id);
    }
  });
  await test('seed already satisfies the carry-forward rules (recalculation changes nothing)', () => {
    const copy = JSON.parse(JSON.stringify(live.dailyLedgers));
    const changed = context.recalculateDailyCarryForward_(copy, dates[0]);
    assert.strictEqual(changed, 0);
  });
  await test('receive and withdraw movements on most days, Lot + mfg/expiry on every row', () => {
    let daysWithIssue = 0, daysWithReceive = 0;
    for (const d of dates) {
      const rows = itemRows(live.dailyLedgers[d]);
      if (rows.some(r => r.issuePackaging > 0)) daysWithIssue++;
      if (rows.some(r => r.receive > 0)) daysWithReceive++;
      for (const r of rows) {
        assert.ok(r.lot, 'lot'); assert.match(r.mfgDate, /^\d{4}-\d{2}-\d{2}$/); assert.match(r.expiryDate, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(r.expiryDate > r.mfgDate);
      }
    }
    assert.ok(daysWithIssue >= 8, 'withdrawals on most days');
    assert.ok(daysWithReceive >= 5, 'receipts on several days');
  });
  await test('expired and soon-to-expire lots exist (expiry monitoring demo)', () => {
    const rows = itemRows(live.dailyLedgers[today]);
    const expired = rows.filter(r => r.expiryDate < today);
    const soon = rows.filter(r => r.expiryDate >= today && r.expiryDate <= addDays(today, 30));
    assert.ok(expired.length >= 3, 'expired ' + expired.length);
    assert.ok(soon.length >= 3, 'soon ' + soon.length);
  });
  await test('older history, deliveries, master lists, areas', () => {
    assert.ok(live.transactions.length > 100);
    for (const t of live.transactions) assert.ok(t.date < dates[0] && t.date >= addDays(today, -30));
    assert.ok(live.deliveries.some(d => d.date > today && d.date <= addDays(today, 7)));
    assert.strictEqual(live.masterLists.suppliers.length, 7);
    assert.ok(live.areas.includes(MAIN_AREA) && live.areas.includes('HOLD'));
    assert.ok(live.dailyReady[addDays(today, -1)].ready);
    assert.ok(!live.dailyReady[today]);
  });
}

/* ─── 2. setup / reset / trigger ────────────────────────────────────────── */
async function demoLifecycleTests() {
  console.log('\nsetupDemo / auto reset');
  const start = bkkNoon('2026-10-13');
  const {context, state} = setup(start);
  const ss = Object.values(state.spreadsheets)[0];

  await test('setupDemo creates the spreadsheet, one sheet per data file, headers, no default sheet', () => {
    assert.strictEqual(Object.keys(state.spreadsheets).length, 1);
    assert.strictEqual(state.props.DEMO_SPREADSHEET_ID, ss.id);
    const names = ss.getSheets().map(s => s.name).sort();
    assert.deepStrictEqual(names, ['areas', 'config', 'daily_ledger_rows', 'daily_ledgers', 'daily_ready', 'deliveries', 'items', 'master_lists', 'transactions']);
    assert.deepStrictEqual(ss.getSheetByName('daily_ready').data[0], ['date', 'ready', 'at']);
    assert.ok(ss.getSheetByName('daily_ledger_rows').maxCols >= 32);
  });
  await test('setupDemo stores DEMO_LAST_RESET and the demo password', () => {
    assert.strictEqual(Number(state.props.DEMO_LAST_RESET), start);
    assert.strictEqual(state.props.DEMO_EDIT_PASSWORD, 'demo1234');
  });
  await test('exactly one hourly time-driven trigger for demoAutoReset (also after re-running setup)', () => {
    state.triggers.push({getHandlerFunction: () => 'demoAutoReset', spec: {handler: 'demoAutoReset', old: true}});
    context.setupDemo();
    context.setupDemo();
    const t = state.triggers.filter(x => x.getHandlerFunction() === 'demoAutoReset');
    assert.strictEqual(t.length, 1);
    assert.strictEqual(state.triggers.length, 1);
    assert.deepStrictEqual({...t[0].spec}, {handler: 'demoAutoReset', timeBased: true, everyHours: 1});
    assert.strictEqual(Object.keys(state.spreadsheets).length, 1, 'reuses the spreadsheet');
  });
  await test('API exposes demo info (last reset, next reset = last + 5 h)', () => {
    const r = ok(context, 'demo_info', {}, 'GET');
    assert.strictEqual(r.demo.resetHours, 5);
    assert.strictEqual(r.demo.lastReset, new Date(start).toISOString());
    assert.strictEqual(r.demo.nextReset, new Date(start + 5 * HOUR).toISOString());
    assert.strictEqual(r.demo.nextResetText, '2026-10-13 17:00');
    const p = ok(context, 'payload', {}, 'GET');
    assert.strictEqual(p.payload.demo.nextReset, r.demo.nextReset);
  });
  const note = () => itemRows(ok(context, 'payload', {}, 'GET').payload.dailyLedgers['2026-10-13']).find(r => r.id === 'seed-BX-1001-1').stockNote;
  await test('demoAutoReset does nothing before 5 hours (fake clock 4 h 59 min)', () => {
    ok(context, 'daily_ledger_save', {date: '2026-10-13', rows: [{id: 'seed-BX-1001-1', stockNote: 'ข้อความทดสอบ'}]});
    for (const h of [1, 2, 3, 4]) {
      state.now = start + h * HOUR;
      assert.strictEqual(context.demoAutoReset(), 'skip: not due', h + ' h');
    }
    state.now = start + 5 * HOUR - 60e3;
    assert.strictEqual(context.demoAutoReset(), 'skip: not due');
    assert.strictEqual(note(), 'ข้อความทดสอบ');
  });
  await test('demoAutoReset re-seeds at 5 hours (user changes removed) and again 5 hours later', () => {
    state.now = start + 5 * HOUR + 60e3;
    assert.strictEqual(context.demoAutoReset(), 'reset');
    assert.notStrictEqual(note(), 'ข้อความทดสอบ');
    assert.strictEqual(Number(state.props.DEMO_LAST_RESET), state.now);
    assert.strictEqual(ok(context, 'demo_info', {}, 'GET').demo.nextReset, new Date(state.now + 5 * HOUR).toISOString());
    const last = state.now;
    state.now = last + 4 * HOUR + 59 * 60e3;
    assert.strictEqual(context.demoAutoReset(), 'skip: not due');
    state.now = last + 5 * HOUR;
    assert.strictEqual(context.demoAutoReset(), 'reset');
  });
  await test('seeded dates follow the clock (reset after midnight → today is the new day)', () => {
    state.now = bkkNoon('2026-10-14') - 8 * HOUR; // 2026-10-14 04:00 BKK, > 5 h after the last reset
    assert.strictEqual(context.demoAutoReset(), 'reset');
    const p = ok(context, 'payload', {}, 'GET').payload;
    assert.strictEqual(p.today, '2026-10-14');
    assert.strictEqual(Object.keys(p.dailyLedgers).sort().at(-1), '2026-10-14');
  });
  await test('resetDemoNow re-seeds immediately', () => {
    const today = ok(context, 'payload', {}, 'GET').payload.today;
    ok(context, 'daily_ledger_save', {date: today, rows: [{id: 'seed-BX-1002-1', stockNote: 'ทดสอบ 2'}]});
    context.resetDemoNow();
    const row = itemRows(ok(context, 'payload', {}, 'GET').payload.dailyLedgers[today]).find(r => r.id === 'seed-BX-1002-1');
    assert.notStrictEqual(row.stockNote, 'ทดสอบ 2');
  });
  await test('before setupDemo the API answers with a setup message', () => {
    const fresh = createGas();
    const r = call(fresh.context, 'payload', {}, 'GET');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /setupDemo/);
    assert.strictEqual(fresh.context.demoAutoReset(), 'skip: not set up');
  });
  await test('missing spreadsheet is re-created by setupDemo', () => {
    const g = setup(start);
    g.state.spreadsheets = {};
    g.context.setupDemo();
    assert.strictEqual(Object.keys(g.state.spreadsheets).length, 1);
    assert.ok(ok(g.context, 'payload', {}, 'GET').payload.items.length > 40);
  });
}

/* ─── 3. every API action ───────────────────────────────────────────────── */
// The full-version logic is kept in the demo backend; these tests switch the
// premium lock off to keep it covered. premiumTests() checks the lock itself.
function setupFull(nowMs) {
  const gas = setup(nowMs);
  vm.runInContext('DEMO_LOCK_PREMIUM = false;', gas.context);
  return gas;
}
async function apiTests() {
  console.log('\nAPI actions (full-version logic, premium lock switched off)');
  const today = '2026-10-13';
  const {context, state} = setupFull(bkkNoon(today));
  const yesterday = addDays(today, -1);
  const P = () => ok(context, 'payload', {}, 'GET').payload;

  await test('payload (GET) has the full data set', () => {
    const p = P();
    for (const k of ['items', 'transactions', 'deliveries', 'deliveriesTotal', 'config', 'dailyLedgers', 'dailyReady', 'areas', 'masterLists', 'today', 'demo']) {
      assert.ok(k in p, k);
    }
    assert.strictEqual(p.today, today);
    assert.deepStrictEqual(p.config, {leadTimeDays: 7, usageWindowDays: 30, lowStockDays: 7});
    const row = itemRows(p.dailyLedgers[today])[0];
    assert.strictEqual(typeof row.remaining, 'number');
    assert.strictEqual(typeof row.lot, 'string');
    assert.ok(!('manualAdded' in row), 'false booleans omitted');
  });
  await test('auth_check accepts the demo password only', () => {
    ok(context, 'auth_check', {password: 'demo1234'});
    err(context, 'auth_check', {password: 'wrong-pass'}, /รหัสผ่านไม่ถูกต้อง/);
  });
  await test('daily_ready_get / daily_ready_mark', () => {
    const g = ok(context, 'daily_ready_get', {date: today}, 'GET');
    assert.strictEqual(g.dailyReady, null);
    assert.ok(ok(context, 'daily_ready_get', {date: yesterday}, 'GET').dailyReady.ready);
    const m = ok(context, 'daily_ready_mark', {date: today});
    assert.ok(m.dailyReady.ready && m.payload.dailyReady[today].ready);
    err(context, 'daily_ready_mark', {date: addDays(today, 5)}, /ไม่พบตาราง/);
    err(context, 'daily_ready_get', {date: 'x'}, /ไม่ถูกต้อง/);
  });
  await test('daily_ledger_save: movement, carry-forward to later days, items sync', () => {
    const id = 'seed-BX-1001-1';
    const before = P();
    const yRow = itemRows(before.dailyLedgers[yesterday]).find(r => r.id === id);
    const tRow = itemRows(before.dailyLedgers[today]).find(r => r.id === id);
    const r = ok(context, 'daily_ledger_save', {date: yesterday, rows: JSON.stringify([{id, receive: yRow.receive + 500, stockNote: 'ทดสอบ'}])});
    assert.strictEqual(r.updatedRows, 1);
    const y2 = itemRows(r.payload.dailyLedgers[yesterday]).find(x => x.id === id);
    const t2 = itemRows(r.payload.dailyLedgers[today]).find(x => x.id === id);
    assert.strictEqual(y2.remaining, yRow.remaining + 500);
    assert.strictEqual(t2.opening, tRow.opening + 500, 'carried forward');
    assert.strictEqual(t2.remaining, tRow.remaining + 500);
    const item = r.payload.items.find(i => i.ledgerId === id);
    assert.strictEqual(item.stock, t2.remaining, 'items sheet follows latest ledger');
  });
  await test('daily_ledger_save: rows as array, min/max/unit/supplier/dates/comment', () => {
    const id = 'seed-CP-4001-1';
    const r = ok(context, 'daily_ledger_save', {date: today, rows: [{id, min: '7000', max: 26000, unit: 'PCS', supplier: 'บจก. ทดสอบ', unitComment: 'หมายเหตุ', mfgDate: '2026-09-01', expiryDate: '2028-09-01', lot: 'LOT-T1'}]});
    const row = itemRows(r.payload.dailyLedgers[today]).find(x => x.id === id);
    assert.strictEqual(row.min, 7000); assert.strictEqual(row.max, 26000); assert.strictEqual(row.unit, 'PCS');
    assert.strictEqual(row.supplier, 'บจก. ทดสอบ'); assert.strictEqual(row.lot, 'LOT-T1'); assert.strictEqual(row.expiryDate, '2028-09-01');
  });
  await test('daily_ledger_save: validation errors', () => {
    const id = 'seed-TP-8002-1';
    err(context, 'daily_ledger_save', {date: today, rows: JSON.stringify([{id, issuePackaging: 99999}])}, /ติดลบ/);
    err(context, 'daily_ledger_save', {date: today, rows: JSON.stringify([{id, receive: -5}])}, /ไม่ติดลบ/);
    err(context, 'daily_ledger_save', {date: today, rows: JSON.stringify([{id, receive: 'abc'}])}, /ไม่ถูกต้อง/);
    err(context, 'daily_ledger_save', {date: today, rows: JSON.stringify([{id, expiryDate: '2569-01-01'}])}, /พ\.ศ\./);
    err(context, 'daily_ledger_save', {date: today, rows: JSON.stringify([{id, mfgDate: '2027-01-01', expiryDate: '2026-01-01'}])}, /ก่อนวันที่ผลิต/);
    err(context, 'daily_ledger_save', {date: today, rows: '{bad'}, /ไม่ถูกต้อง/);
    err(context, 'daily_ledger_save', {date: '2026-13-01', rows: '[]'}, /วันที่/);
    err(context, 'daily_ledger_save', {date: addDays(today, 3), rows: '[]'}, /ไม่พบตาราง/);
  });
  await test('text that looks like a formula is stored safely and read back unchanged', () => {
    const note = '=HYPERLINK("http://x","y")';
    ok(context, 'daily_ledger_save', {date: today, rows: [{id: 'seed-BX-1002-1', stockNote: note}]});
    const row = itemRows(P().dailyLedgers[today]).find(x => x.id === 'seed-BX-1002-1');
    assert.strictEqual(row.stockNote, note);
    const ss = Object.values(state.spreadsheets)[0];
    const cell = ss.getSheetByName('daily_ledger_rows').data.flat().find(v => String(v).includes('HYPERLINK'));
    assert.ok(String(cell).startsWith("'="), 'apostrophe-prefixed in the sheet');
  });
  await test('editing today rewrites only today\'s rows (tail write), data identical to full rewrite', () => {
    state.writes = [];
    ok(context, 'daily_ledger_save', {date: today, rows: [{id: 'seed-BX-1003-1', issuePackaging: 1}]});
    const w = state.writes.filter(x => x.sheet === 'daily_ledger_rows');
    assert.strictEqual(w.length, 1);
    assert.ok(w[0].row > 500, 'starts after earlier days, row ' + w[0].row);
    const p = P();
    const fresh = JSON.parse(JSON.stringify(p.dailyLedgers));
    // a full rewrite + re-read gives the same ledgers
    context.CTX_ = {};
    vm.runInContext('CTX_ = {}; saveDailyLedgers_(getDailyLedgers_()); CTX_ = {};', context);
    assert.deepStrictEqual(P().dailyLedgers, fresh);
  });
  await test('daily_ledger_create: tomorrow copied from today (movements reset), existing → created:false', () => {
    const tomorrow = addDays(today, 1);
    const r = ok(context, 'daily_ledger_create', {date: tomorrow});
    assert.ok(r.created);
    assert.deepStrictEqual(r.createdDates, [tomorrow]);
    const t = r.payload.dailyLedgers[today], n = r.payload.dailyLedgers[tomorrow];
    for (const row of itemRows(n)) {
      const prev = itemRows(t).find(x => x.id === row.id);
      assert.strictEqual(row.opening, prev.remaining);
      assert.strictEqual(row.receive + row.issuePackaging + row.qaIssue, 0);
    }
    assert.ok(!itemRows(n).some(x => x.id === 'seed-TP-8002-1'), 'zero-balance row not carried');
    assert.strictEqual(ok(context, 'daily_ledger_create', {date: tomorrow}).created, false);
    err(context, 'daily_ledger_create', {date: addDays(today, 30)}, /เดโม/);
    // remove tomorrow again for the remaining tests
    vm.runInContext(`CTX_ = {}; var L = getDailyLedgers_(); delete L['${tomorrow}']; saveDailyLedgers_(L); syncItemsFromLatestLedger_(L); CTX_ = {};`, context);
  });
  await test('daily_ledger_create fills a gap of several days', () => {
    const g = setupFull(bkkNoon(today));
    vm.runInContext(`CTX_ = {}; var L = getDailyLedgers_(); delete L['${today}']; delete L['${yesterday}']; saveDailyLedgers_(L); CTX_ = {};`, g.context);
    const r = ok(g.context, 'daily_ledger_create', {date: today});
    assert.deepStrictEqual(r.createdDates, [yesterday, today]);
    assert.strictEqual(r.sourceDate, addDays(today, -2));
  });
  await test('daily_ledger_add_row: new row in an area (and in a not-yet-used area)', () => {
    const r = ok(context, 'daily_ledger_add_row', {date: today, code: 'NEW-001', name: 'กล่องทดสอบ', unit: 'ใบ', area: MAIN_AREA, lot: 'L1', receive: 50});
    const row = itemRows(r.payload.dailyLedgers[today]).find(x => x.id === r.addedRow.id);
    assert.strictEqual(row.remaining, 50);
    assert.strictEqual(row.manualAdded, true);
    ok(context, 'area_add', {name: '1700-คลังสำรอง'});
    const r2 = ok(context, 'daily_ledger_add_row', {date: today, code: 'NEW-002', name: 'ถุงทดสอบ', area: '1700-คลังสำรอง', receive: '5'});
    const rows = r2.payload.dailyLedgers[today].rows;
    const idx = rows.findIndex(x => x.id === r2.addedRow.id);
    assert.strictEqual(rows[idx - 1].kind, 'section');
    assert.strictEqual(rows[idx - 1].title, '1700-คลังสำรอง');
    err(context, 'daily_ledger_add_row', {date: today, code: 'BAD CODE', name: 'x'}, /ใช้ได้เฉพาะ/);
    err(context, 'daily_ledger_add_row', {date: today, code: 'X1', name: 'x', area: 'ไม่มีพื้นที่นี้'}, /พื้นที่/);
    err(context, 'daily_ledger_add_row', {date: today, code: '', name: ''}, /กรุณากรอก/);
  });
  await test('daily_ledger_split_lot and delete_row (split quantity returned to parent)', () => {
    const id = 'seed-BX-1005-1';
    const before = itemRows(P().dailyLedgers[today]).find(x => x.id === id);
    const r = ok(context, 'daily_ledger_split_lot', {date: today, id, qty: 100, lot: 'SPLIT-1', mfgDate: '2026-09-01', expiryDate: '2028-09-01'});
    assert.strictEqual(r.splitRow.parentRemaining, before.remaining - 100);
    const rows = r.payload.dailyLedgers[today].rows;
    const pi = rows.findIndex(x => x.id === id);
    assert.strictEqual(rows[pi + 1].id, r.splitRow.id);
    assert.strictEqual(rows[pi + 1].remaining, 100);
    assert.strictEqual(rows[pi + 1].splitFrom, id);
    err(context, 'daily_ledger_split_lot', {date: today, id, qty: 1e7, lot: 'X'}, /ไม่เกินยอดคงเหลือ/);
    err(context, 'daily_ledger_split_lot', {date: today, id, qty: 1, lot: ''}, /Lot/);
    const d = ok(context, 'daily_ledger_delete_row', {date: today, id: r.splitRow.id});
    assert.strictEqual(d.deletedRow.returnedTo.remaining, before.remaining);
    const countBefore = d.payload.dailyLedgers[today].rows.length;
    const d2 = ok(context, 'daily_ledger_delete_row', {date: today, id: 'seed-BX-1006-1'});
    assert.ok(!d2.payload.items.some(i => i.ledgerId === 'seed-BX-1006-1'));
    const reread = P().dailyLedgers[today].rows; // from the sheet, after a shorter tail write
    assert.strictEqual(reread.length, countBefore - 1, 'left-over rows cleared');
    assert.strictEqual(new Set(reread.map(x => x.id)).size, reread.length, 'no duplicate rows');
    err(context, 'daily_ledger_delete_row', {date: today, id: 'nope'}, /ไม่พบ/);
  });
  await test('txn_add (receive / withdraw / return / adjust) and txn_delete', () => {
    // legacy transactions work on the items sheet (as in api.php)
    const code = 'BX-1004';
    const stock0 = P().items.find(i => i.code === code).stock;
    const a = ok(context, 'txn_add', {type: 'receive', code, qty: '10', date: today, person: 'ทดสอบ'});
    assert.strictEqual(a.txn.after, stock0 + 10);
    const b = ok(context, 'txn_add', {type: 'withdraw', code, qty: 4, date: today});
    ok(context, 'txn_add', {type: 'return', code, qty: 1, date: today});
    const c = ok(context, 'txn_add', {type: 'adjust', code, qty: 0, new_stock: 100, date: today});
    assert.strictEqual(c.txn.after, 100);
    err(context, 'txn_add', {type: 'withdraw', code, qty: 1e6, date: today}, /ไม่พอเบิก/);
    err(context, 'txn_add', {type: 'steal', code, qty: 1}, /ประเภท/);
    err(context, 'txn_add', {type: 'receive', code: 'ZZ-0000', qty: 1}, /ไม่พบรหัส/);
    ok(context, 'txn_delete', {id: c.txn.id});
    ok(context, 'txn_delete', {id: b.txn.id});
    err(context, 'txn_delete', {id: 'none'}, /ไม่พบรายการ/);
    assert.ok(P().transactions.some(t => t.id === a.txn.id));
  });
  await test('item_update and item_add (adds a row to the latest ledger)', () => {
    const r = ok(context, 'item_update', {code: 'BG-6004', min: '600', max: 2100.7, safety: -3, unit: 'ใบ', supplier: 'บจก. ใหม่'});
    const it = r.payload.items.find(i => i.code === 'BG-6004');
    assert.strictEqual(it.min, 600); assert.strictEqual(it.max, 2100); assert.strictEqual(it.safety, 0);
    const add = ok(context, 'item_add', {code: 'ZZ-9999', name: 'สินค้าใหม่ทดสอบ', unit: 'ชิ้น', area: MAIN_AREA, stock: 30, min: 10, max: 100, safety: 5});
    assert.ok(itemRows(add.payload.dailyLedgers[today]).some(x => x.code === 'ZZ-9999' && x.remaining === 30));
    err(context, 'item_add', {code: 'ZZ-9999', name: 'ซ้ำ'}, /มีอยู่แล้ว/);
    err(context, 'item_update', {code: 'NOPE'}, /ไม่พบรหัส/);
  });
  await test('config_save clamps values', () => {
    const r = ok(context, 'config_save', {leadTimeDays: 999, usageWindowDays: '14', lowStockDays: 0});
    assert.deepStrictEqual(r.payload.config, {leadTimeDays: 365, usageWindowDays: 14, lowStockDays: 1});
  });
  await test('area_add / area_rename (renames ledger sections) / area_delete', () => {
    ok(context, 'area_add', {name: 'พื้นที่ A'});
    err(context, 'area_add', {name: 'พื้นที่ A'}, /มีพื้นที่นี้อยู่แล้ว/);
    err(context, 'area_add', {name: '__main__'}, /สงวน/);
    const r = ok(context, 'area_rename', {oldName: '1300-รอคืน Supplier', newName: '1300-รอส่งคืน'});
    assert.ok(r.renamedSections >= 10);
    assert.ok(r.payload.dailyLedgers[today].rows.some(x => x.kind === 'section' && x.title === '1300-รอส่งคืน'));
    err(context, 'area_rename', {oldName: 'ไม่มี', newName: 'ใหม่'}, /ไม่พบพื้นที่เดิม/);
    const d = ok(context, 'area_delete', {name: 'พื้นที่ A'});
    assert.ok(!d.areas.includes('พื้นที่ A'));
  });
  await test('master_add / master_rename / master_delete (suppliers with shelf life, units)', () => {
    let r = ok(context, 'master_add', {kind: 'supplier', name: 'บจก. ผู้ส่งใหม่', shelfLife: '6 เดือน'});
    assert.ok(r.masterLists.supplierShelfLives.some(s => s.supplier === 'บจก. ผู้ส่งใหม่' && s.shelfLife === '6 เดือน'));
    r = ok(context, 'master_rename', {kind: 'supplier', oldName: 'บจก. ผู้ส่งใหม่', newName: 'บจก. ผู้ส่งใหม่ 2', shelfLife: '9 เดือน'});
    assert.ok(r.payload.masterLists.supplierShelfLives.some(s => s.supplier === 'บจก. ผู้ส่งใหม่ 2' && s.shelfLife === '9 เดือน'));
    r = ok(context, 'master_rename', {kind: 'supplier', oldName: 'บจก. ผู้ส่งใหม่ 2', newName: 'บจก. ผู้ส่งใหม่ 2', shelfLife: '10 เดือน'});
    assert.ok(r.payload.masterLists.supplierShelfLives.some(s => s.shelfLife === '10 เดือน'), 'shelf-life only edit');
    ok(context, 'master_delete', {kind: 'supplier', name: 'บจก. ผู้ส่งใหม่ 2'});
    r = ok(context, 'master_add', {kind: 'unit', name: 'แพ็ค'});
    assert.ok(r.payload.masterLists.units.includes('แพ็ค'));
    ok(context, 'master_rename', {kind: 'unit', oldName: 'แพ็ค', newName: 'แพ็ก'});
    r = ok(context, 'master_delete', {kind: 'unit', name: 'แพ็ก'});
    assert.ok(!r.payload.masterLists.units.includes('แพ็ก'));
    err(context, 'master_add', {kind: 'color', name: 'x'}, /ประเภท/);
    err(context, 'master_add', {kind: 'unit', name: 'ใบ'}, /มีรายการนี้อยู่แล้ว/);
  });
  await test('ERP / Excel sync actions are disabled in the demo', () => {
    for (const a of ['oracle_snapshot', 'oracle_realtime', 'daily_ledger_sync_oracle', 'reimport_deliveries']) {
      err(context, a, {date: today}, /ปิดไว้ในเวอร์ชันเดโม/);
    }
  });
  await test('unknown action, malformed body, busy lock', () => {
    err(context, 'drop_everything', {}, /ไม่รู้จักคำสั่ง/);
    const bad = JSON.parse(context.doPost({postData: {contents: '{not json'}}).getContent());
    assert.strictEqual(bad.ok, false);
    state.lockBusy = true;
    err(context, 'area_add', {name: 'ล็อก'}, /ผู้ใช้อื่น/);
    ok(context, 'payload', {}, 'GET'); // reads never need the lock
    state.lockBusy = false;
    assert.strictEqual(state.locks >= state.unlocks, true);
  });
  await test('every lock taken by a request is released', () => {
    const g = setupFull(bkkNoon(today));
    g.state.locks = 0; g.state.unlocks = 0;
    ok(g.context, 'area_add', {name: 'x1'});
    err(g.context, 'area_add', {name: 'x1'});
    assert.strictEqual(g.state.locks, 2);
    assert.strictEqual(g.state.unlocks, 2);
  });
}

/* ─── 3b. Demo premium lock (server side) ───────────────────────────────── */
async function premiumTests() {
  console.log('\nDemo limits: full-version actions refused by the API');
  const today = '2026-10-13';
  const yesterday = addDays(today, -1);
  const {context} = setup(bkkNoon(today));
  const P = () => ok(context, 'payload', {}, 'GET').payload;

  await test('premium lock is on by default', () => {
    assert.strictEqual(vm.runInContext('DEMO_LOCK_PREMIUM', context), true);
  });
  await test('locked actions return {ok:false, error:"ฟีเจอร์นี้มีในเวอร์ชันเต็ม"} and change nothing', () => {
    const before = JSON.stringify(P());
    const calls = {
      daily_ledger_split_lot: {date: today, id: 'seed-BX-1005-1', qty: 1, lot: 'X'},
      daily_ledger_delete_row: {date: today, id: 'seed-BX-1006-1'},
      txn_add: {type: 'receive', code: 'BX-1004', qty: 1, date: today},
      txn_delete: {id: 'any'},
      item_update: {code: 'BG-6004', min: 1},
      item_add: {code: 'ZZ-1', name: 'x'},
      config_save: {leadTimeDays: 3},
      area_add: {name: 'x'}, area_rename: {oldName: MAIN_AREA, newName: 'y'}, area_delete: {name: MAIN_AREA},
      master_add: {kind: 'unit', name: 'x'}, master_rename: {kind: 'unit', oldName: 'ใบ', newName: 'x'},
      master_delete: {kind: 'unit', name: 'ใบ'},
    };
    for (const [action, params] of Object.entries(calls)) {
      const r = err(context, action, params, PREMIUM);
      assert.strictEqual(r.error.startsWith('ฟีเจอร์นี้มีในเวอร์ชันเต็ม'), true, action);
      // also via GET (doGet routes to the same handler)
      assert.strictEqual(call(context, action, params, 'GET').ok, false, action + ' GET');
    }
    const after = JSON.parse(JSON.stringify(P()));
    const b = JSON.parse(before);
    delete b.demo.serverTime; delete after.demo.serverTime;
    assert.deepStrictEqual(after, b);
  });
  await test('daily table works for today only (save / add row / create / ready)', () => {
    err(context, 'daily_ledger_save', {date: yesterday, rows: [{id: 'seed-BX-1001-1', receive: 1}]}, PREMIUM);
    err(context, 'daily_ledger_add_row', {date: yesterday, code: 'N-1', name: 'x'}, PREMIUM);
    err(context, 'daily_ledger_create', {date: addDays(today, 1)}, PREMIUM);
    err(context, 'daily_ready_mark', {date: yesterday}, PREMIUM);
    const r = ok(context, 'daily_ledger_save', {date: today, rows: [{id: 'seed-BX-1001-1', receive: 7, issuePackaging: 2, stockNote: 'วันนี้'}]});
    const row = itemRows(r.payload.dailyLedgers[today]).find(x => x.id === 'seed-BX-1001-1');
    assert.strictEqual(row.receive, 7);
    assert.strictEqual(row.issuePackaging, 2);
    const add = ok(context, 'daily_ledger_add_row', {date: today, code: 'NEW-7', name: 'กล่องทดลอง', area: MAIN_AREA, receive: 3});
    assert.ok(add.addedRow.id);
    assert.strictEqual(ok(context, 'daily_ledger_create', {date: today}).created, false);
    ok(context, 'daily_ready_mark', {date: today});
  });
  await test('daily_ledger_save: Min / Max / Safety / unit / supplier changes refused, unchanged values accepted', () => {
    const row = itemRows(P().dailyLedgers[today]).find(x => x.id === 'seed-CP-4001-1');
    for (const change of [{min: row.min + 1}, {max: row.max + 1}, {safety: row.safety + 1}, {unit: 'กล่องใหม่'}, {supplier: 'บจก. อื่น'}]) {
      err(context, 'daily_ledger_save', {date: today, rows: [{id: row.id, receive: 1, ...change}]}, PREMIUM);
    }
    assert.strictEqual(itemRows(P().dailyLedgers[today]).find(x => x.id === row.id).receive, row.receive, 'nothing saved');
    // the web page sends the whole row back — unchanged master fields are fine
    const r = ok(context, 'daily_ledger_save', {date: today, rows: [{...row, receive: row.receive + 5}]});
    assert.strictEqual(itemRows(r.payload.dailyLedgers[today]).find(x => x.id === row.id).receive, row.receive + 5);
  });
}

/* ─── 4. Frontend (DOM stub + mocked backend) ───────────────────────────── */
function createDom() {
  const elements = new Map();
  function makeEl(key) {
    const classes = new Set();
    const el = {
      key, innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, title: '',
      style: {cssText: ''}, dataset: {}, attributes: {}, className: '',
      classList: {
        add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (c, on) => { const want = on === undefined ? !classes.has(c) : !!on; want ? classes.add(c) : classes.delete(c); return want; },
        contains: c => classes.has(c),
      },
      setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k] ?? null; },
      removeAttribute(k) { delete this.attributes[k]; },
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
      focus() {}, select() {}, setSelectionRange() {}, click() {}, remove() {}, appendChild(c) { return c; },
      replaceChildren() { this.innerHTML = ''; }, closest() { return null; },
      querySelector: sel => getEl(sel), querySelectorAll: () => [],
      getBoundingClientRect: () => ({top: 0, left: 0, width: 0, height: 0}), offsetWidth: 0,
    };
    return el;
  }
  function getEl(sel) {
    if (!elements.has(sel)) elements.set(sel, makeEl(sel));
    return elements.get(sel);
  }
  const listeners = {};
  const document = {
    readyState: 'complete', hidden: false,
    documentElement: {dataset: {theme: 'light', sidebar: 'expanded'}, scrollTop: 0},
    body: makeEl('body'),
    querySelector: getEl, querySelectorAll: () => [], getElementById: id => getEl('#' + id),
    createElement: tag => makeEl('new:' + tag),
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
  };
  return {document, getEl, elements};
}

async function frontendTests() {
  console.log('\nFrontend (docs/) against the mocked Web App');
  const files = ['config.js', 'assets/trial-gate.js', 'assets/demo.js', 'assets/app.js'].map(f => [f, fs.readFileSync(path.join(ROOT, 'docs', f), 'utf8')]);
  const EXEC = 'https://script.google.com/macros/s/DEMO_TEST_DEPLOYMENT/exec';

  // docs/config.js may hold the real Trial Gate URL; the frontend tests run with
  // the placeholder (unless a test passes another gateUrl) so fetchLog only holds
  // the app's own API calls and the gate stays fail-open.
  const GATE_PLACEHOLDER = 'PASTE_TRIAL_GATE_URL_HERE';
  const DEPLOYED_EXEC_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
  function makeFront(apiUrl, gas, gateUrl = GATE_PLACEHOLDER) {
    const dom = createDom();
    const fetchLog = [];
    const win = {
      document: dom.document, console: {log() {}, error() {}, warn() {}},
      localStorage: {getItem: () => null, setItem() {}, removeItem() {}},
      setTimeout: (f, ms) => setTimeout(f, Math.min(ms || 0, 5)), clearTimeout,
      setInterval: () => 0, clearInterval: () => {},
      requestAnimationFrame: f => setTimeout(f, 0),
      scrollTo() {}, print() {}, confirm: () => true, prompt: () => null, addEventListener() {},
      URLSearchParams, Intl, Date, Math, JSON, Promise, Map, Set, Array, Object, String, Number, RegExp, Error, Symbol,
      Event: class { constructor(t) { this.type = t; } },
      getComputedStyle: () => ({fontSize: '12px'}),
      async fetch(url, opt = {}) {
        fetchLog.push({url, opt});
        let out;
        if ((opt.method || 'GET') === 'GET') {
          const q = Object.fromEntries(new URL(url).searchParams);
          out = gas.context.doGet({parameter: q});
        } else {
          assert.strictEqual(opt.headers['Content-Type'], 'text/plain;charset=utf-8', 'POST must be a simple request');
          out = gas.context.doPost({postData: {contents: opt.body}, parameter: {}});
        }
        return {ok: true, status: 200, json: async () => JSON.parse(out.getContent())};
      },
    };
    win.window = win;
    vm.createContext(win);
    for (const [name, code] of files) {
      const src = name === 'config.js'
        ? code.replace(/API_URL: '[^']*'/, `API_URL: '${apiUrl}'`).replace(/gateUrl: '[^']*'/, `gateUrl: '${gateUrl}'`)
        : code;
      vm.runInContext(src, win, {filename: name});
    }
    return {win, dom, fetchLog, run: code => vm.runInContext(code, win)};
  }
  const settle = () => new Promise(r => setTimeout(r, 30));

  await test('API not configured → "ยังไม่ได้ตั้งค่า API" (banner + page), no requests', async () => {
    const f = makeFront('PASTE_DEPLOYED_EXEC_URL_HERE', setup(Date.now()));
    await settle();
    assert.match(f.dom.getEl('#demo-banner').innerHTML, /ยังไม่ได้ตั้งค่า API/);
    assert.match(f.dom.getEl('#view-dash').innerHTML, /ยังไม่ได้ตั้งค่า API/);
    assert.strictEqual(f.fetchLog.length, 0);
  });

  const gas = setup(Date.now());
  const f = makeFront(EXEC, gas);
  await settle();
  const html = sel => f.dom.getEl(sel).innerHTML;

  await test('demo banner: shared data reset every 5 hours, 5 hours per visitor, countdown, contact, demo account', () => {
    const b = html('#demo-banner');
    assert.match(b, /🧪 ระบบทดลองใช้ \(Demo\)/);
    assert.match(b, /ข้อมูลกลางรีเซ็ตกลับเป็นค่าเริ่มต้นทุก 5 ชั่วโมง/);
    assert.match(b, /ผู้ทดลองแต่ละคนใช้งานได้ 5 ชั่วโมง/);
    assert.ok(!/3 วัน/.test(b));
    assert.match(b, /รีเซ็ตครั้งถัดไป: <span id="demo-next-reset"><b>.+<\/b> <span class="demo-countdown">\(อีก 4 ชม\. 5\d นาที\)/);
    assert.match(b, /สนใจใช้งานจริง ติดต่อ: Fastwork \/ LINE: \(ใส่ภายหลัง\)/);
    assert.match(b, /บัญชีทดลอง/);
    assert.match(b, /demo1234/);
  });
  await test('boot loads the payload with a GET request', () => {
    assert.strictEqual(f.fetchLog[0].opt.method, 'GET');
    assert.match(f.fetchLog[0].url, /action=payload/);
    assert.strictEqual(f.run('BOOTED'), true);
  });
  await test('dashboard: KPIs (รายการ / ต่ำกว่า Min / เกิน Max / ปกติ), donut, 7-day bars, Top 3, stock table', () => {
    const d = html('#view-dash');
    const kpi = label => new RegExp(`<div class="kv">(\\d+)</div><div class="kl">${label}</div>`).exec(d)?.[1];
    assert.strictEqual(kpi('รายการทั้งหมด'), '46');
    assert.strictEqual(kpi('ต่ำกว่า Min'), '5');
    assert.strictEqual(kpi('เกิน Max'), '4');
    assert.strictEqual(kpi('ปกติ'), '36');
    assert.strictEqual(kpi('หมดสต๊อก'), '1');
    assert.match(d, /สัดส่วนสถานะสต๊อก/);
    assert.match(d, /stroke-dasharray/);
    assert.match(d, /ยอดเบิกจ่ายรวม 7 วันล่าสุด/);
    assert.strictEqual((d.match(/class="mb-col/g) || []).length, 7);
    assert.match(d, /Top 3 ใกล้หมดสต๊อก/);
    const top = d.slice(d.indexOf('Top 3 ใกล้หมดสต๊อก'));
    assert.strictEqual((top.match(/class="lowstock-item /g) || []).length, 3);
    assert.match(top, /ITEM TP-8002/, 'out-of-stock item ranks first');
    assert.ok(top.indexOf('TP-8002') < top.indexOf('FM-5002'));
    assert.match(d, /<th>Lot<\/th><th class="num">คงเหลือ<\/th><th>ระดับสต๊อก<\/th><th>สถานะ<\/th><th>หมายเหตุ<\/th>/);
    assert.match(d, /class="lvl"/);
    assert.match(d, /รอของเข้า PO-DEMO-26001/);
    assert.match(d, /Top 3 ใกล้หมดอายุ/);
    assert.match(d, /กำหนดรับของ 7 วันข้างหน้า/);
  });
  await test('nav badge counts alert items', () => {
    assert.ok(Number(f.dom.getEl('#nav-alert-n').textContent) >= 10);
  });
  await test('แจ้งเตือน & Lot view: below-Min / above-Max lists and Lot / expiry follow-up', () => {
    f.run("show('pkg')");
    const v = html('#view-pkg');
    assert.match(v, /ต่ำกว่า Min \/ หมดสต๊อก <span class="sub">6 รายการ/);
    assert.match(v, /เกิน Max <span class="sub">4 รายการ/);
    assert.match(v, /ติดตาม Lot และวันหมดอายุ/);
    assert.match(v, /หมดอายุแล้ว <b>[1-9]/);
    assert.match(v, /หมดอายุแล้ว \d+ วัน/);
    f.run("lotFilter.expiry = 'expired'; VIEWS.pkg()");
    const rows = (html('#view-pkg').match(/<tr style="cursor:pointer"/g) || []).length;
    assert.ok(rows >= 3 && rows <= 6, 'expired filter rows ' + rows);
    f.run("lotFilter.expiry = 'all'");
  });
  await test('daily table (บันทึกรับเข้า/เบิกจ่าย): no ERP columns/tabs, area tabs, read-only by default', () => {
    f.run("show('txn')");
    const v = html('#view-txn');
    assert.match(v, /ตารางรับเข้า \/ เบิกจ่ายรายวัน/);
    assert.match(v, /data-testid="daily-table"/);
    assert.ok(!/Oracle|Sync Oracle|สรุปผลต่าง/.test(v), 'no ERP UI');
    assert.match(v, /1100-คลังบรรจุภัณฑ์/);
    assert.match(v, /2100 · ไลน์ 1/);
    assert.match(v, /โหมดดูอย่างเดียว/);
    const th = (v.slice(v.indexOf('data-testid="daily-table"')).split('</thead>')[0].match(/<th[ >]/g) || []).length;
    assert.strictEqual(th, 20, 'header columns match section colspan');
  });
  await test('edit mode password is checked by the API (wrong / demo password)', async () => {
    f.dom.getEl('#daily-edit-password').value = 'wrong';
    await f.run('A.dailyEditPasswordSubmit()');
    assert.strictEqual(f.run('dailyEditMode'), false);
    f.dom.getEl('#daily-edit-password').value = 'demo1234';
    await f.run('A.dailyEditPasswordSubmit()');
    assert.strictEqual(f.run('dailyEditMode'), true);
    assert.match(html('#view-txn'), /โหมดแก้ไข/);
    assert.match(html('#view-txn'), /data-field="issuePackaging"/);
  });
  await test('autosave sends a POST text/plain JSON and updates the ledger', async () => {
    const id = 'seed-BX-1001-1';
    f.run(`(() => { const row = S.dailyLedgers[txnDate].rows.find(r => r.id === '${id}'); row.receive = 1000; row.remaining = dailyBalance(row); dailyDirty.add(row.id); dailyDraftRows.set(row.id, row); })()`);
    await f.run('flushDailyAutosave()');
    const last = f.fetchLog.at(-1);
    assert.strictEqual(last.opt.method, 'POST');
    const body = JSON.parse(last.opt.body);
    assert.strictEqual(body.action, 'daily_ledger_save');
    const saved = gas.context.doGet({parameter: {action: 'payload'}});
    const p = JSON.parse(saved.getContent()).payload;
    assert.strictEqual(itemRows(p.dailyLedgers[p.today]).find(r => r.id === id).receive, 1000);
    assert.strictEqual(f.run('dailyDirty.size'), 0);
  });
  await test('add row (รับเข้า) from the modal', async () => {
    f.run('A.dailyOpenAddRow()');
    assert.match(html('#modal'), /เพิ่มรายการในตารางวันที่/);
    f.dom.getEl('#daily-add-code').value = 'NEW-100';
    f.dom.getEl('#daily-add-name').value = 'กล่องใหม่จากหน้าเว็บ';
    f.dom.getEl('#daily-add-unit').value = 'ใบ';
    f.dom.getEl('#daily-add-receive').value = '25';
    f.dom.getEl('#daily-add-area').value = MAIN_AREA;
    f.dom.getEl('#daily-add-lot').value = 'WEB1';
    await f.run('A.dailyAddRow()');
    assert.ok(f.run("S.items.some(i => i.code === 'NEW-100' && i.stock === 25)"));
  });
  await test('daily table: 🔒 on export / print / pallet / split / delete; Min / Max / Safety / unit not editable', () => {
    f.run("show('txn')");
    const v = html('#view-txn');
    for (const label of ['🔒 EXPORT EXCEL', '🔒 พิมพ์เอกสาร', '🔒 ใบพาเลต', '🔒 แยก LOT', '🔒 ลบ']) assert.ok(v.includes(label), label);
    for (const field of ['min', 'max', 'safety', 'unit']) assert.ok(!v.includes(`data-field="${field}"`), field);
    assert.match(v, /data-field="receive"/);
    assert.match(v, /data-field="lot"|daily-lot/);
    assert.match(v, /demo-locked-cell/);
  });
  await test('locked buttons open the "มีในเวอร์ชันเต็ม" box with the contact and send nothing', () => {
    const n = f.fetchLog.length;
    for (const call of ['A.exportDailyExcel()', 'A.dailyPrint()', "A.dailyOpenPallet('seed-BX-1001-1')", "A.dailyOpenSplitLot('seed-BX-1001-1')",
      "A.dailyDeleteRow('seed-BX-1001-1')", 'A.exportCSV()', "A.txnDelete('x')", "A.updItem('seed-BX-1001-1','min','1')",
      "A.addArea()", "A.addMaster('unit')", "A.deleteMaster('unit','ใบ')", "A.renameArea('x')"]) {
      f.run('A.closePremium()');
      f.run(call);
      const box = f.dom.getEl('#demo-premium');
      assert.strictEqual(box.hidden, false, call);
      assert.match(box.innerHTML, /🔒/);
      assert.match(box.innerHTML, /ฟีเจอร์นี้มีในเวอร์ชันเต็ม/);
      assert.match(box.innerHTML, /สนใจใช้งานจริง ติดต่อ: Fastwork/);
    }
    f.run('A.closePremium()');
    assert.strictEqual(f.dom.getEl('#demo-premium').hidden, true);
    assert.strictEqual(f.fetchLog.length, n, 'no API calls');
  });
  await test('edit mode works on today only (other dates are view-only with a 🔒 note)', () => {
    const today = f.run('S.today');
    f.run(`txnDate = '${addDays(today, -1)}'; VIEWS.txn()`);
    const v = html('#view-txn');
    assert.ok(!v.includes('data-field="receive"'));
    assert.match(v, /แก้ไขได้เฉพาะตารางของวันนี้/);
    const n = f.fetchLog.length;
    f.run(`ensureDailyLedger('${addDays(today, 1)}')`);
    assert.strictEqual(f.fetchLog.length, n, 'no auto-create for other dates');
    f.run(`txnDate = '${today}'; VIEWS.txn()`);
    assert.match(html('#view-txn'), /data-field="receive"/);
  });
  await test('history (ประวัติรายการย้อนหลัง) lists ledger movements and older records', () => {
    f.run("show('history')");
    const v = html('#view-history');
    assert.match(v, /ประวัติรายการ/);
    assert.match(v, /จ่ายบรรจุ/);
    assert.match(v, /รับเข้า/);
    assert.match(v, /เบิกรวม −[\d,]+/);
    const n = Number(/(\d[\d,]*) รายการ/.exec(v)[1].replace(/,/g, ''));
    assert.ok(n > 500, 'history entries ' + n);
    assert.match(v, /🔒 Export CSV/);
  });
  await test('usage statistics and settings render', () => {
    f.run("show('stats')");
    assert.match(html('#view-stats'), /Top 10 ใช้มากที่สุด/);
    f.run("show('settings')");
    const s = html('#view-settings');
    assert.match(s, /บจก\. กล่องไทย ตัวอย่าง/);
    assert.match(s, /รายการสินค้า/);
    assert.match(s, /หน้านี้ดูได้อย่างเดียว/);
    assert.strictEqual((s.match(/class="settings-item-input" readonly/g) || []).length, (s.match(/class="settings-item-input"/g) || []).length);
    for (const label of ['🔒 เพิ่มพื้นที่', '🔒 เพิ่ม</button>', '🔒✎', '🔒✕']) assert.ok(s.includes(label), label);
  });
  await test('item drawer opens with usage + order advice', () => {
    f.run("A.openItem('seed-BX-1001-1')");
    const d = html('#drawer');
    assert.match(d, /กล่องลูกฟูก 3 ชั้น ขนาด A/);
    assert.match(d, /ยอดเบิกรายวัน 30 วัน/);
    assert.match(d, /ควรสั่งซื้อภายใน/);
  });
  await test('trial gate: DEMO_TRIAL configured, script loaded, fail-open with the placeholder URL', () => {
    const t = f.run('window.DEMO_TRIAL');
    assert.strictEqual(t.app, 'packaging');
    assert.strictEqual(t.hours, 5);
    // docs/config.js: placeholder or a deployed Trial Gate /exec URL
    const cfg = files.find(([n]) => n === 'config.js')[1];
    const current = (/gateUrl: '([^']*)'/.exec(cfg) || [])[1];
    assert.ok(current === GATE_PLACEHOLDER || DEPLOYED_EXEC_RE.test(current), 'gate URL ' + current);
    const api = (/API_URL: '([^']*)'/.exec(cfg) || [])[1];
    assert.ok(api === 'PASTE_DEPLOYED_EXEC_URL_HERE' || DEPLOYED_EXEC_RE.test(api), 'API URL ' + api);
    // the frontend under test runs with the placeholder gate URL (overridden above)
    assert.strictEqual(t.gateUrl, GATE_PLACEHOLDER);
    assert.strictEqual(t.contact, f.run('window.DEMO_CONTACT'));
    assert.match(t.priceHtml, /19,900 บาท\/ปี/);
    assert.match(t.priceHtml, /39,900 บาท/);
    assert.strictEqual(f.run('window.DemoTrial.isExpired()'), false);
    assert.ok(!f.fetchLog.some(x => /ipify|cloudflare|PASTE_TRIAL/.test(x.url)), 'no gate requests while the URL is a placeholder');
  });
  await test('index.html loads trial-gate.js right after config.js; file identical to the shared TrialGate client', () => {
    const page = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
    const scripts = [...page.matchAll(/<script src="([^"?]+)/g)].map(m => m[1]);
    assert.deepStrictEqual(scripts, ['config.js', 'assets/trial-gate.js', 'assets/demo.js', 'assets/app.js']);
    const shared = path.join(ROOT, '..', 'TrialGate', 'client', 'trial-gate.js');
    if (fs.existsSync(shared)) {
      assert.strictEqual(fs.readFileSync(path.join(ROOT, 'docs', 'assets', 'trial-gate.js'), 'utf8'), fs.readFileSync(shared, 'utf8'));
    }
    const css = fs.readFileSync(path.join(ROOT, 'docs', 'assets', 'style.css'), 'utf8');
    assert.match(css, /html body #demo-trial-badge \{ left: 248px/, 'badge moved off the sidebar toggle');
  });
  await test('localStorage keys use the demo_pkg_ prefix', () => {
    const all = files.filter(x => x[0] !== 'assets/trial-gate.js').map(x => x[1]).join('\n') + fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
    const keys = [...all.matchAll(/localStorage\.(?:getItem|setItem)\('([^']+)'/g)].map(m => m[1]);
    assert.ok(keys.length >= 5);
    for (const k of keys) assert.ok(k.startsWith('demo_pkg_'), k);
  });
}

/* ─── 5. Branding ───────────────────────────────────────────────────────── */
async function brandingTests() {
  console.log('\nNeutral branding');
  // real names / internal codes of the original system, base64-encoded so this
  // file itself does not contain them (keeps 'grep -ri' over the folder clean)
  const banned = JSON.parse(Buffer.from('WyJLUkciLCJLaW5nIiwi4LiE4Li04LiHIiwi4LmE4Lij4LiL4LmM4Lil4Li14LmIIiwiUmljZUZpZWxkIiwiUmljZSBGaWVsZCIsIkthdG8iLCLguYTguJfguKLguKPguYjguKfguKHguYPguIgiLCLguYHguJnguYfguJsiLCLguYDguJfguJ7guKfguLHguJLguJnguLIiLCJUaGFuYXBob24iLCLguJjguJnguJ7guKUiLCJDRVMgVEVBTSIsIuC4meC5ieC4s+C4oeC4seC4meC4muC4o+C4tOC5guC4oOC4hCIsIuC4m+C4ueC5iOC5gOC4iOC5ieC4siIsImtyb2dyb3VwIiwiRi1QQy0iLCJQQzEsIFNLMSIsIjEwMTAxMDAiLCIxMDEwMjAwIiwiNDAxMTEwIiwiNDAxMTIwIiwiMTkyLjE2OC4iLCIxMjEzMTQiXQ==', 'base64').toString('utf8'));
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else files.push(p);
    }
  })(ROOT);
  await test(`no real company / customer / people names in ${files.length} files`, () => {
    const hits = [];
    for (const p of files) {
      const text = fs.readFileSync(p, 'utf8').toLowerCase();
      for (const b of banned) if (text.includes(b.toLowerCase())) hits.push(`${path.relative(ROOT, p)}: ${b}`);
    }
    assert.deepStrictEqual(hits, []);
  });
  await test('no phone numbers or e-mail addresses', () => {
    const hits = [];
    for (const p of files) {
      if (p.endsWith('.json')) continue;
      const text = fs.readFileSync(p, 'utf8');
      if (/\b0\d{1,2}[- ]?\d{3}[- ]?\d{4}\b/.test(text)) hits.push(path.relative(ROOT, p) + ': phone');
      if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text.replace(/noreply@anthropic\.com/g, ''))) hits.push(path.relative(ROOT, p) + ': email');
    }
    assert.deepStrictEqual(hits, []);
  });
}

(async () => {
  await seedTests();
  await demoLifecycleTests();
  await apiTests();
  await premiumTests();
  await frontendTests();
  await brandingTests();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
