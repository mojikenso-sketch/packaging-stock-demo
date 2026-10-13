/**
 * Ledger.gs — daily ledger rules ported from lib.php / api.php
 * (carry-forward, Lot dates inheritance, area insertion, item sync).
 */

var TZ = 'Asia/Bangkok';
var LEDGER_MOVEMENT_FIELDS = ['receive', 'returnPackaging', 'returnSupplier', 'qaIssue', 'sendBackSupplier', 'issuePackaging'];
var LEDGER_INBOUND_FIELDS = ['opening', 'receive', 'returnPackaging', 'returnSupplier'];
var LEDGER_ALL_QTY_FIELDS = ['opening', 'receive', 'returnPackaging', 'returnSupplier', 'qaIssue', 'sendBackSupplier', 'issuePackaging'];

/* ─── small helpers ─────────────────────────────────────────────────────── */
function ApiError_(message) { this.name = 'ApiError'; this.message = message; }
function fail_(message) { throw new ApiError_(message); }

function str_(v) { return v === undefined || v === null ? '' : String(v); }
function trim_(v) { return str_(v).trim(); }
function upper_(v) { return trim_(v).toUpperCase(); }
function num_(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  var n = parseFloat(str_(v).replace(/^\s+/, ''));
  return isFinite(n) ? n : 0;
}
function isNumeric_(v) {
  if (typeof v === 'number') return isFinite(v);
  if (typeof v !== 'string') return false;
  return /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(v);
}
function has_(obj, key) { return obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key); }
function isIsoDate_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(str_(s)); }
function validYmd_(y, m, d) {
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function addDaysIso_(iso, n) {
  var p = iso.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}
function dayOfWeekIso_(iso) {
  var p = iso.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}
function todayIso_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowStamp_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function compactStamp_() { return Utilities.formatDate(new Date(), TZ, 'yyyyMMddHHmmss'); }
function shortUid_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 8); }
function clone_(v) { return JSON.parse(JSON.stringify(v)); }
function sortedKeys_(obj) { return Object.keys(obj || {}).sort(); }
function round2Text_(n) { return String(Math.round(n * 100) / 100); }

function rowBalance_(row) {
  return num_(row.opening) + num_(row.receive) + num_(row.returnPackaging) + num_(row.returnSupplier)
    - num_(row.qaIssue) - num_(row.sendBackSupplier) - num_(row.issuePackaging);
}

// Locator values may be a bare code (1100) or a code + description
// (1100-คลังบรรจุภัณฑ์). The numeric prefix is the stable comparison key.
function locatorKey_(value) {
  var v = upper_(value);
  var m = /^(\d+)/.exec(v);
  return m ? m[1] : v;
}

function ledgerRowHasMovement_(row) {
  for (var i = 0; i < LEDGER_MOVEMENT_FIELDS.length; i++) {
    if (num_(row[LEDGER_MOVEMENT_FIELDS[i]]) !== 0) return true;
  }
  return false;
}

function ledgerStockStatusKey_(row) {
  var stock = num_(row.remaining), min = num_(row.min), max = num_(row.max);
  if (max > 0 && stock > max) return 'over';
  if (stock <= 0) return 'crit';
  if (min > 0 && stock < min) return 'low';
  return 'ok';
}

// Stock notes follow the stock status: carried while unchanged, cleared on change.
function carryStockNoteForTransition_(previousRow, row) {
  var previousNote = trim_(previousRow.stockNote);
  if (ledgerStockStatusKey_(previousRow) !== ledgerStockStatusKey_(row)) {
    row.stockNote = '';
  } else if (trim_(row.stockNote) === '' && previousNote !== '') {
    row.stockNote = previousNote;
  }
}

function ledgerStockKey_(row, area) {
  var location = trim_(row.locator) || trim_(area === undefined ? '__main__' : area);
  return upper_(row.code) + '|' + upper_(row.lot) + '|' + locatorKey_(location);
}

function areaTone_(area) { return /HOLD/i.test(str_(area)) ? 'hold' : 'normal'; }

// insert_row_into_area()
function insertRowIntoArea_(rows, area, newRow) {
  if (area === '') area = '__main__';
  var next = [];
  var current = '__main__';
  var inserted = false;
  rows.forEach(function (row) {
    if (row.kind === 'section') {
      if (!inserted && current === area) { next.push(newRow); inserted = true; }
      next.push(row);
      current = trim_(row.title);
      return;
    }
    next.push(row);
  });
  if (!inserted && current === area) { next.push(newRow); inserted = true; }
  if (!inserted) {
    next.push({
      id: 'area-' + compactStamp_() + '-' + shortUid_(),
      kind: 'section', title: area, tone: areaTone_(area), sourceRow: 0,
    });
    next.push(newRow);
  }
  return next;
}

// inherit_lot_dates_from_previous_ledger()
function inheritLotDatesFromPreviousLedger_(ledger, ledgers, date) {
  var previousDate = null;
  Object.keys(ledgers).forEach(function (candidate) {
    if (candidate < date && (previousDate === null || candidate > previousDate)) previousDate = candidate;
  });
  if (previousDate === null || !(ledgers[previousDate].rows || []).length) return ledger;
  var previousByKey = {};
  ledgers[previousDate].rows.forEach(function (row) {
    if (row.kind !== 'item') return;
    var code = upper_(row.code), lot = upper_(row.lot);
    if (!code || !lot) return;
    previousByKey[code + '|' + lot] = {mfgDate: str_(row.mfgDate), expiryDate: str_(row.expiryDate)};
  });
  (ledger.rows || []).forEach(function (row) {
    if (row.kind !== 'item') return;
    var code = upper_(row.code), lot = upper_(row.lot);
    var prev = previousByKey[code + '|' + lot];
    if (!code || !lot || !prev) return;
    if (!row.mfgDate && prev.mfgDate !== '') row.mfgDate = prev.mfgDate;
    if (!row.expiryDate && prev.expiryDate !== '') row.expiryDate = prev.expiryDate;
  });
  return ledger;
}

// recalculate_daily_carry_forward(): keep later days linked to the previous
// day's closing balance after an earlier day is edited.
function recalculateDailyCarryForward_(ledgers, fromDate) {
  if (!ledgers || !ledgers[fromDate]) return 0;
  var dates = sortedKeys_(ledgers);
  var start = dates.indexOf(fromDate);
  if (start < 0) return 0;
  var changed = 0;
  var stamp = nowStamp_();

  for (var i = start + 1; i < dates.length; i++) {
    var previousDate = dates[i - 1];
    var date = dates[i];
    var previousRows = {};
    var previousOrder = [];
    var previousArea = '__main__';
    (ledgers[previousDate].rows || []).forEach(function (pr) {
      if (pr.kind === 'section') { previousArea = trim_(pr.title) || '__main__'; return; }
      if (pr.kind !== 'item') return;
      var id = str_(pr.id);
      if (id !== '') {
        if (!previousRows[id]) previousOrder.push(id);
        previousRows[id] = {row: pr, area: previousArea};
      }
    });

    var dayChanged = false;
    var keptRows = [];
    (ledgers[date].rows || []).forEach(function (row) {
      var id = str_(row.id);
      var prevRow = id !== '' && previousRows[id] ? previousRows[id].row : null;
      var rowZero = num_(row.remaining) <= 0.0001;
      var prevZero = prevRow !== null && num_(prevRow.remaining) <= 0.0001;
      var moved = ledgerRowHasMovement_(row);
      if (row.kind === 'item' && ((prevRow === null && !moved) || ((prevZero || rowZero) && !moved))) {
        dayChanged = true;
        changed++;
        return;
      }
      keptRows.push(row);
    });
    var dayRows = keptRows;

    var existingIds = {};
    var existingKeys = {};
    var dayArea = '__main__';
    dayRows.forEach(function (row) {
      if (row.kind === 'section') { dayArea = trim_(row.title) || '__main__'; return; }
      if (row.kind !== 'item') return;
      var id = str_(row.id);
      if (id !== '') existingIds[id] = true;
      var key = ledgerStockKey_(row, dayArea);
      if (key.slice(0, 2) !== '||') existingKeys[key] = true;
      if (id === '' || !previousRows[id]) return;

      var prevRow = previousRows[id].row;
      var nextOpening = num_(prevRow.remaining);
      var nextRemaining = nextOpening + num_(row.receive) + num_(row.returnPackaging) + num_(row.returnSupplier)
        - num_(row.qaIssue) - num_(row.sendBackSupplier) - num_(row.issuePackaging);
      if (Math.abs(num_(row.opening) - nextOpening) > 0.0001 || Math.abs(num_(row.remaining) - nextRemaining) > 0.0001) {
        row.opening = nextOpening;
        row.remaining = nextRemaining;
        dayChanged = true;
        changed++;
      }
      ['min', 'max', 'safety'].forEach(function (f) {
        var prevSetting = num_(prevRow[f]);
        if (Math.abs(num_(row[f]) - prevSetting) > 0.0001) {
          row[f] = prevSetting;
          dayChanged = true;
          changed++;
        }
      });
      if (trim_(row.unitComment) === '' && trim_(prevRow.unitComment) !== '') {
        row.unitComment = trim_(prevRow.unitComment);
        dayChanged = true;
        changed++;
      }
      var beforeNote = str_(row.stockNote);
      carryStockNoteForTransition_(prevRow, row);
      if (beforeNote !== str_(row.stockNote)) { dayChanged = true; changed++; }
    });

    previousOrder.forEach(function (id) {
      if (existingIds[id]) return;
      var source = previousRows[id];
      var sourceRow = source.row;
      if (num_(sourceRow.remaining) <= 0.0001) return;
      var key = ledgerStockKey_(sourceRow, source.area);
      if (key.slice(0, 2) !== '||' && existingKeys[key]) return;
      var newRow = clone_(sourceRow);
      newRow.opening = num_(sourceRow.remaining);
      LEDGER_MOVEMENT_FIELDS.forEach(function (f) { newRow[f] = 0; });
      newRow.remaining = newRow.opening;
      dayRows = insertRowIntoArea_(dayRows, str_(source.area), newRow);
      existingIds[id] = true;
      if (key.slice(0, 2) !== '||') existingKeys[key] = true;
      dayChanged = true;
      changed++;
    });

    ledgers[date].rows = dayRows;
    if (dayChanged) ledgers[date].updated = stamp;
  }
  return changed;
}

// create_daily_ledger_from_previous()
function createDailyLedgerFromPrevious_(ledgers, date) {
  if (ledgers[date]) return false;
  var dates = sortedKeys_(ledgers);
  if (!dates.length) fail_('ยังไม่มีตารางตั้งต้น');
  var previousDate = addDaysIso_(date, -1);
  if (!ledgers[previousDate]) {
    previousDate = null;
    dates.forEach(function (c) { if (c < date) previousDate = c; });
  }
  if (previousDate === null) previousDate = dates[dates.length - 1];

  var next = clone_(ledgers[previousDate]);
  next.date = date;
  next.sourceFile = 'คัดลอกจากตารางวันที่ ' + previousDate;
  next.sourceSheet = '';
  next.sourceDate = previousDate;
  next.updated = nowStamp_();
  (next.rows || []).forEach(function (row) {
    if (row.kind !== 'item') return;
    var previousRow = clone_(row);
    row.opening = num_(row.remaining);
    LEDGER_MOVEMENT_FIELDS.forEach(function (f) { row[f] = 0; });
    row.remaining = row.opening;
    carryStockNoteForTransition_(previousRow, row);
  });
  next = inheritLotDatesFromPreviousLedger_(next, ledgers, date);
  ledgers[date] = next;
  return true;
}

// sync_items_from_ledger() — items sheet mirrors the latest daily table
function syncItemsFromLedger_(ledger) {
  var items = getItems_();
  var byLedgerId = {};
  items.forEach(function (item, i) { if (item.ledgerId) byLedgerId[str_(item.ledgerId)] = i; });

  (ledger.rows || []).forEach(function (row) {
    if (row.kind !== 'item' || row.legacyAggregate) return;
    var id = str_(row.id);
    var idx = has_(byLedgerId, id) ? byLedgerId[id] : -1;
    if (idx < 0) {
      for (var i = 0; i < items.length; i++) {
        if (str_(items[i].code) === str_(row.code) && str_(items[i].name) === str_(row.name)) { idx = i; break; }
      }
    }
    var next = {
      ledgerId: id,
      code: str_(row.code),
      name: str_(row.name),
      unit: row.unit === undefined || row.unit === null ? 'ใบ' : str_(row.unit),
      supplier: row.supplier !== undefined && row.supplier !== null ? str_(row.supplier) : (idx >= 0 ? str_(items[idx].supplier) : ''),
      stock: num_(row.remaining),
      min: num_(row.min),
      max: num_(row.max),
      safety: num_(row.safety),
      stockNote: str_(row.stockNote),
    };
    if (idx >= 0) {
      items[idx] = Object.assign({}, items[idx], next);
    } else {
      items.push(next);
      byLedgerId[id] = items.length - 1;
    }
  });
  saveItems_(items);
}

function syncItemsFromLatestLedger_(ledgers) {
  var dates = sortedKeys_(ledgers);
  if (!dates.length) return;
  syncItemsFromLedger_(ledgers[dates[dates.length - 1]]);
}

/* ─── input cleaners (api.php clean_ledger_*) ───────────────────────────── */
function cleanLedgerNumber_(value) {
  if (value === '' || value === null || value === undefined) return 0;
  if (!isNumeric_(value)) fail_('จำนวนในตารางไม่ถูกต้อง');
  var n = Number(value);
  if (n < 0) fail_('จำนวนในตารางต้องไม่ติดลบ');
  if (n > 100000000) fail_('จำนวนในตารางมากผิดปกติ');
  return n;
}
function cleanLedgerUnit_(value) {
  var unit = trim_(value);
  if (unit.length > 150) fail_('หน่วยนับยาวเกินไป');
  return unit;
}
function cleanLedgerLot_(value) {
  var lot = trim_(value);
  if (lot.length > 50) fail_('Lot ยาวเกิน 50 ตัวอักษร');
  return lot;
}
function cleanLedgerStockNote_(value) {
  var note = trim_(value);
  if (note.length > 250) fail_('หมายเหตุยาวเกิน 250 ตัวอักษร');
  return note;
}
function cleanLedgerUnitComment_(value) {
  var c = trim_(value);
  if (c.length > 250) fail_('หมายเหตุ / คอมเม้นยาวเกิน 250 ตัวอักษร');
  return c;
}
function cleanLedgerDate_(value, label) {
  var date = trim_(value);
  if (date === '') return '';
  var m5 = /^(\d{5,})-\d{2}-\d{2}$/.exec(date);
  if (m5) fail_(label + ': ปี ' + m5[1] + ' มี ' + m5[1].length + ' หลัก — พิมพ์เลขเกินมา กรุณาแก้ให้เหลือ 4 หลัก');
  if (!isIsoDate_(date)) fail_(label + ' ไม่ถูกต้อง');
  var p = date.split('-').map(Number);
  if (!validYmd_(p[0], p[1], p[2])) fail_(label + ' ไม่ถูกต้อง');
  if (p[0] > 2100) fail_(label + ': ปี ' + p[0] + ' เกินช่วงที่ใช้ได้ — ระบบใช้ ค.ศ. (พ.ศ. ' + p[0] + ' = ค.ศ. ' + (p[0] - 543) + ')');
  if (p[0] < 2000) fail_(label + ': ปี ' + p[0] + ' เก่าเกินไป กรุณาตรวจสอบ');
  return date;
}
function requireIsoDate_(value, message) {
  var d = trim_(value);
  if (!isIsoDate_(d)) fail_(message || 'วันที่ไม่ถูกต้อง');
  var p = d.split('-').map(Number);
  if (!validYmd_(p[0], p[1], p[2])) fail_(message || 'วันที่ไม่ถูกต้อง');
  return d;
}
function cleanItemCode_(code, label) {
  if (code.length > 40) fail_((label || 'ITEM') + ' ยาวเกิน 40 ตัวอักษร');
  if (!/^[A-Za-z0-9._\/-]+$/.test(code)) fail_((label || 'ITEM') + ' ใช้ได้เฉพาะตัวอักษร ตัวเลข . _ - /');
  return code;
}
