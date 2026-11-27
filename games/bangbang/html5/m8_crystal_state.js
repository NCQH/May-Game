/* Pure native crystal view state and local draft validation. The authoritative
 * bag/wallet/owned tanks are maintained by m8_meta_state; rewards never add items.
 */

const idsEqual = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === b.length && a.every((id, index) => id === b[index]);
const copyBoard = board => ({boardId: board.boardId, name: board.name ?? '',
  items: board.items ? [...board.items] : null});

export function createCrystalState() {
  return {revision: 0, boards: {}, namesReady: false, detailsReady: false,
    limits: {}, lastResult: null, lastAward: null, lastTip: null};
}

export function applyCrystalPacket(state, packet) {
  if (!state || !packet) return state;
  const revision = state.revision + 1;
  switch (packet.type) {
    case 'crystalNames': {
      const boards = Object.fromEntries(packet.boards.map(b => [b.boardId,
        {boardId: b.boardId, name: b.name, items: state.boards[b.boardId]?.items ?? null}]));
      return {...state, revision, boards, namesReady: true};
    }
    case 'crystalBoards': {
      const boards = Object.fromEntries(packet.boards.map(b => [b.boardId,
        {boardId: b.boardId, name: state.boards[b.boardId]?.name ?? '', items: [...b.items]}]));
      return {...state, revision, boards, detailsReady: true};
    }
    case 'limits': {
      const observed = packet.limits.filter(l => l.limitId === 284 || l.limitId === 285);
      if (!observed.length) return state;
      return {...state, revision, limits: {...state.limits,
        ...Object.fromEntries(observed.map(l => [l.limitId, l.count]))}};
    }
    case 'crystalSaveResult': case 'crystalNameResult':
      return {...state, revision, lastResult: {type: packet.type, result: packet.result, revision}};
    case 'crystalSellNotified':
      return {...state, revision, lastResult: {type: packet.type, itemId: packet.itemId, revision}};
    case 'settleAward':
      if (![8, 19].includes(packet.kind)) return state;
      return {...state, revision, lastAward: {kind: packet.kind, isShow: packet.isShow,
        extra: packet.extra, award: structuredClone(packet.award), revision}};
    case 'systemError':
      if (![423, 424, 425, 426, 427, 430, 155].includes(packet.requestId)) return state;
      return {...state, revision, lastTip: {requestId: packet.requestId, errorId: packet.errorId,
        params: [...packet.params], revision}};
    default: return state;
  }
}

export function snapshotCrystalState(state) {
  return {...state, boards: Object.fromEntries(Object.entries(state.boards).map(([id, b]) => [id, copyBoard(b)])),
    limits: {...state.limits}, lastResult: state.lastResult ? {...state.lastResult} : null,
    lastAward: state.lastAward ? structuredClone(state.lastAward) : null,
    lastTip: state.lastTip ? {...state.lastTip, params: [...state.lastTip.params]} : null};
}

function countIds(items) {
  const result = {};
  for (const id of items || []) if (id) result[id] = (result[id] || 0) + 1;
  return result;
}

export function crystalOwnedCounts(meta) {
  const result = {};
  for (const item of meta?.containers?.[10]?.items || []) {
    if (Number.isInteger(item.count) && item.count > 0)
      result[item.templateId] = (result[item.templateId] || 0) + item.count;
  }
  return result;
}

/** The same copy can appear on several boards: reserve the maximum, not sum. */
export function crystalReservedCounts(state) {
  const result = {};
  for (const board of Object.values(state?.boards || {})) {
    for (const [id, count] of Object.entries(countIds(board.items)))
      result[id] = Math.max(result[id] || 0, count);
  }
  return result;
}

export function crystalSellableCounts(meta, state) {
  const owned = crystalOwnedCounts(meta), reserved = crystalReservedCounts(state);
  return Object.fromEntries(Object.entries(owned).map(([id, count]) => [id, Math.max(0, count - (reserved[id] || 0))]));
}

export function validateCrystalBoard(items, meta, catalog) {
  const errors = [];
  if (!Array.isArray(items) || items.length !== 30)
    return {valid: false, errors: ['Bảng phải có đúng 30 ô.'], counts: {}};
  const counts = countIds(items), owned = crystalOwnedCounts(meta);
  items.forEach((id, index) => {
    const slot = catalog.slots.find(s => s.position === index + 1), item = catalog.items[id];
    if (!Number.isInteger(id) || id < 0 || id > 0xffffffff || (id && (!item || item.type !== slot?.type)))
      errors.push(`Ô ${index + 1}: tinh thể không đúng loại ô.`);
  });
  for (const [id, count] of Object.entries(counts)) {
    if (count > (owned[id] || 0)) errors.push(`${catalog.items[id]?.name || 'Tinh thể'}: không đủ số lượng sở hữu.`);
  }
  return {valid: errors.length === 0, errors, counts};
}

export function createCrystalDraft(board) {
  if (!board?.items || board.items.length !== 30) return null;
  return {boardId: board.boardId, items: [...board.items], baseItems: [...board.items], conflict: false};
}

export function crystalDraftChanged(draft) { return !!draft && !idsEqual(draft.items, draft.baseItems); }

/** Unrelated snapshots and failure resyncs never erase an unsaved local draft. */
export function reconcileCrystalDraft(draft, board) {
  if (!board?.items) return draft;
  if (!draft || draft.boardId !== board.boardId || !crystalDraftChanged(draft)) return createCrystalDraft(board);
  return {...draft, conflict: !idsEqual(draft.baseItems, board.items)};
}

/** Call only with the matching native S1456 acknowledgement. */
export function acknowledgeCrystalDraft(draft, board, packet) {
  if (!draft || packet?.type !== 'crystalSaveResult' || packet.result !== 0
      || board?.boardId !== draft.boardId || !idsEqual(draft.items, board.items)) return draft;
  return createCrystalDraft(board);
}

export function crystalGuaranteeRemaining(state, limitId) {
  const count = state?.limits?.[limitId];
  return Number.isInteger(count) && count >= 0 && count <= 4 ? 5 - count : null;
}
