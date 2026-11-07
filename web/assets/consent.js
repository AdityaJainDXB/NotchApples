/* Notch Apple cookie and storage choices.
   Nothing optional runs until someone opts in. There are no analytics or advertising scripts on this site, so those two
   categories are listed as "not used" and can't be switched on. The one optional thing is a request to GitHub's API (a
   fallback for release info), which shows GitHub the visitor's address, so it waits for a yes.
   Reject is as easy to reach as Accept. The choice is kept in this browser only (localStorage "na-consent") and can be
   changed at any time from the "Cookie settings" link in the footer or on /cookie-policy.html.
   API: window.naConsent.allowed('thirdparty'), .open(), .get(), .onChange(fn) */
(function () {
  'use strict';
  var KEY = 'na-consent', VERSION = 1;
  var listeners = [];
  function read() { try { var v = JSON.parse(localStorage.getItem(KEY)); return v && v.v === VERSION ? v : null; } catch (e) { return null; } }
  function write(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} }
  function purge() { try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('gh:') === 0) localStorage.removeItem(k); }); } catch (e) {} }
  var api = window.naConsent = {
    get: function () { return read(); },
    allowed: function (cat) { var c = read(); return !!(c && c[cat] === true); },
    onChange: function (fn) { listeners.push(fn); },
    open: function () { openDialog(); }
  };
  function save(thirdparty) {
    write({ v: VERSION, t: Date.now(), thirdparty: !!thirdparty });
    if (!thirdparty) purge();                       // withdrawing removes what the optional category stored
    listeners.forEach(function (f) { try { f(read()); } catch (e) {} });
  }

  var css = '#na-cc,#na-cc *{box-sizing:border-box}' +
    '#na-cc{position:fixed;z-index:2147483000;left:16px;right:16px;bottom:16px;max-width:560px;font:14.5px/1.5 Archivo,-apple-system,system-ui,sans-serif;color:#f3f1f8;background:#14121b;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:18px 18px 16px;box-shadow:0 24px 60px -12px rgba(0,0,0,.75)}' +
    '#na-cc h2{font-size:16px;font-weight:650;margin:0 0 6px;letter-spacing:-.01em}' +
    '#na-cc p{margin:0 0 12px;color:#c4bfd1}' +
    '#na-cc a{color:#e2d9ff;text-underline-offset:3px}' +
    '#na-cc .row{display:flex;gap:8px;flex-wrap:wrap}' +
    '#na-cc button{flex:1 1 0;min-width:120px;font:inherit;font-weight:600;color:#f3f1f8;background:#25222f;border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:11px 14px;cursor:pointer}' +
    '#na-cc button:hover{background:#2f2b3b}' +
    '#na-cc button:focus-visible,#na-cc input:focus-visible,#na-cc a:focus-visible{outline:2px solid #cdbfff;outline-offset:2px}' +
    '#na-cc .cat{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;padding:12px 0;border-top:1px solid rgba(255,255,255,.09)}' +
    '#na-cc .cat b{display:block;font-weight:600}' +
    '#na-cc .cat span{display:block;color:#a7a2b5;font-size:13.5px}' +
    '#na-cc .tag{flex:none;color:#a7a2b5;font-size:13px;padding-top:2px}' +
    '#na-cc input[type=checkbox]{flex:none;width:22px;height:22px;margin-top:2px;accent-color:#9b7bff}' +
    '#na-cc .cats{max-height:46vh;overflow:auto;margin-bottom:12px}' +
    '@media (prefers-reduced-motion:no-preference){#na-cc{animation:na-in .25s ease-out}@keyframes na-in{from{opacity:0;transform:translateY(8px)}}}' +
    '@media (max-width:520px){#na-cc{left:8px;right:8px;bottom:8px}#na-cc button{min-width:0}}';
  var st = document.createElement('style'); st.textContent = css;

  var box = null, returnFocus = null;
  function close() { if (box) { box.remove(); box = null; } if (returnFocus && returnFocus.focus) { try { returnFocus.focus(); } catch (e) {} } returnFocus = null; }
  function el(tag, attrs, html) { var e = document.createElement(tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }
  function mount(node) { if (!st.parentNode) document.head.appendChild(st); if (box) box.remove(); box = node; document.body.appendChild(node); }

  function banner() {
    var b = el('div', { id: 'na-cc', role: 'dialog', 'aria-labelledby': 'na-t', 'aria-describedby': 'na-d' });
    b.innerHTML = '<h2 id="na-t">Your privacy choices</h2>' +
      '<p id="na-d">This site has no ads and no tracking. It keeps only what it needs to work in your browser, and to show prices in your currency your connection\'s country is read when you open the pricing page. One optional extra asks GitHub for release info, which shows GitHub your address. It stays off unless you say yes. <a href="cookie-policy.html">Cookie policy</a></p>' +
      '<div class="row"><button type="button" data-a="reject">Reject optional</button><button type="button" data-a="manage">Manage</button><button type="button" data-a="accept">Accept all</button></div>';
    b.addEventListener('click', function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
      if (a === 'manage') { returnFocus = null; openDialog(); return; }
      save(a === 'accept'); close();
    });
    mount(b);
  }

  function openDialog() {
    var c = read() || {}, prev = document.activeElement;
    var d = el('div', { id: 'na-cc', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'na-t' });
    d.innerHTML = '<h2 id="na-t">Cookie and storage settings</h2>' +
      '<div class="cats">' +
      '<div class="cat"><div><b>Strictly necessary</b><span>Remembers this choice, keeps a checkout going on the pricing page, and runs the Cloudflare security check only when you send a message or ask the helper something. Always on.</span></div><span class="tag">Always on</span></div>' +
      '<div class="cat"><div><label for="na-tp"><b>GitHub release info</b></label><span>Asks GitHub for the latest release when this site\'s own copy is unavailable. GitHub sees your IP address. Off until you allow it.</span></div><input id="na-tp" type="checkbox"' + (c.thirdparty ? ' checked' : '') + '></div>' +
      '<div class="cat"><div><b>Analytics</b><span>Not used. This site does not measure visits.</span></div><span class="tag">Not used</span></div>' +
      '<div class="cat"><div><b>Marketing</b><span>Not used. No ads and no advertising trackers.</span></div><span class="tag">Not used</span></div>' +
      '</div>' +
      '<div class="row"><button type="button" data-a="reject">Reject optional</button><button type="button" data-a="save">Save choices</button><button type="button" data-a="accept">Accept all</button></div>' +
      '<p style="margin:12px 0 0"><a href="cookie-policy.html">Read the full cookie policy</a></p>';
    d.addEventListener('click', function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
      var tp = a === 'accept' ? true : a === 'reject' ? false : d.querySelector('#na-tp').checked;
      save(tp); close();
    });
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' && read()) close(); });
    returnFocus = prev;
    mount(d); d.querySelector('button').focus();
  }

  function init() {
    if (!read()) banner();
    // any element marked data-cookie-settings reopens the choices ("Cookie settings" links)
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-cookie-settings]') : null;
      if (t) { e.preventDefault(); openDialog(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
