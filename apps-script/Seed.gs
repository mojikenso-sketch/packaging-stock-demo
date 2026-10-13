/**
 * Seed.gs — default sample data for the demo (fictional company/items).
 *
 * DEMO_SEED_* below is plain data. buildDemoSeed_(today) expands it into the
 * full data set with every date relative to "today":
 *   - 10 daily ledgers (today-9 … today) with receive / withdraw movements
 *   - older withdraw / receive history (today-30 … today-10)
 *   - upcoming deliveries, master lists, areas, config
 * Lots use { s: suffix, use: avg issue/day, final: stock today,
 *            mfg / exp: day offsets from today, recv: day offset the lot
 *            arrived (new lot), area, note, todayIssue }.
 */

var DEMO_COMPANY = 'บริษัท ตัวอย่าง อินดัสทรี จำกัด (Demo Co., Ltd.)';
var DEMO_LEDGER_DAYS = 10;
var DEMO_HISTORY_FROM = -30; // legacy history before the first daily ledger

var A_MAIN = '1100-คลังบรรจุภัณฑ์';
var A_RETURN = '1300-รอคืน Supplier';
var A_SUBCON = '1400-จ้างผลิต';
var A_LABEL = '1500-ฉลากส่ง Supplier';
var A_HOLD = 'HOLD';
var A_RAW = '1600-วัตถุดิบ จ้างผลิต';
var A_LINE1 = '2100-คลังบรรจุ ไลน์ 1';
var A_LINE2 = '2200-คลังบรรจุ ไลน์ 2';

var DEMO_SEED_AREAS = [A_MAIN, A_RETURN, A_SUBCON, A_LABEL, A_HOLD, A_RAW, A_LINE1, A_LINE2];

var DEMO_SEED_SUPPLIERS = [
  {supplier: 'บจก. กล่องไทย ตัวอย่าง', shelfLife: '24 เดือน'},
  {supplier: 'บจก. พลาสติกเดโม อินดัสทรี', shelfLife: '24 เดือน'},
  {supplier: 'บจก. ฉลากสวย การพิมพ์ (ตัวอย่าง)', shelfLife: '12 เดือน'},
  {supplier: 'หจก. ฟิล์มแพ็ค เดโม', shelfLife: '12 เดือน, 18 เดือน'},
  {supplier: 'บจก. ขวดใส ตัวอย่าง', shelfLife: '24 เดือน'},
  {supplier: 'บจก. เทปและสายรัด เดโม', shelfLife: '18 เดือน'},
  {supplier: 'บจก. พาเลท ตัวอย่าง', shelfLife: '60 เดือน'},
];

var DEMO_SEED_UNITS = ['ใบ', 'ชิ้น', 'ขวด', 'ดวง', 'ม้วน', 'แผ่น', 'กล่อง', 'ลัง', 'ถุง', 'PCS'];

// [code, name, unit, supplierIndex, min, max, safety, lots[], qaSample?]
var DEMO_SEED_ITEMS = [
  ['BX-1001', 'กล่องลูกฟูก 3 ชั้น ขนาด A (30x40x25 ซม.)', 'ใบ', 0, 1000, 4000, 500, [
    {s: 'A', use: 140, final: 760, mfg: -80, exp: 650, note: 'รอของเข้า PO-DEMO-26001'}]],
  ['BX-1002', 'กล่องลูกฟูก 5 ชั้น ขนาด B (40x50x35 ซม.)', 'ใบ', 0, 600, 2500, 300, [
    {s: 'A', use: 70, final: 900, mfg: -120, exp: 610},
    {s: 'B', use: 0, final: 800, mfg: -10, exp: 720, recv: -4}]],
  ['BX-1003', 'กล่องลูกฟูก 3 ชั้น ขนาด C (25x30x20 ซม.)', 'ใบ', 0, 800, 3000, 400, [
    {s: 'A', use: 90, final: 1850, mfg: -60, exp: 670},
    {s: 'R', use: 0, final: 150, mfg: -200, exp: 530, area: A_RETURN, note: 'กล่องชำรุด รอส่งคืน Supplier'}]],
  ['BX-1004', 'กล่องกระดาษพิมพ์ 4 สี สินค้า 250 กรัม', 'ใบ', 0, 2000, 6000, 1000, [
    {s: 'A', use: 220, final: 4200, mfg: -90, exp: 640, note: 'ล้นพื้นที่ ย้ายบางส่วนไปพื้นที่สำรอง'},
    {s: 'B', use: 0, final: 3000, mfg: -5, exp: 725, recv: -2}]],
  ['BX-1005', 'กล่องกระดาษพิมพ์ 4 สี สินค้า 500 กรัม', 'ใบ', 0, 1500, 5000, 800, [
    {s: 'A', use: 160, final: 2600, mfg: -70, exp: 660},
    {s: 'L', use: 40, final: 400, mfg: -70, exp: 660, area: A_LINE1}]],
  ['BX-1006', 'กล่องของขวัญ (Gift Set) ช่องใส่ 3 ชิ้น', 'ใบ', 0, 200, 800, 100, [
    {s: 'A', use: 12, final: 410, mfg: -150, exp: 580}]],
  ['CT-7001', 'ลังกระดาษ 12 ขวด (ขวด 1 ลิตร)', 'ใบ', 0, 500, 2000, 250, [
    {s: 'A', use: 60, final: 1240, mfg: -45, exp: 685},
    {s: 'L', use: 20, final: 120, mfg: -45, exp: 685, area: A_LINE2, recv: -4}]],
  ['CT-7002', 'ลังกระดาษ 24 ขวด (ขวด 250 มล.)', 'ใบ', 0, 400, 1500, 200, [
    {s: 'A', use: 35, final: 900, mfg: -100, exp: 630},
    {s: 'B', use: 0, final: 1000, mfg: -3, exp: 727, recv: -1}]],
  ['CT-7003', 'ลังกระดาษ 6 แกลลอน (5 ลิตร)', 'ใบ', 0, 300, 1200, 150, [
    {s: 'A', use: 25, final: 560, mfg: -75, exp: 655}]],
  ['BT-3001', 'ขวด PET ใส 250 มล.', 'ขวด', 4, 5000, 20000, 2500, [
    {s: 'A', use: 900, final: 6200, mfg: -40, exp: 690},
    {s: 'B', use: 0, final: 6000, mfg: -12, exp: 718, recv: -5},
    {s: 'L', use: 300, final: 2400, mfg: -12, exp: 718, area: A_LINE1, recv: -3}], true],
  ['BT-3002', 'ขวด PET ใส 500 มล.', 'ขวด', 4, 4000, 16000, 2000, [
    {s: 'A', use: 650, final: 8800, mfg: -55, exp: 675},
    {s: 'H', use: 0, final: 1200, mfg: -400, exp: -20, area: A_HOLD, note: 'รอ QA ตัดสิน — ขวดเสียรูป'}], true],
  ['BT-3003', 'ขวด PET ใส 1 ลิตร', 'ขวด', 4, 3000, 12000, 1500, [
    {s: 'A', use: 480, final: 2100, mfg: -65, exp: 665, note: 'เร่ง Supplier ส่งของ'},
    {s: 'L', use: 200, final: 900, mfg: -20, exp: 710, area: A_LINE2, recv: -2}], true],
  ['BT-3004', 'ขวด PET 1.5 ลิตร', 'ขวด', 4, 2000, 8000, 1000, [
    {s: 'A', use: 260, final: 3900, mfg: -30, exp: 700},
    {s: 'J', use: 0, final: 1500, mfg: -30, exp: 700, area: A_SUBCON}], true],
  ['BT-3005', 'ขวด HDPE สีขาว 1 ลิตร', 'ขวด', 1, 1500, 6000, 700, [
    {s: 'A', use: 140, final: 2750, mfg: -85, exp: 645}]],
  ['BT-3006', 'ขวดแก้วใส 200 มล.', 'ขวด', 4, 1000, 4000, 500, [
    {s: 'A', use: 70, final: 1600, mfg: -200, exp: 1630}]],
  ['CP-4001', 'ฝาเกลียว 28 มม. สีแดง', 'ชิ้น', 1, 6000, 25000, 3000, [
    {s: 'A', use: 900, final: 9800, mfg: -50, exp: 680},
    {s: 'L', use: 250, final: 3000, mfg: -50, exp: 680, area: A_LINE1, recv: -3}]],
  ['CP-4002', 'ฝาเกลียว 28 มม. สีเขียว', 'ชิ้น', 1, 5000, 20000, 2500, [
    {s: 'A', use: 600, final: 3400, mfg: -70, exp: 660},
    {s: 'R', use: 0, final: 1200, mfg: -150, exp: 580, area: A_RETURN, note: 'ฝาสีเพี้ยน รอส่งคืน'}]],
  ['CP-4003', 'ฝาเกลียว 38 มม. สีขาว', 'ชิ้น', 1, 3000, 12000, 1500, [
    {s: 'A', use: 280, final: 5200, mfg: -40, exp: 690},
    {s: 'L', use: 150, final: 1100, mfg: -40, exp: 690, area: A_LINE2, recv: -2}]],
  ['CP-4004', 'ฝาฟลิปท็อป 24 มม.', 'ชิ้น', 1, 2000, 9000, 1000, [
    {s: 'A', use: 160, final: 2900, mfg: -60, exp: 670},
    {s: 'X', use: 0, final: 400, mfg: -760, exp: -30, note: 'Lot หมดอายุ รอทำลาย'}]],
  ['CP-4005', 'ฝาปั๊ม (Pump) 28/410', 'ชิ้น', 1, 800, 3000, 400, [
    {s: 'A', use: 45, final: 1350, mfg: -90, exp: 640}]],
  ['CP-4006', 'ซีลฝาอลูมิเนียม 38 มม.', 'ชิ้น', 1, 3000, 12000, 1500, [
    {s: 'A', use: 260, final: 5400, mfg: -100, exp: 150}]],
  ['LB-2001', 'ฉลากหน้า ขวด 250 มล. (สินค้า A)', 'ดวง', 2, 5000, 20000, 2500, [
    {s: 'A', use: 900, final: 8400, mfg: -30, exp: 335},
    {s: 'J', use: 0, final: 2000, mfg: -30, exp: 335, area: A_SUBCON},
    {s: 'L', use: 260, final: 2600, mfg: -30, exp: 335, area: A_LINE1, recv: -3}], true],
  ['LB-2002', 'ฉลากหน้า ขวด 500 มล. (สินค้า A)', 'ดวง', 2, 4000, 16000, 2000, [
    {s: 'A', use: 650, final: 7300, mfg: -25, exp: 340},
    {s: 'X', use: 0, final: 300, mfg: -380, exp: -12}], true],
  ['LB-2003', 'ฉลากหน้า ขวด 1 ลิตร (สินค้า A)', 'ดวง', 2, 3000, 12000, 1500, [
    {s: 'A', use: 480, final: 4600, mfg: -45, exp: 320, recv: -7},
    {s: 'S', use: 0, final: 1200, mfg: -45, exp: 320, area: A_LABEL},
    {s: 'L', use: 150, final: 800, mfg: -45, exp: 320, area: A_LINE2, recv: -2}], true],
  ['LB-2004', 'ฉลากหลัง ขวด 1 ลิตร (ข้อมูลโภชนาการ)', 'ดวง', 2, 3000, 12000, 1500, [
    {s: 'A', use: 470, final: 1900, mfg: -150, exp: 25, note: 'ใกล้หมดอายุ ใช้ก่อน'}], true],
  ['LB-2005', 'ฉลากรอบขวด (Shrink Sleeve) 1.5 ลิตร', 'ดวง', 2, 2000, 8000, 1000, [
    {s: 'A', use: 260, final: 3300, mfg: -60, exp: 18}]],
  ['LB-2006', 'สติกเกอร์บาร์โค้ด 50x30 มม.', 'ดวง', 2, 5000, 20000, 2000, [
    {s: 'A', use: 500, final: 11800, mfg: -20, exp: 710}]],
  ['LB-2007', 'สติกเกอร์ส่งออก (Export) ภาษาอังกฤษ', 'ดวง', 2, 1000, 5000, 500, [
    {s: 'A', use: 60, final: 2300, mfg: -90, exp: 9},
    {s: 'S', use: 0, final: 600, mfg: -90, exp: 9, area: A_LABEL, note: 'ส่งให้ Supplier ติดฉลาก'}]],
  ['FM-5001', 'ม้วนฟิล์มหด POF กว้าง 45 ซม.', 'ม้วน', 3, 20, 80, 10, [
    {s: 'A', use: 2, final: 38, mfg: -40, exp: 325},
    {s: 'J', use: 0, final: 12, mfg: -40, exp: 325, area: A_RAW}]],
  ['FM-5002', 'ม้วนฟิล์มยืดพันพาเลต 50 ซม.', 'ม้วน', 3, 40, 150, 20, [
    {s: 'A', use: 6, final: 22, mfg: -60, exp: 670}]],
  ['FM-5003', 'ม้วนฟิล์มหด PE แพ็ค 6 ขวด', 'ม้วน', 3, 15, 60, 8, [
    {s: 'A', use: 2, final: 33, mfg: -35, exp: 695}]],
  ['BG-6001', 'ถุง PE ใส 8x12 นิ้ว', 'ใบ', 1, 3000, 10000, 1500, [
    {s: 'A', use: 200, final: 6400, mfg: -50, exp: 680},
    {s: 'B', use: 0, final: 5000, mfg: -8, exp: 722, recv: -3}]],
  ['BG-6002', 'ถุงซิปล็อก 15x20 ซม.', 'ใบ', 1, 2000, 8000, 1000, [
    {s: 'A', use: 150, final: 4100, mfg: -80, exp: 650},
    {s: 'H', use: 0, final: 400, mfg: -30, exp: 700, area: A_HOLD, note: 'รอผลตรวจ QA'}]],
  ['BG-6003', 'ถุงฟอยด์ตั้งได้ 500 กรัม', 'ใบ', 1, 1500, 6000, 800, [
    {s: 'A', use: 120, final: 2650, mfg: -40, exp: 690},
    {s: 'X', use: 0, final: 250, mfg: -400, exp: -5}]],
  ['BG-6004', 'ถุงกระสอบสาน 25 กก.', 'ใบ', 1, 500, 2000, 250, [
    {s: 'A', use: 35, final: 980, mfg: -100, exp: 630}]],
  ['DR-6101', 'ถังพลาสติก 18 ลิตร พร้อมฝา', 'ใบ', 1, 150, 600, 80, [
    {s: 'A', use: 8, final: 260, mfg: -120, exp: 1700}]],
  ['DR-6102', 'ถังแกลลอน 5 ลิตร', 'ใบ', 1, 400, 1500, 200, [
    {s: 'A', use: 30, final: 720, mfg: -90, exp: 1730}]],
  ['TP-8001', 'เทปกาว OPP ใส 2 นิ้ว', 'ม้วน', 5, 120, 500, 60, [
    {s: 'A', use: 9, final: 260, mfg: -60, exp: 670},
    {s: 'L', use: 3, final: 24, mfg: -60, exp: 670, area: A_LINE1}]],
  ['TP-8002', 'เทปกาวพิมพ์โลโก้ 2 นิ้ว', 'ม้วน', 5, 100, 400, 50, [
    {s: 'A', use: 9, final: 0, mfg: -200, exp: 530, todayIssue: 12}]],
  ['TP-8003', 'สายรัดพลาสติก PP 15 มม.', 'ม้วน', 5, 30, 120, 15, [
    {s: 'A', use: 2, final: 64, mfg: -100, exp: 1730}]],
  ['PL-9001', 'พาเลตพลาสติก 110x110 ซม.', 'แผ่น', 6, 80, 300, 40, [
    {s: 'A', use: 3, final: 280, mfg: -300, exp: 3350},
    {s: 'B', use: 0, final: 60, mfg: -10, exp: 3640, recv: -6}]],
  ['PL-9002', 'พาเลตไม้ 100x120 ซม.', 'แผ่น', 6, 100, 400, 50, [
    {s: 'A', use: 6, final: 210, mfg: -90, exp: 640}]],
  ['SP-9101', 'ไส้ร่องกระดาษ (แผ่นกั้น) 12 ช่อง', 'แผ่น', 0, 1000, 4000, 500, [
    {s: 'A', use: 60, final: 1950, mfg: -50, exp: 680}]],
  ['SP-9102', 'แผ่นรองพาเลต (Slip Sheet)', 'แผ่น', 0, 300, 1200, 150, [
    {s: 'A', use: 12, final: 520, mfg: -110, exp: 620}]],
  ['SP-9103', 'มุมกระดาษกันกระแทก 2 นิ้ว', 'ชิ้น', 0, 800, 3000, 400, [
    {s: 'A', use: 40, final: 1500, mfg: -45, exp: 685}]],
  ['SP-9104', 'ถาดพลาสติกรองขวด 24 ช่อง', 'ใบ', 1, 400, 1500, 200, [
    {s: 'A', use: 18, final: 760, mfg: -70, exp: 660}]],
];

// [code, dayOffset, qty, remark]
var DEMO_SEED_DELIVERIES = [
  ['BX-1004', -2, 3000, 'PO-DEMO-25987 · รับเข้าแล้ว'],
  ['BT-3003', 1, 6000, 'PO-DEMO-26002 · ยืนยันวันส่งแล้ว'],
  ['TP-8002', 1, 300, 'PO-DEMO-26003 · ด่วน'],
  ['BX-1001', 2, 2000, 'PO-DEMO-26001'],
  ['FM-5002', 2, 100, 'PO-DEMO-26004'],
  ['CP-4002', 3, 10000, 'PO-DEMO-26005'],
  ['LB-2004', 4, 8000, 'PO-DEMO-26006 · รอยืนยันอาร์ตเวิร์ก'],
  ['BX-1005', 5, 3000, 'PO-DEMO-26007'],
  ['CT-7002', 6, 600, 'PO-DEMO-26008 · ตรวจพื้นที่ก่อนรับ'],
  ['BT-3001', 8, 8000, 'PO-DEMO-26009'],
  ['LB-2006', 12, 10000, 'PO-DEMO-26010'],
];

var DEMO_SEED_DEPTS = ['ไลน์บรรจุ 1', 'ไลน์บรรจุ 2', 'ฝ่ายผลิต', 'QA / ตัวอย่าง'];

function seedRand_(a, b) {
  var x = Math.sin(a * 12.9898 + b * 78.233 + 0.5) * 43758.5453;
  return x - Math.floor(x);
}

function seedYmd_(iso) { return iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10); }

function seedEmptyMoves_() {
  return {receive: 0, returnPackaging: 0, returnSupplier: 0, qaIssue: 0, sendBackSupplier: 0, issuePackaging: 0};
}

function seedAreaCode_(area) {
  var m = /^(\d+)/.exec(area);
  return m ? m[1] : area.toLowerCase();
}

// Simulate one Lot over the ledger days. Works backwards from the target
// stock today so the closing balance is exactly lot.final.
function seedSimulateLot_(dates, lot, itemIndex, lotIndex, qaSample) {
  var n = dates.length;
  var arrival = lot.recv === undefined ? null : n - 1 + lot.recv; // index of arrival day
  var moves = dates.map(function (date, k) {
    var m = seedEmptyMoves_();
    if (arrival !== null && k < arrival) return m;
    var dow = dayOfWeekIso_(date);
    if (lot.use > 0 && dow !== 0) {
      var r = seedRand_(itemIndex * 31 + lotIndex, k);
      m.issuePackaging = Math.max(0, Math.round(lot.use * (0.55 + 0.9 * r)));
      if (qaSample && seedRand_(itemIndex * 17 + lotIndex, k + 50) < 0.3) m.qaIssue = Math.max(1, Math.round(lot.use * 0.03));
      if (seedRand_(itemIndex * 13 + lotIndex, k + 90) < 0.15) m.returnPackaging = Math.max(1, Math.round(lot.use * 0.08));
    }
    if (k === n - 1 && lot.todayIssue) m.issuePackaging = lot.todayIssue;
    return m;
  });
  var days = new Array(n);
  var after = lot.final;
  for (var k = n - 1; k >= 0; k--) {
    var m = moves[k];
    if (arrival !== null && k === arrival) {
      m.returnPackaging = 0;
      m.receive = after + m.qaIssue + m.sendBackSupplier + m.issuePackaging;
    }
    var before = after - m.receive - m.returnPackaging - m.returnSupplier + m.qaIssue + m.sendBackSupplier + m.issuePackaging;
    if (before < 0) {
      m.returnPackaging = 0;
      before = after - m.receive - m.returnSupplier + m.qaIssue + m.sendBackSupplier + m.issuePackaging;
    }
    days[k] = {opening: Math.max(0, before), remaining: after, moves: m};
    after = Math.max(0, before);
  }
  return days;
}

// A stock note belongs to the current stock status (see
// carryStockNoteForTransition_): it is cleared on the day the status changes.
// Put the note on the days of the current status streak, skipping a day whose
// status differs from the previous day, so the seed is already "settled".
function seedNoteDays_(l) {
  var n = l.days.length;
  l.noteDays = new Array(n).fill(false);
  if (!l.note) return;
  var exists = function (k) {
    var d = l.days[k];
    return d.opening > 0.0001 || Object.keys(d.moves).some(function (f) { return d.moves[f] !== 0; });
  };
  var status = function (k) {
    return ledgerStockStatusKey_({remaining: l.days[k].remaining, min: l.min, max: l.max});
  };
  var k = n - 1;
  while (k - 1 >= 0 && exists(k - 1) && status(k - 1) === status(n - 1)) k--;
  if (k - 1 >= 0 && exists(k - 1)) k++; // first day of a new status would be cleared
  for (var j = Math.max(k, n - 3); j <= n - 1; j++) l.noteDays[j] = true;
}

function buildDemoSeed_(today, stampNow) {
  stampNow = stampNow || (today + ' 09:00:00');
  var dates = [];
  for (var k = DEMO_LEDGER_DAYS - 1; k >= 0; k--) dates.push(addDaysIso_(today, -k));
  var n = dates.length;

  // Expand catalogue → lots with simulated days
  var lots = [];
  DEMO_SEED_ITEMS.forEach(function (it, ii) {
    it[7].forEach(function (lot, li) {
      var mfgDate = addDaysIso_(today, lot.mfg);
      lots.push({
        id: 'seed-' + it[0] + '-' + (li + 1),
        code: it[0], name: it[1], unit: it[2],
        supplier: DEMO_SEED_SUPPLIERS[it[3]].supplier,
        min: it[4], max: it[5], safety: it[6],
        lot: seedYmd_(mfgDate) + lot.s,
        mfgDate: mfgDate,
        expiryDate: addDaysIso_(today, lot.exp),
        area: lot.area || A_MAIN,
        note: lot.note || '',
        unitComment: it[2] === 'ม้วน' && /^FM/.test(it[0]) ? '1 ม้วน ≈ 500 เมตร' : '',
        days: seedSimulateLot_(dates, lot, ii, li, !!it[8]),
      });
    });
  });
  lots.forEach(seedNoteDays_);

  var dailyLedgers = {};
  dates.forEach(function (date, k) {
    var rows = [];
    DEMO_SEED_AREAS.forEach(function (area) {
      rows.push({id: 'area-' + seedAreaCode_(area), kind: 'section', title: area, tone: area === A_HOLD ? 'hold' : 'normal', sourceRow: 0});
      lots.forEach(function (l) {
        if (l.area !== area) return;
        var d = l.days[k];
        var moved = Object.keys(d.moves).some(function (f) { return d.moves[f] !== 0; });
        if (!(d.opening > 0.0001 || moved)) return;
        var row = {
          id: l.id, kind: 'item', code: l.code, name: l.name, lot: l.lot, locator: '',
          mfgDate: l.mfgDate, expiryDate: l.expiryDate,
          opening: d.opening,
          receive: d.moves.receive, returnPackaging: d.moves.returnPackaging, returnSupplier: d.moves.returnSupplier,
          qaIssue: d.moves.qaIssue, sendBackSupplier: d.moves.sendBackSupplier, issuePackaging: d.moves.issuePackaging,
          remaining: d.remaining,
          min: l.min, max: l.max, safety: l.safety,
          unit: l.unit, supplier: l.supplier,
          stockNote: l.noteDays[k] ? l.note : '',
          unitComment: l.unitComment,
          tone: area === A_HOLD ? 'hold' : 'normal',
          sourceRow: 0,
        };
        rows.push(row);
      });
    });
    dailyLedgers[date] = {
      date: date,
      sourceFile: k === 0 ? 'ข้อมูลตั้งต้น (ระบบทดลอง)' : 'คัดลอกจากตารางวันที่ ' + dates[k - 1],
      sourceSheet: '',
      sourceDate: k === 0 ? '' : dates[k - 1],
      updated: k === n - 1 ? stampNow : date + ' 17:05:00',
      rows: rows,
    };
  });

  var dailyReady = {};
  dates.forEach(function (date, k) {
    if (k === n - 1) return;
    dailyReady[date] = {ready: true, at: date + ' 08:' + String(10 + (k * 7) % 40).padStart(2, '0') + ':00'};
  });

  // Older history (before the first daily ledger) — shown by History / Stats
  var transactions = [];
  var seq = 0;
  DEMO_SEED_ITEMS.forEach(function (it, ii) {
    var totalUse = it[7].reduce(function (s, l) { return s + l.use; }, 0);
    if (totalUse <= 0) return;
    for (var off = DEMO_HISTORY_FROM; off < -(DEMO_LEDGER_DAYS - 1); off++) {
      var date = addDaysIso_(today, off);
      if (dayOfWeekIso_(date) === 0) continue;
      var dayNo = off - DEMO_HISTORY_FROM;
      if ((dayNo + ii) % 3 === 0) {
        var qty = Math.max(1, Math.round(totalUse * 3 * (0.7 + 0.6 * seedRand_(ii, off + 500))));
        seq++;
        transactions.push({
          id: 'seed-t' + String(seq).padStart(4, '0'), type: 'withdraw', date: date, code: it[0], qty: qty,
          person: 'ผู้ใช้ทดลอง', dept: DEMO_SEED_DEPTS[(ii + dayNo) % DEMO_SEED_DEPTS.length],
          ref: 'WD-' + seedYmd_(date) + '-' + String(ii + 1).padStart(2, '0'),
          note: 'ประวัติตัวอย่างก่อนเริ่มใช้ตารางรายวัน', after: 0, created: date + ' 10:30:00',
        });
      }
      if ((dayNo + ii) % 10 === 4) {
        var rq = Math.max(10, Math.round(totalUse * 10 / 10) * 10);
        seq++;
        transactions.push({
          id: 'seed-t' + String(seq).padStart(4, '0'), type: 'receive', date: date, code: it[0], qty: rq,
          person: 'ผู้ใช้ทดลอง', dept: DEMO_SEED_SUPPLIERS[it[3]].supplier,
          ref: 'GR-' + seedYmd_(date) + '-' + String(ii + 1).padStart(2, '0'),
          note: 'รับเข้าตาม PO ตัวอย่าง', after: 0, created: date + ' 14:00:00',
        });
      }
    }
  });

  var nameByCode = {};
  DEMO_SEED_ITEMS.forEach(function (it) { nameByCode[it[0]] = it[1]; });
  var deliveries = DEMO_SEED_DELIVERIES.map(function (d) {
    return {code: d[0], name: nameByCode[d[0]] || '', date: addDaysIso_(today, d[1]), qty: d[2], remark: d[3]};
  });

  return {
    company: DEMO_COMPANY,
    items: seedItemsFromLedger_(dailyLedgers[today]),
    transactions: transactions,
    deliveries: deliveries,
    config: defaultConfig_(),
    dailyLedgers: dailyLedgers,
    dailyReady: dailyReady,
    areas: DEMO_SEED_AREAS.slice(),
    masterLists: {
      suppliers: DEMO_SEED_SUPPLIERS.map(function (s) { return s.supplier; }),
      supplierShelfLives: DEMO_SEED_SUPPLIERS.map(function (s) { return {supplier: s.supplier, shelfLife: s.shelfLife}; }),
      units: DEMO_SEED_UNITS.slice(),
    },
  };
}

// Same mapping as sync_items_from_ledger() but without sheet I/O.
function seedItemsFromLedger_(ledger) {
  return (ledger.rows || []).filter(function (r) { return r.kind === 'item'; }).map(function (r) {
    return {
      ledgerId: r.id, code: r.code, name: r.name, unit: r.unit, supplier: r.supplier,
      stock: r.remaining, min: r.min, max: r.max, safety: r.safety, stockNote: r.stockNote || '',
    };
  });
}
