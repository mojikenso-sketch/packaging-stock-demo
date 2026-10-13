/**
 * Packaging Stock — DEMO backend (Google Apps Script Web App)
 * ระบบควบคุมสต๊อกบรรจุภัณฑ์ · บริษัท ตัวอย่าง อินดัสทรี จำกัด (Demo Co., Ltd.)
 *
 * Port of the PHP api.php JSON API. Data lives in a Google Sheet created by
 * setupDemo() (see Demo.gs). Reads: GET ?action=payload. Writes: POST with a
 * text/plain JSON body {action, ...params} (no CORS preflight).
 *
 * Programming by Duongruthai_Milk
 */

var MUTATING_ACTIONS = {
  daily_ledger_create: 1, daily_ledger_save: 1, daily_ledger_add_row: 1, daily_ledger_delete_row: 1,
  daily_ledger_split_lot: 1, daily_ready_mark: 1,
  txn_add: 1, txn_delete: 1, item_update: 1, item_add: 1, config_save: 1,
  area_add: 1, area_rename: 1, area_delete: 1,
  master_add: 1, master_rename: 1, master_delete: 1,
};

// Features of the full system that are switched off in the public demo.
var DEMO_DISABLED_ACTIONS = {
  oracle_snapshot: 'การเชื่อมต่อระบบ ERP',
  oracle_realtime: 'การ Sync ข้อมูลจากระบบ ERP',
  daily_ledger_sync_oracle: 'การนำเข้าข้อมูลจากระบบ ERP',
  reimport_deliveries: 'การนำเข้าตารางกำหนดรับจาก Excel',
};

// Demo safety limits (keeps the public sheet small)
var DEMO_MAX_ROWS_PER_DAY = 400;
var DEMO_MAX_TRANSACTIONS = 3000;
var DEMO_MAX_AREAS = 40;
var DEMO_MAX_MASTER = 80;
var DEMO_PAST_DAYS = 90;
var DEMO_FUTURE_DAYS = 7;

function doGet(e) {
  return handle_((e && e.parameter) || {});
}

function doPost(e) {
  var params = {};
  try {
    if (e && e.postData && e.postData.contents) params = JSON.parse(e.postData.contents) || {};
  } catch (err) {
    return json_({ok: false, error: 'รูปแบบคำขอไม่ถูกต้อง'});
  }
  if (e && e.parameter) {
    Object.keys(e.parameter).forEach(function (k) { if (!has_(params, k)) params[k] = e.parameter[k]; });
  }
  return handle_(params);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(p) {
  CTX_ = {};
  var action = trim_(p.action) || 'payload';
  var lock = null;
  try {
    if (!getSpreadsheetId_()) fail_('ระบบยังไม่ได้ตั้งค่า — กรุณารันฟังก์ชัน setupDemo() ใน Apps Script ก่อน');
    if (MUTATING_ACTIONS[action]) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) {
        lock = null;
        fail_('ระบบกำลังบันทึกข้อมูลของผู้ใช้อื่น กรุณาลองใหม่อีกครั้ง');
      }
    }
    return json_(route_(action, p));
  } catch (err) {
    if (err instanceof ApiError_) return json_({ok: false, error: err.message});
    console.error(err && err.stack || err);
    return json_({ok: false, error: 'เกิดข้อผิดพลาดในระบบ: ' + (err && err.message || err)});
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e) {} }
    CTX_ = {};
  }
}

// full_payload()
function fullPayload_() {
  var today = todayIso_();
  var cutoff = addDaysIso_(today, -45);
  var all = getDeliveries_();
  return {
    items: getItems_(),
    transactions: getTransactions_(),
    deliveries: all.filter(function (d) { return str_(d.date) >= cutoff; }),
    deliveriesTotal: all.length,
    config: getConfig_(),
    dailyLedgers: getDailyLedgers_(),
    dailyReady: getDailyReady_(),
    areas: getAreas_(),
    masterLists: getMasterLists_(),
    today: today,
    demo: demoInfo_(),
  };
}

function respond_(extra) {
  var out = {ok: true};
  Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
  out.payload = fullPayload_();
  return out;
}

function demoDateGuard_(date) {
  var today = todayIso_();
  if (date < addDaysIso_(today, -DEMO_PAST_DAYS) || date > addDaysIso_(today, DEMO_FUTURE_DAYS)) {
    fail_('เวอร์ชันเดโมเปิดให้ทำรายการได้ช่วง ' + DEMO_PAST_DAYS + ' วันย้อนหลัง ถึง ' + DEMO_FUTURE_DAYS + ' วันข้างหน้า');
  }
}

function demoRowGuard_(rows) {
  if ((rows || []).length >= DEMO_MAX_ROWS_PER_DAY) {
    fail_('เวอร์ชันเดโมจำกัดไม่เกิน ' + DEMO_MAX_ROWS_PER_DAY + ' แถวต่อวัน');
  }
}

function parseRows_(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw === undefined || raw === null || raw === '') return [];
  try {
    var v = JSON.parse(String(raw));
    return Array.isArray(v) ? v : null;
  } catch (e) {
    return null;
  }
}

function route_(action, p) {
  if (DEMO_DISABLED_ACTIONS[action]) fail_(DEMO_DISABLED_ACTIONS[action] + ' ปิดไว้ในเวอร์ชันเดโม');
  switch (action) {
    case 'payload': return respond_({});
    case 'demo_info': return {ok: true, demo: demoInfo_(), today: todayIso_()};
    case 'auth_check': return actionAuthCheck_(p);
    case 'daily_ready_get': return actionDailyReadyGet_(p);
    case 'daily_ready_mark': return actionDailyReadyMark_(p);
    case 'daily_ledger_create': return actionDailyLedgerCreate_(p);
    case 'daily_ledger_save': return actionDailyLedgerSave_(p);
    case 'daily_ledger_add_row': return actionDailyLedgerAddRow_(p);
    case 'daily_ledger_split_lot': return actionDailyLedgerSplitLot_(p);
    case 'daily_ledger_delete_row': return actionDailyLedgerDeleteRow_(p);
    case 'txn_add': return actionTxnAdd_(p);
    case 'txn_delete': return actionTxnDelete_(p);
    case 'item_update': return actionItemUpdate_(p);
    case 'item_add': return actionItemAdd_(p);
    case 'config_save': return actionConfigSave_(p);
    case 'area_add': return actionAreaAdd_(p);
    case 'area_rename': return actionAreaRename_(p);
    case 'area_delete': return actionAreaDelete_(p);
    case 'master_add': return actionMasterAdd_(p);
    case 'master_rename': return actionMasterRename_(p);
    case 'master_delete': return actionMasterDelete_(p);
  }
  fail_('ไม่รู้จักคำสั่ง: ' + action);
}

/* ─── Demo login (edit-mode password) ───────────────────────────────────── */
function actionAuthCheck_(p) {
  var expected = PropertiesService.getScriptProperties().getProperty('DEMO_EDIT_PASSWORD') || DEMO_EDIT_PASSWORD;
  if (str_(p.password) !== expected) fail_('รหัสผ่านไม่ถูกต้อง');
  return {ok: true};
}

/* ─── Daily "ready" flag ────────────────────────────────────────────────── */
function actionDailyReadyGet_(p) {
  var date = requireIsoDate_(p.date, 'วันที่สถานะพร้อมใช้งานไม่ถูกต้อง');
  var ready = getDailyReady_();
  return {ok: true, date: date, dailyReady: ready[date] || null, demo: demoInfo_()};
}

function actionDailyReadyMark_(p) {
  var date = requireIsoDate_(p.date, 'วันที่สถานะพร้อมใช้งานไม่ถูกต้อง');
  var ledgers = getDailyLedgers_();
  if (!ledgers[date]) fail_('ไม่พบตารางรายวันของวันที่นี้');
  var ready = getDailyReady_();
  if (!ready[date] || !ready[date].ready) {
    ready[date] = {ready: true, at: nowStamp_()};
    saveDailyReady_(ready);
  }
  return respond_({dailyReady: ready[date]});
}

/* ─── Daily ledger ──────────────────────────────────────────────────────── */
function actionDailyLedgerCreate_(p) {
  var date = requireIsoDate_(p.date);
  var ledgers = getDailyLedgers_();
  if (ledgers[date]) return respond_({created: false});
  var dates = sortedKeys_(ledgers);
  if (!dates.length) fail_('ยังไม่มีตารางตั้งต้น');
  demoDateGuard_(date);

  var latestDate = dates[dates.length - 1];
  var createdDates = [];
  var sourceDate = null;
  if (date > latestDate) {
    var cursor = latestDate;
    while (cursor < date) {
      cursor = addDaysIso_(cursor, 1);
      if (!ledgers[cursor]) {
        if (sourceDate === null) sourceDate = cursor === date ? latestDate : addDaysIso_(cursor, -1);
        createDailyLedgerFromPrevious_(ledgers, cursor);
        createdDates.push(cursor);
      }
    }
  } else {
    dates.forEach(function (c) { if (c < date) sourceDate = c; });
    if (sourceDate === null) sourceDate = latestDate;
    createDailyLedgerFromPrevious_(ledgers, date);
    createdDates.push(date);
  }
  var sorted = sortLedgers_(ledgers);
  if (sourceDate !== null) recalculateDailyCarryForward_(sorted, sourceDate);
  var fromDate = createdDates.concat(sourceDate === null ? [] : [sourceDate]).sort()[0];
  saveDailyLedgers_(sorted, fromDate);
  syncItemsFromLatestLedger_(sorted);
  return respond_({created: true, createdDates: createdDates, sourceDate: sourceDate});
}

var LEDGER_NUMBER_FIELDS = ['receive', 'returnPackaging', 'returnSupplier', 'qaIssue', 'sendBackSupplier', 'issuePackaging', 'min', 'max', 'safety'];

function actionDailyLedgerSave_(p) {
  var date = requireIsoDate_(p.date);
  var changes = parseRows_(p.rows);
  if (changes === null) fail_('ข้อมูลตารางไม่ถูกต้อง');
  if (changes.length > 1000) fail_('มีรายการที่แก้ไขมากเกินไป');

  var ledgers = getDailyLedgers_();
  if (!ledgers[date]) fail_('ไม่พบตารางของวันที่นี้');
  var ledger = ledgers[date];
  var rowIndex = {};
  (ledger.rows || []).forEach(function (row, i) { if (row.id) rowIndex[str_(row.id)] = i; });

  var updated = 0;
  changes.forEach(function (change) {
    if (!change || typeof change !== 'object') return;
    var id = str_(change.id);
    // ERP-only rows (createFromOracle) do not exist in the demo — ignore them.
    if (id === '' || !has_(rowIndex, id)) return;
    var row = ledger.rows[rowIndex[id]];
    if (row.kind !== 'item') return;

    LEDGER_NUMBER_FIELDS.forEach(function (f) { if (has_(change, f)) row[f] = cleanLedgerNumber_(change[f]); });
    if (has_(change, 'unit')) row.unit = cleanLedgerUnit_(change.unit);
    if (has_(change, 'supplier')) {
      var supplier = trim_(change.supplier);
      if (supplier.length > 150) fail_('ชื่อบริษัทผู้ส่งยาวเกิน 150 ตัวอักษร');
      row.supplier = supplier;
    }
    if (has_(change, 'lot')) row.lot = cleanLedgerLot_(change.lot);
    if (has_(change, 'stockNote')) row.stockNote = cleanLedgerStockNote_(change.stockNote);
    if (has_(change, 'unitComment')) row.unitComment = cleanLedgerUnitComment_(change.unitComment);
    if (has_(change, 'mfgDate')) row.mfgDate = cleanLedgerDate_(change.mfgDate, 'วันที่ผลิต');
    if (has_(change, 'expiryDate')) row.expiryDate = cleanLedgerDate_(change.expiryDate, 'วันหมดอายุ');
    var mfg = str_(row.mfgDate), exp = str_(row.expiryDate);
    if (mfg !== '' && exp !== '' && exp < mfg) fail_('วันหมดอายุต้องไม่ก่อนวันที่ผลิต');

    row.remaining = rowBalance_(row);
    if (row.remaining < -0.0001) {
      fail_('ยอดคงเหลือติดลบของ ITEM ' + str_(row.code) + ' Lot ' + str_(row.lot) + ' — ตรวจสอบว่ามีการเบิกซ้ำจากวันก่อนหรือไม่');
    }
    updated++;
  });

  ledger.updated = nowStamp_();
  var carry = recalculateDailyCarryForward_(ledgers, date);
  saveDailyLedgers_(ledgers, date);
  syncItemsFromLatestLedger_(ledgers);
  return respond_({updatedRows: updated, createdRows: [], carryForwardRows: carry});
}

function validAreasFor_(ledgerRows) {
  var valid = {'__main__': true};
  (ledgerRows || []).forEach(function (row) { if (row.kind === 'section') valid[trim_(row.title)] = true; });
  getAreas_().forEach(function (a) { valid[trim_(a)] = true; });
  return valid;
}

function actionDailyLedgerAddRow_(p) {
  var date = requireIsoDate_(p.date);
  var code = trim_(p.code);
  var name = trim_(p.name);
  var unit = cleanLedgerUnit_(has_(p, 'unit') ? p.unit : 'ใบ') || 'ใบ';
  var receive = cleanLedgerNumber_(has_(p, 'receive') ? p.receive : 0);
  var area = trim_(has_(p, 'area') ? p.area : '__main__') || '__main__';
  var lot = cleanLedgerLot_(p.lot);
  if (code === '' || name === '') fail_('กรุณากรอก ITEM และรายการ');
  cleanItemCode_(code);
  if (name.length > 250) fail_('ชื่อรายการยาวเกิน 250 ตัวอักษร');

  var ledgers = getDailyLedgers_();
  if (!ledgers[date]) fail_('ไม่พบตารางของวันที่นี้');
  demoRowGuard_(ledgers[date].rows);
  if (!validAreasFor_(ledgers[date].rows)[area]) fail_('พื้นที่ที่เลือกไม่ถูกต้อง');

  var id = 'manual-' + compactStamp_() + '-' + shortUid_();
  var newRow = {
    id: id, kind: 'item', code: code, name: name, lot: lot, mfgDate: '', expiryDate: '',
    opening: 0, receive: receive, returnPackaging: 0, returnSupplier: 0,
    qaIssue: 0, sendBackSupplier: 0, issuePackaging: 0, remaining: receive,
    min: 0, max: 0, safety: 0, unit: unit, stockNote: '',
    tone: areaTone_(area), sourceRow: 0, manualAdded: true,
  };
  ledgers[date].rows = insertRowIntoArea_(ledgers[date].rows || [], area, newRow);
  ledgers[date].updated = nowStamp_();
  recalculateDailyCarryForward_(ledgers, date);
  saveDailyLedgers_(ledgers, date);
  syncItemsFromLatestLedger_(ledgers);
  return respond_({addedRow: {id: id, code: code, name: name, area: area, lot: lot}});
}

function actionDailyLedgerSplitLot_(p) {
  var date = requireIsoDate_(p.date);
  var id = trim_(p.id);
  var lot = cleanLedgerLot_(p.lot);
  var qty = cleanLedgerNumber_(has_(p, 'qty') ? p.qty : 0);
  if (id === '') fail_('ไม่พบแถวที่ต้องการแยก Lot');
  if (lot === '') fail_('กรุณากรอก Lot');
  if (qty <= 0) fail_('จำนวนที่แยกต้องมากกว่า 0');
  var mfgDate = cleanLedgerDate_(p.mfgDate, 'วันที่ผลิต');
  var expiryDate = cleanLedgerDate_(p.expiryDate, 'วันหมดอายุ');
  if (mfgDate !== '' && expiryDate !== '' && expiryDate < mfgDate) fail_('วันหมดอายุต้องไม่ก่อนวันที่ผลิต');

  var ledgers = getDailyLedgers_();
  if (!ledgers[date]) fail_('ไม่พบตารางของวันที่นี้');
  demoRowGuard_(ledgers[date].rows);
  var rows = ledgers[date].rows || [];
  var index = -1;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].kind === 'item' && str_(rows[i].id) === id) { index = i; break; }
  }
  if (index < 0) fail_('ไม่พบรายการที่ต้องการแยก Lot ในตารางวันที่นี้');

  var parent = rows[index];
  var remaining = num_(parent.remaining);
  if (qty > remaining + 0.0001) fail_('แยกได้ไม่เกินยอดคงเหลือ ' + round2Text_(remaining));
  if (str_(parent.lot) === lot) fail_('แถวนี้เป็น Lot ' + lot + ' อยู่แล้ว');

  var child = clone_(parent);
  child.id = 'split-' + compactStamp_() + '-' + shortUid_();
  child.lot = lot;
  child.mfgDate = mfgDate;
  child.expiryDate = expiryDate;
  child.splitFrom = id;
  child.manualAdded = true;
  child.sourceRow = 0;
  delete child.legacyAggregate; delete child.oracleImported; delete child.oracleQty; delete child.oracleOrgs;
  LEDGER_ALL_QTY_FIELDS.forEach(function (f) { child[f] = 0; });

  var left = qty;
  for (var k = 0; k < LEDGER_INBOUND_FIELDS.length; k++) {
    if (left <= 0.0001) break;
    var f = LEDGER_INBOUND_FIELDS[k];
    var available = num_(parent[f]);
    if (available <= 0) continue;
    var take = Math.min(left, available);
    parent[f] = available - take;
    child[f] = take;
    left -= take;
  }
  if (left > 0.0001) fail_('ยอดรับเข้าของแถวนี้ไม่พอให้แยก กรุณาตรวจสอบตัวเลขอีกครั้ง');
  parent.remaining = rowBalance_(parent);
  child.remaining = rowBalance_(child);

  rows.splice(index + 1, 0, child);
  ledgers[date].updated = nowStamp_();
  recalculateDailyCarryForward_(ledgers, date);
  saveDailyLedgers_(ledgers, date);
  syncItemsFromLatestLedger_(ledgers);
  return respond_({splitRow: {
    id: child.id, parentId: id, code: str_(child.code), lot: lot, qty: qty, parentRemaining: parent.remaining,
  }});
}

function actionDailyLedgerDeleteRow_(p) {
  var date = requireIsoDate_(p.date);
  var id = trim_(p.id);
  if (id === '') fail_('ไม่พบรหัสแถวที่ต้องการลบ');
  var ledgers = getDailyLedgers_();
  if (!ledgers[date]) fail_('ไม่พบตารางของวันที่นี้');

  var deleted = null;
  var nextRows = [];
  (ledgers[date].rows || []).forEach(function (row) {
    if (deleted === null && row.kind === 'item' && str_(row.id) === id) { deleted = row; return; }
    nextRows.push(row);
  });
  if (deleted === null) fail_('ไม่พบรายการที่ต้องการลบในตารางวันที่นี้');

  var returnedTo = null;
  var parentId = str_(deleted.splitFrom);
  if (parentId !== '') {
    for (var i = 0; i < nextRows.length; i++) {
      var row = nextRows[i];
      if (row.kind !== 'item' || str_(row.id) !== parentId) continue;
      LEDGER_ALL_QTY_FIELDS.forEach(function (f) { row[f] = num_(row[f]) + num_(deleted[f]); });
      row.remaining = rowBalance_(row);
      returnedTo = {id: parentId, remaining: row.remaining};
      break;
    }
  }

  ledgers[date].rows = nextRows;
  ledgers[date].updated = nowStamp_();
  recalculateDailyCarryForward_(ledgers, date);
  saveDailyLedgers_(ledgers, date);

  var dates = sortedKeys_(ledgers);
  if (date === dates[dates.length - 1]) {
    saveItems_(getItems_().filter(function (item) { return str_(item.ledgerId) !== id; }));
  }
  return respond_({deletedRow: {id: id, code: str_(deleted.code), name: str_(deleted.name), returnedTo: returnedTo}});
}

/* ─── Legacy transactions (เบิก / รับ / คืน / ปรับยอด) ──────────────────── */
function findItemIndex_(items, code) {
  for (var i = 0; i < items.length; i++) if (str_(items[i].code) === str_(code)) return i;
  return -1;
}

function actionTxnAdd_(p) {
  var type = str_(p.type);
  if (['withdraw', 'receive', 'return', 'adjust'].indexOf(type) < 0) fail_('ประเภทรายการไม่ถูกต้อง');
  var code = trim_(p.code);
  var date = has_(p, 'date') && str_(p.date) !== '' ? str_(p.date) : todayIso_();
  var rawQty = trim_(has_(p, 'qty') ? p.qty : '0');
  if (!isNumeric_(rawQty)) fail_('จำนวนต้องเป็นตัวเลข');
  var qty = Number(rawQty);
  if (code === '') fail_('กรุณาเลือกสินค้า');
  if (type !== 'adjust' && qty <= 0) fail_('จำนวนต้องมากกว่า 0');
  if (qty > 100000000) fail_('จำนวนมากผิดปกติ');
  requireIsoDate_(date);

  var items = getItems_();
  var idx = findItemIndex_(items, code);
  if (idx < 0) fail_('ไม่พบรหัสสินค้า ' + code);
  var txns = getTransactions_();
  if (txns.length >= DEMO_MAX_TRANSACTIONS) fail_('เวอร์ชันเดโมจำกัดจำนวนรายการประวัติไว้ที่ ' + DEMO_MAX_TRANSACTIONS + ' รายการ');

  var stock = num_(items[idx].stock);
  var force = str_(p.force) === '1';
  if (type === 'withdraw' && qty > stock && !force) {
    fail_('สต๊อกคงเหลือ ' + Math.round(stock).toLocaleString('en-US') + ' ไม่พอเบิก ' + Math.round(qty).toLocaleString('en-US'));
  }
  if (type === 'withdraw') items[idx].stock = stock - qty;
  else if (type === 'receive' || type === 'return') items[idx].stock = stock + qty;
  else {
    var rawNew = trim_(has_(p, 'new_stock') ? p.new_stock : '-1');
    if (!isNumeric_(rawNew)) fail_('ยอดใหม่ไม่ถูกต้อง');
    var newStock = Number(rawNew);
    if (newStock < 0) fail_('ยอดใหม่ไม่ถูกต้อง');
    qty = newStock - stock;
    items[idx].stock = newStock;
  }
  var txn = {
    id: 't' + compactStamp_() + shortUid_(), type: type, date: date, code: code, qty: qty,
    person: trim_(p.person), dept: trim_(p.dept), ref: trim_(p.ref), note: trim_(p.note),
    after: num_(items[idx].stock), created: nowStamp_(),
  };
  txns.push(txn);
  saveTransactions_(txns);
  saveItems_(items);
  return respond_({txn: txn});
}

function actionTxnDelete_(p) {
  var id = str_(p.id);
  var txns = getTransactions_();
  var target = null;
  txns.forEach(function (t) { if (!target && t.id === id) target = t; });
  if (!target) fail_('ไม่พบรายการ');
  var items = getItems_();
  var idx = findItemIndex_(items, target.code);
  if (idx >= 0) {
    var q = num_(target.qty);
    if (target.type === 'withdraw') items[idx].stock = num_(items[idx].stock) + q;
    else items[idx].stock = num_(items[idx].stock) - q; // receive / return / adjust (signed diff)
    saveItems_(items);
  }
  saveTransactions_(txns.filter(function (t) { return t.id !== id; }));
  return respond_({});
}

/* ─── Item master ───────────────────────────────────────────────────────── */
function actionItemUpdate_(p) {
  var code = trim_(p.code);
  var items = getItems_();
  var idx = findItemIndex_(items, code);
  if (idx < 0) fail_('ไม่พบรหัสสินค้า');
  if (has_(p, 'name') && trim_(p.name) !== '') items[idx].name = trim_(p.name);
  if (has_(p, 'unit')) items[idx].unit = trim_(p.unit);
  if (has_(p, 'supplier')) {
    var supplier = trim_(p.supplier);
    if (supplier.length > 150) fail_('ชื่อบริษัทผู้ส่งยาวเกิน 150 ตัวอักษร');
    items[idx].supplier = supplier;
  }
  ['min', 'max', 'safety'].forEach(function (f) {
    if (has_(p, f)) items[idx][f] = Math.max(0, Math.trunc(num_(p[f])));
  });
  saveItems_(items);
  return respond_({});
}

function actionItemAdd_(p) {
  var code = trim_(p.code);
  var name = trim_(p.name);
  if (code === '' || name === '') fail_('กรุณากรอกรหัสและชื่อสินค้า');
  if (code.length > 40) fail_('รหัสสินค้ายาวเกินไป');
  if (!/^[A-Za-z0-9._\/-]+$/.test(code)) fail_('รหัสสินค้าใช้ได้เฉพาะตัวอักษร ตัวเลข . _ - /');
  var items = getItems_();
  if (findItemIndex_(items, code) >= 0) fail_('รหัสสินค้านี้มีอยู่แล้ว');
  var area = trim_(has_(p, 'area') ? p.area : '__main__') || '__main__';
  var supplier = trim_(p.supplier);
  if (supplier.length > 150) fail_('ชื่อบริษัทผู้ส่งยาวเกิน 150 ตัวอักษร');
  var newItem = {
    code: code, name: name,
    unit: cleanLedgerUnit_(has_(p, 'unit') ? p.unit : 'ใบ') || 'ใบ',
    supplier: supplier,
    stock: cleanLedgerNumber_(has_(p, 'stock') ? p.stock : 0),
    min: cleanLedgerNumber_(has_(p, 'min') ? p.min : 0),
    max: cleanLedgerNumber_(has_(p, 'max') ? p.max : 0),
    safety: cleanLedgerNumber_(has_(p, 'safety') ? p.safety : 0),
  };
  var ledgers = getDailyLedgers_();
  var dates = sortedKeys_(ledgers);
  if (dates.length) {
    var latestDate = dates[dates.length - 1];
    demoRowGuard_(ledgers[latestDate].rows);
    var id = 'manual-' + compactStamp_() + '-' + shortUid_();
    newItem.ledgerId = id;
    var newRow = {
      id: id, kind: 'item', code: code, name: name, lot: '', mfgDate: '', expiryDate: '',
      opening: newItem.stock, receive: 0, returnPackaging: 0, returnSupplier: 0,
      qaIssue: 0, sendBackSupplier: 0, issuePackaging: 0, remaining: newItem.stock,
      min: newItem.min, max: newItem.max, safety: newItem.safety, unit: newItem.unit,
      supplier: newItem.supplier, stockNote: '', tone: areaTone_(area), sourceRow: 0,
    };
    ledgers[latestDate].rows = insertRowIntoArea_(ledgers[latestDate].rows || [], area, newRow);
    ledgers[latestDate].updated = nowStamp_();
    saveDailyLedgers_(ledgers, latestDate);
    syncItemsFromLatestLedger_(ledgers);
  } else {
    items.push(newItem);
    saveItems_(items);
  }
  return respond_({});
}

/* ─── Settings ──────────────────────────────────────────────────────────── */
function actionConfigSave_(p) {
  var cfg = getConfig_();
  ['leadTimeDays', 'usageWindowDays', 'lowStockDays'].forEach(function (k) {
    if (has_(p, k)) cfg[k] = Math.max(1, Math.min(365, Math.trunc(num_(p[k]))));
  });
  saveConfig_(cfg);
  return respond_({});
}

function cleanAreaName_(value, emptyMessage) {
  var name = trim_(value);
  if (name === '') fail_(emptyMessage);
  if (name === '__main__') fail_('ชื่อนี้สงวนไว้ใช้งานในระบบ กรุณาใช้ชื่ออื่น');
  if (name.length > 80) fail_('ชื่อพื้นที่ยาวเกิน 80 ตัวอักษร');
  return name;
}

function actionAreaAdd_(p) {
  var name = cleanAreaName_(p.name, 'กรุณากรอกชื่อพื้นที่');
  var areas = getAreas_();
  if (areas.indexOf(name) >= 0) fail_('มีพื้นที่นี้อยู่แล้ว');
  if (areas.length >= DEMO_MAX_AREAS) fail_('เวอร์ชันเดโมจำกัดพื้นที่ไม่เกิน ' + DEMO_MAX_AREAS + ' รายการ');
  areas.push(name);
  saveAreas_(areas);
  return respond_({areas: areas});
}

function actionAreaRename_(p) {
  var oldName = trim_(p.oldName);
  if (oldName === '') fail_('ไม่พบชื่อพื้นที่เดิม');
  var newName = cleanAreaName_(p.newName, 'กรุณากรอกชื่อพื้นที่ใหม่');
  if (oldName === newName) fail_('ชื่อใหม่เหมือนชื่อเดิม');

  var areas = getAreas_();
  var oldExists = areas.indexOf(oldName) >= 0;
  var newExists = areas.indexOf(newName) >= 0;
  var ledgers = getDailyLedgers_();
  var renamedSections = 0, renamedRows = 0;
  Object.keys(ledgers).forEach(function (date) {
    (ledgers[date].rows || []).forEach(function (row) {
      if (row.kind === 'section' && trim_(row.title) === oldName) {
        row.title = newName; renamedSections++; oldExists = true;
      }
      if (row.kind === 'item' && trim_(row.locator) === oldName) {
        row.locator = newName; renamedRows++;
      }
    });
  });
  if (!oldExists) fail_('ไม่พบพื้นที่เดิมในระบบ');
  if (newExists) fail_('มีพื้นที่ชื่อนี้อยู่แล้ว');
  var nextAreas = areas.map(function (a) { return a === oldName ? newName : a; });
  if (nextAreas.indexOf(newName) < 0) nextAreas.push(newName);
  saveAreas_(nextAreas);
  if (renamedSections > 0 || renamedRows > 0) saveDailyLedgers_(ledgers);
  return respond_({areas: nextAreas, renamedSections: renamedSections, renamedRows: renamedRows});
}

function actionAreaDelete_(p) {
  var name = trim_(p.name);
  if (name === '') fail_('ไม่พบชื่อพื้นที่ที่ต้องการลบ');
  var areas = getAreas_().filter(function (a) { return a !== name; });
  saveAreas_(areas);
  return respond_({areas: areas});
}

/* ─── Master lists (suppliers / units) ──────────────────────────────────── */
function masterListKey_(kind) {
  kind = trim_(kind).toLowerCase();
  if (kind === 'supplier' || kind === 'suppliers') return 'suppliers';
  if (kind === 'unit' || kind === 'units') return 'units';
  fail_('ประเภทรายการตั้งต้นไม่ถูกต้อง');
}
function cleanMasterName_(value, label) {
  var name = trim_(value);
  if (name === '') fail_('กรุณากรอก' + label);
  if (name.length > 150) fail_(label + 'ยาวเกิน 150 ตัวอักษร');
  return name;
}
function cleanShelfLife_(value) {
  var s = trim_(value);
  if (s.length > 150) fail_('Shelf Life ยาวเกิน 150 ตัวอักษร');
  return s;
}
function sortNatural_(list) {
  return list.sort(function (a, b) {
    return String(a).toLowerCase().localeCompare(String(b).toLowerCase(), undefined, {numeric: true});
  });
}

function actionMasterAdd_(p) {
  var key = masterListKey_(p.kind);
  var label = key === 'suppliers' ? 'ชื่อบริษัทผู้ส่ง' : 'หน่วย';
  var name = cleanMasterName_(p.name, label);
  var masters = getMasterLists_();
  if (masters[key].indexOf(name) >= 0) fail_('มีรายการนี้อยู่แล้ว');
  if (masters[key].length >= DEMO_MAX_MASTER) fail_('เวอร์ชันเดโมจำกัดรายการตั้งต้นไม่เกิน ' + DEMO_MAX_MASTER + ' รายการ');
  masters[key].push(name);
  if (key === 'suppliers') masters.supplierShelfLives.push({supplier: name, shelfLife: cleanShelfLife_(p.shelfLife)});
  else sortNatural_(masters[key]);
  saveMasterLists_(masters);
  return respond_({masterLists: masters});
}

function actionMasterRename_(p) {
  var key = masterListKey_(p.kind);
  var label = key === 'suppliers' ? 'ชื่อบริษัทผู้ส่ง' : 'หน่วย';
  var oldName = cleanMasterName_(p.oldName, label + 'เดิม');
  var newName = cleanMasterName_(p.newName, label + 'ใหม่');
  var masters = getMasterLists_();
  var index = masters[key].indexOf(oldName);
  if (index < 0) fail_('ไม่พบรายการเดิมในระบบ');
  var shelfOnly = key === 'suppliers' && oldName === newName && has_(p, 'shelfLife');
  if (oldName === newName && !shelfOnly) fail_('ชื่อใหม่เหมือนชื่อเดิม');
  if (oldName !== newName && masters[key].indexOf(newName) >= 0) fail_('มีรายการชื่อใหม่นี้อยู่แล้ว');
  masters[key][index] = newName;
  if (key === 'suppliers') {
    for (var i = 0; i < masters.supplierShelfLives.length; i++) {
      var row = masters.supplierShelfLives[i];
      if (row.supplier !== oldName) continue;
      row.supplier = newName;
      if (has_(p, 'shelfLife')) row.shelfLife = cleanShelfLife_(p.shelfLife);
      break;
    }
  } else {
    sortNatural_(masters[key]);
  }
  saveMasterLists_(masters);
  return respond_({masterLists: masters});
}

function actionMasterDelete_(p) {
  var key = masterListKey_(p.kind);
  var label = key === 'suppliers' ? 'ชื่อบริษัทผู้ส่ง' : 'หน่วย';
  var name = cleanMasterName_(p.name, label);
  var masters = getMasterLists_();
  if (masters[key].indexOf(name) < 0) fail_('ไม่พบรายการที่ต้องการลบ');
  masters[key] = masters[key].filter(function (v) { return v !== name; });
  if (key === 'suppliers') {
    masters.supplierShelfLives = masters.supplierShelfLives.filter(function (r) { return r.supplier !== name; });
  }
  saveMasterLists_(masters);
  return respond_({masterLists: masters});
}
