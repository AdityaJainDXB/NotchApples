// The notch's mascots: original characters that greet you when you open your laptop, and F1 cars in your favourite team's livery, each moving its own way across
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
    { id: 'f1lights', name: 'F1: Lights out', how: 'Five start lights, then your team\u2019s car launches' },
    { id: 'f1lap', name: 'F1: Flying lap', how: 'Your team\u2019s car streaks across the notch' },
    { id: 'f1pit', name: 'F1: Pit stop', how: 'Your team\u2019s car pits for fresh tyres' },
  ];
  var IDS = LIST.map(function (m) { return m.id; });

  // Each drawing is centred on 0,0 in a 190 x 210 box.
  var ART = {
    notchy: '<ellipse cx="-24" cy="84" rx="14" ry="6" fill="#cfd3e2"/><ellipse cx="24" cy="84" rx="14" ry="6" fill="#cfd3e2"/><ellipse cx="-66" cy="18" rx="9" ry="14" fill="#eceef6" stroke="#9aa0b5" stroke-width="1.5"/><ellipse class="arm" cx="66" cy="18" rx="9" ry="14" fill="#eceef6" stroke="#9aa0b5" stroke-width="1.5"/><rect x="-60" y="-64" width="120" height="134" rx="24" fill="#eceef6" stroke="#9aa0b5" stroke-width="2"/><path d="M40 -60 H36 Q58 -56 58 -34 V50 Q58 66 44 68 Q60 62 60 40 V-34 Q60 -56 40 -60 Z" fill="#d2d6e6"/><rect x="-49" y="-53" width="98" height="108" rx="15" fill="#17151f"/><path d="M-20 -53 H20 V-45 Q20 -37 12 -37 H-12 Q-20 -37 -20 -45 Z" fill="#000"/><circle cx="0" cy="-46" r="2.2" fill="#3a3548"/><g class="blink"><ellipse cx="-20" cy="-6" rx="8" ry="11" fill="#7ee7ff"/><ellipse cx="20" cy="-6" rx="8" ry="11" fill="#7ee7ff"/><circle cx="-17" cy="-10" r="3" fill="#fff"/><circle cx="23" cy="-10" r="3" fill="#fff"/></g><circle cx="-34" cy="20" r="6" fill="#ff8aa8" opacity=".65"/><circle cx="34" cy="20" r="6" fill="#ff8aa8" opacity=".65"/><path d="M-12 24 Q0 38 12 24" fill="none" stroke="#7ee7ff" stroke-width="3.5" stroke-linecap="round"/><circle cx="0" cy="62" r="3" fill="#b9a6ff"/><path class="leaf" d="M30 -64 Q38 -92 64 -90 Q60 -66 30 -64 Z" fill="#6ee7a8" stroke="#2f9e6b" stroke-width="1.5"/>',
    pomo: '<path d="M0 -48 C-20 -70 -66 -62 -66 -12 C-66 38 -34 74 -12 74 C-6 74 -4 70 0 70 C4 70 6 74 12 74 C34 74 66 38 66 -12 C66 -62 20 -70 0 -48 Z" fill="#ff8aa8" stroke="#c4476b" stroke-width="2"/><path d="M30 -52 C58 -40 62 -10 54 20 C46 48 28 66 12 72 C40 70 66 38 66 -12 C66 -34 52 -50 30 -52 Z" fill="#f0678d"/><ellipse cx="-40" cy="-24" rx="8" ry="15" transform="rotate(-20 -40 -24)" fill="#fff" opacity=".5"/><path d="M0 -48 Q-2 -64 6 -72" fill="none" stroke="#8a5a3c" stroke-width="5" stroke-linecap="round"/><path class="leaf" d="M6 -66 Q22 -88 46 -80 Q38 -58 6 -66 Z" fill="#6ee7a8" stroke="#2f9e6b" stroke-width="1.5"/><g class="blink"><circle cx="-22" cy="-6" r="8" fill="#2b1620"/><circle cx="22" cy="-6" r="8" fill="#2b1620"/><circle cx="-19" cy="-9" r="2.5" fill="#fff"/><circle cx="25" cy="-9" r="2.5" fill="#fff"/></g><circle cx="-40" cy="14" r="9" fill="#ff5d85" opacity=".5"/><circle cx="40" cy="14" r="9" fill="#ff5d85" opacity=".5"/><path d="M-11 14 Q0 32 11 14 Z" fill="#7a2038"/><ellipse cx="0" cy="23" rx="5" ry="3" fill="#ff8aa8"/>',
    wisp: '<path d="M-60 15 Q-60 -55 0 -55 Q60 -55 60 15 V42 Q50 58 40 42 Q30 58 20 42 Q10 58 0 42 Q-10 58 -20 42 Q-30 58 -40 42 Q-50 58 -60 42 Z" fill="#cdbfff" stroke="#7650ee" stroke-width="2"/><ellipse cx="0" cy="-8" rx="46" ry="36" fill="#ddd2ff"/><path d="M-40 -30 Q-22 -46 -2 -44" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".8"/><g class="shut"><path d="M-30 -2 Q-22 -10 -14 -2" fill="none" stroke="#2c2350" stroke-width="3.5" stroke-linecap="round"/><path d="M14 -2 Q22 -10 30 -2" fill="none" stroke="#2c2350" stroke-width="3.5" stroke-linecap="round"/></g><g class="eyes" opacity="0"><circle cx="-22" cy="-4" r="8" fill="#2c2350"/><circle cx="22" cy="-4" r="8" fill="#2c2350"/><circle cx="-19" cy="-7" r="2.5" fill="#fff"/><circle cx="25" cy="-7" r="2.5" fill="#fff"/></g><circle cx="-38" cy="12" r="7" fill="#ff8aa8" opacity=".5"/><circle cx="38" cy="12" r="7" fill="#ff8aa8" opacity=".5"/><ellipse cx="0" cy="14" rx="6" ry="4" fill="#2c2350"/><path class="spark" d="M70 -52 L74 -40 L86 -36 L74 -32 L70 -20 L66 -32 L54 -36 L66 -40 Z" fill="#ffd28a"/><path class="spark" d="M-72 -30 L-69 -22 L-61 -19 L-69 -16 L-72 -8 L-75 -16 L-83 -19 L-75 -22 Z" fill="#ffd28a"/>',
    mochi: '<ellipse class="ear" cx="-24" cy="-62" rx="12" ry="28" fill="#fff" stroke="#9aa0b5" stroke-width="2"/><ellipse class="ear" cx="24" cy="-62" rx="12" ry="28" fill="#fff" stroke="#9aa0b5" stroke-width="2"/><ellipse cx="-24" cy="-60" rx="6" ry="17" fill="#ffb7cb"/><ellipse cx="24" cy="-60" rx="6" ry="17" fill="#ffb7cb"/><ellipse cx="0" cy="10" rx="62" ry="56" fill="#fff" stroke="#9aa0b5" stroke-width="2"/><path d="M-50 36 Q0 78 50 36 Q40 64 0 66 Q-40 64 -50 36 Z" fill="#e9ecf5"/><path d="M-18 -46 H18 V-40 Q18 -32 10 -32 H-10 Q-18 -32 -18 -40 Z" fill="#17151f" stroke="#7650ee" stroke-width="1.5"/><rect x="-18" y="-48" width="36" height="4" fill="#7650ee"/><g class="blink"><circle cx="-20" cy="6" r="6" fill="#2b2b3a"/><circle cx="20" cy="6" r="6" fill="#2b2b3a"/><circle cx="-18" cy="4" r="2" fill="#fff"/><circle cx="22" cy="4" r="2" fill="#fff"/></g><circle cx="-38" cy="22" r="8" fill="#ffb7cb" opacity=".8"/><circle cx="38" cy="22" r="8" fill="#ffb7cb" opacity=".8"/><path d="M-8 20 Q-4 27 0 20 Q4 27 8 20" fill="none" stroke="#2b2b3a" stroke-width="2.5" stroke-linecap="round"/>',
    orbit: '<g transform="rotate(-18)"><path d="M-80 0 A80 18 0 0 1 80 0" fill="none" stroke="#7650ee" stroke-width="7" stroke-linecap="round"/></g><line x1="0" y1="-50" x2="0" y2="-70" stroke="#1f8ea3" stroke-width="3"/><circle class="ant" cx="0" cy="-76" r="7" fill="#ffd28a" stroke="#c28a1a" stroke-width="1.5"/><circle cx="0" cy="0" r="52" fill="#5ad1e6" stroke="#1f8ea3" stroke-width="2"/><path d="M26 -45 A52 52 0 0 1 26 45 A38 52 0 0 0 26 -45 Z" fill="#3fb9cf"/><circle cx="-30" cy="22" r="6" fill="#3fb9cf"/><circle cx="-14" cy="34" r="4" fill="#3fb9cf"/><path d="M-38 -26 Q-28 -40 -12 -42" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".6"/><g class="blink"><circle cx="-18" cy="-6" r="8" fill="#12323a"/><circle cx="18" cy="-6" r="8" fill="#12323a"/><circle cx="-15" cy="-9" r="2.5" fill="#fff"/><circle cx="21" cy="-9" r="2.5" fill="#fff"/></g><path d="M-10 14 Q0 24 10 14" fill="none" stroke="#12323a" stroke-width="3" stroke-linecap="round"/><g transform="rotate(-18)"><path d="M-80 0 A80 18 0 0 0 80 0" fill="none" stroke="#7650ee" stroke-width="7" stroke-linecap="round"/></g>',
    pip: '<g class="tuft"><path d="M-6 -52 Q-14 -76 -26 -74 Q-22 -58 -6 -52 Z" fill="#ff9a76" stroke="#c25a3a" stroke-width="1.5"/><path d="M0 -54 Q0 -82 8 -84 Q12 -66 4 -54 Z" fill="#ff9a76" stroke="#c25a3a" stroke-width="1.5"/><path d="M8 -52 Q18 -72 30 -68 Q26 -54 8 -52 Z" fill="#ff9a76" stroke="#c25a3a" stroke-width="1.5"/></g><ellipse class="wl" cx="-58" cy="10" rx="10" ry="22" fill="#f0805c" stroke="#c25a3a" stroke-width="1.5"/><ellipse class="wr" cx="58" cy="10" rx="10" ry="22" fill="#f0805c" stroke="#c25a3a" stroke-width="1.5"/><circle cx="0" cy="0" r="56" fill="#ff9a76" stroke="#c25a3a" stroke-width="2"/><path d="M30 -46 A56 56 0 0 1 30 46 A40 56 0 0 0 30 -46 Z" fill="#f0805c"/><ellipse cx="0" cy="20" rx="36" ry="30" fill="#ffd9c4"/><g class="blink"><circle cx="-22" cy="-10" r="8" fill="#2b1a14"/><circle cx="22" cy="-10" r="8" fill="#2b1a14"/><circle cx="-19" cy="-13" r="2.5" fill="#fff"/><circle cx="25" cy="-13" r="2.5" fill="#fff"/></g><circle cx="-40" cy="8" r="8" fill="#ff5d85" opacity=".45"/><circle cx="40" cy="8" r="8" fill="#ff5d85" opacity=".45"/><path d="M-9 4 L9 4 L0 18 Z" fill="#ffcf5a" stroke="#c28a1a" stroke-width="1.5" stroke-linejoin="round"/>',
  };

  var ALIAS = {};
  var SIZE = 70;   // how big a mascot is on screen, in px

  var SIZES = {};
  function svg(id, o) {
    var size = SIZES[id] || SIZE, art = ART[id] || ART.notchy;
    return '<svg viewBox="-95 -105 190 210" width="' + size + '" height="' + size * 210 / 190 + '" style="display:block;overflow:visible">' + (typeof art === 'function' ? art(o) : art) + '</svg>';
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


  // Each mascot has its own scene behind it, inside the open notch. The notch stays mostly black: the colour is only a
  // hint (a black veil lies over the backdrop, thinner toward the bottom) and the main things in the scene sit on top of
  // the veil. The handwritten hello stays plain black. Drawn in a 420 x 144 box and animated with SVG's own animation tags,
  // so it works in any web view.
  function rng(seed) { return function () { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
  function stars(n, seed, color, y0, y1) {
    var r = rng(seed), out = '';
    for (var i = 0; i < n; i++) {
      var x = Math.round(r() * 420), y = Math.round(y0 + r() * (y1 - y0)), rad = (0.6 + r() * 1.1).toFixed(1), dur = (1.4 + r() * 2).toFixed(1), at = (r() * 2).toFixed(1);
      out += '<circle cx="' + x + '" cy="' + y + '" r="' + rad + '" fill="' + color + '"><animate attributeName="opacity" values=".15;1;.15" dur="' + dur + 's" begin="' + at + 's" repeatCount="indefinite"/></circle>';
    }
    return out;
  }
  function drift(dx, dur) { return '<animateTransform attributeName="transform" type="translate" values="' + (-dx) + ' 0;' + dx + ' 0;' + (-dx) + ' 0" dur="' + dur + 's" repeatCount="indefinite"/>'; }
  function grad(id, stops) {
    return '<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' + stops.map(function (s) { return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] != null ? ' stop-opacity="' + s[2] + '"' : '') + '/>'; }).join('') + '</linearGradient>';
  }
  function glow(id, color, a) { return '<radialGradient id="' + id + '"><stop offset="0" stop-color="' + color + '" stop-opacity="' + a + '"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></radialGradient>'; }
  var VEIL = grad('vl', [[0, '#000', 0.94], [1, '#000', 0.55]]), FADE = grad('tf', [[0, '#000', 1], [1, '#000', 0]]);
  function frame(defs, back, front) {
    return '<svg viewBox="0 0 420 144" width="100%" height="100%" preserveAspectRatio="xMidYMin slice" style="display:block"><defs>' + defs + VEIL + FADE + '</defs>' +
      '<rect width="420" height="144" fill="#000"/>' + back + '<rect width="420" height="144" fill="url(#vl)"/>' + front + '<rect width="420" height="40" fill="url(#tf)"/></svg>';
  }
  var BAT = 'M0 0 C-4 -5 -9 -5 -12 -1 C-8 -1 -6 2 -4 5 C-2 2 0 1 0 1 C0 1 2 2 4 5 C6 2 8 -1 12 -1 C9 -5 4 -5 0 0Z';
  var SCENES = {
    wisp: { ink: '#f1e9ff', svg: function () {   // spooky night: a moon, bare trees, fog and bats
      return frame(grad('a', [[0, '#241043'], [1, '#5a2270']]),
        '<rect width="420" height="144" fill="url(#a)"/>',
        stars(16, 7, '#fff', 36, 96) +
        '<circle cx="338" cy="70" r="44" fill="url(#m)"/><circle cx="338" cy="70" r="20" fill="#fff6d8"/><circle cx="331" cy="64" r="4" fill="#e8dcb2"/><circle cx="346" cy="77" r="3" fill="#e8dcb2"/><circle cx="344" cy="60" r="2" fill="#e8dcb2"/>' +
        '<g opacity=".22" fill="#cdbfff"><ellipse cx="100" cy="124" rx="95" ry="9">' + drift(30, 9) + '</ellipse><ellipse cx="300" cy="116" rx="100" ry="8">' + drift(36, 11) + '</ellipse></g>' +
        '<g stroke="#000" stroke-width="3" stroke-linecap="round" fill="none"><path d="M26 144 V96 M26 112 L11 99 M26 102 L40 88 M26 124 L40 112 M11 99 L5 90 M40 88 L46 79"/><path d="M392 144 V102 M392 116 L405 104 M392 108 L379 96 M392 128 L378 118 M379 96 L374 88"/></g>' +
        '<path d="M0 144 V132 Q60 122 120 133 T250 131 T380 128 T420 133 V144 Z" fill="#000"/>' +
        '<g fill="#8a6fd0"><path d="' + BAT + '"><animateMotion dur="6s" repeatCount="indefinite" path="M-20 70 Q100 34 200 74 T440 52"/></path><path d="' + BAT + '"><animateMotion dur="8s" begin="2s" repeatCount="indefinite" path="M440 84 Q300 56 210 92 T-20 66"/></path></g>')
        .replace('<defs>', '<defs>' + glow('m', '#fff6d8', 0.5));
    } },
    pip: { ink: '#eef6ff', svg: function () {   // a sky: a small sun and drifting clouds
      var cloud = function (x, y, k, dx, d) { return '<g transform="translate(' + x + ' ' + y + ') scale(' + k + ')" fill="#fff" opacity=".6"><g>' + drift(dx, d) + '<ellipse cx="0" cy="0" rx="26" ry="9"/><ellipse cx="-14" cy="-7" rx="14" ry="10"/><ellipse cx="8" cy="-10" rx="16" ry="12"/></g></g>'; };
      return frame(grad('a', [[0, '#2f7fd0'], [1, '#8fd0ff']]) + glow('s', '#fff3b0', 0.7),
        '<rect width="420" height="144" fill="url(#a)"/><path d="M0 144 V122 Q70 104 140 120 T290 118 T420 112 V144 Z" fill="#4fb36b"/>',
        '<circle cx="64" cy="66" r="40" fill="url(#s)"/><circle cx="64" cy="66" r="15" fill="#ffe27a"/>' + cloud(160, 74, 1.1, 14, 10) + cloud(300, 60, 0.9, 18, 13) + cloud(386, 100, 0.8, 12, 9));
    } },
    pomo: { ink: '#f2ffe9', svg: function () {   // an orchard: an apple tree on a hill and falling petals
      var petal = function (x, d, b) { return '<g transform="translate(' + x + ' 0)"><circle r="2.4" fill="#ff9bb8"><animateMotion path="M0 40 Q12 70 -8 108 T6 160" dur="' + d + 's" begin="' + b + 's" repeatCount="indefinite"/></circle></g>'; };
      return frame(grad('a', [[0, '#3f9e6e'], [1, '#bfe9a0']]),
        '<rect width="420" height="144" fill="url(#a)"/><path d="M0 144 V118 Q80 98 150 116 T300 114 T420 108 V144 Z" fill="#3f9a5c"/>',
        '<rect x="358" y="88" width="8" height="44" fill="#8a5a3c"/><circle cx="362" cy="74" r="24" fill="#3f9a5c"/><circle cx="347" cy="84" r="16" fill="#3f9a5c"/><circle cx="378" cy="84" r="16" fill="#3f9a5c"/><circle cx="353" cy="70" r="4" fill="#e8434f"/><circle cx="371" cy="78" r="4" fill="#e8434f"/><circle cx="364" cy="90" r="4" fill="#e8434f"/>' +
        '<path d="M0 144 V134 Q100 124 200 134 T420 130 V144 Z" fill="#000" opacity=".5"/>' + petal(60, 5, 0) + petal(140, 6, 1.2) + petal(230, 5.5, 2.4) + petal(310, 6.5, 0.6) + petal(190, 7, 3.2));
    } },
    mochi: { ink: '#fff7fb', svg: function () {   // a dusk meadow: a small moon, fireflies and flowers
      var fly = function (x, y, b) { return '<circle cx="' + x + '" cy="' + y + '" r="2" fill="#ffe97a"><animate attributeName="opacity" values="0;1;0" dur="2.4s" begin="' + b + 's" repeatCount="indefinite"/><animate attributeName="cy" values="' + y + ';' + (y - 8) + ';' + y + '" dur="4s" begin="' + b + 's" repeatCount="indefinite"/></circle>'; };
      var flower = function (x, y, c) { return '<circle cx="' + x + '" cy="' + y + '" r="2.6" fill="' + c + '"/>'; };
      return frame(grad('a', [[0, '#2b1b63'], [0.6, '#9a55c4'], [1, '#ff9ec4']]) + glow('m', '#fff0f8', 0.55),
        '<rect width="420" height="144" fill="url(#a)"/>',
        stars(10, 21, '#fff', 36, 70) + '<circle cx="340" cy="62" r="28" fill="url(#m)"/><circle cx="340" cy="62" r="12" fill="#fff4f9"/>' +
        '<path d="M0 144 V124 Q90 112 170 124 T330 122 T420 118 V144 Z" fill="#000"/>' +
        flower(40, 130, '#ff9ec4') + flower(96, 134, '#fff') + flower(150, 131, '#ffd28a') + flower(262, 133, '#ff9ec4') + flower(318, 129, '#fff') + flower(380, 132, '#ffd28a') +
        fly(70, 100, 0) + fly(150, 88, 0.8) + fly(250, 96, 1.4) + fly(330, 102, 0.4) + fly(110, 110, 2));
    } },
    orbit: { ink: '#e9e4ff', svg: function () {   // deep space: stars, a faint nebula, a far planet and a shooting star
      return frame(grad('a', [[0, '#150a38'], [1, '#2a1260']]) + glow('n1', '#7650ee', 0.55) + glow('n2', '#ff8aa8', 0.35),
        '<rect width="420" height="144" fill="url(#a)"/><ellipse cx="110" cy="100" rx="130" ry="50" fill="url(#n1)"/><ellipse cx="320" cy="114" rx="120" ry="44" fill="url(#n2)"/>',
        stars(40, 3, '#fff', 36, 138) +
        '<g transform="translate(352 58)"><circle r="11" fill="#ff8aa8"/><ellipse rx="21" ry="5" fill="none" stroke="#ffd28a" stroke-width="2" transform="rotate(-20)"/></g>' +
        '<g stroke="#fff" stroke-width="1.6" stroke-linecap="round"><line x1="0" y1="0" x2="-22" y2="7"><animateTransform attributeName="transform" type="translate" values="400 40;220 92" dur="1.4s" begin="1s;6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="1.4s" begin="1s;6s" repeatCount="indefinite"/></line></g>');
    } },
    notchy: { ink: '#efe9ff', svg: function () {   // inside the notch itself: a soft purple glow and rising sparks
      var dot = function (x, d, b) { return '<circle cx="' + x + '" cy="140" r="1.6" fill="#cdbfff"><animate attributeName="cy" values="140;48" dur="' + d + 's" begin="' + b + 's" repeatCount="indefinite"/><animate attributeName="opacity" values="0;.9;0" dur="' + d + 's" begin="' + b + 's" repeatCount="indefinite"/></circle>'; };
      return frame(grad('a', [[0, '#120c26'], [1, '#2a1a5e']]) + glow('g', '#7650ee', 0.6),
        '<rect width="420" height="144" fill="url(#a)"/><ellipse cx="210" cy="124" rx="210" ry="70" fill="url(#g)"/>',
        dot(40, 4, 0) + dot(90, 5, 1.4) + dot(150, 4.5, 0.6) + dot(270, 5.5, 2) + dot(330, 4, 0.9) + dot(380, 5, 2.6));
    } },
  };


  // ---- Formula 1: a car in your favourite team's livery, three ways of arriving (lights out, a flying lap, a pit stop).
  // Colours are the teams' well-known liveries: c1 the main body colour, c2 the second colour (sidepod stripe, rear flap),
  // c3 the front wing and thin accent line, helmet the driver's helmet. `notch` is Notch Apple's own purple car.
  var TEAMS = [
    { id: 'notch', name: 'Notch Apple purple', c1: '#7650ee', c2: '#ff8aa8', c3: '#ffffff', helmet: '#ffffff', match: [] },
    { id: 'ferrari', name: 'Ferrari', c1: '#e8002d', c2: '#fff200', c3: '#ffffff', helmet: '#fff200', match: ['ferrari'] },
    { id: 'mercedes', name: 'Mercedes', c1: '#27f4d2', c2: '#0b0f14', c3: '#c9d1d9', helmet: '#0b0f14', match: ['mercedes'] },
    { id: 'redbull', name: 'Red Bull', c1: '#1e2f6b', c2: '#e10600', c3: '#ffd600', helmet: '#e10600', match: ['red bull', 'redbull'] },
    { id: 'mclaren', name: 'McLaren', c1: '#ff8000', c2: '#47c7fc', c3: '#0b0f14', helmet: '#47c7fc', match: ['mclaren'] },
    { id: 'aston', name: 'Aston Martin', c1: '#229971', c2: '#cedc00', c3: '#ffffff', helmet: '#cedc00', match: ['aston'] },
    { id: 'alpine', name: 'Alpine', c1: '#0093cc', c2: '#ff87bc', c3: '#ffffff', helmet: '#ff87bc', match: ['alpine'] },
    { id: 'williams', name: 'Williams', c1: '#64c4ff', c2: '#041e42', c3: '#ffffff', helmet: '#041e42', match: ['williams'] },
    { id: 'racingbulls', name: 'Racing Bulls', c1: '#6692ff', c2: '#ffffff', c3: '#e10600', helmet: '#ffffff', match: ['racing bulls', 'visa cash app', 'toro rosso', 'alphatauri', 'rb f1'] },
    { id: 'haas', name: 'Haas', c1: '#f0f1f5', c2: '#e10600', c3: '#0b0f14', helmet: '#e10600', match: ['haas'] },
    { id: 'audi', name: 'Audi', c1: '#d6d9de', c2: '#f50537', c3: '#0b0f14', helmet: '#f50537', match: ['audi', 'sauber', 'kick', 'alfa romeo'] },
    { id: 'cadillac', name: 'Cadillac', c1: '#14161b', c2: '#ffffff', c3: '#c9a85c', helmet: '#c9a85c', match: ['cadillac'] },
  ];

  /// A team from its id or from any name F1 uses for it ("Ferrari", "Scuderia Ferrari", "Red Bull Racing"…); Notch purple if unknown.
  function teamOf(s) {
    var k = String(s || '').toLowerCase().trim();
    for (var i = 0; i < TEAMS.length; i++) if (TEAMS[i].id === k) return TEAMS[i];
    if (k) for (var j = 0; j < TEAMS.length; j++) for (var m = 0; m < TEAMS[j].match.length; m++) if (k.indexOf(TEAMS[j].match[m]) >= 0) return TEAMS[j];
    return TEAMS[0];
  }

  var CAR = 120;   // how wide the car is on screen, in px
  var GROUND = 110;   // the y (px, in the open notch) of the track the wheels touch

  // A side view of the car facing right, centred in the same 190 x 210 box as the mascots; the wheels sit on y = 33.
  function carArt(o) {
    var L = teamOf(o && o.team), D = '#101116', rr = 17, fr = 13;
    function wheel(cx, cy, r) {
      var s = r * 0.5, d = r * 0.36;
      return '<g transform="translate(' + cx + ' ' + cy + ')"><g class="wheel"><circle r="' + r + '" fill="#17171c"/><circle class="sw" r="' + (r * 0.78).toFixed(1) + '" fill="none" stroke="#ff3b3b" stroke-width="2.6"/><circle r="' + s.toFixed(1) + '" fill="#7c808c"/>' +
        '<path d="M0 ' + -s + ' V' + s + ' M' + -s + ' 0 H' + s + ' M' + -d + ' ' + -d + ' L' + d + ' ' + d + ' M' + d + ' ' + -d + ' L' + -d + ' ' + d + '" stroke="#2a2c34" stroke-width="2"/><circle r="3" fill="#c9ccd6"/></g></g>';
    }
    return '<g class="smoke" opacity="0"><circle cx="-100" cy="24" r="9" fill="#d6d9e2"/><circle cx="-116" cy="18" r="13" fill="#d6d9e2"/><circle cx="-134" cy="22" r="10" fill="#d6d9e2"/></g>' +
      '<path d="M-84 30 H72 L82 24 H-84 Z" fill="' + D + '"/>' +
      '<rect x="-80" y="-10" width="3" height="18" fill="' + D + '"/>' +
      '<rect x="-92" y="-14" width="28" height="4" fill="' + L.c1 + '"/><rect x="-92" y="-14" width="28" height="1.4" fill="' + L.c3 + '"/>' +
      '<rect class="drs" x="-92" y="-20" width="28" height="3.5" fill="' + L.c2 + '"/>' +
      '<rect x="-93" y="-22" width="3" height="16" rx="1" fill="' + L.c2 + '"/><rect x="-66" y="-22" width="3" height="16" rx="1" fill="' + L.c2 + '"/>' +
      '<path d="M-78 24 L-76 6 Q-70 -4 -50 -6 L-26 -8 L-10 -16 Q0 -20 10 -14 L34 2 L84 14 L92 20 L90 28 L-78 28 Z" fill="' + L.c1 + '"/>' +
      '<path d="M-52 2 L-8 -2 L26 10 L-52 14 Z" fill="' + L.c2 + '"/><path d="M-52 15 L28 11 L36 14 L-52 19 Z" fill="' + L.c3 + '" opacity=".92"/>' +
      '<path d="M-78 25 H90 L92 28 L-78 30 Z" fill="rgba(0,0,0,.3)"/>' +
      '<path d="M-34 -8 L-30 -26 Q-24 -30 -14 -28 L-10 -16 Z" fill="' + L.c1 + '"/><path d="M-30 -24 Q-24 -27 -17 -26 L-15 -20 L-29 -19 Z" fill="' + D + '"/>' +
      '<path d="M70 12 L92 20 L84 22 L66 16 Z" fill="' + L.c2 + '"/>' +
      '<circle cx="6" cy="-11" r="6" fill="' + L.helmet + '" stroke="#0b0b10" stroke-width="1.2"/><rect x="3" y="-13" width="9" height="4" rx="2" fill="#1a1f2b"/>' +
      '<path d="M-6 -12 Q4 -27 24 -3" fill="none" stroke="#0b0b10" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M54 26 H100 V31 H50 Z" fill="' + L.c3 + '"/><rect x="97" y="19" width="3.2" height="13" rx="1" fill="' + L.c2 + '"/>' +
      wheel(-58, 16, rr) + wheel(56, 20, fr) +
      '<g class="gun" opacity="0" fill="#fff6b0"><path d="M-58 -4 l4 -7 l3 7 l7 1 l-5 4 l1 7 l-6 -3 l-6 3 l1 -7 l-5 -4 z"/><path d="M56 2 l3 -6 l3 6 l6 1 l-4 3 l1 6 l-6 -3 l-5 3 l1 -6 l-4 -3 z"/></g>';
  }
  ART.f1lights = ART.f1lap = ART.f1pit = carArt;
  SIZES.f1lights = SIZES.f1lap = SIZES.f1pit = CAR;

  // Wheels turning for a stretch of the greeting: from `from` to `to` ms after it starts.
  function roll(el, from, to) {
    each(el, '.wheel', function (n) {
      n.style.transformBox = 'fill-box'; n.style.transformOrigin = '50% 50%';
      n.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 110, delay: from, iterations: Math.max(1, Math.round((to - from) / 110)), easing: 'linear' });
    });
  }
  function puff(el, at) {
    each(el, '.smoke', function (n) {
      n.style.transformBox = 'fill-box'; n.style.transformOrigin = '100% 60%';
      n.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: .85, transform: 'scale(1)', offset: .25 }, { opacity: 0, transform: 'scale(1.7) translateX(-14px)' }], { duration: 900, delay: at, fill: 'both', easing: 'ease-out' });
    });
  }
  var CAR_Y = GROUND - 87;   // the car's wheels (87 px down its drawing) touch the track

  // Lights out: the car waits on the grid, five red lights come on one by one and go out, and it launches in a cloud of smoke.
  MOTION.f1lights = function (w) {
    var x0 = Math.round(w * 0.2), launch = 0.44, ms = 4400;
    return { ms: ms, frames: path(60, function (t) {
      var u = t < launch ? 0 : (t - launch) / (1 - launch), x = x0 + (w + 200 - x0) * Math.pow(u, 2.3), squat = u > 0 && u < 0.25 ? -3 * Math.sin(u / 0.25 * Math.PI) : 0;
      return 'translate(' + x + 'px,' + (CAR_Y + (t < launch ? Math.sin(t * 90) * 0.4 : 0)) + 'px) rotate(' + squat + 'deg)';
    }), extra: function (el) { var go = 450 + launch * ms; roll(el, go, go + 1900); puff(el, go); } };
  };
  // Flying lap: flat out across the notch past speed lines and kerbs, the rear flap (DRS) opening on the straight.
  MOTION.f1lap = function (w) {
    var ms = 3300;
    return { ms: ms, frames: path(60, function (t) {
      var u = t < 0.14 ? t / 0.14 * 0.1 : 0.1 + 0.9 * Math.pow((t - 0.14) / 0.86, 1.15), x = -150 + (w + 330) * u;
      return 'translate(' + x + 'px,' + (CAR_Y + Math.sin(t * 46) * 0.7) + 'px) rotate(' + (-1.2 * Math.sin(t * Math.PI)) + 'deg)';
    }), extra: function (el) {
      roll(el, 450, 450 + ms);
      each(el, '.drs', function (n) { n.style.transformBox = 'fill-box'; n.style.transformOrigin = '0% 100%'; n.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-32deg)', offset: .12 }, { transform: 'rotate(-32deg)', offset: .88 }, { transform: 'rotate(0deg)' }], { duration: 1500, delay: 450 + ms * 0.3, fill: 'both' }); });
    } };
  };
  // Pit stop: the car brakes into its box, four wheel guns spark, the tyres change from soft (red) to medium (yellow) and it leaves.
  MOTION.f1pit = function (w) {
    var stop = Math.round(w / 2 - CAR / 2), ms = 4800, arrive = 0.3, leave = 0.62;
    return { ms: ms, frames: path(72, function (t) {
      var x, y = CAR_Y;
      if (t < arrive) { var a = t / arrive; x = -150 + (stop + 150) * (1 - Math.pow(1 - a, 3)); }
      else if (t < leave) { x = stop; y += Math.sin(t * 160) * 0.35; }
      else { var b = (t - leave) / (1 - leave); x = stop + (w + 200 - stop) * Math.pow(b, 2.2); }
      return 'translate(' + x + 'px,' + y + 'px)';
    }), extra: function (el) {
      var a0 = 450 + ms * arrive, l0 = 450 + ms * leave;
      roll(el, 450, a0); roll(el, l0, l0 + 1500);
      each(el, '.gun', function (n) { n.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }, { opacity: 1 }, { opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 1100, delay: a0 + 150, fill: 'both' }); });
      each(el, '.sw', function (n) { n.animate([{ stroke: '#ff3b3b' }, { stroke: '#ffd23a' }], { duration: 120, delay: a0 + 650, fill: 'forwards' }); });
      puff(el, l0);
    } };
  };

  // The three F1 scenes: a night track in the team's colour. Only the open notch's own colours change with the team.
  function track(o, back, front, flow) {
    var L = teamOf(o && o.team), kerb = '';
    for (var i = 0; i < 24; i++) kerb += '<rect x="' + (i * 28) + '" y="106" width="14" height="5" fill="#e8e8ee"/><rect x="' + (i * 28 + 14) + '" y="106" width="14" height="5" fill="#e10600"/>';
    return frame(grad('a', [[0, '#04060d'], [1, '#101a33']]) + glow('t', L.c1, 0.5) + glow('fl', '#dbe9ff', 0.7),
      '<rect width="420" height="144" fill="url(#a)"/><ellipse cx="210" cy="112" rx="230" ry="46" fill="url(#t)"/>' + stars(16, 5, '#bcd4ff', 38, 70) +
      '<g><circle cx="64" cy="66" r="22" fill="url(#fl)"/><circle cx="356" cy="62" r="22" fill="url(#fl)"/><rect x="62" y="68" width="3" height="40" fill="#0b0e18"/><rect x="354" y="64" width="3" height="44" fill="#0b0e18"/></g>' +
      '<path d="M0 100 H420 V108 H0 Z" fill="#0a0d18"/>' +
      '<g>' + (flow ? '<animateTransform attributeName="transform" type="translate" values="0 0;-56 0" dur=".5s" repeatCount="indefinite"/>' : '') + kerb + '</g>' +
      '<rect y="111" width="420" height="33" fill="#13151c"/><rect y="111" width="420" height="1.5" fill="' + L.c1 + '" opacity=".7"/>' + (back || ''),
      front || '');
  }
  SCENES.f1lights = { ink: '#ffffff', svg: function (o) {
    var xs = [-48, -24, 0, 24, 48], lights = '';
    xs.forEach(function (x, i) {
      lights += '<circle cx="' + x + '" cy="3" r="6" fill="#3a0a0a" stroke="#1a0606"><set attributeName="fill" to="#ff2a2a" begin="' + (0.75 + i * 0.28).toFixed(2) + 's" fill="freeze"/><set attributeName="fill" to="#3a0a0a" begin="2.4s" fill="freeze"/></circle>' +
        '<circle cx="' + x + '" cy="3" r="14" fill="#ff2a2a" opacity="0"><set attributeName="opacity" to=".35" begin="' + (0.75 + i * 0.28).toFixed(2) + 's" fill="freeze"/><set attributeName="opacity" to="0" begin="2.4s" fill="freeze"/></circle>';
    });
    return track(o, '', '<g transform="translate(210 48)"><rect x="-64" y="-6" width="128" height="18" rx="7" fill="#0c0c10" stroke="#2c2c36"/>' + lights + '</g>');
  } };
  SCENES.f1lap = { ink: '#ffffff', svg: function (o) {
    var lines = '';
    [52, 66, 80, 94, 104].forEach(function (y, i) {
      lines += '<line x1="0" y1="' + y + '" x2="' + (60 + i * 14) + '" y2="' + y + '" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity=".5"><animateTransform attributeName="transform" type="translate" values="460 0;-120 0" dur="' + (0.5 + i * 0.12).toFixed(2) + 's" begin="' + (0.5 + i * 0.1).toFixed(1) + 's" repeatCount="indefinite"/></line>';
    });
    var flag = '<g opacity="0" transform="translate(372 100)"><set attributeName="opacity" to="1" begin="2.5s" fill="freeze"/><rect x="0" y="-52" width="2.5" height="52" fill="#cfd3dc"/><g><animateTransform attributeName="transform" type="skewY" values="-6;6;-6" dur=".6s" repeatCount="indefinite"/>' +
      [0, 1, 2, 3].map(function (r) { return [0, 1, 2, 3, 4].map(function (c) { return '<rect x="' + (3 + c * 7) + '" y="' + (-52 + r * 7) + '" width="7" height="7" fill="' + ((r + c) % 2 ? '#fff' : '#111') + '"/>'; }).join(''); }).join('') + '</g></g>';
    return track(o, '', lines + flag, true);
  } };
  SCENES.f1pit = { ink: '#ffffff', svg: function (o) {
    var crew = function (x) { return '<g transform="translate(' + x + ' 104)"><circle cx="0" cy="-17" r="4" fill="#d8dbe4"/><rect x="-4" y="-13" width="8" height="14" rx="3" fill="#2b2f3a"/><circle cx="6" cy="-4" r="3" fill="#fff6b0" opacity="0"><animate attributeName="opacity" values="0;1;0" dur=".25s" begin="2.0s" repeatCount="4"/></circle></g>'; };
    var sign = '<g transform="translate(336 62)"><rect width="48" height="34" rx="4" fill="#12151f" stroke="#2c3040"/><circle cx="14" cy="11" r="5" fill="#e10600"><set attributeName="fill" to="#1a0606" begin="3.15s" fill="freeze"/></circle><circle cx="34" cy="11" r="5" fill="#0a1a10"><set attributeName="fill" to="#2dd870" begin="3.15s" fill="freeze"/></circle><text x="24" y="29" font-size="9" font-family="system-ui,sans-serif" font-weight="700" fill="#ffd23a" text-anchor="middle">PIT</text></g>';
    return track(o, '<rect y="108" width="420" height="2" fill="#ffd23a" opacity=".55"/>', sign + crew(138) + crew(284), false);
  } };

  function greetingFor(id, name) {
    name = String(name || '').trim(); var nm = name ? ', ' + name : '';
    if (id === 'f1lights') return 'Lights out and away we go' + nm + '!';
    if (id === 'f1pit') return 'Hello' + nm + '! Fresh tyres, fresh start.';
    if (id === 'f1lap') return 'Hello' + nm + '! Fastest lap of the day.';
    return greeting(name);
  }

  function greeting(name) { name = String(name || '').trim(); return name ? 'Hello, ' + name + '!' : 'Hello!'; }

  /// Draws the open notch in `host` and plays the mascot across it. options: { id, name, notchHeight, width, height, onDone }.
  /// Returns { stop() }. Without the Web Animations API (very old web views) it just calls onDone.
  function play(host, options) {
    var o = options || {};
    var parts = String(o.id || '').split(':');
    if (parts[0] === 'hello') return hello(host, o);
    var id = IDS.indexOf(parts[0]) >= 0 ? parts[0] : 'notchy', key = ALIAS[id] || id, look = { team: o.team || parts[1] || '' };
    var w = o.width || 420, nh = o.notchHeight || 32, h = o.height || nh + 112, top = nh + 6, done = false;
    host.innerHTML = '';
    host.style.cssText += ';position:relative;overflow:hidden;width:' + w + 'px;height:' + h + 'px;';
    if (!host.animate) { if (o.onDone) o.onDone(); return { stop: function () {} }; }
    var bg = document.createElement('div');
    bg.style.cssText = 'position:absolute;top:0;left:50%;background:#000;border-radius:0 0 26px 26px;width:180px;height:' + nh + 'px;transform:translateX(-50%)';
    var m = document.createElement('div');
    m.style.cssText = 'position:absolute;left:0;top:0;opacity:0;will-change:transform';
    m.innerHTML = svg(id, look);
    var msg = document.createElement('div');
    msg.textContent = greetingFor(id, o.name);
    msg.style.cssText = 'position:absolute;left:0;right:0;bottom:12px;text-align:center;color:rgba(255,255,255,.92);font:600 14px ui-rounded,"SF Pro Rounded",system-ui,"Segoe UI",sans-serif;opacity:0';
    var sc = SCENES[key], scene = null;
    if (sc) {
      bg.style.overflow = 'hidden';
      scene = document.createElement('div');
      scene.style.cssText = 'position:absolute;top:0;left:50%;width:' + w + 'px;height:' + h + 'px;transform:translateX(-50%);opacity:0';
      scene.innerHTML = sc.svg(look);
      bg.appendChild(scene);
      msg.style.color = sc.ink; msg.style.textShadow = '0 1px 3px rgba(0,0,0,.45)';
      scene.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 150, fill: 'forwards' });
    }
    host.appendChild(bg); host.appendChild(m); host.appendChild(msg);

    var grow = bg.animate([{ width: '180px', height: nh + 'px' }, { width: w + 'px', height: h + 'px' }], { duration: 500, easing: 'cubic-bezier(.2,.9,.25,1.05)', fill: 'forwards' });
    var mv = MOTION[key](w, top), ms = mv.ms;
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
      if (scene) scene.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    }, end);
    var t2 = setTimeout(finish, end + 520);
    function finish() { if (done) return; done = true; if (o.onDone) o.onDone(); }
    return { stop: function () { clearTimeout(t1); clearTimeout(t2); grow.cancel(); run.cancel(); finish(); } };
  }

  var api = { list: LIST, ids: IDS, teams: TEAMS, teamOf: teamOf, scene: function (id, o) { return SCENES[id] ? SCENES[id].svg(o || {}) : ''; }, helloPath: [HELLO_H1, HELLO_H2], svg: svg, greeting: greeting, greetingFor: greetingFor, play: play, size: SIZE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NotchMascots = api;
})(typeof window !== 'undefined' ? window : globalThis);
