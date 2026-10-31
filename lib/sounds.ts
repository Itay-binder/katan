'use client';
// Game sounds, synthesised in the browser (no audio files). Phones only allow sound after the
// player has touched the page once, so the audio engine is unlocked on the first tap.

let ctx: AudioContext | null = null;
const KEY = 'katan:sound';

export function soundOn(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setSoundOn(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
  if (on) unlock();
}

function unlock() {
  try {
    ctx ||= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch { /* no audio */ }
}
if (typeof window !== 'undefined') {
  const first = () => { unlock(); window.removeEventListener('pointerdown', first); };
  window.addEventListener('pointerdown', first);
}

function ready(): AudioContext | null {
  if (!soundOn() || !ctx || ctx.state !== 'running') return null;
  return ctx;
}

/** One note with a quick attack and an exponential fade. */
function note(c: AudioContext, out: AudioNode, freq: number, at: number, dur: number, type: OscillatorType, vol: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function drum(c: AudioContext, out: AudioNode, at: number, vol: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.setValueAtTime(140, at);
  o.frequency.exponentialRampToValueAtTime(45, at + 0.35);
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + 0.5);
}

/** The robber is coming (a 7 or a knight): war drums and a low, dark horn call. */
export function playRobber() {
  const c = ready();
  if (!c) return;
  const t = c.currentTime + 0.02;
  const out = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;
  out.gain.value = 0.9;
  lp.connect(out).connect(c.destination);
  drum(c, out, t, 0.9);
  drum(c, out, t + 0.22, 0.7);
  drum(c, out, t + 0.44, 0.9);
  // D minor horn: D4 F4 A4 ... D4 (held)
  const horn: [number, number, number][] = [[293.7, 0.62, 0.22], [349.2, 0.84, 0.22], [440, 1.06, 0.3], [293.7, 1.4, 0.9]];
  for (const [f, at, d] of horn) {
    note(c, lp, f, t + at, d, 'sawtooth', 0.16);
    note(c, lp, f / 2, t + at, d, 'square', 0.06);
  }
  drum(c, out, t + 1.4, 1);
}

/** Your turn: a short bright bell arpeggio. */
export function playYourTurn() {
  const c = ready();
  if (!c) return;
  const t = c.currentTime + 0.02;
  const notes = [523.3, 659.3, 784, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => {
    note(c, c.destination, f, t + i * 0.11, 0.9, 'sine', 0.22);
    note(c, c.destination, f * 2, t + i * 0.11, 0.35, 'triangle', 0.05);
  });
}
