/* ─── ตั้งค่าเว็บเดโม ─────────────────────────────────────────────────────
 * แก้ไฟล์นี้หลัง Deploy Google Apps Script เป็น Web App แล้ว
 * (ดูขั้นตอนใน README_DEMO.txt)
 */
window.DEMO_CONFIG = {
  // วาง URL ของ Web App (ลงท้ายด้วย /exec) แทนข้อความด้านล่าง
  API_URL: 'PASTE_DEPLOYED_EXEC_URL_HERE',
};

// ข้อความติดต่อที่แสดงบนแถบ Demo ทุกหน้า
const DEMO_CONTACT = 'สนใจใช้งานจริง ติดต่อ: Fastwork / LINE: (ใส่ภายหลัง)';

// บัญชีทดลอง — ต้องตรงกับ DEMO_EDIT_PASSWORD ใน apps-script/Demo.gs
const DEMO_ACCOUNTS = [
  {label: 'รหัสผ่านเปิดโหมดแก้ไข (ตารางรับเข้า / เบิกจ่าย)', value: 'demo1234'},
];

window.DEMO_CONTACT = DEMO_CONTACT;
window.DEMO_ACCOUNTS = DEMO_ACCOUNTS;
