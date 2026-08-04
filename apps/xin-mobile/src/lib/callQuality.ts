/** LiveKit connection quality helpers (mirror web callQuality.ts). */
import { ConnectionQuality } from "livekit-client";

export type CallQualityLevel = "excellent" | "good" | "poor" | "lost" | "unknown";

export function qualityFromLiveKit(q: ConnectionQuality): CallQualityLevel {
  switch (q) {
    case ConnectionQuality.Excellent:
      return "excellent";
    case ConnectionQuality.Good:
      return "good";
    case ConnectionQuality.Poor:
      return "poor";
    case ConnectionQuality.Lost:
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
      return "Poor connection";
    case "lost":
      return "Connection lost";
    default:
      return "";
  }
}

export function isDegradedQuality(q: CallQualityLevel): boolean {
  return q === "poor" || q === "lost";
}
