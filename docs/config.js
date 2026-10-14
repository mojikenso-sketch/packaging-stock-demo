/* ─── ตั้งค่าเว็บเดโม ─────────────────────────────────────────────────────
 * แก้ไฟล์นี้หลัง Deploy Google Apps Script เป็น Web App แล้ว
 * (ดูขั้นตอนใน README_DEMO.txt)
 */
window.DEMO_CONFIG = {
  // วาง URL ของ Web App (ลงท้ายด้วย /exec) แทนข้อความด้านล่าง
  API_URL: 'https://script.google.com/macros/s/AKfycbwcePRNtEq6PERhUJWWEJRxJ0l1Fou74W4vwCmjrXniItegiSEn4B8aamhvexSibt5F/exec',
};

// ข้อความติดต่อที่แสดงบนแถบ Demo ทุกหน้า
const DEMO_CONTACT = 'สนใจใช้งานจริง ติดต่อ: Fastwork / LINE: (ใส่ภายหลัง)';

// บัญชีทดลอง — ต้องตรงกับ DEMO_EDIT_PASSWORD ใน apps-script/Demo.gs
const DEMO_ACCOUNTS = [
  {label: 'รหัสผ่านเปิดโหมดแก้ไข (ตารางรับเข้า / เบิกจ่าย)', value: 'demo1234'},
];

window.DEMO_CONTACT = DEMO_CONTACT;
window.DEMO_ACCOUNTS = DEMO_ACCOUNTS;

// สิทธิ์ทดลองใช้ 5 ชั่วโมงต่อคน (นับตาม IP + อุปกรณ์) — assets/trial-gate.js
// gateUrl = URL /exec ของโปรเจกต์ Apps Script "Trial Gate" (แยกจาก API ของเดโมนี้)
// ถ้ายังเป็น PASTE_... หรือเชื่อมต่อไม่ได้ เดโมยังใช้งานได้ตามปกติ (fail-open)
window.DEMO_TRIAL = {
  gateUrl: 'https://script.google.com/macros/s/AKfycbwQzhsI1OIN-YUumWLE0n1150c9hTPC--Npm19k44AIDjneJfn2SFXnTYxsW9OGbO0/exec',
  app: 'packaging',
  hours: 5,
  contact: DEMO_CONTACT,
  priceHtml: 'เช่ารายปีเริ่ม 19,900 บาท/ปี · ขายขาดเริ่ม 39,900 บาท',
};
