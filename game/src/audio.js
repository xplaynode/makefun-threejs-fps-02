// audio.js -- all audio is generated with WebAudio; there are no files.
// Shots are filtered noise bursts plus a low thump, reloads are short timed
// clicks, the charge beeps, and hits produce ticks. A single shared noise
// buffer plus a few oscillators cover everything, with loudness scaled by
// distance from the listener (the player).

let audioCtx = null;
let masterBus = null;
let sharedNoise = null;

export function initAudio() {
  if (audioCtx) return;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  audioCtx = new Ctor();
  masterBus = audioCtx.createGain();
  masterBus.gain.value = 0.5;
  masterBus.connect(audioCtx.destination);
  const sampleCount = audioCtx.sampleRate * 0.5;
  sharedNoise = audioCtx.createBuffer(1, sampleCount, audioCtx.sampleRate);
  const channel = sharedNoise.getChannelData(0);
  for (let idx = 0; idx < sampleCount; idx++) channel[idx] = Math.random() * 2 - 1;
}

export function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function applyEnvelope(gainNode, startAt, peakLevel, decaySecs) {
  gainNode.gain.setValueAtTime(peakLevel, startAt);
  gainNode.gain.exponentialRampToValueAtTime(0.001, startAt + decaySecs);
}

// Convert metres-from-player into a 0..1 loudness factor.
function volumeAt(dist) {
  const v = 14 / (14 + dist);
  return Math.max(0, Math.min(1, v));
}

function playNoise({ dist = 0, freq = 1800, q = 0.8, peak = 0.7, decay = 0.14, type = 'bandpass' }) {
  if (!audioCtx) return;
  const startAt = audioCtx.currentTime;
  const source = audioCtx.createBufferSource();
  source.buffer = sharedNoise;
  source.playbackRate.value = 0.9 + Math.random() * 0.2;
  const filterNode = audioCtx.createBiquadFilter();
  filterNode.type = type;
  filterNode.frequency.value = freq;
  filterNode.Q.value = q;
  const gainNode = audioCtx.createGain();
  applyEnvelope(gainNode, startAt, peak * volumeAt(dist), decay);
  source.connect(filterNode);
  filterNode.connect(gainNode);
  gainNode.connect(masterBus);
  source.start(startAt);
  source.stop(startAt + decay + 0.05);
}

function playThump({ dist = 0, freq = 120, peak = 0.5, decay = 0.12 }) {
  if (!audioCtx) return;
  const startAt = audioCtx.currentTime;
  const oscNode = audioCtx.createOscillator();
  oscNode.type = 'sine';
  oscNode.frequency.setValueAtTime(freq, startAt);
  oscNode.frequency.exponentialRampToValueAtTime(38, startAt + decay);
  const gainNode = audioCtx.createGain();
  applyEnvelope(gainNode, startAt, peak * volumeAt(dist), decay);
  oscNode.connect(gainNode);
  gainNode.connect(masterBus);
  oscNode.start(startAt);
  oscNode.stop(startAt + decay + 0.05);
}

function playBeep({ freq = 880, dur = 0.07, peak = 0.25, when = 0 }) {
  if (!audioCtx) return;
  const startAt = audioCtx.currentTime + when;
  const oscNode = audioCtx.createOscillator();
  oscNode.type = 'square';
  oscNode.frequency.value = freq;
  const gainNode = audioCtx.createGain();
  gainNode.gain.setValueAtTime(0, startAt);
  gainNode.gain.linearRampToValueAtTime(peak, startAt + 0.008);
  gainNode.gain.setValueAtTime(peak, startAt + dur - 0.012);
  gainNode.gain.linearRampToValueAtTime(0, startAt + dur);
  oscNode.connect(gainNode);
  gainNode.connect(masterBus);
  oscNode.start(startAt);
  oscNode.stop(startAt + dur + 0.02);
}

export const sfx = {
  shoot(kind, dist) {
    if (kind === 'sniper') {
      playNoise({ dist: dist, freq: 900, peak: 1.0, decay: 0.32 });
      playThump({ dist: dist, freq: 90, peak: 0.8, decay: 0.22 });
    } else if (kind === 'smg') {
      playNoise({ dist: dist, freq: 2400, peak: 0.5, decay: 0.09 });
      playThump({ dist: dist, freq: 150, peak: 0.3, decay: 0.07 });
    } else if (kind === 'pistol') {
      playNoise({ dist: dist, freq: 2000, peak: 0.55, decay: 0.11 });
      playThump({ dist: dist, freq: 140, peak: 0.35, decay: 0.09 });
    } else {
      playNoise({ dist: dist, freq: 1600, peak: 0.75, decay: 0.16 });
      playThump({ dist: dist, freq: 120, peak: 0.5, decay: 0.12 });
    }
  },
  dryFire() { playBeep({ freq: 1400, dur: 0.03, peak: 0.12 }); },
  reloadStart() {
    playBeep({ freq: 500, dur: 0.04, peak: 0.15 });
    playNoise({ freq: 900, peak: 0.2, decay: 0.06 });
  },
  reloadEnd() { playBeep({ freq: 760, dur: 0.04, peak: 0.18, when: 0.01 }); },
  hit(head) { playBeep({ freq: head ? 1560 : 1180, dur: 0.05, peak: 0.22 }); },
  hurt() { playThump({ freq: 70, peak: 0.5, decay: 0.16 }); },
  kill() {
    playBeep({ freq: 980, dur: 0.06, peak: 0.2 });
    playBeep({ freq: 1470, dur: 0.09, peak: 0.2, when: 0.07 });
  },
  explosion(dist) {
    playNoise({ dist: dist, freq: 300, type: 'lowpass', peak: 1.2, decay: 0.7 });
    playThump({ dist: dist, freq: 55, peak: 1.1, decay: 0.6 });
  },
  flashPop(dist) { playNoise({ dist: dist, freq: 3200, peak: 0.5, decay: 0.2 }); },
  throwPin() { playBeep({ freq: 1900, dur: 0.03, peak: 0.1 }); },
  plantBeep() { playBeep({ freq: 1040, dur: 0.06, peak: 0.22 }); },
  defuseWire() { playBeep({ freq: 660, dur: 0.05, peak: 0.18 }); },
  roundWin() {
    playBeep({ freq: 784, dur: 0.1, peak: 0.2 });
    playBeep({ freq: 1046, dur: 0.16, peak: 0.2, when: 0.11 });
  },
  roundLose() {
    playBeep({ freq: 392, dur: 0.12, peak: 0.2 });
    playBeep({ freq: 311, dur: 0.2, peak: 0.2, when: 0.12 });
  },
  buy() { playBeep({ freq: 1240, dur: 0.05, peak: 0.18 }); },
  denied() { playBeep({ freq: 220, dur: 0.09, peak: 0.18 }); },
  step(dist, run) { playNoise({ dist: dist, freq: 500, type: 'lowpass', peak: run ? 0.16 : 0.05, decay: 0.05 }); },
  jump() { playNoise({ freq: 700, type: 'lowpass', peak: 0.1, decay: 0.05 }); },
};
