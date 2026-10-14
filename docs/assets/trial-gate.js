/*
 * Demo Trial Gate client — shared by every demo site (copy this file as is).
 *
 * Needs, before this script:
 *   window.DEMO_TRIAL = {
 *     gateUrl: 'https://script.google.com/macros/s/.../exec',  // Trial Gate web app
 *     app: 'sds',             // a-z 0-9 - ; one id per demo site
 *     hours: 5,               // shown to the visitor; the server decides the real limit
 *     contact: 'สนใจใช้งานจริง ติดต่อ: ...',
 *     priceHtml: ''           // optional extra line in the "time is up" box
 *   };
 *
 * Shows a small countdown badge, and a full-screen "หมดเวลาทดลอง" box once the
 * visitor's trial (counted per IP or per browser) is over. If the gate cannot be
 * reached the demo stays usable (fail-open).
 *
 * Other scripts can use window.DemoTrial: isExpired(), state, onChange(fn).
 */
(function () {
  'use strict';
  var cfg = window.DEMO_TRIAL || {};
  var app = String(cfg.app || 'demo');
  var hours = Number(cfg.hours) || 5;
  var CACHE_KEY = 'demo_trial_state_' + app;
  var DEVICE_KEY = 'demo_trial_device';
  var listeners = [];
  var state = { expiresAt: 0, expired: false, checked: false, unlimited: false };

  function store(op, key, value) {
    try {
      if (op === 'get') return window.localStorage.getItem(key);
      window.localStorage.setItem(key, value);
    } catch (e) {}
    return null;
  }

  function deviceId() {
    var id = store('get', DEVICE_KEY);
    if (!id) {
      id = 'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
      store('set', DEVICE_KEY, id);
    }
    return id;
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function publicIp() {
    return withTimeout(fetch('https://api.ipify.org?format=json', { cache: 'no-store' }), 5000)
      .then(function (r) { return r.json(); })
      .then(function (j) { return String(j.ip || ''); })
      .catch(function () {
        return withTimeout(fetch('https://www.cloudflare.com/cdn-cgi/trace', { cache: 'no-store' }), 5000)
          .then(function (r) { return r.text(); })
          .then(function (t) { var m = /(?:^|\n)ip=([^\n]+)/.exec(t); return m ? m[1].trim() : ''; })
          .catch(function () { return ''; });
      });
  }

  function fmtLeft(ms) {
    var min = Math.max(0, Math.ceil(ms / 60000));
    var h = Math.floor(min / 60);
    var m = min % 60;
    return (h ? h + ' ชม. ' : '') + m + ' นาที';
  }

  function css() {
    if (document.getElementById('demo-trial-css')) return;
    var s = document.createElement('style');
    s.id = 'demo-trial-css';
    s.textContent =
      '#demo-trial-badge{position:fixed;left:12px;bottom:12px;z-index:2147483000;max-width:calc(100vw - 24px);' +
      'background:rgba(17,24,39,.92);color:#fff;font:500 12px/1.4 Sarabun,"Segoe UI",Tahoma,sans-serif;' +
      'padding:6px 10px;border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.25)}' +
      '#demo-trial-badge small{display:block;opacity:.75;font-weight:400}' +
      '#demo-trial-block{position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.82);' +
      'display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)}' +
      '#demo-trial-block .box{background:#fff;color:#111827;max-width:440px;width:100%;border-radius:16px;' +
      'padding:24px;text-align:center;font:400 15px/1.6 Sarabun,"Segoe UI",Tahoma,sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.35)}' +
      '#demo-trial-block h2{margin:0 0 8px;font-size:20px}' +
      '#demo-trial-block .contact{margin-top:12px;font-weight:600;color:#1d4ed8}' +
      '#demo-trial-block .owner-link{display:inline-block;margin-top:18px;font-size:11px;color:#9ca3af;' +
      'background:none;border:0;cursor:pointer;padding:2px 4px}' +
      '#demo-trial-block .owner-form{display:none;margin-top:10px;gap:6px;justify-content:center}' +
      '#demo-trial-block .owner-form.show{display:flex}' +
      '#demo-trial-block .owner-form input{width:140px;padding:6px 8px;border:1px solid #d1d5db;border-radius:8px;font:inherit}' +
      '#demo-trial-block .owner-form button{padding:6px 12px;border:0;border-radius:8px;background:#1d4ed8;color:#fff;font:inherit;cursor:pointer}' +
      '#demo-trial-block .owner-msg{min-height:18px;margin-top:6px;font-size:12px;color:#b91c1c}' +
      '@media print{#demo-trial-badge,#demo-trial-block{display:none!important}}';
    document.head.appendChild(s);
  }

  function badge() {
    var el = document.getElementById('demo-trial-badge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-trial-badge';
      document.body.appendChild(el);
    }
    return el;
  }

  function block() {
    if (document.getElementById('demo-trial-block')) return;
    var wrap = document.createElement('div');
    wrap.id = 'demo-trial-block';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    var box = document.createElement('div');
    box.className = 'box';
    var h = document.createElement('h2');
    h.textContent = '⏰ หมดเวลาทดลองใช้ ' + hours + ' ชั่วโมงแล้ว';
    var p = document.createElement('p');
    p.textContent = 'ขอบคุณที่ทดลองใช้งาน สิทธิ์ทดลองใช้ได้ 1 ครั้งต่อคน (นับตาม IP และอุปกรณ์)';
    box.appendChild(h);
    box.appendChild(p);
    if (cfg.priceHtml) {
      var price = document.createElement('div');
      price.innerHTML = cfg.priceHtml;
      box.appendChild(price);
    }
    var c = document.createElement('div');
    c.className = 'contact';
    c.textContent = cfg.contact || 'สนใจใช้งานจริง กรุณาติดต่อผู้ขาย';
    box.appendChild(c);
    ownerUnlock(box);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
  }

  /** Discreet owner unlock: the code is checked only by the gate server. */
  function ownerUnlock(box) {
    var link = document.createElement('button');
    link.type = 'button';
    link.className = 'owner-link';
    link.textContent = 'ผู้ดูแล';
    var form = document.createElement('form');
    form.className = 'owner-form';
    var input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.placeholder = 'รหัส';
    input.setAttribute('aria-label', 'รหัสผู้ดูแล');
    var go = document.createElement('button');
    go.type = 'submit';
    go.textContent = 'ปลดล็อก';
    var msg = document.createElement('div');
    msg.className = 'owner-msg';
    form.appendChild(input);
    form.appendChild(go);
    link.addEventListener('click', function () { form.classList.add('show'); input.focus(); });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!input.value || !cfg.gateUrl || /PASTE_/.test(cfg.gateUrl)) return;
      go.disabled = true;
      msg.textContent = '';
      publicIp().then(function (ip) {
        return withTimeout(fetch(cfg.gateUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'unlock', app: app, ip: ip, device: deviceId(), code: input.value,
            ua: navigator.userAgent.slice(0, 200) })
        }), 15000);
      }).then(function (r) { return r.json(); }).then(function (j) {
        input.value = '';
        if (j && j.ok && j.unlimited) applyUnlimited();
        else msg.textContent = (j && j.error) || 'ปลดล็อกไม่สำเร็จ';
      }).catch(function () {
        msg.textContent = 'เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง';
      }).then(function () { go.disabled = false; });
    });
    box.appendChild(link);
    box.appendChild(form);
    box.appendChild(msg);
  }

  function applyUnlimited() {
    state.unlimited = true;
    state.expired = false;
    store('set', CACHE_KEY, 'unlimited');
    var b = document.getElementById('demo-trial-block');
    if (b) b.remove();
    var badgeEl = document.getElementById('demo-trial-badge');
    if (badgeEl) badgeEl.remove();
    listeners.forEach(function (fn) { try { fn(state); } catch (e) {} });
  }

  function render() {
    if (!document.body) return;
    css();
    if (state.unlimited || !state.expiresAt) return;
    var left = state.expiresAt - Date.now();
    var wasExpired = state.expired;
    state.expired = left <= 0;
    if (state.expired) {
      var b = document.getElementById('demo-trial-badge');
      if (b) b.remove();
      block();
    } else {
      badge().innerHTML = '';
      var line = document.createElement('span');
      line.textContent = '⏳ เวลาทดลองของคุณเหลือ ' + fmtLeft(left);
      var note = document.createElement('small');
      note.textContent = 'ระบบบันทึก IP/อุปกรณ์ เพื่อจำกัดสิทธิ์ทดลอง 1 ครั้งต่อคน';
      badge().appendChild(line);
      badge().appendChild(note);
    }
    if (wasExpired !== state.expired) listeners.forEach(function (fn) { try { fn(state); } catch (e) {} });
  }

  function apply(expiresAtMs) {
    state.expiresAt = expiresAtMs;
    state.checked = true;
    store('set', CACHE_KEY, String(expiresAtMs));
    render();
  }

  function check() {
    if (!cfg.gateUrl || /PASTE_/.test(cfg.gateUrl)) return Promise.resolve();
    return publicIp().then(function (ip) {
      var url = cfg.gateUrl + '?action=check&app=' + encodeURIComponent(app) +
        '&ip=' + encodeURIComponent(ip) + '&device=' + encodeURIComponent(deviceId()) +
        '&ua=' + encodeURIComponent(navigator.userAgent.slice(0, 200));
      return withTimeout(fetch(url, { cache: 'no-store' }), 15000)
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok && j.unlimited) {
            applyUnlimited();
          } else if (j && j.ok) {
            // Use the server's remaining time against the local clock (clock skew safe).
            state.unlimited = false;
            apply(Date.now() + Number(j.remainingMs || 0));
          }
        });
    }).catch(function () { /* fail-open: keep the demo usable */ });
  }

  window.DemoTrial = {
    state: state,
    isExpired: function () { return !!state.expired; },
    onChange: function (fn) { listeners.push(fn); }
  };

  function start() {
    var cachedRaw = store('get', CACHE_KEY);
    var cached = Number(cachedRaw) || 0;
    if (cachedRaw === 'unlimited') state.unlimited = true;
    else if (cached) { state.expiresAt = cached; render(); }
    check();
    setInterval(render, 30000);
    setInterval(check, 5 * 60000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
