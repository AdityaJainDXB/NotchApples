/* Instagram button: a pill at the bottom right (the Ask button is at the bottom left). It opens a small menu with the profile and a direct message.
   Plain links only: nothing is loaded from Instagram until someone clicks one. */
(function () {
  'use strict';
  var PROFILE = 'https://www.instagram.com/notchapples/', DM = 'https://ig.me/m/notchapples';
  var css = '.na-ig{position:fixed;right:max(16px,env(safe-area-inset-right));z-index:56;font:600 14px/1 Archivo,-apple-system,system-ui,sans-serif}' +
    '.na-ig-b{display:flex;align-items:center;gap:8px;height:44px;padding:0 16px 0 8px;border:0;border-radius:10px;background:#fff;color:#14121b;font:inherit;cursor:pointer;box-shadow:0 8px 24px -8px rgba(0,0,0,.6)}' +
    '.na-ig-b>span:first-child{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#f9a03f,#e1306c 55%,#7a3fd1);color:#fff}' +
    '.na-ig-b svg{width:16px;height:16px}' +
    '.na-ig-m{position:absolute;right:0;bottom:54px;min-width:210px;padding:6px;border-radius:8px;background:#14121b;border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 44px -10px rgba(0,0,0,.75)}' +
    '.na-ig-m[hidden]{display:none}' +
    '.na-ig-m a{display:block;padding:11px 12px;border-radius:9px;color:#f3f1f8;text-decoration:none;font-weight:550}' +
    '.na-ig-m a small{display:block;margin-top:3px;color:#a7a2b5;font-weight:400;font-size:12.5px}' +
    '.na-ig-m a:hover{background:rgba(255,255,255,.08)}' +
    '.na-ig button:focus-visible,.na-ig a:focus-visible{outline:2px solid #cdbfff;outline-offset:2px}' +
    '@media (max-width:480px){.na-ig-t{display:none}.na-ig-b{padding:0 8px}}';
  function init() {
    if (document.getElementById('na-ig')) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var w = document.createElement('div'); w.className = 'na-ig'; w.id = 'na-ig';
    w.style.bottom = document.getElementById('toTop') ? 'max(72px,calc(env(safe-area-inset-bottom) + 60px))' : 'max(16px,env(safe-area-inset-bottom))';
    w.innerHTML = '<div class="na-ig-m" id="na-ig-m" hidden>' +
      '<a href="' + PROFILE + '" target="_blank" rel="noopener">Open our profile<small>@notchapples on Instagram</small></a>' +
      '<a href="' + DM + '" target="_blank" rel="noopener">Send us a message<small>Opens a direct message</small></a></div>' +
      '<button type="button" class="na-ig-b" aria-haspopup="true" aria-expanded="false" aria-controls="na-ig-m" aria-label="Notch Apple on Instagram">' +
      '<span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor"/></svg></span><span class="na-ig-t">Instagram</span></button>';
    document.body.appendChild(w);
    var b = w.querySelector('.na-ig-b'), m = w.querySelector('#na-ig-m');
    function set(open) { m.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    b.addEventListener('click', function () { set(m.hidden); });
    document.addEventListener('click', function (e) { if (!w.contains(e.target)) set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !m.hidden) { set(false); b.focus(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
