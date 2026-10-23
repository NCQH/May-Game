// Runs the Cờ tướng search off the main thread. game.js skips its browser adapter here (no `document`).
importScripts("./game.js?v=1");

self.onmessage = (event) => {
  const { id, moves, level, seed } = event.data || {};
  const pos = positionFromMoves(moves);
  const found = pos ? searchBest(pos, { level, random: seededRandom(seed) }) : null;
  self.postMessage({ id, move: found ? found.move : null });
};
