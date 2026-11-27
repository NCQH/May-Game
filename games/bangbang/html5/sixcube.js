/* Bang Bang HTML5 M1 transport: records the original wire protocol, not gameplay. */
export class SixcubeStream {
  constructor(onFrame = () => {}, onHandshake = () => {}) {
    this.onFrame = onFrame;
    this.onHandshake = onHandshake;
    this.buffer = new Uint8Array(0);
    this.ready = false;
  }
  push(chunk) {
    if (!(chunk instanceof Uint8Array)) chunk = new Uint8Array(chunk);
    const next = new Uint8Array(this.buffer.length + chunk.length);
    next.set(this.buffer, 0); next.set(chunk, this.buffer.length);
    this.buffer = next;
    if (!this.ready) {
      if (this.buffer.length < 2) return;
      if (this.buffer[0] !== 0 || this.buffer[1] !== 0)
        throw new Error('Expected Flash CNetConnection 00 00 handshake');
      this.buffer = this.buffer.slice(2);
      this.ready = true;
      this.onHandshake();
    }
    while (this.buffer.length >= 2) {
      const length = this.buffer[0] | (this.buffer[1] << 8);
      if (length < 8 || length > 65535) throw new Error('Bad Sixcube frame length: ' + length);
      if (this.buffer.length < length) break;
      const frame = this.buffer.slice(0, length);
      const msgId = frame[2] | (frame[3] << 8);
      this.onFrame({ msgId, payload: frame.slice(8), raw: frame });
      this.buffer = this.buffer.slice(length);
    }
    if (this.buffer.length > 1024 * 1024) throw new Error('Stream buffer overflow');
  }
}
export function encodeFrame(msgId, payload = new Uint8Array()) {
  if (!(payload instanceof Uint8Array)) payload = new Uint8Array(payload);
  const size = payload.length + 8;
  if (size > 65535 || msgId < 0 || msgId > 65535 || !Number.isInteger(msgId)) throw Error('Frame out of range');
  const frame = new Uint8Array(size);
  const dv = new DataView(frame.buffer);
  dv.setUint16(0, size, true); dv.setUint16(2, msgId, true); dv.setUint32(4, 0, true);
  frame.set(payload, 8);
  return frame;
}
export function versionProbe() {
  // Diagnostic only: triggers the AUTH version-ack branch of sixcube_server.py.
  return encodeFrame(0x0034, new TextEncoder().encode('curVersion=1.0.1.8480'));
}
