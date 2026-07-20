"use client";

import type { useCall } from "@/lib/useCall";

type CallApi = ReturnType<typeof useCall>;

/** Incoming ring overlay + in-call panel (Mattermost Calls UI placement). */
export default function CallOverlay({ call }: { call: CallApi }) {
  const {
    incoming,
    active,
    error,
    connecting,
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
  } = call;

  return (
    <>
      <audio ref={(el) => setRemoteAudioEl(el)} autoPlay playsInline />

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
            {error && <div className="error-text">{error}</div>}
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
