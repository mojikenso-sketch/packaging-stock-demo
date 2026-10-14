/**
 * Demo.gs — one-time setup, seeding and the 5-hour auto reset.
 *
 *   setupDemo()      รันครั้งเดียว: สร้าง Spreadsheet + ชีต, ใส่ข้อมูลตัวอย่าง,
 *                    ตั้งรหัสผ่านทดลอง และติดตั้ง Trigger รีเซ็ตอัตโนมัติ (รายชั่วโมง)
 *   resetDemoNow()   รีเซ็ตข้อมูลกลับเป็นค่าเริ่มต้นทันที
 *   demoAutoReset()  ถูกเรียกโดย Trigger ทุกชั่วโมง — รีเซ็ตเมื่อครบ 5 ชั่วโมง
 */

var DEMO_RESET_HOURS = 5;
var DEMO_TRIGGER_HANDLER = 'demoAutoReset';
var DEMO_TRIGGER_EVERY_HOURS = 1;    // Trigger ทำงานทุก 1 ชั่วโมง
var DEMO_RESET_TOLERANCE_MS = 30 * 1000;   // เผื่อเวลา Trigger คลาดเคลื่อนเล็กน้อย (วินาที)
var DEMO_EDIT_PASSWORD = 'demo1234'; // รหัสผ่านเปิดโหมดแก้ไขตารางรายวัน
var DEMO_SPREADSHEET_NAME = 'Packaging Stock DEMO — ข้อมูลระบบทดลอง (Demo Co., Ltd.)';
var PROP_LAST_RESET = 'DEMO_LAST_RESET';
var PROP_EDIT_PASSWORD = 'DEMO_EDIT_PASSWORD';
var HOUR_MS = 3600 * 1000;

function setupDemo() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    CTX_ = {};
    var id = ensureDemoSpreadsheet_();
    ensureDemoSheets_();
    var summary = seedDemoData_();
    PropertiesService.getScriptProperties().setProperty(PROP_EDIT_PASSWORD, DEMO_EDIT_PASSWORD);
    installDemoTrigger_();
    var info = demoInfo_();
    var message = 'Demo พร้อมใช้งาน · Spreadsheet ID: ' + id +
      ' · ข้อมูล ' + summary.items + ' ITEM / ' + summary.ledgerRows + ' แถวรายวัน (' + summary.days + ' วัน)' +
      ' · รีเซ็ตครั้งถัดไป ' + info.nextResetText;
    Logger.log(message);
    return message;
  } finally {
    lock.releaseLock();
    CTX_ = {};
  }
}

function resetDemoNow() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    CTX_ = {};
    ensureDemoSheets_();
    var summary = seedDemoData_();
    Logger.log('รีเซ็ตข้อมูลเดโมแล้ว: ' + JSON.stringify(summary));
    return summary;
  } finally {
    lock.releaseLock();
    CTX_ = {};
  }
}

// Time-driven trigger (hourly). Re-seeds when >= 5 hours since the last reset.
function demoAutoReset() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP_SPREADSHEET_ID)) return 'skip: not set up';
  var last = Number(props.getProperty(PROP_LAST_RESET) || 0);
  if (last && Date.now() < demoDueAt_(last)) return 'skip: not due';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return 'skip: busy';
  try {
    CTX_ = {};
    ensureDemoSheets_();
    seedDemoData_();
    return 'reset';
  } finally {
    lock.releaseLock();
    CTX_ = {};
  }
}

// Due 5 hours after the last reset (minus a few seconds of tolerance so a
// trigger that fires a hair early is not pushed a whole hour later). The
// hourly trigger therefore resets within 5–6 hours of the previous reset.
function demoDueAt_(lastMs) {
  return lastMs + DEMO_RESET_HOURS * HOUR_MS - DEMO_RESET_TOLERANCE_MS;
}

// Shown on the banner: last reset + 5 hours (the hourly trigger picks it up
// within the following hour at the latest).
function demoNextResetAt_(lastMs) {
  return lastMs + DEMO_RESET_HOURS * HOUR_MS;
}

function demoInfo_() {
  var last = Number(PropertiesService.getScriptProperties().getProperty(PROP_LAST_RESET) || 0);
  var next = last ? demoNextResetAt_(last) : 0;
  return {
    resetHours: DEMO_RESET_HOURS,
    lastReset: last ? new Date(last).toISOString() : '',
    nextReset: next ? new Date(next).toISOString() : '',
    nextResetText: next ? Utilities.formatDate(new Date(next), TZ, 'yyyy-MM-dd HH:mm') : '-',
    serverTime: new Date().toISOString(),
  };
}

function ensureDemoSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_SPREADSHEET_ID);
  if (id) {
    try {
      SpreadsheetApp.openById(id);
      return id;
    } catch (e) {
      // spreadsheet was deleted — create a new one below
    }
  }
  var ss = SpreadsheetApp.create(DEMO_SPREADSHEET_NAME);
  props.setProperty(PROP_SPREADSHEET_ID, ss.getId());
  CTX_.ss = ss;
  return ss.getId();
}

function ensureDemoSheets_() {
  var ss = ss_();
  Object.keys(SHEET_DEFS).forEach(function (name) {
    var sh = sheet_(name);
    var cols = sheetColumns_(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols.map(function (c) { return c.name; })]);
  });
  // remove the default empty sheet (Sheet1 / แผ่น1 / ชีต1)
  ss.getSheets().forEach(function (sh) {
    if (!SHEET_DEFS[sh.getName()] && ss.getSheets().length > 1 && sh.getLastRow() === 0) ss.deleteSheet(sh);
  });
}

function installDemoTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === DEMO_TRIGGER_HANDLER) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(DEMO_TRIGGER_HANDLER).timeBased().everyHours(DEMO_TRIGGER_EVERY_HOURS).create();
}

// Wipes every data sheet and writes the default sample data (dates relative to today).
function seedDemoData_() {
  var seed = buildDemoSeed_(todayIso_(), nowStamp_());
  saveItems_(seed.items);
  saveTransactions_(seed.transactions);
  saveDeliveries_(seed.deliveries);
  saveConfig_(seed.config);
  saveDailyLedgers_(seed.dailyLedgers);
  saveDailyReady_(seed.dailyReady);
  saveAreas_(seed.areas);
  saveMasterLists_(seed.masterLists);
  PropertiesService.getScriptProperties().setProperty(PROP_LAST_RESET, String(Date.now()));
  CTX_.tables = {};
  CTX_.ledgers = null;
  return seedSummary_(seed);
}

function seedSummary_(seed) {
  var dates = Object.keys(seed.dailyLedgers);
  var rows = 0;
  dates.forEach(function (d) { rows += seed.dailyLedgers[d].rows.filter(function (r) { return r.kind === 'item'; }).length; });
  var codes = {};
  seed.items.forEach(function (i) { codes[i.code] = true; });
  return {items: Object.keys(codes).length, days: dates.length, ledgerRows: rows, transactions: seed.transactions.length};
}
