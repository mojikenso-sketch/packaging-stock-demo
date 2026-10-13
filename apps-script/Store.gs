/**
 * Store.gs — Google Sheets storage layer (one sheet per former JSON file).
 *
 *   items              ← data/items.json
 *   transactions       ← data/transactions.json
 *   deliveries         ← data/deliveries.json
 *   config             ← data/config.json
 *   daily_ledgers      ← data/daily_ledgers.json (หัวตารางรายวัน 1 แถว/วัน)
 *   daily_ledger_rows  ← data/daily_ledgers.json (แถวในตารางรายวัน)
 *   daily_ready        ← data/daily_ready.json
 *   areas              ← data/areas.json
 *   master_lists       ← data/master_lists.json
 *
 * Every cell is written as plain text ("@" number format) so Lot numbers,
 * ITEM codes and ISO dates are never converted by Sheets. Types are restored
 * from the column definitions below when reading.
 */

var PROP_SPREADSHEET_ID = 'DEMO_SPREADSHEET_ID';

// name[:type]  — type: s = text (default), n = number, b = boolean, j = JSON
var SHEET_DEFS = {
  items: ['ledgerId', 'code', 'name', 'unit', 'supplier', 'stock:n', 'min:n', 'max:n', 'safety:n', 'stockNote'],
  transactions: ['id', 'type', 'date', 'code', 'qty:n', 'person', 'dept', 'ref', 'note', 'after:n', 'created'],
  deliveries: ['code', 'name', 'date', 'qty:n', 'remark'],
  config: ['key', 'value:n'],
  daily_ledgers: ['date', 'sourceFile', 'sourceSheet', 'sourceDate', 'updated'],
  daily_ledger_rows: [
    'date', 'seq:n', 'kind', 'id', 'title', 'tone', 'code', 'name', 'lot', 'locator',
    'mfgDate', 'expiryDate',
    'opening:n', 'receive:n', 'returnPackaging:n', 'returnSupplier:n',
    'qaIssue:n', 'sendBackSupplier:n', 'issuePackaging:n', 'remaining:n',
    'min:n', 'max:n', 'safety:n',
    'unit', 'supplier', 'stockNote', 'unitComment', 'splitFrom',
    'manualAdded:b', 'legacyAggregate:b', 'sourceRow:n', 'extra:j',
  ],
  daily_ready: ['date', 'ready:b', 'at'],
  areas: ['name'],
  master_lists: ['kind', 'name', 'shelfLife'],
};

// Per-request memo (reset by handle_ / seedDemoData_)
var CTX_ = {};

function sheetColumns_(name) {
  var defs = SHEET_DEFS[name];
  if (!defs) throw new Error('Unknown sheet ' + name);
  return defs.map(function (d) {
    var parts = d.split(':');
    return {name: parts[0], type: parts[1] || 's'};
  });
}

function getSpreadsheetId_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID) || '';
}

function ss_() {
  if (CTX_.ss) return CTX_.ss;
  var id = getSpreadsheetId_();
  if (!id) fail_('ระบบยังไม่ได้ตั้งค่า — กรุณารันฟังก์ชัน setupDemo() ใน Apps Script ก่อน');
  CTX_.ss = SpreadsheetApp.openById(id);
  return CTX_.ss;
}

function sheet_(name) {
  CTX_.sheets = CTX_.sheets || {};
  if (CTX_.sheets[name]) return CTX_.sheets[name];
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  var cols = sheetColumns_(name);
  var created = false;
  if (!sh) { sh = ss.insertSheet(name); created = true; }
  // a new sheet has 26 columns — daily_ledger_rows needs more
  var maxCols = sh.getMaxColumns();
  if (maxCols < cols.length) sh.insertColumnsAfter(maxCols, cols.length - maxCols);
  if (created) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols.map(function (c) { return c.name; })]);
    sh.setFrozenRows(1);
  }
  CTX_.sheets[name] = sh;
  return sh;
}

function decodeCell_(raw, type) {
  if (raw instanceof Date) raw = Utilities.formatDate(raw, TZ, 'yyyy-MM-dd');
  var s = raw === null || raw === undefined ? '' : String(raw);
  // Text that looked like a formula was stored with a leading apostrophe.
  if (/^'[=+\-@]/.test(s)) s = s.slice(1);
  if (type === 'n') {
    if (s.trim() === '') return 0;
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }
  if (type === 'b') return raw === true || /^(true|1|yes)$/i.test(s.trim());
  if (type === 'j') {
    if (!s.trim()) return {};
    try { var v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
  }
  return s;
}

function encodeCell_(value, type) {
  if (type === 'n') {
    var n = Number(value);
    return isFinite(n) ? String(n) : '0';
  }
  if (type === 'b') return value ? 'TRUE' : '';
  if (type === 'j') {
    if (!value || typeof value !== 'object' || !Object.keys(value).length) return '';
    return JSON.stringify(value);
  }
  var s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // never let user text become a formula
  return s;
}

function readTable_(name) {
  CTX_.tables = CTX_.tables || {};
  if (CTX_.tables[name]) return CTX_.tables[name];
  var sh = sheet_(name);
  var cols = sheetColumns_(name);
  var last = sh.getLastRow();
  var out = [];
  CTX_.rawCounts = CTX_.rawCounts || {};
  CTX_.rawCounts[name] = last >= 2 ? last - 1 : 0;
  if (last >= 2) {
    var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
    for (var r = 0; r < values.length; r++) {
      var line = values[r];
      var empty = true;
      for (var c = 0; c < line.length; c++) {
        if (line[c] !== '' && line[c] !== null && line[c] !== undefined) { empty = false; break; }
      }
      if (empty) continue;
      var obj = {};
      for (var k = 0; k < cols.length; k++) obj[cols[k].name] = decodeCell_(line[k], cols[k].type);
      out.push(obj);
    }
  }
  CTX_.tables[name] = out;
  return out;
}

function writeTable_(name, objects) {
  var sh = sheet_(name);
  var cols = sheetColumns_(name);
  var n = objects.length;
  var maxRows = sh.getMaxRows();
  if (maxRows < n + 1) sh.insertRowsAfter(maxRows, n + 1 - maxRows);
  var last = sh.getLastRow();
  // Overwrite first, then clear what is left below — a concurrent read never
  // sees an empty table.
  if (n) {
    var values = objects.map(function (obj) {
      return cols.map(function (c) { return encodeCell_(obj[c.name], c.type); });
    });
    var range = sh.getRange(2, 1, n, cols.length);
    range.setNumberFormat('@');
    range.setValues(values);
  }
  if (last > n + 1) sh.getRange(n + 2, 1, last - n - 1, cols.length).clearContent();
  CTX_.tables = CTX_.tables || {};
  delete CTX_.tables[name];
}

// Rewrite only the rows after the first `keep` data rows (used when an edit
// can only affect one day and the days after it).
function writeTableTail_(name, keep, objects) {
  var sh = sheet_(name);
  var cols = sheetColumns_(name);
  var start = 2 + keep;
  var n = objects.length;
  var maxRows = sh.getMaxRows();
  if (maxRows < start - 1 + n) sh.insertRowsAfter(maxRows, start - 1 + n - maxRows);
  var last = sh.getLastRow();
  if (n) {
    var values = objects.map(function (obj) {
      return cols.map(function (c) { return encodeCell_(obj[c.name], c.type); });
    });
    var range = sh.getRange(start, 1, n, cols.length);
    range.setNumberFormat('@');
    range.setValues(values);
  }
  var end = start + n; // first row after the written block
  if (last >= end) sh.getRange(end, 1, last - end + 1, cols.length).clearContent();
  CTX_.tables = CTX_.tables || {};
  delete CTX_.tables[name];
}

/* ─── Typed loaders / savers (mirror lib.php get_* / save_json) ─────────── */

function getItems_() {
  return readTable_('items').map(function (r) {
    var item = {
      code: r.code, name: r.name, unit: r.unit || 'ใบ', supplier: r.supplier,
      stock: r.stock, min: r.min, max: r.max, safety: r.safety, stockNote: r.stockNote,
    };
    if (r.ledgerId) item.ledgerId = r.ledgerId;
    return item;
  });
}
function saveItems_(items) { writeTable_('items', items); }

function getTransactions_() {
  return readTable_('transactions').map(function (r) { return Object.assign({}, r); });
}
function saveTransactions_(txns) { writeTable_('transactions', txns); }

function getDeliveries_() {
  return readTable_('deliveries').map(function (r) { return Object.assign({}, r); })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}
function saveDeliveries_(rows) { writeTable_('deliveries', rows); }

function defaultConfig_() {
  return {leadTimeDays: 7, usageWindowDays: 30, lowStockDays: 7};
}
function getConfig_() {
  var cfg = defaultConfig_();
  readTable_('config').forEach(function (r) { if (r.key) cfg[r.key] = r.value; });
  return cfg;
}
function saveConfig_(cfg) {
  writeTable_('config', Object.keys(cfg).map(function (k) { return {key: k, value: cfg[k]}; }));
}

var LEDGER_ROW_COLUMNS_ = null;
function ledgerRowColumns_() {
  if (!LEDGER_ROW_COLUMNS_) {
    LEDGER_ROW_COLUMNS_ = sheetColumns_('daily_ledger_rows').filter(function (c) {
      return c.name !== 'date' && c.name !== 'seq' && c.name !== 'extra';
    });
  }
  return LEDGER_ROW_COLUMNS_;
}

function getDailyLedgers_() {
  if (CTX_.ledgers) return CTX_.ledgers;
  var ledgers = {};
  readTable_('daily_ledgers').forEach(function (m) {
    if (!isIsoDate_(m.date)) return;
    ledgers[m.date] = {
      date: m.date, sourceFile: m.sourceFile, sourceSheet: m.sourceSheet,
      sourceDate: m.sourceDate, updated: m.updated, rows: [],
    };
  });
  var byDate = {};
  readTable_('daily_ledger_rows').forEach(function (r) {
    if (!ledgers[r.date]) return;
    (byDate[r.date] = byDate[r.date] || []).push(r);
  });
  Object.keys(byDate).forEach(function (date) {
    byDate[date].sort(function (a, b) { return a.seq - b.seq; });
    ledgers[date].rows = byDate[date].map(decodeLedgerRow_);
  });
  CTX_.ledgers = sortLedgers_(ledgers);
  return CTX_.ledgers;
}

function decodeLedgerRow_(r) {
  var row;
  if (r.kind === 'section') {
    row = {id: r.id, kind: 'section', title: r.title, tone: r.tone || 'normal', sourceRow: r.sourceRow};
  } else {
    row = {};
    ledgerRowColumns_().forEach(function (c) {
      if (c.name === 'title') return;
      var v = r[c.name];
      if (c.type === 'b') { if (v) row[c.name] = true; return; }
      if (c.name === 'splitFrom' && !v) return;
      row[c.name] = v;
    });
  }
  var extra = r.extra || {};
  Object.keys(extra).forEach(function (k) { if (!(k in row)) row[k] = extra[k]; });
  return row;
}

function encodeLedgerRow_(date, seq, row) {
  var rec = {date: date, seq: seq, extra: {}};
  var known = {};
  ledgerRowColumns_().forEach(function (c) { known[c.name] = true; rec[c.name] = row[c.name]; });
  Object.keys(row).forEach(function (k) {
    if (!known[k] && k !== 'date' && k !== 'seq' && row[k] !== undefined) rec.extra[k] = row[k];
  });
  return rec;
}

function sortLedgers_(ledgers) {
  var sorted = {};
  Object.keys(ledgers).sort().forEach(function (d) { sorted[d] = ledgers[d]; });
  return sorted;
}

function saveDailyLedgers_(ledgers, fromDate) {
  var dates = Object.keys(ledgers).sort();
  var meta = [];
  var rows = [];
  dates.forEach(function (date) {
    var l = ledgers[date] || {};
    meta.push({
      date: date, sourceFile: l.sourceFile || '', sourceSheet: l.sourceSheet || '',
      sourceDate: l.sourceDate || '', updated: l.updated || '',
    });
    (l.rows || []).forEach(function (row, i) { rows.push(encodeLedgerRow_(date, i + 1, row)); });
  });
  var keep = fromDate ? ledgerRowsPrefixCount_(fromDate) : -1;
  writeTable_('daily_ledgers', meta);
  var tail = keep >= 0 ? rows.filter(function (r) { return r.date >= fromDate; }) : null;
  if (tail && rows.length - tail.length === keep) {
    writeTableTail_('daily_ledger_rows', keep, tail);
  } else {
    writeTable_('daily_ledger_rows', rows);
  }
  CTX_.ledgers = sortLedgers_(ledgers);
}

// Number of sheet rows (in their current order) dated before fromDate, or -1
// when the sheet is not a clean date-sorted list we can safely append to.
function ledgerRowsPrefixCount_(fromDate) {
  var raw = CTX_.tables && CTX_.tables.daily_ledger_rows;
  if (!raw || !CTX_.rawCounts || CTX_.rawCounts.daily_ledger_rows !== raw.length) return -1;
  var keep = 0;
  while (keep < raw.length && raw[keep].date < fromDate) keep++;
  for (var i = 1; i < raw.length; i++) {
    if (raw[i].date < raw[i - 1].date) return -1;
  }
  return keep;
}

function getDailyReady_() {
  var out = {};
  readTable_('daily_ready').forEach(function (r) {
    if (isIsoDate_(r.date)) out[r.date] = {ready: !!r.ready, at: r.at};
  });
  return out;
}
function saveDailyReady_(ready) {
  writeTable_('daily_ready', Object.keys(ready).sort().map(function (d) {
    return {date: d, ready: !!(ready[d] && ready[d].ready), at: (ready[d] && ready[d].at) || ''};
  }));
}

function getAreas_() {
  return readTable_('areas').map(function (r) { return r.name; }).filter(function (n) { return n !== ''; });
}
function saveAreas_(areas) {
  writeTable_('areas', areas.map(function (n) { return {name: n}; }));
}

// Mirrors get_master_lists() in lib.php
function getMasterLists_() {
  var supplierRows = [];
  var seen = {};
  var units = [];
  readTable_('master_lists').forEach(function (r) {
    var name = trim_(r.name);
    if (!name) return;
    if (r.kind === 'supplier') {
      if (seen[name]) return;
      seen[name] = true;
      supplierRows.push({supplier: name, shelfLife: trim_(r.shelfLife)});
    } else if (r.kind === 'unit') {
      if (units.indexOf(name) < 0) units.push(name);
    }
  });
  if (!units.length && !readTable_('master_lists').length) units = ['ใบ'];
  return {
    suppliers: supplierRows.map(function (r) { return r.supplier; }),
    supplierShelfLives: supplierRows,
    units: units,
  };
}
function saveMasterLists_(masters) {
  var rows = [];
  var seen = {};
  (masters.supplierShelfLives || []).forEach(function (r) {
    var name = trim_(r.supplier);
    if (!name || seen[name]) return;
    seen[name] = true;
    rows.push({kind: 'supplier', name: name, shelfLife: trim_(r.shelfLife)});
  });
  (masters.suppliers || []).forEach(function (s) {
    var name = trim_(s);
    if (!name || seen[name]) return;
    seen[name] = true;
    rows.push({kind: 'supplier', name: name, shelfLife: ''});
  });
  (masters.units || []).forEach(function (u) {
    var name = trim_(u);
    if (name) rows.push({kind: 'unit', name: name, shelfLife: ''});
  });
  writeTable_('master_lists', rows);
}
