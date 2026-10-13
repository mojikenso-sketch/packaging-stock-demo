ระบบควบคุมสต๊อกบรรจุภัณฑ์ (Packaging Stock) — เวอร์ชันทดลองใช้ (DEMO)
=====================================================================
บริษัทสมมติ: บริษัท ตัวอย่าง อินดัสทรี จำกัด (Demo Co., Ltd.)
Programming by Duongruthai_Milk

1) ระบบนี้คืออะไร
------------------
เว็บแอปควบคุมสต๊อกบรรจุภัณฑ์ (กล่อง ฉลาก ขวด PET ฝา ฟิล์มหด ถุง ลังกระดาษ ฯลฯ)
หน้าเว็บเป็นไฟล์ static บน GitHub Pages (โฟลเดอร์ docs/) และใช้ Google Apps Script
(โฟลเดอร์ apps-script/) เป็น API — ข้อมูลเก็บใน Google Sheets ที่สคริปต์สร้างให้เอง

ฟังก์ชันหลัก
  • แดชบอร์ด: จำนวนรายการ / หมดสต๊อก / ต่ำกว่า Min / เกิน Max / ปกติ,
    โดนัทสัดส่วนสถานะสต๊อก, กราฟยอดเบิกจ่ายรวม 7 วันล่าสุด,
    Top 3 ใกล้หมดสต๊อก, Top 3 ใกล้หมดอายุ, กำหนดรับของ 7 วันข้างหน้า
  • ตารางสต๊อกคงเหลือ: LOT, คงเหลือ, ระดับ (แถบ Min/Safety/Max), สถานะ, หมายเหตุ (บันทึกอัตโนมัติ)
  • แจ้งเตือน & Lot: รายการต่ำกว่า Min / เกิน Max พร้อมคำแนะนำ และติดตาม Lot + วันหมดอายุ
  • ตารางรับเข้า / เบิกจ่ายรายวัน: รับเข้า, รับคืน, จ่าย QA, ส่งคืน Supplier, จ่ายบรรจุ,
    ยอดยกมา–คงเหลือคำนวณอัตโนมัติ, แยก Lot, เพิ่ม/ลบรายการ, ข้อมูลรวมต่อ ITEM,
    พิมพ์ใบกำกับพาเลต / ใบบันทึกการใช้ฉลาก, Export Excel, พิมพ์เอกสาร
  • ประวัติรายการย้อนหลัง (กรองวันที่/ประเภท/ค้นหา, Export CSV)
  • อัตราการใช้งาน (Top 10, เปรียบเทียบรายเดือน) และหน้า สินค้า & ตั้งค่า
  • ใช้ได้ทั้ง PC / แท็บเล็ต / มือถือ, โหมดสว่าง/มืด

ข้อมูลตัวอย่าง: 46 ITEM, 73 Lot, ตารางรายวัน 10 วันล่าสุด (นับจากวันนี้),
ประวัติเก่าอีก 3 สัปดาห์, มีรายการต่ำกว่า Min 5 รายการ, เกิน Max 4 รายการ,
หมดสต๊อก 1 รายการ และ Lot ที่หมดอายุ/ใกล้หมดอายุ — ทั้งหมดเป็นข้อมูลสมมติ

ข้อมูลทั้งหมดจะถูกรีเซ็ตกลับเป็นค่าเริ่มต้นทุก 3 วันโดยอัตโนมัติ
(แถบ "🧪 ระบบทดลองใช้ (Demo)" ด้านบนทุกหน้าจะแสดงเวลารีเซ็ตครั้งถัดไป)

2) บัญชีทดลอง
--------------
  • หน้าดูข้อมูลทุกหน้า: เปิดใช้ได้ทันที ไม่ต้องล็อกอิน
  • รหัสผ่านเปิด "โหมดแก้ไข" ของตารางรับเข้า / เบิกจ่าย:  demo1234
    (ตั้งค่าใน apps-script/Demo.gs → DEMO_EDIT_PASSWORD และแสดงบนเว็บจาก docs/config.js → DEMO_ACCOUNTS
     ถ้าเปลี่ยนรหัส ให้แก้ทั้ง 2 ที่ แล้วรัน setupDemo อีกครั้ง)

ฟังก์ชันที่ปิดไว้ในเดโม: การเชื่อมต่อ/Sync ข้อมูลจากระบบ ERP และการนำเข้าตารางกำหนดรับจาก Excel

3) ขั้นตอนติดตั้ง (Deploy)
---------------------------
 1. เปิด https://script.google.com → New project (โปรเจกต์แบบ standalone)
 2. สร้างไฟล์สคริปต์ 5 ไฟล์ แล้ววางโค้ดจากโฟลเดอร์ apps-script/ ให้ชื่อตรงกัน:
      Code.gs, Store.gs, Ledger.gs, Seed.gs, Demo.gs
    (ลบโค้ดเดิมใน Code.gs ทิ้งก่อน)
 3. Project Settings → ติ๊ก "Show appsscript.json manifest file in editor"
    แล้ววางเนื้อหาจาก apps-script/appsscript.json (Time zone = Asia/Bangkok)
 4. เลือกฟังก์ชัน setupDemo แล้วกด Run ครั้งเดียว → กดอนุญาตสิทธิ์ (Authorize)
    สคริปต์จะ: สร้าง Google Sheet ใหม่, ใส่ข้อมูลตัวอย่าง, บันทึก DEMO_LAST_RESET,
    ตั้งรหัสผ่านทดลอง และติดตั้ง Trigger รายวัน demoAutoReset (มีเพียง 1 ตัว)
    ดูผลได้ที่ Execution log
 5. Deploy → New deployment → เลือกประเภท Web app
      Execute as:      Me
      Who has access:  Anyone
    กด Deploy แล้วคัดลอก Web app URL (ลงท้ายด้วย /exec)
 6. เปิดไฟล์ docs/config.js แล้วแทนที่ PASTE_DEPLOYED_EXEC_URL_HERE ด้วย URL /exec
 7. สร้าง GitHub repository ใหม่ → push โปรเจกต์นี้ขึ้นไป (branch main)
 8. GitHub → Settings → Pages → Source: Deploy from a branch → Branch: main / folder: /docs → Save
 9. รอ 1–2 นาที แล้วเปิด https://<username>.github.io/<repo>/

ฟังก์ชันที่รันเองได้ใน Apps Script
  • setupDemo()      ติดตั้งครั้งแรก (รันซ้ำได้ — ใช้ Sheet เดิม, Trigger ยังมีแค่ 1 ตัว และรีเซ็ตข้อมูล)
  • resetDemoNow()   รีเซ็ตข้อมูลกลับเป็นค่าเริ่มต้นทันที
  • demoAutoReset()  ตัวที่ Trigger เรียกทุกวันช่วง 01:00–02:00 น. — รีเซ็ตเมื่อครบ 3 วัน

หมายเหตุ
  • ถ้าแก้โค้ด .gs ภายหลัง ต้อง Deploy → Manage deployments → Edit → Version: New version
    (URL /exec เดิมใช้ต่อได้)
  • ถ้าหน้าเว็บขึ้น "ยังไม่ได้ตั้งค่า API" แปลว่ายังไม่ได้ใส่ URL ใน docs/config.js
  • ถ้าขึ้น "กรุณารันฟังก์ชัน setupDemo()" แปลว่ายังไม่ได้รัน setupDemo ใน Apps Script
  • ข้อความติดต่อบนแถบ Demo แก้ได้ที่ docs/config.js → DEMO_CONTACT

4) ทดสอบ (สำหรับนักพัฒนา)
---------------------------
  node test/run-tests.js
  (จำลอง SpreadsheetApp / PropertiesService / ScriptApp / ContentService / Utilities / LockService
   ทดสอบ setupDemo, การรีเซ็ต 3 วัน, ทุก API action และหน้าเว็บ docs/ กับ API จำลอง)
  ข้อมูลตัวอย่างแบบ plain data สำหรับตรวจสอบ: test/seed-snapshot.json (สร้างที่วันที่ 2026-01-15)
  สร้างใหม่ได้ด้วย  node test/run-tests.js --update-snapshot
