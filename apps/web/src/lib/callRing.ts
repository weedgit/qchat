/**
 * Incoming-call ringtone (Mattermost ringForCall / RING_LENGTH ≈ 30s).
 * Uses Web Audio oscillators — no asset file required.
 */

const RING_LENGTH_MS = 30_000;

let ctx: AudioContext | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let pulseTimer: ReturnType<typeof setInterval> | null = null;
let ringing = false;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

function beep(audio: AudioContext, freq: number, start: number, dur: number) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Play one classic double-ring pulse. */
function pulseOnce() {
  const audio = ensureCtx();
  if (!audio) return;
  if (audio.state === "suspended") audio.resume().catch(() => {});
  const t = audio.currentTime;
  beep(audio, 880, t, 0.18);
  beep(audio, 880, t + 0.22, 0.18);
}

/** Start ringing until stopCallRing or RING_LENGTH. */
export function startCallRing(): void {
  stopCallRing();
  ringing = true;
  pulseOnce();
  pulseTimer = setInterval(() => {
    if (!ringing) return;
    pulseOnce();
  }, 2000);
  stopTimer = setTimeout(() => stopCallRing(), RING_LENGTH_MS);
}

export function stopCallRing(): void {
  ringing = false;
  if (pulseTimer) {
    clearInterval(pulseTimer);
    pulseTimer = null;
  }
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
}

export { RING_LENGTH_MS };
