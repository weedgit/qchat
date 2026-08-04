import type { Room, Track } from "livekit-client";

/** DEGRADED_CALL_QUALITY_ALERT_WAIT — avoid flashing on brief dips. */
export const DEGRADED_CALL_QUALITY_ALERT_WAIT_MS = 20_000;

export type CallQualityLevel = "excellent" | "good" | "poor" | "lost" | "unknown";

export type CallRtcStats = {
  rttMs: number | null;
  jitterMs: number | null;
  packetsLost: number | null;
  bitrateKbps: number | null;
};

/** Map LiveKit ConnectionQuality string enum without importing the runtime package. */
export function qualityFromLiveKit(q: string): CallQualityLevel {
  switch (q) {
    case "excellent":
      return "excellent";
    case "good":
      return "good";
    case "poor":
      return "poor";
    case "lost":
      return "lost";
    default:
      return "unknown";
  }
}

export function qualityLabel(q: CallQualityLevel): string {
  switch (q) {
    case "excellent":
      return "Excellent";
    case "good":
      return "Good";
    case "poor":
      return "Poor";
    case "lost":
      return "Lost";
    default:
      return "Unknown";
  }
}

export function isDegradedQuality(q: CallQualityLevel): boolean {
  return q === "poor" || q === "lost";
}

/** Map LiveKit / getUserMedia failures to actionable copy. */
export function friendlyCallError(err: unknown): string {
  const raw = err && typeof err === "object" && "message" in err
    ? String((err as { message?: string }).message || "")
    : String(err || "");
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name?: string }).name || "")
      : "";
  if (!raw && !name) return "Failed to connect media";
  if (raw.startsWith("MIC_INSECURE_ORIGIN:")) return raw;
  const lower = `${name} ${raw}`.toLowerCase();
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "Couldn’t connect media in time — check LiveKit (port 7880), UDP/firewall, or try a stronger network.";
  }
  if (lower.includes("notallowed") || lower.includes("permission denied")) {
    return "Microphone/camera permission denied — allow access in the browser and try again.";
  }
  if (
    lower.includes("could not start video source") ||
    lower.includes("notreadable") ||
    lower.includes("trackstarterror") ||
    lower.includes("device in use") ||
    lower.includes("aborterror")
  ) {
    return "Camera is busy or unavailable — close other apps using it, then turn the camera back on.";
  }
  if (lower.includes("notfound") || lower.includes("requested device not found")) {
    return "No microphone or camera found — plug in a device and try again.";
  }
  if (lower.includes("ice") || lower.includes("dtls") || lower.includes("peerconnection")) {
    return "WebRTC connection failed — check TURN/coturn and that UDP media ports are open.";
  }
  if (lower.includes("websocket") || lower.includes("signal")) {
    return "Couldn’t reach LiveKit signaling — confirm LIVEKIT_URL and that port 7880 is reachable.";
  }
  if (lower.includes("missing livekit")) {
    return "Call media isn’t configured — set LIVEKIT_URL on the API and NEXT_PUBLIC_LIVEKIT_URL in the web app.";
  }
  return raw || "Failed to connect media";
}

/** Best-effort RTC stats from the local mic sender (optional stats). */
export async function sampleCallStats(room: Room | null): Promise<CallRtcStats> {
  const empty: CallRtcStats = { rttMs: null, jitterMs: null, packetsLost: null, bitrateKbps: null };
  if (!room) return empty;
  try {
    const pub = room.localParticipant.getTrackPublication("microphone" as Track.Source);
    const track = pub?.track as { sender?: RTCRtpSender } | undefined;
    const sender = track?.sender;
    if (!sender) return empty;
    const report = await sender.getStats();
    let rttMs: number | null = null;
    let jitterMs: number | null = null;
    let packetsLost: number | null = null;
    let bitrateKbps: number | null = null;
    report.forEach((r) => {
      if (r.type === "candidate-pair" && (r as RTCIceCandidatePairStats).state === "succeeded") {
        const pair = r as RTCIceCandidatePairStats & { currentRoundTripTime?: number };
        if (typeof pair.currentRoundTripTime === "number") {
          rttMs = Math.round(pair.currentRoundTripTime * 1000);
        }
      }
      if (r.type === "remote-inbound-rtp") {
        const remote = r as RTCInboundRtpStreamStats & {
          roundTripTime?: number;
          jitter?: number;
          packetsLost?: number;
        };
        if (typeof remote.roundTripTime === "number") {
          rttMs = Math.round(remote.roundTripTime * 1000);
        }
        if (typeof remote.jitter === "number") {
          jitterMs = Math.round(remote.jitter * 1000);
        }
        if (typeof remote.packetsLost === "number") {
          packetsLost = remote.packetsLost;
        }
      }
      if (r.type === "outbound-rtp") {
        const out = r as RTCOutboundRtpStreamStats & { bytesSent?: number; timestamp?: number };
        const target = (r as { targetBitrate?: number }).targetBitrate;
        if (typeof target === "number" && target > 0) {
          bitrateKbps = Math.round(target / 1000);
        } else if (typeof out.bytesSent === "number") {
          /* leave null without prior sample */
        }
      }
    });
    return { rttMs, jitterMs, packetsLost, bitrateKbps };
  } catch {
    return empty;
  }
}
