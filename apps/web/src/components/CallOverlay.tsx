"use client";

import { useEffect, useState } from "react";
import type { useCall } from "@/lib/useCall";
import { qualityLabel } from "@/lib/callQuality";

type CallApi = ReturnType<typeof useCall>;

const MIC_BAR_COUNT = 5;

type CallIconName =
  | "microphone"
  | "microphoneOff"
  | "camera"
  | "cameraOff"
  | "phone"
  | "phoneEnd"
  | "stats";

function CallIcon({ name }: { name: CallIconName }) {
  const paths: Record<CallIconName, React.ReactNode> = {
    microphone: (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
      </>
    ),
    microphoneOff: (
      <>
        <path d="M9.5 4.2A3 3 0 0 1 15 6v4M5 11a7 7 0 0 0 11.8 5.1M12 18v3M9 21h6M3 3l18 18" />
      </>
    ),
    camera: (
      <>
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="m16 10 5-3v10l-5-3z" />
      </>
    ),
    cameraOff: (
      <>
        <path d="M3 3l18 18M10.5 6H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h11a2 2 0 0 0 1.4-.6M16 10l5-3v10l-2.2-1.3" />
      </>
    ),
    phone: <path d="M7.5 11.5a15 15 0 0 0 5 5l2.1-2.1a1.5 1.5 0 0 1 1.5-.36 10 10 0 0 0 3.1.5A1.8 1.8 0 0 1 21 16.35V19a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2h2.65A1.8 1.8 0 0 1 9.46 4.8a10 10 0 0 0 .5 3.1 1.5 1.5 0 0 1-.36 1.5z" />,
    phoneEnd: (
      <>
        <path d="M4 15.5c4.8-4.2 11.2-4.2 16 0" />
        <path d="m7 13-2 5M17 13l2 5" />
      </>
    ),
    stats: (
      <>
        <path d="M5 18v-3M10 18v-6M15 18V9M20 18V5" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function formatCallClock(elapsedMs: number): string {
  const sec = Math.max(0, Math.floor(elapsedMs / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** In-call elapsed timer (Calls duration display). */
function CallDuration({ connectedAt }: { connectedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [connectedAt]);
  return (
    <div className="call-duration" aria-live="polite">
      {formatCallClock(now - connectedAt)}
    </div>
  );
}

/** Continuous local/remote mic VU (Web Audio analyser → 0–1). */
function MicLevelMeter({
  level,
  muted,
  label,
}: {
  level: number;
  muted?: boolean;
  label: string;
}) {
  const lit = muted ? 0 : Math.min(MIC_BAR_COUNT, Math.round(level * MIC_BAR_COUNT));
  const pct = muted ? 0 : Math.round(level * 100);
  return (
    <div
      className={`call-mic-meter ${muted ? "muted" : lit >= 4 ? "hot" : lit >= 2 ? "mid" : "low"}`}
      role="status"
      aria-label={muted ? `${label} muted` : `${label} level ${pct}%`}
      title={muted ? `${label}: muted` : `${label}: ${pct}%`}
    >
      <div className="call-mic-meter-bars" aria-hidden>
        {Array.from({ length: MIC_BAR_COUNT }, (_, i) => (
          <span key={i} className={`call-mic-meter-bar ${i < lit ? "on" : ""}`} />
        ))}
      </div>
      <span className="call-mic-meter-label">{muted ? `${label} muted` : label}</span>
    </div>
  );
}

/** Incoming ring overlay + in-call panel (Calls UI placement). */
export default function CallOverlay({ call }: { call: CallApi }) {
  const {
    incoming,
    active,
    error,
    connecting,
    reconnecting,
    connectedAt,
    connectionQuality,
    qualityDegraded,
    showCallStats,
    callStats,
    micLevel,
    remoteMicLevel,
    micMuted,
    cameraOff,
    setRemoteVideoEl,
    setLocalVideoEl,
    setRemoteAudioEl,
    answerCall,
    declineCall,
    hangup,
    toggleMic,
    toggleCamera,
    enableSound,
    toggleCallStats,
    audioPlaybackOk,
  } = call;

  const statusTitle =
    active?.status === "ringing"
      ? `Calling… (${active.kind})`
      : reconnecting
        ? "Reconnecting…"
        : connecting
          ? "Connecting…"
          : `${active?.kind === "video" ? "Video" : "Voice"} call`;

  return (
    <>
      <audio
        ref={(el) => setRemoteAudioEl(el)}
        autoPlay
        playsInline
        style={{ display: "none" }}
      />

      {incoming && (
        <div className="call-overlay incoming" role="dialog" aria-label="Incoming call">
          <div className="call-overlay-card call-ringing-card">
            <div className="call-peer-avatar" aria-hidden>
              {(incoming.initiatorName || "S").trim().charAt(0).toUpperCase()}
            </div>
            <div className="call-overlay-title">
              Incoming {incoming.kind === "video" ? "video" : "voice"} call
            </div>
            <div className="call-overlay-name">
              {incoming.initiatorName || "Someone"}
            </div>
            {error && <div className="error-text">{error}</div>}
            <div className="call-overlay-actions">
              <button
                type="button"
                className="call-control danger"
                aria-label="Decline call"
                title="Decline"
                onClick={() => declineCall().catch(() => {})}
              >
                <CallIcon name="phoneEnd" />
              </button>
              <button
                type="button"
                className="call-control answer"
                aria-label="Answer call"
                title="Answer"
                onClick={() => answerCall().catch(() => {})}
              >
                <CallIcon name="phone" />
              </button>
            </div>
          </div>
        </div>
      )}

      {active && (
        <div
          className={`call-overlay ${active.status === "ringing" ? "calling" : "in-call"} ${active.kind}`}
          role="dialog"
          aria-label={active.status === "ringing" ? "Calling" : "In call"}
        >
          <div
            className={`call-overlay-card call-media-card ${
              active.status === "ringing" ? "call-ringing-card" : ""
            }`}
          >
            {active.status === "ringing" && (
              <div className="call-peer-avatar calling-pulse" aria-hidden>
                {(active.peerName || "?").trim().charAt(0).toUpperCase()}
              </div>
            )}
            <div className="call-overlay-title">{statusTitle}</div>
            {active.status === "ringing" && (
              <div className="call-overlay-name">{active.peerName || "Calling…"}</div>
            )}
            {active.status === "active" && connectedAt != null && !connecting && (
              <CallDuration connectedAt={connectedAt} />
            )}
            {active.status === "active" && !connecting && connectionQuality !== "unknown" && (
              <div
                className={`call-quality-badge ${connectionQuality}`}
                title="LiveKit connection quality"
              >
                {qualityLabel(connectionQuality)}
              </div>
            )}
            {(qualityDegraded || reconnecting) && active.status === "active" && (
              <div className="call-quality-hint" role="status">
                {reconnecting
                  ? "Network interrupted — reconnecting…"
                  : "Connection unstable — check your network or move closer to Wi‑Fi."}
              </div>
            )}
            {active.kind === "video" && active.status === "active" && (
              <div className="call-videos">
                <video
                  className="call-video remote"
                  ref={(el) => setRemoteVideoEl(el)}
                  autoPlay
                  playsInline
                />
                <video
                  className="call-video local"
                  ref={(el) => setLocalVideoEl(el)}
                  autoPlay
                  playsInline
                  muted
                />
              </div>
            )}
            {active.kind === "voice" && active.status === "active" && (
              <div className="call-voice-stage">
                <div className="call-peer-avatar" aria-hidden>
                  {(active.peerName || "?").trim().charAt(0).toUpperCase()}
                </div>
                <div className="call-overlay-name">{active.peerName || "Voice call"}</div>
                <div className="call-voice-placeholder muted">
                  {reconnecting
                    ? "Reconnecting media…"
                    : connecting
                      ? "Setting up media…"
                      : "Voice connected"}
                </div>
              </div>
            )}
            {active.status === "active" && !connecting && (
              <div className="call-mic-meters">
                <MicLevelMeter level={micLevel} muted={micMuted} label="You" />
                <MicLevelMeter
                  level={remoteMicLevel}
                  label={active.peerName?.trim() || "Them"}
                />
              </div>
            )}
            {active.status === "active" && !connecting && showCallStats && (
              <div className="call-stats" aria-live="polite">
                <div>Quality: {qualityLabel(connectionQuality)}</div>
                <div>RTT: {callStats?.rttMs != null ? `${callStats.rttMs} ms` : "—"}</div>
                <div>Jitter: {callStats?.jitterMs != null ? `${callStats.jitterMs} ms` : "—"}</div>
                <div>Lost: {callStats?.packetsLost != null ? callStats.packetsLost : "—"}</div>
                {callStats?.bitrateKbps != null && (
                  <div>Bitrate: ~{callStats.bitrateKbps} kbps</div>
                )}
              </div>
            )}
            {active.status === "active" && !connecting && !audioPlaybackOk && (
              <button
                type="button"
                className="btn call-enable-sound"
                onClick={() => enableSound().catch(() => {})}
              >
                Tap to enable sound
              </button>
            )}
            {error && (
              error.startsWith("MIC_INSECURE_ORIGIN:") ? (
                <div className="error-text call-mic-help">
                  <div>Microphone needs HTTPS (secure context).</div>
                  <ol className="call-mic-steps">
                    <li>
                      Open this app over HTTPS:{" "}
                      <a href={error.slice("MIC_INSECURE_ORIGIN:".length).replace(/^http:/, "https:")}>
                        {error.slice("MIC_INSECURE_ORIGIN:".length).replace(/^http:/, "https:")}
                      </a>
                      {" "}
                      (accept the self-signed certificate warning once).
                    </li>
                    <li>
                      Local only:{" "}
                      <a href="http://localhost:3000">http://localhost:3000</a> (mic allowed on
                      localhost without TLS).
                    </li>
                  </ol>
                </div>
              ) : (
                <div className="error-text">{error}</div>
              )
            )}
            <div className="call-overlay-actions">
              {active.status === "active" && (
                <>
                  <button
                    type="button"
                    className={`call-control ${micMuted ? "off" : ""}`}
                    aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
                    title={micMuted ? "Unmute" : "Mute"}
                    onClick={() => toggleMic().catch(() => {})}
                  >
                    <CallIcon name={micMuted ? "microphoneOff" : "microphone"} />
                  </button>
                  {active.kind === "video" && (
                    <button
                      type="button"
                      className={`call-control ${cameraOff ? "off" : ""}`}
                      aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
                      title={cameraOff ? "Camera on" : "Camera off"}
                      onClick={() => toggleCamera().catch(() => {})}
                    >
                      <CallIcon name={cameraOff ? "cameraOff" : "camera"} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`call-control ${showCallStats ? "active" : ""}`}
                    aria-label={showCallStats ? "Hide call statistics" : "Show call statistics"}
                    title={showCallStats ? "Hide stats" : "Stats"}
                    onClick={() => toggleCallStats()}
                  >
                    <CallIcon name="stats" />
                  </button>
                </>
              )}
              <button
                type="button"
                className="call-control danger"
                aria-label={active.status === "ringing" ? "Cancel call" : "End call"}
                title={active.status === "ringing" ? "Cancel" : "Hang up"}
                onClick={() => hangup().catch(() => {})}
              >
                <CallIcon name="phoneEnd" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
