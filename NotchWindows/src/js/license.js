// Offline access-code gating, ported from AccessCodeManager.swift so the same
// 50 codes work on Windows and macOS. Only SHA-256 hashes of the codes ship here;
// the codes themselves are never stored in the app.

const VALID = new Set([
  '8c71d5c4d8df7b252f3cc6543476019524361c9cc0619a4bac9ae97b030d14dc',
  '7f4b31b5c204e6b84b5df7bc53b13899069c6188bff4a736b17804d320c13cc7',
  '03af20393ab00a3763cea0557dd88b8fb6a340e5c06661f70fa6a9a19d11714a',
  'ffb65c59eb5246a648bff7defcf18ffc3669d736ab5537bea07c0150b8f71c50',
  'b408103da5cd47f6c124c317fbb26c1b47f3e9d647a66435fa636413d3b9eb54',
  'edbf8b98ef8995c69782d59c61ddccb0964509975bd01888eb0eeecd8a0d717c',
  'fbafbd0e656db90254227366f8403d8cbe37763baacb9b8a232eea84586db588',
  '83a44b9ab8dd113d26d16712cfaac483836ebe52b810bd574f4e95f80d499113',
  '7a4446456746767e6544f2167e14bf1520800fde7cfca9177b9ffc013ac7f39d',
  'a0c2203532abf574a1571f3062c36762d4783f4a0e23b07dcc4254eb9d5868b3',
  'f4a2375b6395c8f7d0f07f5ef30223371cfe45fe3a4449a940893597a62a085c',
  'c00076e982a23371b4bd29b3be5c6139df4c08bb63891f7d23c97af0bfd3e324',
  'd8a1d41f43c825bbb65f062396c86059667cc925caf7c07348f0c11b7465752c',
  'c233475e3d9c88cc6931b921384786a7e76b3e8e6d25b5c76b9df0850f94c6ac',
  '66628cc36dae07ef48cd2c5013552ae2cfbb87f898c35de53423eaf05fe88fe1',
  '87154f1c0db41931bf343a3b3e363d031cd5870a4f230a79e26c6d74cd5af208',
  '5ef017dd422c5303c37b13bc46e334b83d335509f252a3fe3406445518def347',
  'd0148de3947e0bebf03fc1139ab99f825df434bd2316d9458fd13f00ad645461',
  'df53b45e26ab812da4ad752630007889ba8a6b4ebe7db43c4c434c8da4747753',
  'acb199eda227ea89eb7f0d12f4bca33efe437e003ac2601255ab7b33cbd9f431',
  '32c2234f6a26a581ba6a7af8a48ec1ebac7c825270cfca9fb7234bb2a85ce641',
  'cd7ec7e75a20ec8ff722a15d94abcf94859c2f10759730fdb713a8df6db0d9b4',
  'f38699a0ae85a0aa876143a7aa3d9dcedd671d8498943458ee99e171a4cbae1f',
  'ca255449d9987b260397e3d45b84228887b107013edf9eb33bb4d7e2979081e7',
  '968737c4fee7346f1e0f55a4539805c52a6b7ec3d1a87337b6e720224ab7d49b',
  '5b8d186e9392b6496a4589860057b120d594ebaacd53d215335ed6b2be4f3649',
  '8a7ab6514553930dc7db95fc443201f7c5bd23450c3d435811d8cb396b2116d4',
  '4eb8f167eb42173ec3f71931c402a7ca497824de78f8e88b628dd02d3328ff5d',
  'fa678bd8501a1ffe0e310157d88a46c5bb6c204684d30bc38156d7c5293367d9',
  '2031b928a2e3fba24ffd7ba384f178d285c7e767f68c4aa98e1f6adf783c10d1',
  '6b87d5376147decc187d515b35b0cf91992022ef53b12d79cb7254494b880f16',
  'cad782e4069a61c4459f5e158d7ef6a7839d941eefddddf1613de09371cdad12',
  'fc3935d31f3cef10d32a93ae2e5972a8c611e0a4da6b82f6d12225bca4f76c13',
  '94de99a9e0abc4dafbde7838ead4de3120d8abd76998a3e297d6d8c9f5c5d6ee',
  '79e0b53fead74489f69597f9c9e780da1dfeda6212768cf5984aef9e79d5417b',
  '30b9ac41e9cc32fbe3c0edfde41c81076809f5ff6aaf5b703f32c5faf131d73f',
  'e14e933ea3cd728367695d3952ca60d95e876212ed45fd55f699235c148ddd62',
  '030842942fd99b301765d20f16248e2193825b806ebaec639774a75743b9a013',
  'f3ecdfe0cb64567167b6a9dec9c752104904c737927c399d474e0588e0cc0cc5',
  '8999cd9e470a0e95bbdfd5d3d1bdbbc5c23a97ac23cce0c8033a5b329d96ec72',
  '6485a966b12c2f567ed2457a70d5232616018d57b9ab675dce5d3a249a5dac5b',
  'e40c031657167696ab77844d53ca4cb4e5e13c3c5eaa1053ae2e5cabf7e3c093',
  'c211b9112f825a9ae707e1402923b454207c4a201a6449a559d20cdca5078163',
  '870295a6a879e4674e63d3836d209075b2746fa96f6cb12ea36af14712ddb619',
  '9aae3b1a66349ff08f89d4caf0bb2793acc3981773a4071653befb5cb2551455',
  'f7ecd175e5aa2f7695c56054ec3208dc78910371802302be80991c427050c060',
  '09808a606ab1fa1a4d847afda47f6823b7c8ada32a4e26525515c4ec436961a3',
  '01af30fef426d3ff49f74ba11b447ae122eff2fb351ce2e3cba71cb2378b5110',
  '3d3718b39320e56cb9b03f9cf65e0bd04e31119300d20f6a81f5019788aade3d',
  'f9f5e70844c9eb34aa35830f02f94fad77b0f75b01a5e1be516cfd8f7d3d435a',
]);

/// Features that need a code (Pro), matching Module.isGated in the macOS app.
/// Of these, only AI exists on Windows so far; the rest are listed so the sets
/// stay in step as more tabs arrive. Now Playing is free on both platforms.
export const GATED = new Set(['ai', 'messenger', 'audio', 'vpn']);

/// What a code unlocks, worded for Windows. The macOS app adds Voice Notes,
/// Screen Time and Quick Add, which have no Windows equivalent yet.
export const PRO_SUMMARY = 'AI (and Messenger, Audio and VPN as they arrive)';

const KEY = 'license.activated';
const MASK_KEY = 'license.codeMask';

export const sanitize = (s) =>
  (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function hashOf(clean) {
  const bytes = new TextEncoder().encode(clean);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function validate(input) {
  const clean = sanitize(input);
  if (clean.length !== 13 || !clean.startsWith('NOTCH')) return false;
  return VALID.has(await hashOf(clean));
}

export async function activate(input) {
  const clean = sanitize(input);
  if (!(await validate(clean))) return false;
  localStorage.setItem(KEY, (await hashOf(clean)));
  localStorage.setItem(MASK_KEY, `NOTCH-${clean.slice(5, 9)}-****`);
  return true;
}

export function isActivated() {
  const saved = localStorage.getItem(KEY);
  return !!saved && VALID.has(saved);
}

export const maskedCode = () => localStorage.getItem(MASK_KEY) || 'NOTCH-****-****';

export function deactivate() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(MASK_KEY);
}

/// Formats as NOTCH-XXXX-XXXX while typing; the NOTCH prefix is added for you.
export function format(input) {
  let s = sanitize(input);
  if (!'NOTCH'.startsWith(s) && !s.startsWith('NOTCH')) s = 'NOTCH' + s;
  s = s.slice(0, 13);
  if (s.length <= 5) return s;
  const body = s.slice(5);
  return 'NOTCH-' + body.slice(0, 4) + (body.length > 4 ? '-' + body.slice(4) : '');
}
