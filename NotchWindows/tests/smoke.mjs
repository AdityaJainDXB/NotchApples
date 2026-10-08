// Smoke test: runs the app's real screens (Tools, To-do) in a simulated browser and checks what they show.
// Needs jsdom, which scripts/run-windows-smoke.sh installs into a temporary folder. The app's files are
// copied to <tmp>/js, so the app's own source is not touched.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root" style="width:700px;height:400px"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const k of ['window', 'document', 'localStorage', 'navigator', 'HTMLElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent', 'requestAnimationFrame', 'getComputedStyle', 'MutationObserver']) {
  try { globalThis[k] = dom.window[k]; } catch { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true }); }
}
globalThis.speechSynthesis = { cancel() {}, speak() {} };
const errors = [];
dom.window.addEventListener('error', (e) => errors.push(e.message));
process.on('unhandledRejection', (e) => errors.push(String(e?.stack || e)));
const root = () => { const r = document.createElement('div'); document.body.append(r); return r; };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : detail}`); if (!cond) fails++; };

// ---- Tools
const tools = await import('./js/modules/tools.js');
const t = root();
await tools.render(t);
await tick(80);
const labels = [...t.querySelector('.seg').querySelectorAll('button')].map((b) => b.textContent).join(',');
ok('Tools shows three pages', labels === 'Utilities,Calculator,Translator', labels);
[...t.querySelectorAll('.seg button')].find((b) => b.textContent === 'Calculator').click();
await tick(30);
const ta = t.querySelector('textarea');
ok('Calculator has a multi-line box', !!ta);
ta.value = 'a = 5\n2a + 1\n2x + 3 = 11\nx^2 - 5x + 6 = 0\nfactor(x^2 - 1)\n12% of 80\n5 km to mi\n1/0';
ta.dispatchEvent(new dom.window.Event('input'));
await tick(30);
const text = t.textContent;
for (const want of ['a = 5', '= 11', 'x = 4', 'x = 2', 'x = 3', '(x - 1)(x + 1)', '9.6', '3.10', "Can't divide by zero"]) ok(`Calculator shows “${want}”`, text.includes(want), text.slice(0, 400));
[...t.querySelectorAll('.seg button')].find((b) => b.textContent === 'Translator').click();
await tick(120);
ok('Translator page appears inside Tools', !!t.querySelector('textarea[placeholder^="Type or paste"]'));
[...t.querySelectorAll('.seg button')].find((b) => b.textContent === 'Utilities').click();
await tick(30);
ok('Utilities page shows Keep awake', t.textContent.includes('Keep awake'));

// ---- To-do
const todo = await import('./js/modules/todo.js');
const d = root();
await todo.render(d);
await tick(60);
const input = d.querySelector('input.field');
const add = async (line) => { input.value = line; input.dispatchEvent(new dom.window.Event('input')); input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' })); await tick(10); };
await add('water plants !');
await add('buy milk');
await add('pay rent !!!');
const rows = () => [...d.querySelectorAll('.item')].map((r) => r.textContent).filter((x) => /water|milk|rent/.test(x));
const order = rows();
ok('three tasks are listed', order.length === 3, order.join(' | '));
ok('high priority is first', /pay rent/.test(order[0] || ''), order.join(' | '));
ok('low priority is last', /water plants/.test(order[2] || ''), order.join(' | '));
ok('marks are stripped from the title', !order.join('').includes('!'), order.join(' | '));
const first = [...d.querySelectorAll('.item')].find((r) => /pay rent/.test(r.textContent));
ok('the high task is red', /rgb\(255, 85, 85\)|#ff5555/i.test(first.getAttribute('style') || '') || /255, 85, 85/.test(first.getAttribute('style') || ''), first.getAttribute('style'));
// turn priority sorting off: newest first
const sortBox = [...d.querySelectorAll('label')].find((l) => /Sort by priority/.test(l.textContent)).querySelector('input');
sortBox.checked = false; sortBox.dispatchEvent(new dom.window.Event('change'));
await tick(20);
ok('sorting off keeps newest first', /pay rent/.test(rows()[0] || ''), rows().join(' | '));
sortBox.checked = true; sortBox.dispatchEvent(new dom.window.Event('change'));
await tick(20);

// ---- Share (PairDrop)
const PDsvc = await import('./js/services/pairdrop.js');
await PDsvc.start();
const share = await import('./js/modules/share.js');
const sh = root();
await share.render(sh);
await tick(40);
ok('Share shows my code, spaced', sh.textContent.includes('4 8 2 9 1 5'), sh.textContent.slice(0, 200));
ok('Share shows the name and the ready status', sh.textContent.includes('Dev PC') && sh.textContent.includes('Ready to receive'));
const modeBtn = (name) => [...sh.querySelector('.seg').querySelectorAll('button')].find((b) => b.textContent === name);
modeBtn('Send').click(); await tick(20);
const code = sh.querySelector('input[placeholder="Their 6-digit code"]');
ok('Send: the file button waits for a full code', [...sh.querySelectorAll('button')].find((b) => b.textContent === 'Choose a file…').disabled === true);
code.value = '12ab345678'; code.dispatchEvent(new dom.window.Event('input')); await tick(20);
ok('Send: the code box keeps only six digits', code.value === '123456', code.value);
const pick = [...sh.querySelectorAll('button')].find((b) => b.textContent === 'Choose a file…');
ok('Send: the file button is ready with a full code', pick.disabled === false);
pick.click(); await tick(80);
const sendCall = (globalThis.window.__pdCalls || []).find((c) => c[0] === 'pd_send');
ok('Send: asks the engine to send the chosen file with the code', sendCall && sendCall[1].code === '123456' && sendCall[1].paths[0].endsWith('notes.txt'), JSON.stringify(sendCall));
await tick(60);
ok('Send: the result is shown', sh.textContent.includes('Sent to Sam'), sh.textContent.slice(0, 300));
modeBtn('Chat').click(); await tick(20);
[...sh.querySelectorAll('button')].find((b) => b.textContent === 'Connect').click(); await tick(40);
ok('Chat: connecting opens a conversation', sh.textContent.includes('Sam') && sh.textContent.includes('Chat with Sam is open'), sh.textContent.slice(0, 300));
const msg = sh.querySelector('input[placeholder="Message…"]');
msg.value = 'hello from the PC'; msg.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' })); await tick(40);
ok('Chat: a sent message appears in the thread', sh.textContent.includes('hello from the PC'), sh.textContent.slice(0, 300));
// the name can be changed
modeBtn('Receive').click(); await tick(20);
[...sh.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Change the name')).click(); await tick(10);
const nameBox = sh.querySelector('input[placeholder="Your name"]'); nameBox.value = 'Sam’s laptop';
[...sh.querySelectorAll('button')].find((b) => b.textContent === 'Save').click(); await tick(60);
ok('The name can be changed', sh.textContent.includes('Sam’s laptop'), sh.textContent.slice(0, 200));

ok('no errors were thrown', errors.length === 0, errors.join('\n'));
console.log(fails ? `\n${fails} FAILED` : '\nall smoke checks passed');
process.exit(fails ? 1 : 0);
