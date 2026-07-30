/**
 * Normalize browser voice recordings to PCM WAV so Android/iOS native players
 * (expo-av) can start immediately. Chrome MediaRecorder defaults to WebM/Opus,
 * which phones often probe for ~20s before failing or buffering.
 */

const VOICE_SAMPLE_RATE = 16_000;

function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/mp4",
    "audio/aac",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

/** MIME type to pass to MediaRecorder (may be empty → browser default). */
export function preferredVoiceRecorderMime(): string {
  return pickRecorderMime();
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

/** Encode mono PCM as 16-bit little-endian WAV. */
function encodeWavMono(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) out[i] += data[i] / numberOfChannels;
  }
  return out;
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  if (toRate <= 0 || fromRate <= 0) return input;
  const ratio = fromRate / toRate;
  const newLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j] ?? 0;
      count++;
    }
    out[i] = count > 0 ? sum / count : (input[start] ?? 0);
  }
  return out;
}

/**
 * Re-encode an arbitrary recorded blob (usually WebM/Opus) to 16 kHz mono WAV.
 * Already-mobile-friendly containers are returned unchanged.
 */
export async function normalizeVoiceForMobile(blob: Blob): Promise<Blob> {
  const type = (blob.type || "").toLowerCase();
  if (
    type.includes("audio/mp4") ||
    type.includes("audio/aac") ||
    type.includes("audio/mpeg") ||
    type.includes("audio/wav") ||
    type.includes("audio/x-wav") ||
    type.includes("audio/x-m4a")
  ) {
    return blob;
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return blob;

  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = mixToMono(decoded);
    const sampled = downsample(mono, decoded.sampleRate, VOICE_SAMPLE_RATE);
    return encodeWavMono(sampled, VOICE_SAMPLE_RATE);
  } finally {
    await ctx.close().catch(() => {});
  }
}
