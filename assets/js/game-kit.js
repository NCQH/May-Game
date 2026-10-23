// Shared browser helpers for Máy Game pages: saved record, status announcements and a small synth.
// Loaded as a module before each game's own script; exposes globalThis.MayGameKit.
const PREFIX = "may-game:v1:";

function createStore(id) {
  const key = PREFIX + id;
  return {
    read() {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
      } catch { return null; }
    },
    write(record) {
      try { localStorage.setItem(key, JSON.stringify({ ...record, version: record.version ?? 1, updatedAt: Date.now() })); return true; }
      catch { return false; } // Keep playing when storage is disabled or full.
    },
  };
}

// Notes are [frequency, startOffsetSeconds, durationSeconds, wave?]; gain stays near -20 dBFS.
function createTone(isMuted) {
  let audio = null;
  const unlock = () => {
    if (isMuted()) return null;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return null;
      audio ||= new Audio();
      if (audio.state === "suspended") audio.resume().catch(() => {});
      return audio;
    } catch { return null; }
  };
  return {
    unlock,
    play(notes, gain = .1) {
      const context = unlock();
      if (!context || context.state !== "running") return;
      const now = context.currentTime;
      for (const [frequency, start = 0, duration = .08, wave = "square"] of notes) {
        const oscillator = context.createOscillator();
        const volume = context.createGain();
        oscillator.type = wave;
        oscillator.frequency.setValueAtTime(frequency, now + start);
        volume.gain.setValueAtTime(gain, now + start);
        volume.gain.exponentialRampToValueAtTime(.001, now + start + duration);
        oscillator.connect(volume).connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); volume.disconnect(); };
        oscillator.start(now + start);
        oscillator.stop(now + start + duration + .02);
      }
    },
  };
}

function createAnnouncer(element) {
  let timer = 0;
  return (text) => {
    if (!element) return;
    clearTimeout(timer);
    element.textContent = "";
    // Re-set after a tick so repeated messages are announced again.
    timer = setTimeout(() => { element.textContent = text; }, 30);
  };
}

globalThis.MayGameKit = { createStore, createTone, createAnnouncer };
