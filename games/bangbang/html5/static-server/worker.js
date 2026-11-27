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
  self.postMessage({ buffers: { AUTH: buffers.AUTH.sab, GATE: buffers.GATE.sab } });
  self.postMessage({ ready: true, profile });
  for (const role of ROLES) { send(role, frames.handshake); handshook[role] = true; }
  started = true;
  setInterval(() => { for (const role of ROLES) { let data; while ((data = drain(role))) handle(role, data); } }, 8);
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
