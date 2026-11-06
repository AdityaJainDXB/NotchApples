// The notch's mascots: six original characters that greet you when you open your laptop, each moving its own way across
// the notch (the bird flies, the apple bounces, the bunny hops, the planet orbits, the cloud drifts, Notchy drops out).
// One plain script shared by the Mac app (a transparent web view over the notch) and the Windows app (a small window at
// the top of the screen). `NotchMascots.play(host, options)` draws everything inside `host`; nothing is sent anywhere.

(function (root) {
  'use strict';

  var LIST = [
    { id: 'notchy', name: 'Notchy', how: 'Drops out of the notch and waves' },
    { id: 'pomo', name: 'Pomo', how: 'Bounces across the notch' },
    { id: 'wisp', name: 'Wisp', how: 'Drifts across, wakes up on the way' },
    { id: 'mochi', name: 'Mochi', how: 'Hops across the notch' },
    { id: 'orbit', name: 'Orbit', how: 'Circles around the notch' },
    { id: 'pip', name: 'Pip', how: 'Flies across the notch' },
  ];
  var IDS = LIST.map(function (m) { return m.id; });

  // Each drawing is centred on 0,0 in a 190 x 210 box.
  var ART = {
    notchy: '<ellipse cx="-66" cy="20" rx="9" ry="14" fill="#17151f" stroke="#7650ee" stroke-width="1.5"/><ellipse class="arm" cx="66" cy="20" rx="9" ry="14" fill="#17151f" stroke="#7650ee" stroke-width="1.5"/><ellipse cx="-24" cy="82" rx="15" ry="6" fill="#7650ee"/><ellipse cx="24" cy="82" rx="15" ry="6" fill="#7650ee"/><path d="M-58 -65 H58 V25 Q58 78 8 78 H-8 Q-58 78 -58 25 Z" fill="#17151f" stroke="#7650ee" stroke-width="2"/><path d="M40 -61 V25 Q40 62 14 74 Q58 70 58 25 V-61 Z" fill="#2a2440"/><rect x="-58" y="-69" width="116" height="8" fill="#7650ee"/><g class="blink"><circle cx="-24" cy="-8" r="16" fill="#fff"/><circle cx="24" cy="-8" r="16" fill="#fff"/><circle cx="-21" cy="-5" r="8" fill="#7650ee"/><circle cx="27" cy="-5" r="8" fill="#7650ee"/><circle cx="-18" cy="-9" r="3" fill="#fff"/><circle cx="30" cy="-9" r="3" fill="#fff"/></g><circle cx="-42" cy="22" r="7" fill="#ff8aa8" opacity=".5"/><circle cx="42" cy="22" r="7" fill="#ff8aa8" opacity=".5"/><path d="M-12 24 Q0 38 12 24" fill="none" stroke="#cdbfff" stroke-width="3" stroke-linecap="round"/><path class="leaf" d="M0 -69 Q8 -98 36 -96 Q32 -70 0 -69 Z" fill="#6ee7a8" stroke="#2f9e6b" stroke-width="1.5"/>',
    pomo: '<path d="M0 -48 C-20 -70 -66 -62 -66 -12 C-66 38 -34 74 -12 74 C-6 74 -4 70 0 70 C4 70 6 74 12 74 C34 74 66 38 66 -12 C66 -62 20 -70 0 -48 Z" fill="#ff8aa8" stroke="#c4476b" stroke-width="2"/><path d="M30 -52 C58 -40 62 -10 54 20 C46 48 28 66 12 72 C40 70 66 38 66 -12 C66 -34 52 -50 30 -52 Z" fill="#f0678d"/><ellipse cx="-40" cy="-24" rx="8" ry="15" transform="rotate(-20 -40 -24)" fill="#fff" opacity=".5"/><path d="M0 -48 Q-2 -64 6 -72" fill="none" stroke="#8a5a3c" stroke-width="5" stroke-linecap="round"/><path class="leaf" d="M6 -66 Q22 -88 46 -80 Q38 -58 6 -66 Z" fill="#6ee7a8" stroke="#2f9e6b" stroke-width="1.5"/><g class="blink"><circle cx="-22" cy="-6" r="8" fill="#2b1620"/><circle cx="22" cy="-6" r="8" fill="#2b1620"/><circle cx="-19" cy="-9" r="2.5" fill="#fff"/><circle cx="25" cy="-9" r="2.5" fill="#fff"/></g><circle cx="-40" cy="14" r="9" fill="#ff5d85" opacity=".5"/><circle cx="40" cy="14" r="9" fill="#ff5d85" opacity=".5"/><path d="M-11 14 Q0 32 11 14 Z" fill="#7a2038"/><ellipse cx="0" cy="23" rx="5" ry="3" fill="#ff8aa8"/>',
    wisp: '<path d="M-60 15 Q-60 -55 0 -55 Q60 -55 60 15 V42 Q50 58 40 42 Q30 58 20 42 Q10 58 0 42 Q-10 58 -20 42 Q-30 58 -40 42 Q-50 58 -60 42 Z" fill="#cdbfff" stroke="#7650ee" stroke-width="2"/><ellipse cx="0" cy="-8" rx="46" ry="36" fill="#ddd2ff"/><path d="M-40 -30 Q-22 -46 -2 -44" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".8"/><g class="shut"><path d="M-30 -2 Q-22 -10 -14 -2" fill="none" stroke="#2c2350" stroke-width="3.5" stroke-linecap="round"/><path d="M14 -2 Q22 -10 30 -2" fill="none" stroke="#2c2350" stroke-width="3.5" stroke-linecap="round"/></g><g class="eyes" opacity="0"><circle cx="-22" cy="-4" r="8" fill="#2c2350"/><circle cx="22" cy="-4" r="8" fill="#2c2350"/><circle cx="-19" cy="-7" r="2.5" fill="#fff"/><circle cx="25" cy="-7" r="2.5" fill="#fff"/></g><circle cx="-38" cy="12" r="7" fill="#ff8aa8" opacity=".5"/><circle cx="38" cy="12" r="7" fill="#ff8aa8" opacity=".5"/><ellipse cx="0" cy="14" rx="6" ry="4" fill="#2c2350"/><path class="spark" d="M70 -52 L74 -40 L86 -36 L74 -32 L70 -20 L66 -32 L54 -36 L66 -40 Z" fill="#ffd28a"/><path class="spark" d="M-72 -30 L-69 -22 L-61 -19 L-69 -16 L-72 -8 L-75 -16 L-83 -19 L-75 -22 Z" fill="#ffd28a"/>',
    mochi: '<ellipse class="ear" cx="-24" cy="-62" rx="12" ry="28" fill="#fff" stroke="#9aa0b5" stroke-width="2"/><ellipse class="ear" cx="24" cy="-62" rx="12" ry="28" fill="#fff" stroke="#9aa0b5" stroke-width="2"/><ellipse cx="-24" cy="-60" rx="6" ry="17" fill="#ffb7cb"/><ellipse cx="24" cy="-60" rx="6" ry="17" fill="#ffb7cb"/><ellipse cx="0" cy="10" rx="62" ry="56" fill="#fff" stroke="#9aa0b5" stroke-width="2"/><path d="M-50 36 Q0 78 50 36 Q40 64 0 66 Q-40 64 -50 36 Z" fill="#e9ecf5"/><path d="M-18 -46 H18 V-40 Q18 -32 10 -32 H-10 Q-18 -32 -18 -40 Z" fill="#17151f" stroke="#7650ee" stroke-width="1.5"/><rect x="-18" y="-48" width="36" height="4" fill="#7650ee"/><g class="blink"><circle cx="-20" cy="6" r="6" fill="#2b2b3a"/><circle cx="20" cy="6" r="6" fill="#2b2b3a"/><circle cx="-18" cy="4" r="2" fill="#fff"/><circle cx="22" cy="4" r="2" fill="#fff"/></g><circle cx="-38" cy="22" r="8" fill="#ffb7cb" opacity=".8"/><circle cx="38" cy="22" r="8" fill="#ffb7cb" opacity=".8"/><path d="M-8 20 Q-4 27 0 20 Q4 27 8 20" fill="none" stroke="#2b2b3a" stroke-width="2.5" stroke-linecap="round"/>',
    orbit: '<g transform="rotate(-18)"><path d="M-80 0 A80 18 0 0 1 80 0" fill="none" stroke="#7650ee" stroke-width="7" stroke-linecap="round"/></g><line x1="0" y1="-50" x2="0" y2="-70" stroke="#1f8ea3" stroke-width="3"/><circle class="ant" cx="0" cy="-76" r="7" fill="#ffd28a" stroke="#c28a1a" stroke-width="1.5"/><circle cx="0" cy="0" r="52" fill="#5ad1e6" stroke="#1f8ea3" stroke-width="2"/><path d="M26 -45 A52 52 0 0 1 26 45 A38 52 0 0 0 26 -45 Z" fill="#3fb9cf"/><circle cx="-30" cy="22" r="6" fill="#3fb9cf"/><circle cx="-14" cy="34" r="4" fill="#3fb9cf"/><path d="M-38 -26 Q-28 -40 -12 -42" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".6"/><g class="blink"><circle cx="-18" cy="-6" r="8" fill="#12323a"/><circle cx="18" cy="-6" r="8" fill="#12323a"/><circle cx="-15" cy="-9" r="2.5" fill="#fff"/><circle cx="21" cy="-9" r="2.5" fill="#fff"/></g><path d="M-10 14 Q0 24 10 14" fill="none" stroke="#12323a" stroke-width="3" stroke-linecap="round"/><g transform="rotate(-18)"><path d="M-80 0 A80 18 0 0 0 80 0" fill="none" stroke="#7650ee" stroke-width="7" stroke-linecap="round"/></g>',
    pip: '<g class="tuft"><path d="M-6 -52 Q-14 -76 -26 -74 Q-22 -58 -6 -52 Z" fill="#ff9a76" stroke="#c25a3a" stroke-width="1.5"/><path d="M0 -54 Q0 -82 8 -84 Q12 -66 4 -54 Z" fill="#ff9a76" stroke="#c25a3a" stroke-width="1.5"/><path d="M8 -52 Q18 -72 30 -68 Q26 -54 8 -52 Z" fill="#ff9a76" stroke="#c25a3a" stroke-width="1.5"/></g><ellipse class="wl" cx="-58" cy="10" rx="10" ry="22" fill="#f0805c" stroke="#c25a3a" stroke-width="1.5"/><ellipse class="wr" cx="58" cy="10" rx="10" ry="22" fill="#f0805c" stroke="#c25a3a" stroke-width="1.5"/><circle cx="0" cy="0" r="56" fill="#ff9a76" stroke="#c25a3a" stroke-width="2"/><path d="M30 -46 A56 56 0 0 1 30 46 A40 56 0 0 0 30 -46 Z" fill="#f0805c"/><ellipse cx="0" cy="20" rx="36" ry="30" fill="#ffd9c4"/><g class="blink"><circle cx="-22" cy="-10" r="8" fill="#2b1a14"/><circle cx="22" cy="-10" r="8" fill="#2b1a14"/><circle cx="-19" cy="-13" r="2.5" fill="#fff"/><circle cx="25" cy="-13" r="2.5" fill="#fff"/></g><circle cx="-40" cy="8" r="8" fill="#ff5d85" opacity=".45"/><circle cx="40" cy="8" r="8" fill="#ff5d85" opacity=".45"/><path d="M-9 4 L9 4 L0 18 Z" fill="#ffcf5a" stroke="#c28a1a" stroke-width="1.5" stroke-linejoin="round"/>',
  };

  var SIZE = 70;   // how big a mascot is on screen, in px

  function svg(id) {
    return '<svg viewBox="-95 -105 190 210" width="' + SIZE + '" height="' + SIZE * 210 / 190 + '" style="display:block;overflow:visible">' + (ART[id] || ART.notchy) + '</svg>';
  }

  function path(n, f) {
    var out = [];
    for (var i = 0; i <= n; i++) out.push(f(i / n));
    return out;
  }

  // Where each mascot goes. `w` is the width of the open notch, `top` the first free pixel under the notch itself.
  // Returns { ms, frames } for the whole mascot (transform keyframes, offsets spread evenly) and optional `extra(el)`.
  var MOTION = {
    pip: function (w, top) {
      return { ms: 3600, frames: path(48, function (t) {
        var x = -90 + (w + 180) * t, y = top + 14 + 20 * Math.sin(t * Math.PI * 3.2), tilt = 14 * Math.cos(t * Math.PI * 3.2);
        return 'translate(' + x + 'px,' + y + 'px) rotate(' + tilt + 'deg)';
      }), extra: function (el) {
        each(el, '.wl', function (n) { spin(n, '100% 0', 32, 120); });
        each(el, '.wr', function (n) { spin(n, '0 0', -32, 120); });
        each(el, '.tuft', function (n) { spin(n, '50% 100%', -14, 220); });
      } };
    },
    pomo: function (w, top) {
      var stop = w / 2 - SIZE / 2;
      return { ms: 3800, frames: path(60, function (t) {
        var run = Math.min(t / 0.62, 1), x = -90 + (stop + 90) * run;
        var y = top + 8 - (t < 0.62 ? Math.abs(Math.sin(run * Math.PI * 3)) * 46 * (1 - run * 0.4) : 0);
        var wob = t < 0.62 ? 0 : 7 * Math.sin((t - 0.62) * 38);
        return 'translate(' + x + 'px,' + y + 'px) rotate(' + wob + 'deg)';
      }), extra: function (el) { each(el, '.leaf', function (n) { spin(n, '0 100%', 360, 700, 1, 2300); }); } };
    },
    wisp: function (w, top) {
      return { ms: 4600, frames: path(48, function (t) {
        var e = t * t * (3 - 2 * t), x = -90 + (w + 180) * e, y = top + 6 + 12 * Math.sin(t * Math.PI * 4);
        return 'translate(' + x + 'px,' + y + 'px)';
      }), extra: function (el) {
        each(el, '.shut', function (n) { n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 1500, fill: 'forwards' }); });
        each(el, '.eyes', function (n) { n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 1500, fill: 'forwards' }); });
        each(el, '.spark', function (n, i) { n.style.transformBox = 'fill-box'; n.style.transformOrigin = '50% 50%'; n.animate([{ transform: 'scale(.4)', opacity: .5 }, { transform: 'scale(1.25)', opacity: 1 }, { transform: 'scale(.4)', opacity: .5 }], { duration: 900, delay: i * 350, iterations: Infinity }); });
      } };
    },
    mochi: function (w, top) {
      return { ms: 3800, frames: path(72, function (t) {
        var x = -90 + (w + 180) * t, hop = Math.abs(Math.sin(t * Math.PI * 6)), y = top + 8 - hop * 40, sq = 1 - 0.1 * (1 - hop);
        return 'translate(' + x + 'px,' + y + 'px) scale(' + (2 - sq) + ',' + sq + ')';
      }), extra: function (el) { each(el, '.ear', function (n) { spin(n, '50% 100%', 10, 300); }); } };
    },
    orbit: function (w, top) {
      var cx = w / 2 - SIZE / 2, rx = Math.min(w / 2 - SIZE / 2 + 20, 190), ry = 26;
      return { ms: 3800, frames: path(72, function (t) {
        var a = Math.PI + t * Math.PI * 2, settle = t > 0.8 ? (t - 0.8) / 0.2 : 0, k = 1 - settle;
        var x = cx + rx * Math.cos(a) * k, y = top + 8 + ry * Math.sin(a) * k;
        return 'translate(' + x + 'px,' + y + 'px)';
      }), extra: function (el) { each(el, '.ant', function (n) { n.animate([{ opacity: 1 }, { opacity: .2 }, { opacity: 1 }], { duration: 500, iterations: Infinity }); }); } };
    },
    notchy: function (w, top) {
      var cx = w / 2 - SIZE / 2;
      return { ms: 3800, frames: path(40, function (t) {
        var drop = t < 0.22 ? t / 0.22 : t > 0.86 ? 1 - (t - 0.86) / 0.14 : 1, e = drop < 1 ? drop * drop * (3 - 2 * drop) : 1;
        var over = t < 0.22 ? Math.sin(drop * Math.PI) * 8 : 0;
        return 'translate(' + cx + 'px,' + (-SIZE - 20 + (top + 8 + SIZE + 20) * e + over) + 'px)';
      }), extra: function (el) {
        each(el, '.arm', function (n) { spin(n, '50% 0', -60, 300, 5, 900); });
        each(el, '.leaf', function (n) { spin(n, '0 100%', 14, 500); });
      } };
    },
  };

  function each(el, sel, fn) { var n = el.querySelectorAll(sel); for (var i = 0; i < n.length; i++) fn(n[i], i); }
  function spin(n, origin, deg, ms, times, delay) {
    n.style.transformBox = 'fill-box'; n.style.transformOrigin = origin;
    n.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(' + deg + 'deg)' }, { transform: 'rotate(0deg)' }],
      { duration: ms, iterations: times || Infinity, delay: delay || 0, easing: 'ease-in-out' });
  }
  function blinkAll(el) {
    each(el, '.blink', function (n) {
      n.style.transformBox = 'fill-box'; n.style.transformOrigin = '50% 50%';
      n.animate([{ transform: 'scaleY(1)', offset: 0 }, { transform: 'scaleY(1)', offset: .9 }, { transform: 'scaleY(.1)', offset: .95 }, { transform: 'scaleY(1)', offset: 1 }], { duration: 1800, delay: 700, iterations: Infinity });
    });
  }

  // The Mac's own handwritten "hello" (two strokes of an SVG path, 638 x 200), drawn bit by bit.
  var HELLO_H1 = 'M8.69214 166.553C36.2393 151.239 61.3409 131.548 89.8191 98.0295C109.203 75.1488 119.625 49.0228 120.122 31.0026C120.37 17.6036 113.836 7.43883 101.759 7.43883C88.3598 7.43883 79.9231 17.6036 74.7122 40.9363C69.005 66.5793 64.7866 96.0036 54.1166 190.356';
  var HELLO_H2 = 'M55.1624 181.135C60.6251 133.114 81.4118 98.0479 107.963 98.0479C123.844 98.0479 133.937 110.703 131.071 128.817C129.457 139.487 127.587 150.405 125.408 163.06C122.869 178.941 130.128 191.348 152.122 191.348C184.197 191.348 219.189 173.523 237.097 145.915C243.198 136.509 245.68 128.073 245.928 119.884C246.176 104.996 237.739 93.8296 222.851 93.8296C203.992 93.8296 189.6 115.17 189.6 142.465C189.6 171.745 205.481 192.341 239.208 192.341C285.066 192.341 335.86 137.292 359.199 75.8585C365.788 58.513 368.26 42.4065 368.26 31.1512C368.26 17.8057 364.042 7.55823 352.131 7.55823C340.469 7.55823 332.777 16.6141 325.829 30.9129C317.688 47.4967 311.667 71.4162 309.203 98.4549C303 166.301 316.896 191.348 349.936 191.348C390 191.348 434.542 135.534 457.286 75.6686C463.803 58.513 466.275 42.4065 466.275 31.1512C466.275 17.8057 462.057 7.55823 450.146 7.55823C438.484 7.55823 430.792 16.6141 423.844 30.9129C415.703 47.4967 409.682 71.4162 407.218 98.4549C401.015 166.301 414.911 191.348 444.416 191.348C473.874 191.348 489.877 165.67 499.471 138.402C508.955 111.447 520.618 94.8221 544.935 94.8221C565.035 94.8221 580.916 109.71 580.916 137.75C580.916 168.768 560.792 192.093 535.362 192.341C512.984 192.589 498.285 174.475 499.774 147.179C501.511 116.907 519.873 94.8221 543.943 94.8221C557.839 94.8221 569.51 100.999 578.682 107.725C603.549 125.866 622.709 114.656 630.047 96.7186';

  /// The handwriting version of the greeting, in the same open notch: "hello" is written out in shifting colours, then your name.
  function hello(host, o) {
    var w = o.width || 420, nh = o.notchHeight || 32, h = o.height || nh + 112, done = false;
    host.innerHTML = '';
    host.style.cssText += ';position:relative;overflow:hidden;width:' + w + 'px;height:' + h + 'px;';
    if (!host.animate) { if (o.onDone) o.onDone(); return { stop: function () {} }; }
    var bg = document.createElement('div');
    bg.style.cssText = 'position:absolute;top:0;left:50%;background:#000;border-radius:0 0 26px 26px;width:180px;height:' + nh + 'px;transform:translateX(-50%)';
    var sw = Math.round(w * 0.58), sh = Math.round(sw * 200 / 638);
    var box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:50%;top:' + (nh + 6) + 'px;width:' + sw + 'px;height:' + sh + 'px;transform:translateX(-50%);opacity:0';
    var stroke = 'fill="none" stroke="url(#hi)" stroke-width="14.89" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"';
    box.innerHTML = '<svg viewBox="0 0 638 200" width="' + sw + '" height="' + sh + '"><defs><linearGradient id="hi" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="638" y2="0"><stop offset="0" stop-color="#5cc7ff"/><stop offset=".33" stop-color="#bf80ff"/><stop offset=".66" stop-color="#ff739e"/><stop offset="1" stop-color="#ffbd4d"/></linearGradient></defs><path class="h1" d="' + HELLO_H1 + '" ' + stroke + '/><path class="h2" d="' + HELLO_H2 + '" ' + stroke + '/></svg>';
    var msg = document.createElement('div');
    msg.textContent = String(o.name || '').trim();
    msg.style.cssText = 'position:absolute;left:0;right:0;bottom:12px;text-align:center;color:rgba(255,255,255,.92);font:600 14px ui-rounded,"SF Pro Rounded",system-ui,"Segoe UI",sans-serif;opacity:0';
    host.appendChild(bg); host.appendChild(box); host.appendChild(msg);
    var grow = bg.animate([{ width: '180px', height: nh + 'px' }, { width: w + 'px', height: h + 'px' }], { duration: 500, easing: 'cubic-bezier(.2,.9,.25,1.05)', fill: 'forwards' });
    box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 200, fill: 'forwards' });
    box.querySelector('.h1').animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 800, delay: 300, easing: 'ease-in-out', fill: 'both' });
    box.querySelector('.h2').animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 2800, delay: 1000, easing: 'ease-in-out', fill: 'both' });
    msg.animate([{ opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 500, delay: 3600, fill: 'forwards' });
    var t1 = setTimeout(function () {
      msg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
      box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
      bg.animate([{ width: w + 'px', height: h + 'px' }, { width: '180px', height: nh + 'px' }], { duration: 450, easing: 'ease-in-out', fill: 'forwards' });
    }, 5200);
    var t2 = setTimeout(finish, 5750);
    function finish() { if (done) return; done = true; if (o.onDone) o.onDone(); }
    return { stop: function () { clearTimeout(t1); clearTimeout(t2); grow.cancel(); finish(); } };
  }

  function greeting(name) { name = String(name || '').trim(); return name ? 'Hello, ' + name + '!' : 'Hello!'; }

  /// Draws the open notch in `host` and plays the mascot across it. options: { id, name, notchHeight, width, height, onDone }.
  /// Returns { stop() }. Without the Web Animations API (very old web views) it just calls onDone.
  function play(host, options) {
    var o = options || {};
    if (o.id === 'hello') return hello(host, o);
    var id = IDS.indexOf(o.id) >= 0 ? o.id : 'notchy';
    var w = o.width || 420, nh = o.notchHeight || 32, h = o.height || nh + 112, top = nh + 6, done = false;
    host.innerHTML = '';
    host.style.cssText += ';position:relative;overflow:hidden;width:' + w + 'px;height:' + h + 'px;';
    if (!host.animate) { if (o.onDone) o.onDone(); return { stop: function () {} }; }
    var bg = document.createElement('div');
    bg.style.cssText = 'position:absolute;top:0;left:50%;background:#000;border-radius:0 0 26px 26px;width:180px;height:' + nh + 'px;transform:translateX(-50%)';
    var m = document.createElement('div');
    m.style.cssText = 'position:absolute;left:0;top:0;opacity:0;will-change:transform';
    m.innerHTML = svg(id);
    var msg = document.createElement('div');
    msg.textContent = greeting(o.name);
    msg.style.cssText = 'position:absolute;left:0;right:0;bottom:12px;text-align:center;color:rgba(255,255,255,.92);font:600 14px ui-rounded,"SF Pro Rounded",system-ui,"Segoe UI",sans-serif;opacity:0';
    host.appendChild(bg); host.appendChild(m); host.appendChild(msg);

    var grow = bg.animate([{ width: '180px', height: nh + 'px' }, { width: w + 'px', height: h + 'px' }], { duration: 500, easing: 'cubic-bezier(.2,.9,.25,1.05)', fill: 'forwards' });
    var mv = MOTION[id](w, top), ms = mv.ms;
    var frames = mv.frames.map(function (t, i, a) { return { transform: t, opacity: 1, offset: i / (a.length - 1) }; });
    var run = m.animate(frames, { duration: ms, delay: 450, easing: 'linear', fill: 'both' });
    m.style.opacity = 1;
    if (mv.extra) mv.extra(m);
    blinkAll(m);
    msg.animate([{ opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 600, delay: 900, fill: 'forwards' });
    var end = 450 + ms;
    var t1 = setTimeout(function () {
      msg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
      bg.animate([{ width: w + 'px', height: h + 'px' }, { width: '180px', height: nh + 'px' }], { duration: 450, easing: 'ease-in-out', fill: 'forwards' });
      m.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: 'forwards' });
    }, end);
    var t2 = setTimeout(finish, end + 520);
    function finish() { if (done) return; done = true; if (o.onDone) o.onDone(); }
    return { stop: function () { clearTimeout(t1); clearTimeout(t2); grow.cancel(); run.cancel(); finish(); } };
  }

  var api = { list: LIST, ids: IDS, helloPath: [HELLO_H1, HELLO_H2], svg: svg, greeting: greeting, play: play, size: SIZE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchMascots = api;
})(typeof window !== 'undefined' ? window : globalThis);
