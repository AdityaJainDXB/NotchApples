/* A small helper on the website that answers simple questions about Notch Apple.
 *
 * It is not a language model: it matches the question against the entries in faq.json (written from this site and the
 * README) and shows the best one, or says it is not sure and points to GitHub. It runs entirely in the page: nothing you
 * type is sent anywhere. Answers are shown as plain text (links are checked first), so nothing in the data can run. */
(function () {
  'use strict';

  var STOP = new Set(('a an the is are was were be been am do does did can could would should will shall may might i you it its my me we our your to of in ' +
    'on for with and or but if at by from as about how what when where why which who this that these those there here please tell show want need get ' +
    'make use using notch apple app notchapple').split(' '));
  // Different words for the same thing, so "buy" finds the price answer and "mac book" finds the Mac one.
  var SYN = { cost: 'price', costs: 'price', pricing: 'price', pay: 'price', paid: 'price', buy: 'price', purchase: 'price', money: 'price', cheap: 'price', expensive: 'price', dollar: 'price',
    licence: 'license', licenses: 'license', licences: 'license', serial: 'license', code: 'license', win: 'windows', pc: 'windows', microsoft: 'windows', macbook: 'mac', macos: 'mac', osx: 'mac',
    crash: 'bug', crashes: 'bug', crashing: 'bug', broken: 'bug', glitch: 'bug', error: 'bug', freeze: 'bug', froze: 'bug', frozen: 'bug', problem: 'bug', issue: 'bug',
    spy: 'privacy', track: 'privacy', tracking: 'privacy', telemetry: 'privacy', analytics: 'privacy', safe: 'privacy', secure: 'privacy', private: 'privacy',
    plane: 'flight', aeroplane: 'flight', airplane: 'flight', aircraft: 'flight', simulator: 'flight', sim: 'flight', pilot: 'flight', jet: 'flight', helicopter: 'flight', heli: 'flight',
    shortcut: 'hotkey', shortcuts: 'hotkey', keybinding: 'hotkey', keys: 'hotkey', key: 'key', delete: 'uninstall', remove: 'uninstall', screenshot: 'capture', snip: 'capture',
    gpt: 'ai', chatgpt: 'ai', llm: 'ai', openai: 'openai', ollama: 'ollama', download: 'install', setup: 'install', installing: 'install', installation: 'install',
    upgrade: 'update', updates: 'update', updating: 'update', idea: 'feature', suggestion: 'feature', suggest: 'feature', request: 'feature', wish: 'feature', hello: 'hi', hey: 'hi' };

  function stem(w) {
    if (w.length > 4 && w.slice(-3) === 'ing') w = w.slice(0, -3);
    else if (w.length > 4 && w.slice(-2) === 'ed') w = w.slice(0, -2);
    else if (w.length > 3 && w.slice(-1) === 's' && w.slice(-2) !== 'ss') w = w.slice(0, -1);
    return w;
  }
  function tokens(text) {
    var out = [];
    String(text).toLowerCase().replace(/[^a-z0-9$ ]+/g, ' ').split(/\s+/).forEach(function (raw) {
      if (!raw || STOP.has(raw)) return;
      var w = SYN[raw] || raw;
      w = SYN[stem(w)] || stem(w);
      if (w && !STOP.has(w)) out.push(w);
    });
    return out;
  }

  /** Builds a matcher over `entries` ({q, a, k, link}). */
  function engine(entries) {
    var docs = entries.map(function (e) {
      var tf = {};
      function add(text, weight) { tokens(text).forEach(function (t) { tf[t] = (tf[t] || 0) + weight; }); }
      add(e.q, 3); add(e.k || '', 3); add(e.a, 1);
      return { e: e, tf: tf };
    });
    var df = {};
    docs.forEach(function (d) { Object.keys(d.tf).forEach(function (t) { df[t] = (df[t] || 0) + 1; }); });
    var N = docs.length;
    var idf = function (t) { return Math.log(1 + N / (df[t] || 0.5)); };
    function rank(query) {
      var qt = tokens(query);
      if (!qt.length) return [];
      var uniq = qt.filter(function (t, i) { return qt.indexOf(t) === i; });
      var scored = docs.map(function (d) {
        var s = 0, hit = 0;
        uniq.forEach(function (t) { if (d.tf[t]) { s += idf(t) * Math.min(d.tf[t], 4); hit++; } });
        return { e: d.e, score: s * (0.6 + 0.4 * hit / uniq.length), hit: hit };
      }).filter(function (x) { return x.hit > 0; });
      scored.sort(function (a, b) { return b.score - a.score; });
      return scored;
    }
    return {
      rank: rank,
      /** {entry, related[]} for a confident match, else {entry:null, related[]}. */
      answer: function (query) {
        var r = rank(query);
        var best = r[0];
        var sure = best && best.score >= 3.2 && (best.hit >= 2 || tokens(query).length <= 2 || best.score >= 6);
        return { entry: sure ? best.e : null, related: r.slice(sure ? 1 : 0, sure ? 3 : 4).map(function (x) { return x.e; }) };
      },
    };
  }

  var GREETING = /^(hi|hello|hey|yo|good (morning|afternoon|evening))\b/i, THANKS = /\b(thanks|thank you|thx|cheers)\b/i;

  /** Only same-site pages and our own GitHub are linked from an answer. */
  function safeHref(h) {
    return /^(#[a-z0-9_-]+|[a-z0-9_-]+\.html|https:\/\/github\.com\/AdityaJainDXB\/NotchApples[\/a-zA-Z0-9_#-]*)$/.test(h) ? h : null;
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { engine: engine, tokens: tokens, safeHref: safeHref }; }
  if (typeof document === 'undefined') return;

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }

  function mount(entries) {
    var eng = engine(entries);
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var fab = el('button', { class: 'nc-fab', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Ask a question about Notch Apple' });
    fab.append(el('span', { 'aria-hidden': 'true' }, '?'), el('span', { class: 'nc-fab-t' }, 'Ask'));
    var panel = el('div', { class: 'nc-panel', role: 'dialog', 'aria-label': 'Ask about Notch Apple', hidden: '' });
    var head = el('div', { class: 'nc-head' });
    head.append(el('strong', null, 'Ask about Notch Apple'));
    var close = el('button', { class: 'nc-x', type: 'button', 'aria-label': 'Close' }, '×');
    head.append(close);
    var log = el('div', { class: 'nc-log', role: 'log', 'aria-live': 'polite' });
    var chips = el('div', { class: 'nc-chips' });
    var form = el('form', { class: 'nc-form', autocomplete: 'off' });
    var input = el('input', { class: 'nc-in', type: 'text', maxlength: '200', placeholder: 'e.g. How much is Pro?', 'aria-label': 'Your question' });
    var send = el('button', { class: 'nc-send', type: 'submit' }, 'Send');
    form.append(input, send);
    var foot = el('div', { class: 'nc-foot' }, 'Answers come from this site and the README. Nothing you type leaves this page.');
    panel.append(head, log, chips, form, foot);
    document.body.append(fab, panel);

    function say(text, who, link) {
      var m = el('div', { class: 'nc-msg nc-' + who });
      m.append(el('p', null, text));
      if (link) { var href = safeHref(link[1]); if (href) { var a = el('a', { href: href }, link[0] + ' →'); if (/^https:/.test(href)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); } m.append(a); } }
      log.append(m); log.scrollTop = log.scrollHeight;
    }
    function setChips(list) {
      chips.textContent = '';
      list.slice(0, 4).forEach(function (e) {
        var b = el('button', { class: 'nc-chip', type: 'button' }, e.q);
        b.addEventListener('click', function () { ask(e.q); });
        chips.append(b);
      });
    }
    var starters = ['Is it really free?', 'How do I install it on a Mac?', 'Does it work on Windows?', 'Is my data private? Does it track me?']
      .map(function (q) { return entries.filter(function (e) { return e.q === q; })[0]; }).filter(Boolean);

    function ask(q) {
      q = String(q || '').trim().slice(0, 200);
      if (!q) return;
      input.focus();   // a chip that was just used is replaced, so keep the keyboard where it can continue
      say(q, 'me');
      if (GREETING.test(q) && tokens(q).length <= 1) { say('Hello! I can answer simple questions about Notch Apple: price, installing, shortcuts, privacy, the flight simulator and more.', 'bot'); setChips(starters); return; }
      if (THANKS.test(q) && tokens(q).length <= 1) { say('You are welcome!', 'bot'); return; }
      var r = eng.answer(q);
      if (r.entry) { say(r.entry.a, 'bot', r.entry.link); setChips(r.related); }
      else {
        say('I am not sure about that one. Try one of these, or ask on GitHub where the developers can answer properly.', 'bot', ['Open an issue', 'https://github.com/AdityaJainDXB/NotchApples/issues']);
        setChips(r.related.length ? r.related : starters);
      }
    }

    var lastFocus = null;
    function open() {
      lastFocus = document.activeElement; panel.hidden = false; fab.setAttribute('aria-expanded', 'true'); fab.classList.add('nc-hide');
      if (!log.children.length) { say('Hi! Ask me a simple question about Notch Apple, or pick one below.', 'bot'); setChips(starters); }
      setTimeout(function () { input.focus(); }, reduce ? 0 : 30);
    }
    function shut() { panel.hidden = true; fab.setAttribute('aria-expanded', 'false'); fab.classList.remove('nc-hide'); var back = lastFocus && lastFocus !== document.body && document.contains(lastFocus) ? lastFocus : fab; back.focus(); }   // (Safari does not focus a button when it is clicked, so fall back to the button)
    fab.addEventListener('click', open);
    close.addEventListener('click', shut);
    // Escape closes it from anywhere while it is open (not only from inside the panel).
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { e.stopPropagation(); shut(); } }, true);
    form.addEventListener('submit', function (e) { e.preventDefault(); var v = input.value; input.value = ''; ask(v); });
    // Hash links to the same page should not hide the answer behind the panel.
    log.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[href^="#"]'); if (a) shut(); });
  }

  function start() {
    fetch('assets/faq.json').then(function (r) { return r.ok ? r.json() : []; }).then(function (data) {
      if (Array.isArray(data) && data.length) mount(data);
    }).catch(function () { /* no helper if the data can't load: the page works the same */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}());
