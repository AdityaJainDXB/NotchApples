import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load.mjs';

const L = await loadModule('services/bambulogic.js');
const snap = (o) => ({ ...L.emptySnapshot(), ...o });

test('remaining time is minutes, not seconds', () => {
  const s = L.apply({ print: { gcode_state: 'RUNNING', mc_remaining_time: 84 } }, L.waiting());
  assert.equal(s.remainingMinutes, 84);
  assert.equal(L.remainingLabel(s.remainingMinutes), '1h 24m left');
});
test('reports are deltas: a missing field keeps its value', () => {
  let s = L.apply({ print: { gcode_state: 'RUNNING', mc_percent: 40, nozzle_temper: 215, nozzle_target_temper: 220 } }, L.waiting());
  s = L.apply({ print: { bed_temper: 60 } }, s);
  assert.equal(s.progress, 40); assert.equal(s.nozzleTargetC, 220); assert.equal(s.bedC, 60); assert.equal(s.phase, 'printing');
});
test('pause and finish are events, a repeat is not', () => {
  assert.equal(L.printEvent(snap({ phase: 'printing', gcodeState: 'RUNNING' }), snap({ phase: 'paused', gcodeState: 'PAUSE' })), 'paused');
  assert.equal(L.printEvent(snap({ phase: 'printing', gcodeState: 'RUNNING' }), snap({ phase: 'idle', gcodeState: 'FINISH' })), 'finished');
  assert.equal(L.printEvent(snap({ phase: 'printing', gcodeState: 'RUNNING' }), snap({ phase: 'idle', gcodeState: 'FAILED' })), 'failed');
  assert.equal(L.printEvent(snap({ phase: 'idle', gcodeState: 'FINISH' }), snap({ phase: 'idle', gcodeState: 'FINISH' })), null);
  assert.equal(L.printEvent(snap({ phase: 'offline' }), snap({ phase: 'paused', gcodeState: 'PAUSE' })), null);
});
test('thermal alerts: limits, overshoot, creep', () => {
  assert.equal(L.thermalAlert(null, snap({ phase: 'printing', nozzleC: 305 })).kind, 'nozzleHot');
  assert.equal(L.thermalAlert(null, snap({ phase: 'printing', bedC: 115 })).kind, 'bedHot');
  assert.equal(L.thermalAlert(null, snap({ phase: 'printing', nozzleC: 240, nozzleTargetC: 220 })).value, 20);
  assert.equal(L.thermalAlert(null, snap({ phase: 'printing', nozzleC: 225, nozzleTargetC: 220, bedC: 62, bedTargetC: 60 })), null);
  const before = snap({ phase: 'idle', nozzleC: 80, nozzleTargetC: 0 });
  assert.equal(L.thermalAlert(before, snap({ phase: 'idle', nozzleC: 83, nozzleTargetC: 0 })).kind, 'heatCreep');
  assert.equal(L.thermalAlert(before, snap({ phase: 'idle', nozzleC: 76, nozzleTargetC: 0 })), null);
  assert.equal(L.thermalAlert(snap({ phase: 'idle', nozzleC: 30 }), snap({ phase: 'idle', nozzleC: 33 })), null);
  assert.equal(L.thermalAlert(null, snap({ phase: 'offline', nozzleC: 400 })), null);
});
test('the printer address is read from its little-endian number, and the video address is built safely', () => {
  assert.equal(L.ipFromNumber(1677830336), '192.168.1.100');
  assert.equal(L.ipFromNumber(0), null); assert.equal(L.ipFromNumber(-1), null); assert.equal(L.ipFromNumber(2 ** 32), null);
  assert.equal(L.rtspsAddress('192.168.1.100', 'ab12cd34'), 'rtsps://bblp:ab12cd34@192.168.1.100:322/streaming/live/1');
  assert.equal(L.rtspsAddress('10.0.0.2', 'a@b/c'), 'rtsps://bblp:a%40b%2Fc@10.0.0.2:322/streaming/live/1');
  assert.equal(L.rtspsAddress('evil.example.com', 'x'), null);
});
test('the report gives the printer its address and, for video printers, the stream address', () => {
  const s = L.apply({ print: { gcode_state: 'IDLE', net: { conf: 0, info: [{ ip: 0 }, { ip: 1677830336 }] }, ipcam: { rtsp_url: 'rtsps://192.168.1.100:322/streaming/live/1' } } }, L.waiting());
  assert.equal(s.ip, '192.168.1.100'); assert.match(s.rtspsUrl, /^rtsps:/);
  assert.equal(L.apply({ print: { ipcam: { rtsp_url: 'disable' } } }, s).rtspsUrl, null);
});
