/* ═══ Demo banner — shown on every page of the demo ═══════════════════════
 * "🧪 ระบบทดลองใช้ (Demo) — ข้อมูลทั้งหมดจะถูกรีเซ็ตกลับเป็นค่าเริ่มต้นทุก 3 วัน"
 * + next reset time / countdown (from the API) + DEMO_CONTACT + demo accounts.
 */
'use strict';
(function () {
  const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  let info = null;
  let missing = false;
  let timer = null;

  function contactText() {
    return String(window.DEMO_CONTACT || 'สนใจใช้งานจริง ติดต่อ: Fastwork / LINE: (ใส่ภายหลัง)');
  }

  function accounts() {
    return Array.isArray(window.DEMO_ACCOUNTS) ? window.DEMO_ACCOUNTS : [];
  }

  function accountsHtml() {
    return accounts().map(a => `${escHtml(a.label)} <code class="demo-code">${escHtml(a.value)}</code>`).join(' · ');
  }

  function formatThai(date) {
    try {
      return new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }).format(date) + ' น.';
    } catch (e) {
      return date.toLocaleString();
    }
  }

  function countdown(ms) {
    if (ms <= 0) return 'ถึงรอบรีเซ็ตแล้ว (ระบบจะรีเซ็ตภายในรอบถัดไป)';
    const min = Math.floor(ms / 60000);
    const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
    if (d > 0) return `อีก ${d} วัน ${h} ชม.`;
    if (h > 0) return `อีก ${h} ชม. ${m} นาที`;
    return m > 0 ? `อีก ${m} นาที` : 'อีกไม่ถึง 1 นาที';
  }

  function nextResetHtml() {
    if (missing) return '<b class="demo-warn">ยังไม่ได้ตั้งค่า API</b>';
    if (!info) return 'กำลังโหลด…';
    if (!info.nextReset) return 'รอตั้งค่าระบบ (setupDemo)';
    const next = new Date(info.nextReset);
    return `<b>${escHtml(formatThai(next))}</b> <span class="demo-countdown">(${escHtml(countdown(next.getTime() - Date.now()))})</span>`;
  }

  function render() {
    const host = document.getElementById('demo-banner');
    if (!host) return;
    const accountsOpen = host.dataset.accountsOpen === '1';
    host.innerHTML = `
      <div class="demo-banner-line">
        <span class="demo-banner-tag">🧪 ระบบทดลองใช้ (Demo)</span>
        <span>— ข้อมูลทั้งหมดจะถูกรีเซ็ตกลับเป็นค่าเริ่มต้นทุก 3 วัน · รีเซ็ตครั้งถัดไป: <span id="demo-next-reset">${nextResetHtml()}</span></span>
      </div>
      <div class="demo-banner-line demo-banner-sub">
        <span class="demo-contact">📞 ${escHtml(contactText())}</span>
        ${accounts().length ? `<button type="button" class="demo-accounts-btn" aria-expanded="${accountsOpen ? 'true' : 'false'}"
          onclick="DemoBanner.toggleAccounts()">🔑 บัญชีทดลอง</button>` : ''}
      </div>
      ${accounts().length ? `<div class="demo-accounts" ${accountsOpen ? '' : 'hidden'}>
        <b>บัญชีทดลอง</b>
        <ul>${accounts().map(a => `<li>${escHtml(a.label)}: <code class="demo-code">${escHtml(a.value)}</code></li>`).join('')}</ul>
        <div class="demo-accounts-note">หน้าดูข้อมูลเปิดให้ใช้ได้ทันที · โหมดแก้ไขของตารางรายวันต้องใช้รหัสผ่านด้านบน · ทุกการแก้ไขจะถูกล้างเมื่อรีเซ็ต</div>
      </div>` : ''}`;
  }

  window.DemoBanner = {
    update(demo) {
      if (demo && typeof demo === 'object') info = demo;
      missing = false;
      render();
    },
    apiMissing() {
      missing = true;
      render();
    },
    toggleAccounts() {
      const host = document.getElementById('demo-banner');
      if (!host) return;
      host.dataset.accountsOpen = host.dataset.accountsOpen === '1' ? '' : '1';
      render();
    },
    accountsHtml,
    render,
  };

  document.addEventListener('DOMContentLoaded', render);
  if (document.readyState !== 'loading') render();
  clearInterval(timer);
  timer = setInterval(() => {
    const el = document.getElementById('demo-next-reset');
    if (el) el.innerHTML = nextResetHtml();
  }, 30000);
})();
