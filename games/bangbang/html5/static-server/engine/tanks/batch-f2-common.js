/* Shared helpers for the batch-F2 ports (no core edits).
 *
 * Python struct.pack('<I', x) is `packI`; `choose` adapts random.choice to the
 * JS core's function RNG. `flightPending`/`pendingFlight` replace the Python
 * arena.pending callback.__self__/__name__ probes with the JS entry shape.
 */
import { pyRound } from '../math.js';

/** Python struct.pack('<I', value). */
export function packI(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

/** Python random.choice(items) over a function RNG. */
export function choose(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

/** Stable key for a Python tuple identity (id, generation, ...). */
export function keyOf(value) {
  return Array.isArray(value) ? value.join(',') : String(value);
}

/** True when this actor still owns a queued flight matching `predicate`. */
export function flightPending(actor, predicate = () => true) {
  return actor.arena.pending.some(entry => entry.callback?.__owner === actor
    && entry.args?.[0] === 'flight' && entry.args[1]?.[0]
    && predicate(entry.args[1][0]));
}

/** Newest queued flight this actor owns; optional predicate. */
export function lastFlight(actor, predicate = () => true) {
  const entries = actor.arena.pending.filter(entry => entry.callback?.__owner === actor
    && entry.args?.[0] === 'flight' && entry.args[1]?.[0]
    && predicate(entry.args[1][0]));
  entries.sort((a, b) => (b.due - a.due) || (b.order - a.order));
  return entries.length ? entries[0].args[1][0] : null;
}

/** Python round(n) on a number. */
export function roundInt(value) { return pyRound(value); }
