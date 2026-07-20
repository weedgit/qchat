"use client";

import type { useCall } from "@/lib/useCall";

type CallApi = ReturnType<typeof useCall>;

const MIC_BAR_COUNT = 5;

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

/** Incoming ring overlay + in-call panel (Mattermost Calls UI placement). */
export default function CallOverlay({ call }: { call: CallApi }) {
  const {
    incoming,
    active,
    error,
    connecting,
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
    audioPlaybackOk,
  } = call;

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
          <div className="call-overlay-card">
            <div className="call-overlay-title">
              Incoming {incoming.kind === "video" ? "video" : "voice"} call
            </div>
            <div className="call-overlay-name">
              {incoming.initiatorName || "Someone"}
            </div>
            {error && <div className="error-text">{error}</div>}
            <div className="call-overlay-actions">
              <button type="button" className="btn call-decline" onClick={() => declineCall().catch(() => {})}>
                Decline
              </button>
              <button
                type="button"
                className="btn call-answer"
                onClick={() => answerCall().catch(() => {})}
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {active && (
        <div className={`call-overlay in-call ${active.kind}`} role="dialog" aria-label="In call">
          <div className="call-overlay-card call-media-card">
            <div className="call-overlay-title">
              {active.status === "ringing"
                ? `Calling… (${active.kind})`
                : connecting
                  ? "Connecting…"
                  : `${active.kind === "video" ? "Video" : "Voice"} call`}
            </div>
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
              <div className="call-voice-placeholder muted">
                {connecting ? "Setting up media…" : "Voice connected"}
              </div>
            )}
            {active.status === "active" && !connecting && (
              <div className="call-mic-meters">
                <MicLevelMeter level={micLevel} muted={micMuted} label="You" />
                <MicLevelMeter level={remoteMicLevel} label="Them" />
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
                  <div>Microphone needs a secure context.</div>
                  <ol className="call-mic-steps">
                    <li>
                      Fastest with Cursor: open{" "}
                      <a href="http://localhost:3000">http://localhost:3000</a> (mic allowed on
                      localhost).
                    </li>
                    <li>
                      Or keep this LAN URL: in Chrome open{" "}
                      <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>, enable
                      it, add{" "}
                      <code>{error.slice("MIC_INSECURE_ORIGIN:".length)}</code>, relaunch Chrome.
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
                  <button type="button" className="btn-ghost" onClick={() => toggleMic().catch(() => {})}>
                    {micMuted ? "Unmute" : "Mute"}
                  </button>
                  {active.kind === "video" && (
                    <button type="button" className="btn-ghost" onClick={() => toggleCamera().catch(() => {})}>
                      {cameraOff ? "Camera on" : "Camera off"}
                    </button>
                  )}
                </>
              )}
              <button type="button" className="btn call-decline" onClick={() => hangup().catch(() => {})}>
                {active.status === "ringing" ? "Cancel" : "Hang up"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
