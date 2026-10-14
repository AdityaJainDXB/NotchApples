import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const C = await loadModule('services/bambucloudlogic.js');
const L = await loadModule('services/bambulogic.js');
const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.' + 'a'.repeat(40);
const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, text: typeof body === 'string' ? body : JSON.stringify(body), headers });
/// A fake Bambu: records every call so the tests can check where the password went.
function fake(routes) {
  const calls = [];
  const http = async (url, opts = {}) => { calls.push({ url, opts }); const r = routes(url, opts); if (r instanceof Error) throw r; return r; };
  return { http, calls };
}

test('a good password signs in and the password goes only to Bambu over https', async () => {
  const f = fake(() => res(200, { accessToken: TOKEN, loginType: '' }));
  const r = await C.signIn(f.http, 'global', 'me@example.com', 'hunter2');
  assert.deepEqual(r, { kind: 'ok', token: TOKEN });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://api.bambulab.com/v1/user-service/user/login');
  assert.equal(f.calls[0].opts.json.password, 'hunter2');
  assert.ok(f.calls.every((c) => c.url.startsWith('https://api.bambulab.com/')));
});
test('China uses its own address, and an unknown region is refused without any call', async () => {
  const f = fake(() => res(200, { accessToken: TOKEN }));
  await C.signIn(f.http, 'china', 'me@example.com', 'x');
  assert.ok(f.calls[0].url.startsWith('https://api.bambulab.cn/'));
  const g = fake(() => res(200, {}));
  assert.equal((await C.signIn(g.http, 'evil.example.com', 'me@example.com', 'x')).kind, 'error');
  assert.equal(g.calls.length, 0);
});
test('bad input is refused before anything is sent', async () => {
  const f = fake(() => res(200, {}));
  assert.equal((await C.signIn(f.http, 'global', 'not-an-email', 'x')).kind, 'error');
  assert.equal((await C.signIn(f.http, 'global', 'me@example.com', '')).kind, 'error');
  assert.equal(f.calls.length, 0);
});
test('Bambu asking for an email code or an authenticator code is understood', async () => {
  assert.deepEqual(await C.signIn(fake(() => res(200, { success: false, loginType: 'verifyCode' })).http, 'global', 'me@example.com', 'x'), { kind: 'verify' });
  assert.deepEqual(await C.signIn(fake(() => res(200, { success: false, loginType: 'tfa', tfaKey: 'k123' })).http, 'global', 'me@example.com', 'x'), { kind: 'tfa', tfaKey: 'k123' });
});
test('a wrong password, a rate limit, a browser check and a network failure each get their own plain message', async () => {
  const msg = async (r) => (await C.signIn(fake(() => r).http, 'global', 'me@example.com', 'x')).message;
  assert.match(await msg(res(401, { success: false })), /check the email, password/i);
  assert.match(await msg(res(429, {})), /limiting/i);
  assert.match(await msg(res(403, '<html>Just a moment...</html>')), /browser check/i);
  assert.match(await msg(new Error('boom')), /internet/i);
  assert.match(await msg(res(200, { weird: true })), /LAN Mode/);
});
test('no message ever contains the password or the token', async () => {
  const f = fake(() => res(401, { success: false, accessToken: '', echoed: 'hunter2' }));
  const r = await C.signIn(f.http, 'global', 'me@example.com', 'hunter2');
  assert.ok(!JSON.stringify(r).includes('hunter2'));
});
test('the email code: it is requested, and only six digits are accepted', async () => {
  const f = fake((url) => (url.endsWith('/sendemail/code') ? res(200, { success: true }) : res(200, { accessToken: TOKEN })));
  assert.deepEqual(await C.sendCode(f.http, 'global', 'me@example.com'), { ok: true });
  assert.equal(f.calls[0].opts.json.type, 'codeLogin');
  assert.equal((await C.signInWithCode(f.http, 'global', 'me@example.com', 'abc')).kind, 'error');
  assert.deepEqual(await C.signInWithCode(f.http, 'global', 'me@example.com', '123456'), { kind: 'ok', token: TOKEN });
  assert.equal(f.calls.at(-1).opts.json.password, undefined);
});
test('two-step sign-in: the CSRF token is fetched and sent, and the token can arrive as a cookie', async () => {
  const f = fake((url) => (url.endsWith('/api/csrf') ? res(200, { csrfToken: 'tok' }, { 'set-cookie': 'csrf=abc; Path=/' }) : res(200, { success: true }, { 'set-cookie': `token=${TOKEN}; Path=/; HttpOnly` })));
  const r = await C.signInWithTfa(f.http, 'global', 'k123', '654321');
  assert.deepEqual(r, { kind: 'ok', token: TOKEN });
  const post = f.calls.find((c) => c.url.endsWith('/api/sign-in/tfa'));
  assert.equal(post.opts.headers['x-csrf-token'], 'tok'); assert.equal(post.opts.headers.cookie, 'csrf=abc');
  assert.deepEqual(post.opts.json, { tfaKey: 'k123', tfaCode: '654321' });
  assert.ok(f.calls.every((c) => c.url.startsWith('https://bambulab.com/')));
  assert.equal((await C.signInWithTfa(f.http, 'global', 'k123', '12')).kind, 'error');
});
test('the account: the id and the printers are read, odd entries dropped, names cleaned', async () => {
  const f = fake((url) => (url.includes('preference') ? res(200, { uid: 1234567890 }) : res(200, { devices: [
    { dev_id: '01P00A123456789', name: 'Office <b>X1</b>', dev_product_name: 'X1 Carbon', online: true },
    { dev_id: 'short', name: 'bad' }, { name: 'no id' }, { dev_id: '03W00X987654321', name: '', dev_product_name: 'P1S', online: false }] })));
  const r = await C.fetchAccount(f.http, 'global', TOKEN);
  assert.equal(r.ok, true); assert.equal(r.uid, '1234567890'); assert.equal(r.devices.length, 2);
  assert.equal(r.devices[0].name, 'Office bX1/b'); assert.equal(r.devices[1].name, 'P1S');
  assert.ok(f.calls.every((c) => c.opts.headers.authorization === `Bearer ${TOKEN}` && c.url.startsWith('https://api.bambulab.com/')));
  assert.equal((await C.fetchAccount(f.http, 'global', 'short')).ok, false);
});
test('an account id that is not digits is refused (it becomes the MQTT user name)', () => {
  assert.equal(C.readUid({ uid: '12a' }), null); assert.equal(C.readUid({ uid: 'u_5' }), null); assert.equal(C.readUid({ uid: 42 }), '42');
});
test('a cloud printer needs only a serial number, and is named from the account', () => {
  const p = C.cloudPrinter({ serial: '01P00A123456789', name: 'Office', model: 'X1', online: true }, 'global');
  assert.equal(L.problem(p, {}), null); assert.equal(p.cloud, 'global'); assert.equal(L.printerName(p), 'Office');
  assert.notEqual(L.problem({ ...p, serial: 'x' }, {}), null);
});
test('the printers can be listed again through the saved sign-in, and an expired one is explained', async () => {
  const ok = await C.accountVia(async (what) => (what === 'preference' ? '{"uid":42}' : JSON.stringify({ devices: [{ dev_id: '01P00A123456789', name: 'Office', online: true }] })));
  assert.equal(ok.ok, true); assert.equal(ok.devices.length, 1);
  const expired = await C.accountVia(async () => { throw new Error('Bambu Cloud refused the saved sign-in. It has probably expired: sign in again under Bambu account.'); });
  assert.equal(expired.ok, false); assert.match(expired.message, /sign in again/);
  assert.equal((await C.accountVia(async () => 'not json')).ok, false);
});
