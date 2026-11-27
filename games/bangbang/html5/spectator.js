/** Camera-only death spectating. Source: NormalScrollManager.onTankDead,
 * enableChangeTank/changeScrollTank and onSelfTankInit. No game packet or
 * actor ownership is changed. A fresh state object resets even if scene IDs
 * are reused by the native server for the next match.
 */
export class SpectatorCamera {
  constructor() { this.reset(); }

  reset() {
    this.state = null; this.lifeKey = null; this.followObjectId = null;
    this.deathAt = null; this.enabledAt = null; this.mode = 'self';
    this.selfObjectId = null; this.eligibleObjectIds = []; this.canSwitch = false;
  }

  update(state, now) {
    if (!Number.isFinite(now)) throw new TypeError('A monotonic camera time is required');
    if (this.state !== state) { this.reset(); this.state = state; }
    const self = state?.actors?.[String(state.selfObjectId)];
    this.selfObjectId = self?.objectId ?? null;
    this.canSwitch = false; this.eligibleObjectIds = [];
    if (!self) { this.mode = 'waiting'; this.followObjectId = null; return this.snapshot(); }
    if (state.result) { this.mode = 'result'; return this.snapshot(); }
    if (!self.dead && !self.removed && self.hp > 0) {
      this.mode = 'self'; this.followObjectId = self.objectId;
      this.lifeKey = null; this.deathAt = null; this.enabledAt = null;
      return this.snapshot();
    }
    const lifeKey = `${self.objectId}:${self.lifeEpoch}:${self.deathAt ?? ''}`;
    if (this.lifeKey !== lifeKey) {
      this.lifeKey = lifeKey; this.deathAt = self.deathAt ?? now;
      this.enabledAt = this.deathAt + 2000; this.followObjectId = self.objectId;
    }
    this.eligibleObjectIds = Object.values(state.actors).filter(actor =>
      actor.objectId !== self.objectId && actor.camp === self.camp
      && actor.hp > 0 && !actor.dead && !actor.removed).map(actor => actor.objectId);
    if (now < this.enabledAt) { this.mode = 'death-delay'; return this.snapshot(); }
    this.canSwitch = this.eligibleObjectIds.length > 0;
    if (!this.eligibleObjectIds.includes(this.followObjectId)) {
      this.followObjectId = this.eligibleObjectIds[0] ?? self.objectId;
    }
    this.mode = this.canSwitch ? 'spectating' : 'waiting';
    return this.snapshot();
  }

  next(state, now) {
    this.update(state, now);
    if (!this.canSwitch) return false;
    const index = this.eligibleObjectIds.indexOf(this.followObjectId);
    this.followObjectId = this.eligibleObjectIds[(index + 1) % this.eligibleObjectIds.length];
    return true;
  }

  selectAccount(state, accountId, now) {
    this.update(state, now);
    if (!this.canSwitch) return false;
    const actor = Object.values(state.actors).find(value => value.accountId === accountId
      && this.eligibleObjectIds.includes(value.objectId));
    if (!actor) return false;
    this.followObjectId = actor.objectId;
    return true;
  }

  snapshot() {
    return {mode: this.mode, selfObjectId: this.selfObjectId, followObjectId: this.followObjectId,
      eligibleObjectIds: [...this.eligibleObjectIds], enabledAt: this.enabledAt,
      canSwitch: this.canSwitch, deathAt: this.deathAt};
  }
}
