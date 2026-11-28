// Static BangBang lobby server: replays verified AUTH/GATE frames, no Python.
const ROLES = ['AUTH', 'GATE'];
const buffers = {
  AUTH: makeBuffer(),
  GATE: makeBuffer(),
};
function makeBuffer() {
  const sab = new SharedArrayBuffer(2 * 1024 * 1024);
  return { sab, header: new Int32Array(sab, 0, 4), data: new Uint8Array(sab, 16) };
}
const b64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};
function msgIdOf(bytes) { return bytes.length >= 4 ? bytes[2] | (bytes[3] << 8) : 0; }
function patchEnter(stream, name) {
  let off = 0;
  while (off + 8 <= stream.length) {
    const len = stream[off] | (stream[off + 1] << 8);
    const id = stream[off + 2] | (stream[off + 3] << 8);
    if (id === 1016 && off + 136 <= stream.length) {
      const oldLen = stream[off + 134] | (stream[off + 135] << 8);
      const text = new TextEncoder().encode((name || 'Người chơi').slice(0, 32));
      const frame = new Uint8Array(len + text.length - oldLen);
      frame.set(stream.subarray(off, off + 134), 0);
      frame[134] = text.length & 255; frame[135] = text.length >> 8;
      frame.set(text, 136);
      frame.set(stream.subarray(off + 136 + oldLen, off + len), 136 + text.length);
      new DataView(frame.buffer).setUint16(0, frame.length, true);
      const out = new Uint8Array(stream.length + text.length - oldLen);
      out.set(stream.subarray(0, off), 0);
      out.set(frame, off);
      out.set(stream.subarray(off + len), off + frame.length);
      return out;
    }
    if (!len) break;
    off += len;
  }
  return stream;
}

function patchNamed(stream, name) {
  const target = new TextEncoder().encode('M2 Test');
  const replacement = new TextEncoder().encode((name || 'Người chơi').slice(0, 32));
  let out = stream;
  for (let guard = 0; guard < 8; guard++) {
    let idx = -1;
    for (let i = 0; i + target.length <= out.length; i++) {
      let ok = true;
      for (let j = 0; j < target.length; j++) if (out[i + j] !== target[j]) { ok = false; break; }
      if (ok) { idx = i; break; }
    }
    if (idx < 2) break;
    const oldLen = out[idx - 2] | (out[idx - 1] << 8);
    if (oldLen !== target.length) break;
    let frameOff = -1, frameLen = 0, off = 0;
    while (off + 8 <= out.length) {
      const len = out[off] | (out[off + 1] << 8);
      if (off <= idx && idx < off + len) { frameOff = off; frameLen = len; break; }
      if (!len) break;
      off += len;
    }
    if (frameOff < 0) break;
    const delta = replacement.length - oldLen;
    const frame = new Uint8Array(frameLen + delta);
    const nameAt = idx - 2 - frameOff;
    frame.set(out.subarray(frameOff, idx - 2), 0);
    frame[nameAt] = replacement.length & 255;
    frame[nameAt + 1] = replacement.length >> 8;
    frame.set(replacement, nameAt + 2);
    frame.set(out.subarray(idx + target.length, frameOff + frameLen), nameAt + 2 + replacement.length);
    new DataView(frame.buffer).setUint16(0, frame.length, true);
    const next = new Uint8Array(out.length + delta);
    next.set(out.subarray(0, frameOff), 0);
    next.set(frame, frameOff);
    next.set(out.subarray(frameOff + frameLen), frameOff + frame.length);
    out = next;
  }
  return out;
}


class R {
  constructor(b) { this.b = b; this.o = 0; }
  u8() { const v = this.b[this.o]; this.o += 1; return v; }
  u16() { const v = this.b[this.o] | (this.b[this.o + 1] << 8); this.o += 2; return v; }
  i16() { const v = this.u16(); return v >= 0x8000 ? v - 0x10000 : v; }
  u32() { const v = (this.b[this.o] | (this.b[this.o + 1] << 8) | (this.b[this.o + 2] << 16) | (this.b[this.o + 3] << 24)) >>> 0; this.o += 4; return v; }
  i32() { return this.u32() | 0; }
}
class W {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 255); return this; }
  u16(v) { this.a.push(v & 255, (v >> 8) & 255); return this; }
  i16(v) { return this.u16(v & 0xffff); }
  u32(v) { this.a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); return this; }
  i32(v) { return this.u32(v >>> 0); }
  bytes() { return new Uint8Array(this.a); }
}
function encode(id, w) {
  const p = w.bytes(), f = new Uint8Array(p.length + 8), dv = new DataView(f.buffer);
  dv.setUint16(0, f.length, true); dv.setUint16(2, id, true); f.set(p, 8); return f;
}
const battle = { player: null, npcs: [], bullet: 1 };
function parseBattle(stream) {
  let off = 0;
  while (off + 8 <= stream.length) {
    const len = stream[off] | (stream[off + 1] << 8);
    const id = stream[off + 2] | (stream[off + 3] << 8);
    const p = stream.subarray(off + 8, off + len);
    if (id === 1550) {
      const r = new R(p);
      battle.player = { objectId: r.u32(), accountId: r.u32(), x: r.i16(), y: r.i16(), hp: r.i32(), maxHp: r.i32() };
    } else if (id === 1556) {
      const r = new R(p); r.u32();
      const o = { objectId: r.u32(), templateId: r.u32(), x: r.i16(), y: r.i16(), hp: r.i32(), camp: r.u8(), maxHp: r.i32() };
      if (o.hp > 0 && o.camp === 0) battle.npcs.push(o);
    }
    if (!len) break;
    off += len;
  }
}
function sceneUpdate({ moves = [], fires = [], hp = [], deaths = [] } = {}) {
  const w = new W();
  w.u8(moves.length);
  for (const m of moves) { w.u32(m.objectId).i16(m.x).i16(m.y).i16(m.speed).u8(m.direction).u8(m.moveType || 0); }
  w.u8(fires.length);
  for (const f of fires) { w.u32(f.bulletId).u32(f.objectId).i16(f.startX).i16(f.startY).i16(f.destX).i16(f.destY).i16(f.speed).u32(f.templateId); }
  w.u8(0); // skills
  w.u8(hp.length);
  for (const h of hp) { w.u32(h.objectId).i32(h.hp); }
  w.u8(deaths.length);
  for (const d of deaths) { w.u32(d.npcId).i16(d.x).i16(d.y); }
  w.u8(0).u8(0).u8(0).u8(0); // mp, blown, removed, expired
  w.u8(0); // shields
  return encode(1564, w);
}

function drain(role) {
  const b = buffers[role];
  const len = Atomics.load(b.header, 0);
  if (len <= 0) return null;
  const bytes = b.data.slice(0, len);
  Atomics.store(b.header, 0, 0);
  return bytes;
}
function send(role, bytes) { self.postMessage({ role, out: Array.from(bytes) }); }

let frames;
let profile = { name: '', body: '' };
let token = 'js-offline-token';
let enter = null;
let started = false;
let handshook = { AUTH: false, GATE: false };
let initDone;
const initPromise = new Promise((resolve) => { initDone = resolve; });

async function load() {
  frames = {};
  const raw = await (await fetch(new URL('./frames.json', import.meta.url), { cache: 'no-store' })).json();
  for (const [key, value] of Object.entries(raw)) frames[key] = b64(value);
  await Promise.race([initPromise, new Promise((resolve) => setTimeout(resolve, 100))]);
  enter = patchEnter(frames.gateEnter, profile.name);
  parseBattle(patchNamed(frames.entryBattle, profile.name));
  self.postMessage({ buffers: { AUTH: buffers.AUTH.sab, GATE: buffers.GATE.sab } });
  self.postMessage({ ready: true, profile });
  for (const role of ROLES) { send(role, frames.handshake); handshook[role] = true; }
  started = true;
  setInterval(() => { for (const role of ROLES) { let data; while ((data = drain(role))) handle(role, data); } }, 8);
}

function movePlayer(role, data) {
  if (!battle.player) return;
  const r = new R(data.subarray(8));
  const x = r.u16(), y = r.u16(), dir = r.u8(); r.u32();
  const step = [[-17, -17], [0, -24], [17, -17], [24, 0], [17, 17], [0, 24], [-17, 17], [-24, 0]][dir] || [0, 0];
  battle.player.x = x + step[0]; battle.player.y = y + step[1];
  send(role, sceneUpdate({ moves: [{ objectId: battle.player.objectId, x: battle.player.x, y: battle.player.y, speed: 240, direction: dir }] }));
}
function useSkill(role, data) {
  if (!battle.player) return;
  const r = new R(data.subarray(8));
  r.u32(); const target = r.u32(); r.u8(); const dx = r.i16(), dy = r.i16();
  let best = null, bestD = Infinity;
  for (const npc of battle.npcs) {
    const d = (npc.x - (dx || battle.player.x)) ** 2 + (npc.y - (dy || battle.player.y)) ** 2;
    if (d < bestD) { bestD = d; best = npc; }
  }
  if (!best) return;
  const damage = target && target === best.objectId ? 200 : 50;
  best.hp = Math.max(0, best.hp - damage);
  const fires = [{ bulletId: battle.bullet++, objectId: battle.player.objectId,
    startX: battle.player.x, startY: battle.player.y, destX: best.x, destY: best.y, speed: 1200, templateId: 0 }];
  const hp = [{ objectId: best.objectId, hp: best.hp }];
  const deaths = best.hp <= 0 ? [{ npcId: best.objectId, x: best.x, y: best.y }] : [];
  if (best.hp <= 0) battle.npcs = battle.npcs.filter((n) => n !== best);
  send(role, sceneUpdate({ fires, hp, deaths }));
}

function handle(role, data) {
  if (!frames || data.length < 4) return;
  const id = msgIdOf(data);
  if (role === 'AUTH') {
    if (id === 52) send(role, frames.auth903);
    else if (id === 51) send(role, frames.authLogin);
    return;
  }
  if (id === 52) send(role, frames.gate903);
  else if (id === 54) send(role, frames.gate1008);
  else if (id === 56) send(role, enter);
  else if (id === 72) send(role, frames.gateGarage);
  else if (id === 165) send(role, concat(frames.gateExtra1100, frames.gateFinal));
  else if (id === 600) send(role, patchNamed(frames.room1700, profile.name));
  else if (id === 602) send(role, patchNamed(frames.battle1705, profile.name));
  else if (id === 605) send(role, frames.load1709);
  else if (id === 552) {
    send(role, concat(frames.load1709, patchNamed(frames.entryBattle, profile.name)));
    parseBattle(patchNamed(frames.entryBattle, profile.name));
    setTimeout(() => send(role, frames.tickBattle), 3000);
  }
  else if (id === 501) movePlayer(role, data);
  else if (id === 503) useSkill(role, data);
  else if (id === 61) send(role, frames.tick);
}

self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type === 'init') {
    profile = { name: String(data.profile?.name || ''), body: String(data.profile?.body || '') };
    if (initDone) { initDone(); initDone = null; }
    if (started) enter = patchEnter(frames.gateEnter, profile.name);
  } else if (data.type === 'create') {
    profile = { name: String(data.name || '').slice(0, 32), body: String(data.body || '').slice(0, 80) };
    enter = patchEnter(frames.gateEnter, profile.name);
    self.postMessage({ token });
  }
};

load().catch((error) => self.postMessage({ fatal: String(error && error.stack || error) }));
