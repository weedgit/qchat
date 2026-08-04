/**
 * Call ringtone / ringback via Web Audio (no asset file).
 *
 * Incoming (callee): classic telephone ring — 440+480 Hz, 2s on / 4s off
 *   (North-American PSTN cadence so phone→web matches a real handset ring).
 * Outgoing (caller): same tones, slightly softer (ringback while waiting).
 */

const RING_LENGTH_MS = 60_000;
/** 2s tone + 4s silence (North-American ring / ringback cadence). */
const RING_CYCLE_MS = 6_000;

export type CallRingKind = "incoming" | "outgoing";

let ctx: AudioContext | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let pulseTimer: ReturnType<typeof setInterval> | null = null;
let ringing = false;
let activeKind: CallRingKind | null = null;
/** Oscillators / gains for the active burst so we can cut them on stop. */
let liveNodes: AudioNode[] = [];

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

function clearLiveNodes() {
  for (const n of liveNodes) {
    try {
      if ("stop" in n && typeof (n as OscillatorNode).stop === "function") {
        (n as OscillatorNode).stop();
      }
      n.disconnect();
    } catch {
      /* already stopped */
    }
  }
  liveNodes = [];
}

/** Dual-tone burst (classic North-American telephone ring / ringback). */
function dualToneBurst(
  audio: AudioContext,
  freqs: [number, number],
  start: number,
  dur: number,
  peak = 0.22
) {
  for (const freq of freqs) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.04);
    gain.gain.setValueAtTime(peak, start + Math.max(0.05, dur - 0.08));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(start);
    osc.stop(start + dur + 0.05);
    liveNodes.push(osc, gain);
  }
}

/** Incoming: full telephone ring (2s dual-tone). */
function pulseIncoming() {
  const audio = ensureCtx();
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume().catch(() => {});
  clearLiveNodes();
  dualToneBurst(audio, [440, 480], audio.currentTime, 2.0, 0.26);
}

/** Outgoing ringback: same 2s dual-tone, softer. */
function pulseOutgoing() {
  const audio = ensureCtx();
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume().catch(() => {});
  clearLiveNodes();
  dualToneBurst(audio, [440, 480], audio.currentTime, 2.0, 0.18);
}

/** Start ringing until stopCallRing or RING_LENGTH. */
export function startCallRing(kind: CallRingKind = "incoming"): void {
  stopCallRing();
  ringing = true;
  activeKind = kind;
  const pulse = kind === "outgoing" ? pulseOutgoing : pulseIncoming;
  pulse();
  pulseTimer = setInterval(() => {
    if (!ringing) return;
    pulse();
  }, RING_CYCLE_MS);
  stopTimer = setTimeout(() => stopCallRing(), RING_LENGTH_MS);
}

export function stopCallRing(): void {
  ringing = false;
  activeKind = null;
  clearLiveNodes();
  if (pulseTimer) {
    clearInterval(pulseTimer);
    pulseTimer = null;
  }
  if (stopTimer) {
    clearTimeout(stopTimer);
    stopTimer = null;
  }
}

export function isCallRinging(): boolean {
  return ringing;
}

export function currentCallRingKind(): CallRingKind | null {
  return activeKind;
}

export { RING_LENGTH_MS };
