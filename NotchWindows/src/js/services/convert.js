// Convert (Ultimate): turn a file into another kind of file. Pictures, text, Markdown, web pages, Word text, tables
// (CSV, TSV, JSON, Excel) and audio to WAV are converted right here; Office documents go through Word, PowerPoint or
// Excel when they're installed (LibreOffice, free, when they aren't); audio and video go through FFmpeg; PDF pages
// become pictures with Windows' own PDF renderer. The native half is src-tauri/src/convert.rs. Every converted file
// is saved next to the original ("Report.pdf"), never over anything.

import { invoke } from '../native.js';

/// New in 1.38.0: show the tab once for people who already chose their tabs (it explains Ultimate until unlocked).
export async function start() {
  const { load, save } = await import('../store.js');
  if (load('convert.introduced', false)) return;
  save('convert.introduced', true);
  const enabled = load('modules.enabled', null);
  if (Array.isArray(enabled) && !enabled.includes('convert')) (await import('../app.js')).setEnabled('convert', true);
}

// ---------------------------------------------------------------- formats

const fmt = (kind, name) => ({ kind, name });
export const FORMATS = {
  png: fmt('image', 'PNG picture'), jpg: fmt('image', 'JPEG picture'), webp: fmt('image', 'WebP picture'), gif: fmt('image', 'GIF picture'),
  bmp: fmt('image', 'Bitmap picture'), tiff: fmt('image', 'TIFF picture'), heic: fmt('image', 'HEIC photo'), ico: fmt('image', 'Icon'),
  svg: fmt('image', 'SVG drawing'), avif: fmt('image', 'AVIF picture'),
  pdf: fmt('pdf', 'PDF'),
  docx: fmt('document', 'Word document'), doc: fmt('document', 'Word 97–2003 document'), rtf: fmt('document', 'Rich text'),
  odt: fmt('document', 'OpenDocument text'), txt: fmt('document', 'Plain text'), md: fmt('document', 'Markdown'),
  html: fmt('document', 'Web page'), pages: fmt('document', 'Pages document'),
  pptx: fmt('presentation', 'PowerPoint'), ppt: fmt('presentation', 'PowerPoint 97–2003'), odp: fmt('presentation', 'OpenDocument slides'),
  key: fmt('presentation', 'Keynote'),
  xlsx: fmt('spreadsheet', 'Excel workbook'), xls: fmt('spreadsheet', 'Excel 97–2003'), ods: fmt('spreadsheet', 'OpenDocument sheet'),
  csv: fmt('spreadsheet', 'CSV table'), tsv: fmt('spreadsheet', 'Tab-separated table'), json: fmt('spreadsheet', 'JSON'),
  numbers: fmt('spreadsheet', 'Numbers'),
  mp3: fmt('audio', 'MP3 audio'), m4a: fmt('audio', 'M4A (AAC) audio'), wav: fmt('audio', 'WAV audio'), flac: fmt('audio', 'FLAC audio'),
  ogg: fmt('audio', 'Ogg Vorbis audio'), opus: fmt('audio', 'Opus audio'), aiff: fmt('audio', 'AIFF audio'), wma: fmt('audio', 'Windows Media audio'),
  aac: fmt('audio', 'AAC audio'),
  mp4: fmt('video', 'MP4 video'), mov: fmt('video', 'QuickTime movie'), mkv: fmt('video', 'Matroska video'), webm: fmt('video', 'WebM video'),
  avi: fmt('video', 'AVI video'), wmv: fmt('video', 'Windows Media video'), m4v: fmt('video', 'M4V video'), flv: fmt('video', 'Flash video'),
  zip: fmt('archive', 'Zip archive'), folder: fmt('folder', 'Folder'),
};
const ALIASES = { jpeg: 'jpg', jfif: 'jpg', tif: 'tiff', heif: 'heic', htm: 'html', xhtml: 'html', markdown: 'md', text: 'txt', log: 'txt',
  aif: 'aiff', oga: 'ogg', '3gp': 'mp4', mpeg: 'mp4', mpg: 'mp4', jsonl: 'json' };

export const KINDS = [
  ['image', 'Pictures'], ['pdf', 'PDF'], ['document', 'Documents'], ['presentation', 'Presentations'], ['spreadsheet', 'Tables'],
  ['audio', 'Audio'], ['video', 'Video'], ['archive', 'Archives'], ['folder', 'Folders'],
];

const TARGETS = {
  image: ['png', 'jpg', 'webp', 'gif', 'bmp', 'tiff', 'ico', 'pdf'],
  pdf: ['docx', 'txt', 'rtf', 'html', 'odt', 'doc', 'png', 'jpg'],
  document: ['pdf', 'docx', 'txt', 'md', 'html', 'rtf', 'odt', 'doc'],
  presentation: ['pdf', 'pptx', 'png', 'jpg', 'ppt', 'odp'],
  spreadsheet: ['xlsx', 'csv', 'json', 'tsv', 'html', 'pdf', 'xls', 'ods'],
  audio: ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aiff', 'wma'],
  video: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'gif', 'mp3', 'm4a', 'wav'],
  archive: ['folder'],
  folder: ['zip'],
};

/// The format of a path, from its extension ("folder" for a folder, null when unknown).
export function detect(path, isDir = false) {
  if (isDir) return 'folder';
  const ext = (path.match(/\.([^.\\/]+)$/)?.[1] || '').toLowerCase();
  const f = ALIASES[ext] || ext;
  return FORMATS[f] ? f : null;
}

/// What a format can become, best first. Any file can also be zipped.
export function targets(from) {
  const kind = FORMATS[from]?.kind;
  const list = (TARGETS[kind] || []).filter((t) => t !== from);
  return kind && kind !== 'folder' && kind !== 'archive' ? [...list, 'zip'] : list;
}

export const label = (f) => (f === 'folder' ? 'Folder' : `${f.toUpperCase()} · ${FORMATS[f]?.name || ''}`);

// ---------------------------------------------------------------- helpers it may need

export const HELP = {
  office: { text: 'This needs Microsoft Office or LibreOffice (free).', link: 'https://www.libreoffice.org/download/download-libreoffice/', button: 'Get LibreOffice' },
  ffmpeg: { text: 'Audio and video need FFmpeg (free). Install it, then click Check again.', link: 'https://www.gyan.dev/ffmpeg/builds/', button: 'Get FFmpeg', command: 'winget install Gyan.FFmpeg' },
  mac: { text: 'Only a Mac can open this file (in Keynote, Pages or Numbers). Export it from there, or convert it in Notch apple on a Mac.' },
};
export class NeedsHelp extends Error { constructor(what) { super(HELP[what].text); this.help = what; } }

let toolsCache = null;
/// Which helper apps this PC has: { word, powerpoint, excel, libreoffice, ffmpeg }.
export async function tools(refresh = false) {
  if (!toolsCache || refresh) toolsCache = await invoke('convert_tools').catch(() => ({}));
  return toolsCache;
}

// ---------------------------------------------------------------- converting

const WORD = { pdf: 17, docx: 16, doc: 0, rtf: 6, txt: 7, html: 10, odt: 23 };
const POWERPOINT = { pdf: 32, pptx: 24, ppt: 1, odp: 35, png: 18, jpg: 17 };
const EXCEL = { xlsx: 51, xls: 56, ods: 60, csv: 62, tsv: 42, html: 44, pdf: 'pdf' };
const TEXTISH = ['txt', 'md', 'html'];
const TABLES = ['csv', 'tsv', 'json', 'xlsx'];

const out = (path, ext, suffix) => invoke('convert_target', { input: path, ext, suffix: suffix ?? null });
const native = (engine, input, output, format, from) => invoke('convert_run', { engine, input, output, format: String(format), from: from ?? null });
async function readBytes(path) {
  const b64 = await invoke('convert_read', { path });
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
async function writeBytes(path, bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  await invoke('convert_write', { path, data: btoa(s) });
  return path;
}
const utf8 = (s) => new TextEncoder().encode(s);
const text = (u) => new TextDecoder('utf-8').decode(u).replace(/^\uFEFF/, '');
/// A file with a different extension in the temp folder, for jobs that take two steps.
async function temp(path, ext) {
  const name = path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  return invoke('convert_target', { input: `${await tempDir()}\\${name}.${ext}`, ext, suffix: null });
}
let tmpDir = null;
const tempDir = async () => (tmpDir ??= await invoke('convert_temp_dir').catch(() => 'C:\\Windows\\Temp'));

/// Converts one file. Returns where the result was saved (a file, or a folder for pictures of every page).
export async function convert(path, from, to, onStep = () => {}) {
  const t = await tools();
  const kind = FORMATS[from]?.kind;
  if (to === 'zip') { onStep('Zipping…'); return native('zip', path, await out(path, 'zip'), 'zip'); }
  if (from === 'zip' && to === 'folder') { onStep('Unzipping…'); return native('unzip', path, await out(path, ''), ''); }
  if (['pages', 'key', 'numbers'].includes(from)) throw new NeedsHelp('mac');

  if (kind === 'image') {
    onStep('Converting…');
    let bytes, mime = MIME[from];
    if (from === 'tiff' || from === 'heic') {
      // Windows' own decoders read these; the page carries on from a PNG.
      const png = to === 'png' ? await out(path, 'png') : await temp(path, 'png');
      await native('wic', path, png, 'png');
      if (to === 'png') return png;
      bytes = await readBytes(png); mime = 'image/png';
    } else bytes = await readBytes(path);
    const img = await decodeImage(bytes, mime);
    return writeBytes(await out(path, to), await encodeImage(img, to));
  }

  if (kind === 'pdf') {
    if (to === 'png' || to === 'jpg') { onStep('Rendering pages…'); return native('pdfpages', path, await out(path, '', ' pages'), to); }
    return office(t, 'word', WORD, path, from, to, onStep);
  }

  if (kind === 'document') {
    const local = (TEXTISH.includes(from) || from === 'docx') && (['txt', 'md', 'html', 'docx'].includes(to) || (to === 'pdf' && !t.word && !t.libreoffice));
    if (local && !(from === 'docx' && to === 'docx')) {
      onStep('Converting…');
      const blocks = await readBlocks(path, from);
      return writeBytes(await out(path, to), writeBlocks(blocks, to, path));
    }
    if (from === 'md') {
      // Word and LibreOffice don't read Markdown: go through a web page.
      const html = await temp(path, 'html');
      await writeBytes(html, writeBlocks(await readBlocks(path, 'md'), 'html', path));
      return office(t, 'word', WORD, html, 'html', to, onStep, path);
    }
    return office(t, 'word', WORD, path, from, to, onStep);
  }

  if (kind === 'presentation') {
    if ((to === 'png' || to === 'jpg') && !t.powerpoint && t.libreoffice) {
      // LibreOffice only draws the first slide as a picture: make a PDF, then picture every page of it.
      onStep('Opening in LibreOffice…');
      const pdf = await temp(path, 'pdf');
      await native('soffice', path, pdf, 'pdf', from);
      onStep('Rendering slides…');
      return native('pdfpages', pdf, await out(path, '', ' slides'), to);
    }
    return office(t, 'powerpoint', POWERPOINT, path, from, to, onStep);
  }

  if (kind === 'spreadsheet') {
    if (TABLES.includes(from) && ['csv', 'tsv', 'json', 'xlsx', 'html'].includes(to)) {
      onStep('Converting…');
      return writeBytes(await out(path, to), writeTable(await readTable(path, from), to, path));
    }
    if (to === 'json' && (t.excel || t.libreoffice)) {
      // Excel and LibreOffice don't write JSON: go through CSV.
      const csv = await temp(path, 'csv');
      await office(t, 'excel', EXCEL, path, from, 'csv', onStep, path, csv);
      return writeBytes(await out(path, 'json'), writeTable(parseDelimited(text(await readBytes(csv)), ','), 'json'));
    }
    if (to === 'pdf' && TABLES.includes(from) && !t.excel && !t.libreoffice) {
      onStep('Converting…');
      return writeBytes(await out(path, 'pdf'), tablePdf(await readTable(path, from)));
    }
    return office(t, 'excel', EXCEL, path, from, to, onStep);
  }

  if (kind === 'audio' || kind === 'video') {
    if (t.ffmpeg) { onStep(kind === 'video' ? 'Converting the video (this can take a while)…' : 'Converting…'); return native('ffmpeg', path, await out(path, to), to); }
    if (to === 'wav') { onStep('Converting…'); return writeBytes(await out(path, 'wav'), await toWav(await readBytes(path))); }
    throw new NeedsHelp('ffmpeg');
  }
  throw new Error(`Can't turn ${from.toUpperCase()} into ${to.toUpperCase()}.`);
}

/// Through Word / PowerPoint / Excel, or LibreOffice. `named` is the original file (for the output's name).
async function office(t, app, formats, path, from, to, onStep, named = path, output = null) {
  const dest = output || (await (app === 'powerpoint' && (to === 'png' || to === 'jpg') ? out(named, '', ' slides') : out(named, to)));
  if (t[app] && formats[to] !== undefined) {
    onStep(`Opening in ${app === 'word' ? 'Word' : app === 'excel' ? 'Excel' : 'PowerPoint'}…`);
    try { return await native(app, path, dest, formats[to]); }
    catch (e) { if (!t.libreoffice) throw e; }
  }
  if (t.libreoffice) {
    onStep('Opening in LibreOffice…');
    return native('soffice', path, dest, to === 'tsv' ? 'csv:"Text - txt - csv (StarCalc)":9,34,76' : to, from);
  }
  throw new NeedsHelp('office');
}

/// Several pictures as the pages of one PDF, saved next to the first ("Combined.pdf").
export async function combinePdf(items, onStep = () => {}) {
  const pages = [];
  for (const [i, it] of items.entries()) {
    onStep(`Adding ${i + 1} of ${items.length}…`);
    let bytes, mime = MIME[it.from];
    if (it.from === 'tiff' || it.from === 'heic') { const png = await temp(it.path, 'png'); await native('wic', it.path, png, 'png'); bytes = await readBytes(png); mime = 'image/png'; }
    else bytes = await readBytes(it.path);
    pages.push(await jpegPage(await decodeImage(bytes, mime)));
  }
  const dir = items[0].path.replace(/[\\/][^\\/]*$/, '');
  return writeBytes(await out(`${dir}\\Combined.pdf`, 'pdf'), pdfDocument(pages));
}

// ---------------------------------------------------------------- pictures

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', avif: 'image/avif' };

export async function decodeImage(bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) { w = 1024; h = 1024; }   // an SVG without a size
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  } catch { throw new Error("That picture couldn't be opened."); }
  finally { URL.revokeObjectURL(url); }
}

const blobBytes = async (b) => new Uint8Array(await b.arrayBuffer());
function toBlob(canvas, type, quality) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the picture."))), type, quality));
}
function flatten(canvas) {
  // JPEG and BMP have no transparency: put the picture on white.
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(canvas, 0, 0);
  return c;
}

export async function encodeImage(canvas, to) {
  switch (to) {
    case 'png': return blobBytes(await toBlob(canvas, 'image/png'));
    case 'jpg': return blobBytes(await toBlob(flatten(canvas), 'image/jpeg', 0.92));
    case 'webp': return blobBytes(await toBlob(canvas, 'image/webp', 0.9));
    case 'bmp': return bmp(flatten(canvas));
    case 'tiff': return tiff(canvas);
    case 'gif': return gif(canvas);
    case 'ico': return ico(canvas);
    case 'pdf': return pdfDocument([await jpegPage(canvas)]);
    default: throw new Error(`Can't make .${to} pictures.`);
  }
}

const pixels = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;

function bmp(c) {
  const w = c.width, h = c.height, row = (w * 3 + 3) & ~3, size = 54 + row * h;
  const b = new Uint8Array(size), v = new DataView(b.buffer), px = pixels(c);
  b[0] = 0x42; b[1] = 0x4d; v.setUint32(2, size, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true);
  v.setUint32(34, row * h, true); v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    const o = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; b[o + x * 3] = px[i + 2]; b[o + x * 3 + 1] = px[i + 1]; b[o + x * 3 + 2] = px[i]; }
  }
  return b;
}

function tiff(c) {
  const w = c.width, h = c.height, data = pixels(c), n = 11;
  const ifd = 8, bpsAt = ifd + 2 + n * 12 + 4, pixAt = bpsAt + 8;
  const b = new Uint8Array(pixAt + data.length), v = new DataView(b.buffer);
  b.set([0x49, 0x49, 42, 0]); v.setUint32(4, ifd, true); v.setUint16(ifd, n, true);
  const tags = [[256, 4, 1, w], [257, 4, 1, h], [258, 3, 4, bpsAt], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, pixAt],
    [277, 3, 1, 4], [278, 4, 1, h], [279, 4, 1, data.length], [284, 3, 1, 1], [338, 3, 1, 2]];
  tags.forEach(([tag, type, count, value], i) => {
    const o = ifd + 2 + i * 12;
    v.setUint16(o, tag, true); v.setUint16(o + 2, type, true); v.setUint32(o + 4, count, true);
    if (type === 3 && count === 1) v.setUint16(o + 8, value, true); else v.setUint32(o + 8, value, true);
  });
  for (let i = 0; i < 4; i++) v.setUint16(bpsAt + i * 2, 8, true);
  b.set(data, pixAt);
  return b;
}

async function ico(c) {
  // One 256 × 256 (or smaller) picture, centred on a square, stored as PNG inside the icon.
  const side = Math.min(256, Math.max(c.width, c.height));
  const k = side / Math.max(c.width, c.height);
  const sq = document.createElement('canvas');
  sq.width = sq.height = side;
  sq.getContext('2d').drawImage(c, (side - c.width * k) / 2, (side - c.height * k) / 2, c.width * k, c.height * k);
  const png = await blobBytes(await toBlob(sq, 'image/png'));
  const b = new Uint8Array(22 + png.length), v = new DataView(b.buffer);
  v.setUint16(2, 1, true); v.setUint16(4, 1, true);
  b[6] = side >= 256 ? 0 : side; b[7] = side >= 256 ? 0 : side;
  v.setUint16(10, 1, true); v.setUint16(12, 32, true); v.setUint32(14, png.length, true); v.setUint32(18, 22, true);
  b.set(png, 22);
  return b;
}

/// GIF: the 255 commonest colours (one more slot for see-through), each pixel mapped to the nearest.
export function gif(c) {
  const w = c.width, h = c.height, px = pixels(c);
  const count = new Uint32Array(32768), sums = new Float64Array(32768 * 3);
  let clear = false;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) { clear = true; continue; }
    const k = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
    count[k]++; sums[k * 3] += px[i]; sums[k * 3 + 1] += px[i + 1]; sums[k * 3 + 2] += px[i + 2];
  }
  const keys = [];
  for (let k = 0; k < 32768; k++) if (count[k]) keys.push(k);
  keys.sort((a, b) => count[b] - count[a]);
  const first = clear ? 1 : 0;
  const pal = keys.slice(0, 256 - first).map((k) => [sums[k * 3] / count[k], sums[k * 3 + 1] / count[k], sums[k * 3 + 2] / count[k]].map(Math.round));
  const palette = new Uint8Array(768);
  pal.forEach((p, i) => palette.set(p, (i + first) * 3));
  const near = new Int16Array(32768).fill(-1);
  const idx = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    if (px[i + 3] < 128) { idx[p] = 0; continue; }
    const k = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
    if (near[k] < 0) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < pal.length; j++) {
        const d = (pal[j][0] - px[i]) ** 2 + (pal[j][1] - px[i + 1]) ** 2 + (pal[j][2] - px[i + 2]) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
      near[k] = best + first;
    }
    idx[p] = near[k];
  }
  const parts = [utf8('GIF89a'), le16(w), le16(h), new Uint8Array([0xf7, 0, 0]), palette];
  if (clear) parts.push(new Uint8Array([0x21, 0xf9, 4, 1, 0, 0, 0, 0]));
  parts.push(new Uint8Array([0x2c, 0, 0, 0, 0]), le16(w), le16(h), new Uint8Array([0, 8]));
  const lz = lzw(idx, 8);
  for (let i = 0; i < lz.length; i += 255) { const n = Math.min(255, lz.length - i); parts.push(new Uint8Array([n]), lz.subarray(i, i + n)); }
  parts.push(new Uint8Array([0, 0x3b]));
  return concat(parts);
}
const le16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);

function lzw(indices, min) {
  const clear = 1 << min, eoi = clear + 1;
  let size = min + 1, next = eoi + 1, dict = new Map();
  const out = []; let acc = 0, bits = 0;
  const emit = (code) => { acc |= code << bits; bits += size; while (bits >= 8) { out.push(acc & 255); acc >>>= 8; bits -= 8; } };
  emit(clear);
  let cur = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = cur * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { cur = hit; continue; }
    emit(cur);
    if (next === 4096) { emit(clear); dict = new Map(); size = min + 1; next = eoi + 1; }
    else { if (next >= 1 << size) size++; dict.set(key, next++); }
    cur = k;
  }
  emit(cur); emit(eoi);
  if (bits > 0) out.push(acc & 255);
  return new Uint8Array(out);
}

function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0), b = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { b.set(p, o); o += p.length; }
  return b;
}

// ---------------------------------------------------------------- PDF (written by hand: pictures and plain text)

async function jpegPage(canvas) {
  return { w: canvas.width * 0.75, h: canvas.height * 0.75, image: { w: canvas.width, h: canvas.height, jpeg: await blobBytes(await toBlob(flatten(canvas), 'image/jpeg', 0.9)) } };
}

/// pages: [{ w, h, image: {w, h, jpeg} } | { w, h, lines: [{ x, y, size, bold, mono, text }] }]
export function pdfDocument(pages) {
  const objs = [];   // each: Uint8Array parts
  const add = (...parts) => { objs.push(parts.map((p) => (typeof p === 'string' ? utf8(p) : p))); return objs.length; };
  const fonts = { F1: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    F2: add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
    F3: add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>') };
  const pagesId = objs.length + 1; add('');   // filled in below
  const kids = [];
  for (const p of pages) {
    let content, res;
    if (p.image) {
      const im = add(`<< /Type /XObject /Subtype /Image /Width ${p.image.w} /Height ${p.image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.image.jpeg.length} >>\nstream\n`, p.image.jpeg, '\nendstream');
      content = `q ${n(p.w)} 0 0 ${n(p.h)} 0 0 cm /Im1 Do Q`;
      res = `<< /XObject << /Im1 ${im} 0 R >> >>`;
    } else {
      content = p.lines.map((l) => `BT /${l.mono ? 'F3' : l.bold ? 'F2' : 'F1'} ${l.size} Tf ${n(l.x)} ${n(l.y)} Td (${pdfText(l.text)}) Tj ET`).join('\n');
      res = `<< /Font << /F1 ${fonts.F1} 0 R /F2 ${fonts.F2} 0 R /F3 ${fonts.F3} 0 R >> >>`;
    }
    const bytes = latin1(content);
    const c = add(`<< /Length ${bytes.length} >>\nstream\n`, bytes, '\nendstream');
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(p.w)} ${n(p.h)}] /Resources ${res} /Contents ${c} 0 R >>`));
  }
  objs[pagesId - 1] = [utf8(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`)];
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const parts = [utf8('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  const offsets = [];
  let at = parts[0].length;
  objs.forEach((o, i) => {
    offsets.push(at);
    const piece = concat([utf8(`${i + 1} 0 obj\n`), ...o, utf8('\nendobj\n')]);
    parts.push(piece); at += piece.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  parts.push(utf8(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${at}\n%%EOF\n`));
  return concat(parts);
}
const n = (x) => Math.round(x * 100) / 100;
const pdfText = (s) => s.replace(/[\\()]/g, '\\$&');
function latin1(s) {
  // WinAnsi: Latin letters keep their accents; anything else becomes "?".
  const map = { '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '…': 0x85, '€': 0x80, '™': 0x99 };
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b[i] = c < 256 ? c : map[s[i]] ?? 63; }
  return b;
}

let measureCtx = null;
function measure(s, size, bold, mono) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = `${bold ? 'bold ' : ''}${size}px ${mono ? 'Courier New, monospace' : 'Helvetica, Arial, sans-serif'}`;
  return measureCtx.measureText(s).width;
}

/// Text on A4 pages: headings bold, long lines wrapped.
function textPdf(blocks) {
  const W = 595, H = 842, M = 56, pages = [];
  let lines = [], y = H - M;
  const newPage = () => { if (lines.length) pages.push({ w: W, h: H, lines }); lines = []; y = H - M; };
  for (const b of blocks) {
    const size = b.type === 'h' ? [0, 20, 16, 14, 13, 12, 12][b.level] : b.type === 'code' ? 9.5 : 11;
    const bold = b.type === 'h', mono = b.type === 'code';
    const indent = b.type === 'li' ? 14 : 0;
    const raw = b.type === 'code' ? b.text : (b.type === 'li' ? '• ' : '') + runsText(b.runs);
    for (const para of raw.split('\n')) {
      const words = para.split(/(\s+)/);
      let line = '';
      const flush = () => { if (y < M + size) newPage(); y -= size * 1.35; lines.push({ x: M + indent, y, size, bold, mono, text: line }); line = ''; };
      for (const w of words) {
        if (line && measure(line + w, size, bold, mono) > W - 2 * M - indent) { flush(); if (/^\s+$/.test(w)) continue; }
        line += w;
      }
      flush();
    }
    y -= b.type === 'h' ? 8 : 5;
  }
  newPage();
  if (!pages.length) pages.push({ w: W, h: H, lines: [] });
  return pdfDocument(pages);
}

function tablePdf(rows) {
  const widths = [];
  for (const r of rows) r.forEach((c, i) => { widths[i] = Math.min(40, Math.max(widths[i] || 0, String(c).length)); });
  const line = (r) => r.map((c, i) => String(c).slice(0, 40).padEnd(widths[i])).join('  ');
  return textPdf(rows.map((r) => ({ type: 'code', text: line(r) })));
}

// ---------------------------------------------------------------- documents as blocks

// A block: { type: 'h', level, runs } | { type: 'p', runs } | { type: 'li', runs } | { type: 'code', text }
// A run: { text, b, i }
const runsText = (runs) => runs.map((r) => r.text).join('');

async function readBlocks(path, from) {
  const bytes = await readBytes(path);
  if (from === 'txt') return text(bytes).replace(/\r/g, '').split('\n').map((l) => ({ type: 'p', runs: [{ text: l }] }));
  if (from === 'md') return mdBlocks(text(bytes));
  if (from === 'html') return htmlBlocks(text(bytes));
  if (from === 'docx') return docxBlocks(await unzip(bytes));
  throw new Error(`Can't read ${from.toUpperCase()} here.`);
}

export function mdInline(s) {
  const runs = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    if (m[2] !== undefined) runs.push({ text: m[2], b: true });
    else if (m[4] !== undefined) runs.push({ text: m[4], i: true });
    else if (m[5] !== undefined) runs.push({ text: m[5], code: true });
    else runs.push({ text: m[6], href: m[7] });
    last = re.lastIndex;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs;
}

export function mdBlocks(md) {
  const lines = md.replace(/\r/g, '').split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const code = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      out.push({ type: 'code', text: code.join('\n') });
    } else if (/^#{1,6}\s/.test(l)) out.push({ type: 'h', level: l.match(/^#+/)[0].length, runs: mdInline(l.replace(/^#+\s+/, '')) });
    else if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) out.push({ type: 'li', runs: mdInline(l.replace(/^\s*([-*+]|\d+[.)])\s+/, '')) });
    else if (/^>\s?/.test(l)) out.push({ type: 'p', runs: mdInline(l.replace(/^>\s?/, '')).map((r) => ({ ...r, i: true })) });
    else if (l.trim()) {
      const para = [l];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(```|#{1,6}\s|\s*([-*+]|\d+[.)])\s+|>)/.test(lines[i + 1])) para.push(lines[++i]);
      out.push({ type: 'p', runs: mdInline(para.join(' ')) });
    }
  }
  return out;
}

export function htmlBlocks(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  let cur = null;
  const flush = () => { if (cur && runsText(cur.runs).trim()) out.push(cur); cur = null; };
  const walk = (node, style) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        const t = c.textContent.replace(/\s+/g, ' ');
        if (!t.trim() && !cur) continue;
        (cur ??= { type: 'p', runs: [] }).runs.push({ text: t, ...style });
        continue;
      }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName.toLowerCase();
      if (['script', 'style', 'head', 'template', 'noscript'].includes(tag)) continue;
      if (/^h[1-6]$/.test(tag)) { flush(); cur = { type: 'h', level: +tag[1], runs: [] }; walk(c, style); flush(); }
      else if (tag === 'li') { flush(); cur = { type: 'li', runs: [] }; walk(c, style); flush(); }
      else if (tag === 'pre') { flush(); out.push({ type: 'code', text: c.textContent.replace(/\n$/, '') }); }
      else if (tag === 'br') { (cur ??= { type: 'p', runs: [] }).runs.push({ text: '\n' }); }
      else if (tag === 'tr') { flush(); cur = { type: 'p', runs: [{ text: [...c.children].map((td) => td.textContent.trim()).join(' | '), ...style }] }; flush(); }
      else if (['p', 'div', 'section', 'article', 'blockquote', 'ul', 'ol', 'table', 'header', 'footer', 'main', 'nav', 'aside', 'figure', 'hr', 'dl', 'dt', 'dd', 'body'].includes(tag)) { flush(); walk(c, style); flush(); }
      else walk(c, { ...style, ...(tag === 'b' || tag === 'strong' ? { b: true } : {}), ...(tag === 'i' || tag === 'em' ? { i: true } : {}), ...(tag === 'code' ? { code: true } : {}) });
    }
  };
  walk(doc.body || doc.documentElement, {});
  flush();
  for (const b of out) if (b.runs) { b.runs[0].text = b.runs[0].text.replace(/^\s+/, ''); const l = b.runs[b.runs.length - 1]; l.text = l.text.replace(/\s+$/, ''); }
  return out;
}

function docxBlocks(files) {
  const xml = files['word/document.xml'];
  if (!xml) throw new Error("That doesn't look like a Word document.");
  const doc = new DOMParser().parseFromString(text(xml), 'application/xml');
  const out = [];
  for (const p of doc.getElementsByTagName('w:p')) {
    const style = p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') || '';
    const runs = [];
    for (const r of p.getElementsByTagName('w:r')) {
      const pr = r.getElementsByTagName('w:rPr')[0];
      const on = (tag) => { const e = pr?.getElementsByTagName(tag)[0]; return !!e && !['0', 'false'].includes(e.getAttribute('w:val')); };
      let t = '';
      for (const c of r.childNodes) {
        if (c.nodeName === 'w:t') t += c.textContent;
        else if (c.nodeName === 'w:tab') t += '\t';
        else if (c.nodeName === 'w:br' || c.nodeName === 'w:cr') t += '\n';
      }
      if (t) runs.push({ text: t, b: on('w:b'), i: on('w:i') });
    }
    const heading = style.match(/^(?:Heading|heading)\s?(\d)$/)?.[1] || (/^Title$/i.test(style) ? '1' : null);
    if (heading) out.push({ type: 'h', level: +heading, runs });
    else if (p.getElementsByTagName('w:numPr').length || /List/i.test(style)) {
      if (runs[0]) runs[0].text = runs[0].text.replace(/^[•·\-–]\s*/, '');
      out.push({ type: 'li', runs: runs.filter((r) => r.text) });
    }
    else out.push({ type: 'p', runs });
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function writeBlocks(blocks, to, path = '') {
  if (to === 'txt') return utf8(blocks.map((b) => (b.type === 'code' ? b.text : (b.type === 'li' ? '• ' : '') + runsText(b.runs))).join('\n'));
  if (to === 'md') {
    const md = (runs) => runs.map((r) => (r.code ? `\`${r.text}\`` : r.href ? `[${r.text}](${r.href})` : r.b && r.i ? `***${r.text}***` : r.b ? `**${r.text}**` : r.i ? `*${r.text}*` : r.text)).join('');
    const one = (b) => (b.type === 'h' ? `${'#'.repeat(b.level)} ${md(b.runs)}` : b.type === 'li' ? `- ${md(b.runs)}` : b.type === 'code' ? `\`\`\`\n${b.text}\n\`\`\`` : md(b.runs));
    // List items sit together; everything else gets a blank line between.
    return utf8(blocks.map((b, i) => (i && !(b.type === 'li' && blocks[i - 1].type === 'li') ? '\n\n' : i ? '\n' : '') + one(b)).join('') + '\n');
  }
  if (to === 'html') {
    const inl = (runs) => runs.map((r) => {
      let h = esc(r.text).replace(/\n/g, '<br>');
      if (r.code) h = `<code>${h}</code>`; if (r.b) h = `<strong>${h}</strong>`; if (r.i) h = `<em>${h}</em>`;
      if (r.href) h = `<a href="${esc(r.href)}">${h}</a>`;
      return h;
    }).join('');
    const body = []; let list = false;
    for (const b of blocks) {
      if (b.type === 'li' && !list) { body.push('<ul>'); list = true; }
      if (b.type !== 'li' && list) { body.push('</ul>'); list = false; }
      body.push(b.type === 'h' ? `<h${b.level}>${inl(b.runs)}</h${b.level}>` : b.type === 'li' ? `<li>${inl(b.runs)}</li>` : b.type === 'code' ? `<pre><code>${esc(b.text)}</code></pre>` : `<p>${inl(b.runs)}</p>`);
    }
    if (list) body.push('</ul>');
    const title = esc(path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'Document');
    return utf8(`<!doctype html>\n<html><head><meta charset="utf-8"><title>${title}</title>\n<style>body{font:16px/1.55 system-ui,sans-serif;max-width:46em;margin:2em auto;padding:0 1em}pre{background:#f4f4f4;padding:1em;overflow:auto}</style></head>\n<body>\n${body.join('\n')}\n</body></html>\n`);
  }
  if (to === 'docx') return docx(blocks);
  if (to === 'pdf') return textPdf(blocks);
  throw new Error(`Can't write ${to.toUpperCase()} here.`);
}

// Normal text, six heading levels (real Word headings, so they show in the navigation pane) and a bulleted list.
const DOCX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:style>'
  + [40, 32, 28, 26, 24, 22].map((sz, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${i}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`).join('')
  + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/><w:ind w:left="360" w:hanging="240"/></w:pPr></w:style>'
  + '</w:styles>';

function docx(blocks) {
  const x = (s) => esc(s).replace(/\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
  const run = (r, extra = '') => `<w:r><w:rPr>${extra}${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}${r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ''}</w:rPr><w:t xml:space="preserve">${x(r.text)}</w:t></w:r>`;
  const paras = blocks.map((b) => {
    if (b.type === 'code') return b.text.split('\n').map((l) => `<w:p>${run({ text: l, code: true })}</w:p>`).join('');
    if (b.type === 'h') return `<w:p><w:pPr><w:pStyle w:val="Heading${Math.min(6, b.level)}"/></w:pPr>${b.runs.map((r) => run(r)).join('')}</w:p>`;
    if (b.type === 'li') return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr>${run({ text: '•\t' })}${b.runs.map((r) => run(r)).join('')}</w:p>`;
    return `<w:p>${b.runs.map((r) => run(r)).join('')}</w:p>`;
  }).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml': DOCX_STYLES,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  });
}

// ---------------------------------------------------------------- tables

async function readTable(path, from) {
  const bytes = await readBytes(path);
  if (from === 'csv') return parseDelimited(text(bytes), sniff(text(bytes)));
  if (from === 'tsv') return parseDelimited(text(bytes), '\t');
  if (from === 'json') return jsonRows(JSON.parse(text(bytes)));
  if (from === 'xlsx') return xlsxRows(await unzip(bytes));
  throw new Error(`Can't read ${from.toUpperCase()} here.`);
}
const sniff = (s) => { const head = s.split('\n')[0]; return (head.match(/;/g) || []).length > (head.match(/,/g) || []).length ? ';' : ','; };

export function parseDelimited(s, sep) {
  const rows = []; let row = [], field = '', q = false;
  s = s.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"' && !field) q = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function jsonRows(v) {
  if (Array.isArray(v) && v.every((r) => Array.isArray(r))) return v.map((r) => r.map(cell));
  if (Array.isArray(v)) {
    const keys = [...new Set(v.flatMap((r) => (r && typeof r === 'object' ? Object.keys(r) : ['value'])))];
    return [keys, ...v.map((r) => (r && typeof r === 'object' ? keys.map((k) => cell(r[k])) : [cell(r)]))];
  }
  if (v && typeof v === 'object') return [['key', 'value'], ...Object.entries(v).map(([k, x]) => [k, cell(x)])];
  return [[cell(v)]];
}
const cell = (x) => (x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x));

function xlsxRows(files) {
  const xml = (name) => (files[name] ? new DOMParser().parseFromString(text(files[name]), 'application/xml') : null);
  const strings = [...(xml('xl/sharedStrings.xml')?.getElementsByTagName('si') || [])].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
  // The first sheet, through the workbook's own list.
  let sheet = 'xl/worksheets/sheet1.xml';
  const first = xml('xl/workbook.xml')?.getElementsByTagName('sheet')[0];
  const rid = first?.getAttribute('r:id');
  const rel = rid && [...(xml('xl/_rels/workbook.xml.rels')?.getElementsByTagName('Relationship') || [])].find((r) => r.getAttribute('Id') === rid);
  if (rel) { const t = rel.getAttribute('Target'); sheet = t.startsWith('/') ? t.slice(1) : `xl/${t}`; }
  const doc = xml(sheet);
  if (!doc) throw new Error("That workbook's first sheet couldn't be read.");
  const rows = [];
  for (const r of doc.getElementsByTagName('row')) {
    const y = (+r.getAttribute('r') || rows.length + 1) - 1;
    const row = (rows[y] ||= []);
    let auto = 0;
    for (const c of r.getElementsByTagName('c')) {
      const ref = c.getAttribute('r');
      const x = ref ? colIndex(ref.replace(/\d+$/, '')) : auto;
      auto = x + 1;
      const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      row[x] = t === 's' ? strings[+v] ?? '' : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map((e) => e.textContent).join('') : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v;
    }
  }
  const width = Math.max(0, ...rows.map((r) => r?.length || 0));
  return [...rows].map((r) => Array.from({ length: width }, (_, i) => r?.[i] ?? ''));
}
const colIndex = (letters) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const colName = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

export function writeTable(rows, to, path = '') {
  if (to === 'csv' || to === 'tsv') {
    const sep = to === 'csv' ? ',' : '\t';
    const q = (c) => (/[",\n\r\t]/.test(c) && to === 'csv' ? `"${c.replace(/"/g, '""')}"` : to === 'tsv' ? c.replace(/[\t\n\r]/g, ' ') : c);
    return utf8(rows.map((r) => r.map((c) => q(String(c))).join(sep)).join('\r\n') + '\r\n');
  }
  if (to === 'json') {
    const [head, ...body] = rows;
    const keyed = head && body.length && head.every((h) => h && typeof h === 'string') && new Set(head).size === head.length;
    const val = (c) => (c !== '' && NUMBER.test(c) && !/^0\d/.test(c) ? Number(c) : c === 'TRUE' ? true : c === 'FALSE' ? false : c);
    return utf8(JSON.stringify(keyed ? body.map((r) => Object.fromEntries(head.map((h, i) => [h, val(r[i] ?? '')]))) : rows.map((r) => r.map(val)), null, 2) + '\n');
  }
  if (to === 'html') {
    const [head, ...body] = rows;
    const title = esc(path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'Table');
    return utf8(`<!doctype html>\n<html><head><meta charset="utf-8"><title>${title}</title><style>body{font:14px system-ui,sans-serif;margin:2em}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f4f4f4}</style></head><body>\n<table>\n${head ? `<tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>\n` : ''}${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('\n')}\n</table>\n</body></html>\n`);
  }
  if (to === 'xlsx') {
    const sheet = rows.map((r, y) => `<row r="${y + 1}">${r.map((c, x) => {
      const ref = `${colName(x)}${y + 1}`; c = String(c);
      if (c === '') return '';
      return NUMBER.test(c) && !/^0\d/.test(c) && c.length < 16 ? `<c r="${ref}"><v>${c}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return zip({
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
    });
  }
  throw new Error(`Can't write ${to.toUpperCase()} here.`);
}

// ---------------------------------------------------------------- zip (Office files are zips)

const CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/// A zip of { name: string | Uint8Array }, stored (Office reads these fine).
export function zip(files) {
  const local = [], central = [];
  let at = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? utf8(content) : content, nm = utf8(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, at, true);
    local.push(new Uint8Array(h.buffer), nm, data); central.push(new Uint8Array(c.buffer), nm);
    at += 30 + nm.length + data.length;
  }
  const cd = concat(central), count = Object.keys(files).length;
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, count, true); e.setUint16(10, count, true); e.setUint32(12, cd.length, true); e.setUint32(16, at, true);
  return concat([...local, cd, new Uint8Array(e.buffer)]);
}

/// The files in a zip, as { name: Uint8Array }.
export async function unzip(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("That file isn't what its name says (it isn't a zip inside).");
  const count = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
    const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const raw = b.subarray(start, start + size);
    files[name] = method === 0 ? raw : method === 8 ? await inflate(raw) : null;
    p += 46 + nlen + xlen + clen;
  }
  return files;
}
async function inflate(raw) {
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------- audio to WAV (no FFmpeg needed)

async function toWav(bytes) {
  let buf;
  try { buf = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }
  catch { throw new NeedsHelp('ffmpeg'); }
  return wav(buf);
}
export function wav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
  const b = new Uint8Array(44 + len * ch * 2), v = new DataView(b.buffer);
  b.set(utf8('RIFF')); v.setUint32(4, 36 + len * ch * 2, true); b.set(utf8('WAVEfmt '), 8);
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  b.set(utf8('data'), 36); v.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  for (let i = 0, o = 44; i < len; i++) for (let c = 0; c < ch; c++, o += 2) { const s = Math.max(-1, Math.min(1, data[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return b;
}
