import {isPveMap} from './m81314_protocol.js';
import {aiNpcTemplate} from './tank_appearance.js';

const scoped = state => Number(state?.roomType) === 4 && isPveMap(state?.mapId);
const uint = value => Number.isFinite(Number(value)) && Number(value) >= 0
  ? Math.trunc(Number(value)) : 0;

/** PveObjManager/BossHpView: a group's denominator grows on unique NPC_ADD,
 * does not shrink on NPC_REMOVE, and resets only when that group is empty.
 * This is presentation state only; HP/outcomes are never computed locally. */
export class PveBossGroups {
  constructor() { this.reset(); }
  reset() { this.scene = null; this.groups = new Map(); this.members = new Map(); }

  add(object, catalog) {
    const template = aiNpcTemplate(catalog, object);
    if (Number(template?.nAIType) !== 1 || this.members.has(object.objectId)) return;
    const groupId = uint(template.nBossGroup), maximum = uint(object.maxHp);
    if (!maximum) return;
    let group = this.groups.get(groupId);
    if (!group) {
      group = {groupId, name: template.szName || '', maximum: 0, ids: new Set()};
      this.groups.set(groupId, group);
    }
    group.maximum += maximum;
    group.ids.add(object.objectId);
    this.members.set(object.objectId, groupId);
  }

  remove(objectId) {
    if (!this.members.has(objectId)) return;
    const groupId = this.members.get(objectId), group = this.groups.get(groupId);
    this.members.delete(objectId);
    group.ids.delete(objectId);
    if (!group.ids.size) this.groups.delete(groupId);
  }

  consume(events, state, catalog) {
    if (!scoped(state)) { this.reset(); return; }
    if (this.scene !== state) { this.reset(); this.scene = state; }
    // Preserve packet order even if ADD, REMOVE and ID reuse happen between
    // two RAFs. NPC_ADD carries its own maximum, not a later object's HP cap.
    for (const event of events) {
      if (event.kind === 'npcAdd') this.add(event, catalog);
      else if (event.kind === 'objectRemoved') this.remove(event.objectId);
    }
    // A fresh observer may attach to a native reconnect snapshot after the
    // effect queue was drained. Only present authoritative objects seed it.
    for (const id of state.objectOrder || Object.keys(state.objects || {})) {
      const object = state.objects[String(id)];
      if (object && !object.removed) this.add(object, catalog);
    }
    for (const id of [...this.members.keys()]) {
      if (!state.objects[String(id)] || state.objects[String(id)].removed) this.remove(id);
    }
  }

  rows(state = this.scene) {
    if (!scoped(state) || state !== this.scene) return [];
    return [...this.groups.values()].map(group => {
      const hp = [...group.ids].reduce((sum, id) => {
        const object = state.objects[String(id)];
        return sum + (object && !object.removed ? uint(object.hp) : 0);
      }, 0);
      const nativeFrame = Math.trunc(hp * 100 / group.maximum);
      return {groupId: group.groupId, name: group.name, hp, maxHp: group.maximum,
        objectIds: [...group.ids], nativeFrame,
        // MovieClip's source frame1 is the empty-fill border, frame100 full.
        frameIndex: Math.max(0, Math.min(99, nativeFrame - 1))};
    });
  }
}

/** Original 458×33 movie, at worldHeight−120 and 43px spacing. Art uses the
 * battle's existing GPU/CPU surface; labels use its existing HUD text layer. */
export class PveBossHud extends PveBossGroups {
  draw(view, state) {
    if (!scoped(state) || state.result || !view.prepared?.pveBossCatalog) return;
    const bar = view.prepared.pveBossCatalog.bossBar, context = view.context;
    const left = Math.trunc((view.width - bar.width) / 2);
    this.rows(state).forEach((row, index) => {
      const top = view.height - bar.bottomOffset - bar.rowHeight * index;
      const frame = bar.frames[row.frameIndex], asset = frame?.asset || bar.asset;
      const image = view.store.image(asset);
      if (!frame || !image) return; // Asset gate reports absence; no fake bar.
      view.surface.draw(image, {sx: frame.sx, sy: frame.sy, sw: frame.w, sh: frame.h,
        x: left + frame.offsetX + frame.w / 2, y: top + frame.offsetY + frame.h / 2,
        width: frame.w, height: frame.h});
      context.save();
      context.textBaseline = 'top'; context.textAlign = 'center';
      context.font = 'bold 16px Verdana, sans-serif'; context.fillStyle = '#fff';
      context.strokeStyle = '#121500'; context.lineWidth = 2;
      const hpLabel = `${row.hp}/${row.maxHp}`;
      context.strokeText(hpLabel, left + bar.width / 2, top + 5);
      context.fillText(hpLabel, left + bar.width / 2, top + 5);
      context.font = 'bold 22px "Microsoft YaHei", Tahoma, sans-serif';
      context.textAlign = 'right';
      const gradient = context.createLinearGradient(0, top, 0, top + 27);
      gradient.addColorStop(0, '#ffff00'); gradient.addColorStop(1, '#ff7c00');
      context.fillStyle = gradient; context.strokeStyle = '#4d1700'; context.lineWidth = 4;
      // Native name label occupies [-200,0] relative to the bar, never the bar.
      context.strokeText(row.name, left, top, 200);
      context.fillText(row.name, left, top, 200);
      context.restore();
    });
  }
  snapshot(state = this.scene) { return {active: scoped(state), rows: this.rows(state)}; }
}
