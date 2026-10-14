// The Bambu Lab tab's rules, shared by the Windows UI: what a printer is allowed to look like, how the
// printer's own LAN reports are merged (they are deltas, so the last value seen for a field wins), what
// the status colours are and what the words are. Pure, so it is tested without a window
// (tests/bambulogic.test.mjs mirrors the Mac's BambuStatusLogic).

/// The colours, as the Mac has them: green printing, yellow paused, blue idle, gray offline.
export const COLOURS = { printing: '#30d158', paused: '#ffd60a', idle: '#64d2ff', offline: '#8e8e93', failed: '#8e8e93', finish: '#8e8e93' };

export const emptySnapshot = () => ({ phase: 'offline', gcodeState: '', progress: 0, remainingMinutes: null, nozzleC: null, bedC: null, nozzleTargetC: null, bedTargetC: null, filename: '', error: null, at: 0 });

/// A printer as the user typed it: IP or hostname, the access code and the serial from its LAN mode screen.
export const blankPrinter = () => ({ id: Math.random().toString(36).slice(2, 9), name: '', host: '', accessCode: '', serial: '' });

export const printerName = (p) => p.name?.trim() || p.host || 'My Printer';
export const viaCloud = (p) => !!(p && p.cloud);

/// A usable IP or hostname: strips a pasted scheme, path and port, then says no to spaces.
export function normalizeHost(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  const url = s.match(/^[a-z][a-z0-9+.-]*:\/\/(.+)$/i);
  if (url) s = url[1];
  s = s.split('/')[0];
  if (/^\[[0-9a-f:.]+\]$/i.test(s)) return s.slice(1, -1);
  if (/^[0-9a-f.:]+$/i.test(s) && /:/.test(s)) return s;          // IPv6, whole string
  if (/^[^:]+:\d+$/.test(s)) s = s.split(':')[0];                 // host:port
  s = s.trim();
  if (!s || /\s/.test(s) || s.length > 253) return null;
  return s;
}

/// The serial as the printer shows it: letters and digits, 8 to 32 of them.
export function normalizeSerial(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, '').toUpperCase();
  if (s.length < 8 || s.length > 32 || !/^[A-Z0-9]+$/.test(s)) return null;
  return s;
}

export const reportTopic = (serial) => `device/${serial}/report`;

/// The settings fields, or the environment variable that fills an empty one.
export function resolved(p, env = {}) {
  const pick = (stored, keys) => {
    const t = String(stored || '').trim();
    if (t) return t;
    for (const k of keys) { const v = String(env[k] || '').trim(); if (v) return v; }
    return t;
  };
  return { ...p, host: pick(p.host, ['BAMBU_IP', 'BAMBU_PRINTER_IP']), accessCode: pick(p.accessCode, ['BAMBU_ACCESS_CODE']), serial: pick(p.serial, ['BAMBU_SERIAL']) };
}

/// A plain-language problem with the credentials, or null when they are usable.
export function problem(p, env) {
  if (p && p.cloud) return normalizeSerial(p.serial) ? null : 'That printer’s serial number looks wrong.';   // reached through the account: no address or code
  const r = resolved(p, env);
  if (!normalizeHost(r.host)) return r.host ? `“${r.host}” doesn’t look like an IP address or hostname.` : 'Add the printer’s IP address or hostname.';
  if (!r.accessCode) return 'Add the access code from the printer’s screen (Settings → LAN).';
  if (!normalizeSerial(r.serial)) return r.serial ? `“${r.serial}” doesn’t look like a Bambu serial number.` : 'Add the printer’s serial number.';
  return null;
}

/// The printer's states, onto the phases the notch shows.
export function phaseOf(gcodeState, connected) {
  if (!connected) return 'offline';
  switch (String(gcodeState || '').toUpperCase()) {
    case 'RUNNING': case 'PREPARE': case 'SLICING': case 'PRINTING': return 'printing';
    case 'PAUSE': case 'PAUSED': return 'paused';
    default: return 'idle';
  }
}

const num = (v) => (typeof v === 'number' ? v : v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);

/// Merges one report (or a "print" object) onto the snapshot we have. Bambu reports are deltas: a
/// missing field means "unchanged", never zero.
export function apply(root, current) {
  const now = Date.now();
  const next = { ...current, at: now };
  if (!root || typeof root !== 'object') return next;
  if (root.error) { next.error = null; }
  const p = root.print && typeof root.print === 'object' ? root.print : root;
  if (p.gcode_state != null && String(p.gcode_state).length) next.gcodeState = String(p.gcode_state);
  const percent = num(p.mc_percent);
  if (percent != null) next.progress = Math.min(100, Math.max(0, Math.round(percent)));
  const left = num(p.mc_remaining_time);
  if (left != null) next.remainingMinutes = Math.max(0, Math.round(left)); // the printer reports minutes
  const nozzle = num(p.nozzle_temper);
  if (nozzle != null) next.nozzleC = nozzle;
  const bed = num(p.bed_temper);
  if (bed != null) next.bedC = bed;
  const nozzleTarget = num(p.nozzle_target_temper);
  if (nozzleTarget != null) next.nozzleTargetC = nozzleTarget;
  const bedTarget = num(p.bed_target_temper);
  if (bedTarget != null) next.bedTargetC = bedTarget;
  const name = p.subtask_name || p.gcode_file || '';
  if (name) next.filename = String(name).split(/[\\/]/).filter(Boolean).pop() || String(name);
  next.phase = phaseOf(next.gcodeState, true);
  return next;
}

/// A snapshot for a printer that just connected but hasn't reported yet.
export const waiting = () => ({ ...emptySnapshot(), phase: 'idle' });

export const offline = (error) => ({ ...emptySnapshot(), error: error || null });

/// "1h 24m left", or null when there is no clock to show.
export function remainingLabel(minutes) {
  if (minutes == null || minutes < 0 || !Number.isFinite(minutes)) return null;
  const m = Math.round(minutes);
  if (m < 1) return '<1m left';
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60), r = m % 60;
  return r === 0 ? `${h}h left` : `${h}h ${r}m left`;
}

export const tempLabel = (v) => (v == null ? '—' : `${Math.round(v)}°`);

/// What the pill shows at a glance: "72%", "Paused", "Idle", "Off".
export function pillText(s) {
  if (!s) return 'Off';
  if (s.phase === 'printing') return s.progress > 0 ? `${s.progress}%` : 'Print';
  if (s.phase === 'paused') return 'Paused';
  if (s.phase === 'idle') return 'Idle';
  return 'Off';
}

export const phaseColour = (s) => (s ? COLOURS[s.phase] || COLOURS.offline : COLOURS.offline);

/// How many printers come free; more need Pro.
export const FREE_PRINTERS = 1;

const isActive = (s) => s && (s.phase === 'printing' || s.phase === 'paused');

/// Something worth a sound and a glance: 'paused', 'finished' or 'failed' (or null). Same rules as the Mac.
export function printEvent(old, now) {
  if (!old || !now || old.phase === 'offline' || now.phase === 'offline') return null;
  if (old.phase === 'printing' && now.phase === 'paused') return 'paused';
  const was = String(old.gcodeState || '').toUpperCase(), cur = String(now.gcodeState || '').toUpperCase();
  if (cur === 'FAILED' && was !== 'FAILED') return 'failed';
  if (cur === 'FINISH' && was !== 'FINISH' && isActive(old)) return 'finished';
  return null;
}

/// Bambu nozzles top out near 300°, beds near 110°; a heater may drift 15° over its target. Heat creep is
/// a hotend above 60° with its heater off that is still rising between two reports.
export const LIMITS = { nozzle: 300, bed: 110, overshoot: 15, creepFloor: 60, creepRise: 1 };

/// { kind, value, message } for the worst thermal problem, or null.
export function thermalAlert(prev, now) {
  if (!now || now.phase === 'offline') return null;
  const r = Math.round;
  if (now.nozzleC != null && now.nozzleC > LIMITS.nozzle) return { kind: 'nozzleHot', value: r(now.nozzleC), message: `Nozzle is at ${r(now.nozzleC)}°, above the safe limit.` };
  if (now.bedC != null && now.bedC > LIMITS.bed) return { kind: 'bedHot', value: r(now.bedC), message: `Bed is at ${r(now.bedC)}°, above the safe limit.` };
  if (now.nozzleC != null && now.nozzleTargetC > 0 && now.nozzleC > now.nozzleTargetC + LIMITS.overshoot) {
    const o = r(now.nozzleC - now.nozzleTargetC); return { kind: 'nozzleOvershoot', value: o, message: `Nozzle is ${o}° over its target.` };
  }
  if (now.bedC != null && now.bedTargetC > 0 && now.bedC > now.bedTargetC + LIMITS.overshoot) {
    const o = r(now.bedC - now.bedTargetC); return { kind: 'bedOvershoot', value: o, message: `Bed is ${o}° over its target.` };
  }
  if (now.phase === 'idle' && now.nozzleC > LIMITS.creepFloor && !(now.nozzleTargetC > 0) && prev?.nozzleC != null && now.nozzleC >= prev.nozzleC + LIMITS.creepRise) {
    return { kind: 'heatCreep', value: r(now.nozzleC), message: `Nozzle is still climbing (${r(now.nozzleC)}°) with the heater off. Check the hotend fan and cooling.` };
  }
  return null;
}

export const PIN_MISMATCH_HINT = 'certificate changed';
