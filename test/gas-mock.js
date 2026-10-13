/*
 * In-memory mocks of the Apps Script services used by apps-script/*.gs.
 * createGas() returns {context, state} where context runs every .gs file in a
 * single vm global scope (exactly like an Apps Script project).
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GS_FILES = ['Ledger.gs', 'Store.gs', 'Seed.gs', 'Demo.gs', 'Code.gs'];

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

// Utilities.formatDate for the patterns used by the project (Asia/Bangkok, UTC+7)
function formatDate(date, tz, pattern) {
  const offset = tz === 'Asia/Bangkok' ? 7 * 3600e3 : 0;
  const d = new Date(date.getTime() + offset);
  const map = {
    yyyy: String(d.getUTCFullYear()), MM: pad(d.getUTCMonth() + 1), dd: pad(d.getUTCDate()),
    HH: pad(d.getUTCHours()), mm: pad(d.getUTCMinutes()), ss: pad(d.getUTCSeconds()),
  };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, t => map[t]);
}

function createGas(options = {}) {
  const state = {
    props: {}, spreadsheets: {}, seq: 0, triggers: [], locks: 0, unlocks: 0,
    writes: [], clears: [], formats: 0, now: options.now || null, logs: [],
  };

  class Range {
    constructor(sheet, row, col, nr, nc) {
      if (row < 1 || col < 1 || nr < 1 || nc < 1) throw new Error(`Range out of bounds ${row},${col},${nr},${nc}`);
      if (row + nr - 1 > sheet.maxRows) throw new Error(`Range exceeds rows ${row + nr - 1} > ${sheet.maxRows} (${sheet.name})`);
      if (col + nc - 1 > sheet.maxCols) throw new Error(`Range exceeds cols ${col + nc - 1} > ${sheet.maxCols}`);
      Object.assign(this, {sheet, row, col, nr, nc});
    }
    getValues() {
      const out = [];
      for (let r = 0; r < this.nr; r++) {
        const src = this.sheet.data[this.row - 1 + r] || [];
        const line = [];
        for (let c = 0; c < this.nc; c++) {
          const v = src[this.col - 1 + c];
          line.push(v === undefined || v === null ? '' : v);
        }
        out.push(line);
      }
      return out;
    }
    setValues(values) {
      if (values.length !== this.nr) throw new Error('setValues row count mismatch');
      state.writes.push({sheet: this.sheet.name, row: this.row, rows: this.nr});
      values.forEach((line, r) => {
        if (line.length !== this.nc) throw new Error('setValues column count mismatch');
        const idx = this.row - 1 + r;
        while (this.sheet.data.length <= idx) this.sheet.data.push([]);
        line.forEach((v, c) => {
          if (typeof v === 'string' && /^=/.test(v)) throw new Error('Formula written to sheet: ' + v);
          if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean' && !(v instanceof Date)) {
            throw new Error('Unsupported cell value type: ' + typeof v);
          }
          this.sheet.data[idx][this.col - 1 + c] = v;
        });
      });
      return this;
    }
    clearContent() {
      state.clears.push({sheet: this.sheet.name, row: this.row, rows: this.nr});
      for (let r = 0; r < this.nr; r++) {
        const line = this.sheet.data[this.row - 1 + r];
        if (!line) continue;
        for (let c = 0; c < this.nc; c++) line[this.col - 1 + c] = '';
      }
      return this;
    }
    setNumberFormat() { state.formats++; return this; }
  }

  class Sheet {
    constructor(ss, name) { Object.assign(this, {ss, name, data: [], maxRows: 1000, maxCols: 26, frozen: 0}); }
    getName() { return this.name; }
    getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
    getLastRow() {
      for (let i = this.data.length - 1; i >= 0; i--) {
        if ((this.data[i] || []).some(v => v !== '' && v !== null && v !== undefined)) return i + 1;
      }
      return 0;
    }
    getMaxRows() { return this.maxRows; }
    getMaxColumns() { return this.maxCols; }
    insertColumnsAfter(after, n) { this.maxCols += n; return this; }
    insertRowsAfter(after, n) { this.maxRows += n; return this; }
    setFrozenRows(n) { this.frozen = n; }
  }

  class Spreadsheet {
    constructor(name) {
      this.id = 'ss-' + (++state.seq);
      this.name = name;
      this.sheets = [new Sheet(this, 'Sheet1')];
    }
    getId() { return this.id; }
    getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
    insertSheet(n) { const s = new Sheet(this, n); this.sheets.push(s); return s; }
    getSheets() { return this.sheets.slice(); }
    deleteSheet(sh) { this.sheets = this.sheets.filter(s => s !== sh); }
  }

  const SpreadsheetApp = {
    create(name) { const ss = new Spreadsheet(name); state.spreadsheets[ss.id] = ss; return ss; },
    openById(id) {
      const ss = state.spreadsheets[id];
      if (!ss) throw new Error('Spreadsheet not found: ' + id);
      return ss;
    },
  };

  const PropertiesService = {
    getScriptProperties() {
      return {
        getProperty: k => (Object.prototype.hasOwnProperty.call(state.props, k) ? state.props[k] : null),
        setProperty: (k, v) => { state.props[k] = String(v); },
        deleteProperty: k => { delete state.props[k]; },
      };
    },
  };

  const LockService = {
    getScriptLock() {
      return {
        tryLock: () => { state.locks++; return !state.lockBusy; },
        waitLock: () => { state.locks++; if (state.lockBusy) throw new Error('lock timeout'); },
        releaseLock: () => { state.unlocks++; },
      };
    },
  };

  let triggerSeq = 0;
  const ScriptApp = {
    getProjectTriggers: () => state.triggers.slice(),
    deleteTrigger: t => { state.triggers = state.triggers.filter(x => x !== t); },
    newTrigger(handler) {
      const spec = {handler};
      const builder = {
        timeBased() { spec.timeBased = true; return builder; },
        everyDays(n) { spec.everyDays = n; return builder; },
        everyHours(n) { spec.everyHours = n; return builder; },
        atHour(h) { spec.atHour = h; return builder; },
        create() {
          const t = {id: ++triggerSeq, spec, getHandlerFunction: () => handler, getUniqueId: () => String(t.id)};
          state.triggers.push(t);
          return t;
        },
      };
      return builder;
    },
  };

  const ContentService = {
    MimeType: {JSON: 'application/json'},
    createTextOutput(text) {
      return {
        text, mime: 'text/plain',
        setMimeType(m) { this.mime = m; return this; },
        getContent() { return this.text; },
      };
    },
  };

  let uuidSeq = 0;
  const Utilities = {
    formatDate,
    getUuid: () => {
      uuidSeq++;
      const h = require('crypto').createHash('md5').update('u' + uuidSeq).digest('hex');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
    },
  };

  // Date that can be frozen / advanced by the tests (state.now = ms)
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0 && state.now !== null) super(state.now);
      else super(...args);
    }
    static now() { return state.now !== null ? state.now : RealDate.now(); }
  }

  const context = {
    SpreadsheetApp, PropertiesService, LockService, ScriptApp, ContentService, Utilities,
    Logger: {log: m => state.logs.push(String(m))},
    console: {log: () => {}, error: m => state.logs.push('ERR ' + m), warn: () => {}},
    Date: MockDate, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, isFinite, parseFloat, parseInt,
  };
  vm.createContext(context);
  for (const f of GS_FILES) {
    const code = fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8');
    vm.runInContext(code, context, {filename: f});
  }
  return {context, state};
}

module.exports = {createGas, formatDate, GS_FILES, ROOT};
