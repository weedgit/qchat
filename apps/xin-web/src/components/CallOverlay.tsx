"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import type { CallRemotePeer, useCall } from "@/lib/useCall";
import { focusMainChatWindow } from "@/lib/callHandoff";
import { qualityLabel } from "@/lib/callQuality";
import { useLocale } from "@/lib/locale";

type CallApi = ReturnType<typeof useCall>;

const MIC_BAR_COUNT = 5;
const CALL_AVATAR_SIZE = 88;
const LOCAL_FOCUS_ID = "__local__";

type GroupLayout = "focus" | "grid";

type CallIconName =
  | "microphone"
  | "microphoneOff"
  | "camera"
  | "cameraOff"
  | "screenShare"
  | "screenShareOff"
  | "phone"
  | "phoneEnd"
  | "stats"
  | "grid"
  | "focus"
  | "chat"
  | "more"
  | "popout";

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
    screenShare: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </>
    ),
    screenShareOff: (
      <>
        <path d="M3 3l18 18M7 7H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h11M21 13V9a2 2 0 0 0-2-2h-5M8 20h8M12 16v4" />
      </>
    ),
    phone: <path d="M7.5 11.5a15 15 0 0 0 5 5l2.1-2.1a1.5 1.5 0 0 1 1.5-.36 10 10 0 0 0 3.1.5A1.8 1.8 0 0 1 21 16.35V19a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2h2.65A1.8 1.8 0 0 1 9.46 4.8a10 10 0 0 0 .5 3.1 1.5 1.5 0 0 1-.36 1.5z" />,
    phoneEnd: (
      // Classic hang-up: handset rotated to “end call” orientation (not upside-down U).
      <g transform="rotate(135 12 12)">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </g>
    ),
    stats: (
      <>
        <path d="M5 18v-3M10 18v-6M15 18V9M20 18V5" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    focus: (
      <>
        <rect x="3" y="5" width="14" height="14" rx="2" />
        <rect x="15" y="3" width="6" height="8" rx="1.5" />
      </>
    ),
    chat: (
      <>
        <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      </>
    ),
    more: (
      <>
        <circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" />
      </>
    ),
    popout: (
      <>
        <rect x="3" y="8" width="11" height="11" rx="2" />
        <path d="M10 3h11v11M14 3l7 7" />
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

function peerStatusText(
  peer: Pick<CallRemotePeer, "micMuted" | "cameraOff">,
  t: (key: "call.cameraOff" | "call.listening") => string
): string {
  if (peer.cameraOff && peer.micMuted) return t("call.cameraOff");
  if (peer.micMuted) return t("call.listening");
  if (peer.cameraOff) return t("call.cameraOff");
  return t("call.listening");
}

type GroupVideoStageProps = {
  call: CallApi;
  onInviteClick?: () => void;
  onMinimize: () => void;
  /** Telegram-style dedicated call window (no chat chrome). */
  popoutMode?: boolean;
};

function GroupVideoStage({
  call,
  onInviteClick,
  onMinimize,
  popoutMode = false,
}: GroupVideoStageProps) {
  const { t } = useLocale();
  const {
    active,
    error,
    connecting,
    reconnecting,
    connectedAt,
    connectionQuality,
    qualityDegraded,
    showCallStats,
    callStats,
    micMuted,
    cameraOff,
    screenSharing,
    remotePeers,
    setLocalVideoEl,
    bindPeerVideoEl,
    hangup,
    kickFromCall,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    enableSound,
    toggleCallStats,
    audioPlaybackOk,
  } = call;

  const [layout, setLayout] = useState<GroupLayout>("focus");
  const [focusedId, setFocusedId] = useState<string>(LOCAL_FOCUS_ID);
  const [moreOpen, setMoreOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (connectedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [connectedAt]);

  const focusCandidates = useMemo(() => {
    const ids = remotePeers.map((p) => p.identity);
    ids.push(LOCAL_FOCUS_ID);
    return ids;
  }, [remotePeers]);

  useEffect(() => {
    if (!focusCandidates.includes(focusedId)) {
      setFocusedId(remotePeers[0]?.identity || LOCAL_FOCUS_ID);
    }
  }, [focusCandidates, focusedId, remotePeers]);

  if (!active) return null;

  const focusedPeer =
    focusedId === LOCAL_FOCUS_ID
      ? null
      : remotePeers.find((p) => p.identity === focusedId) || null;
  const focusedName =
    focusedId === LOCAL_FOCUS_ID ? t("chat.you") : focusedPeer?.name || "User";
  const focusedMicMuted = focusedId === LOCAL_FOCUS_ID ? micMuted : Boolean(focusedPeer?.micMuted);
  const focusedScreenSharing =
    focusedId === LOCAL_FOCUS_ID ? screenSharing : Boolean(focusedPeer?.screenSharing);
  const focusedCameraOff =
    focusedId === LOCAL_FOCUS_ID
      ? cameraOff && !screenSharing
      : Boolean(focusedPeer?.cameraOff);

  function selectFocus(id: string) {
    setFocusedId(id);
    setLayout("focus");
  }

  const floatingControls = (
    <div className="call-floating-bar" role="toolbar" aria-label="Call controls">
      <div className="call-floating-more-wrap">
        <button
          type="button"
          className={`call-control ${moreOpen ? "active" : ""}`}
          aria-label="More"
          title="More"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          <CallIcon name="more" />
        </button>
        {moreOpen ? (
          <div className="call-floating-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className={layout === "grid" ? "is-active" : ""}
              onClick={() => {
                setLayout("grid");
                setMoreOpen(false);
              }}
            >
              {t("call.layoutGrid")}
            </button>
            <button
              type="button"
              role="menuitem"
              className={layout === "focus" ? "is-active" : ""}
              onClick={() => {
                setLayout("focus");
                setMoreOpen(false);
              }}
            >
              {t("call.layoutFocus")}
            </button>
            <button
              type="button"
              role="menuitem"
              className={showCallStats ? "is-active" : ""}
              onClick={() => {
                toggleCallStats();
                setMoreOpen(false);
              }}
            >
              Stats
            </button>
            <button
              type="button"
              role="menuitem"
              className={screenSharing ? "is-active" : ""}
              onClick={() => {
                toggleScreenShare().catch(() => {});
                setMoreOpen(false);
              }}
            >
              {screenSharing ? "Stop share" : "Share screen"}
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className={`call-control ${cameraOff ? "off" : ""}`}
        aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
        title={cameraOff ? "Camera on" : "Camera off"}
        onClick={() => toggleCamera().catch(() => {})}
      >
        <CallIcon name={cameraOff ? "cameraOff" : "camera"} />
      </button>
      <button
        type="button"
        className={`call-control ${micMuted ? "off is-muted" : ""}`}
        aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
        title={micMuted ? "Unmute" : "Mute"}
        onClick={() => toggleMic().catch(() => {})}
      >
        <CallIcon name={micMuted ? "microphoneOff" : "microphone"} />
      </button>
      <button
        type="button"
        className="call-control"
        aria-label={popoutMode ? t("call.returnToChat") : t("call.minimize")}
        title={popoutMode ? t("call.returnToChat") : t("call.minimize")}
        onClick={onMinimize}
      >
        <CallIcon name="chat" />
      </button>
      {onInviteClick ? (
        <button
          type="button"
          className="call-control"
          aria-label={t("call.invite")}
          title={t("call.invite")}
          onClick={onInviteClick}
        >
          <CallIcon name="phone" />
        </button>
      ) : null}
      <button
        type="button"
        className="call-control danger"
        aria-label="End call"
        title="Hang up"
        onClick={() => hangup().catch(() => {})}
      >
        <CallIcon name="phoneEnd" />
      </button>
    </div>
  );

  return (
    <div className="call-group-shell" role="dialog" aria-label="Group video call">
      <div className="call-group-stage">
        <div className="call-group-topbar">
          <div className="call-group-topbar-title">
            {active.peerName || t("chat.videoCallTitle")}
            {connectedAt != null && !connecting ? (
              <span className="call-group-topbar-clock">
                {" "}
                · {formatCallClock(now - connectedAt)}
              </span>
            ) : null}
          </div>
          <div className="call-layout-toggles" role="group" aria-label="Layout">
            <button
              type="button"
              className={`call-layout-btn ${layout === "grid" ? "is-active" : ""}`}
              aria-pressed={layout === "grid"}
              title={t("call.layoutGrid")}
              onClick={() => setLayout("grid")}
            >
              <CallIcon name="grid" />
            </button>
            <button
              type="button"
              className={`call-layout-btn ${layout === "focus" ? "is-active" : ""}`}
              aria-pressed={layout === "focus"}
              title={t("call.layoutFocus")}
              onClick={() => setLayout("focus")}
            >
              <CallIcon name="focus" />
            </button>
          </div>
        </div>

        {layout === "grid" ? (
          <div
            className={`call-video-grid call-video-grid-fill count-${Math.min(
              remotePeers.length + 1,
              9
            )}`}
          >
            {remotePeers.map((p) => (
              <button
                key={p.identity}
                type="button"
                className="call-video-tile"
                onClick={() => selectFocus(p.identity)}
                title={t("call.focusPeer")}
              >
                <video
                  className={`call-video remote${p.screenSharing ? " is-screenshare" : ""}`}
                  ref={(el) => bindPeerVideoEl(p.identity, el)}
                  autoPlay
                  playsInline
                  muted
                />
                {p.cameraOff ? (
                  <div className="call-video-fallback">
                    <Avatar name={p.name} size={64} />
                  </div>
                ) : null}
                <div className="call-video-tile-label">
                  <span>{p.name}</span>
                  {p.micMuted ? <CallIcon name="microphoneOff" /> : null}
                </div>
              </button>
            ))}
            <button
              type="button"
              className="call-video-tile is-local"
              onClick={() => selectFocus(LOCAL_FOCUS_ID)}
              title={t("call.focusPeer")}
            >
              <video
                className={`call-video${screenSharing ? " is-screenshare" : ""}`}
                ref={(el) => setLocalVideoEl(el)}
                autoPlay
                playsInline
                muted
              />
              {cameraOff && !screenSharing ? (
                <div className="call-video-fallback">
                  <Avatar name={t("chat.you")} size={64} />
                </div>
              ) : null}
              <div className="call-video-tile-label">
                <span>{t("chat.you")}</span>
                {micMuted ? <CallIcon name="microphoneOff" /> : null}
              </div>
            </button>
          </div>
        ) : (
          <div className="call-focus-stage">
            {focusedId === LOCAL_FOCUS_ID ? (
              <video
                className={`call-video call-focus-video${focusedScreenSharing ? " is-screenshare" : ""}`}
                ref={(el) => setLocalVideoEl(el)}
                autoPlay
                playsInline
                muted
              />
            ) : (
              <video
                key={focusedId}
                className={`call-video call-focus-video${focusedScreenSharing ? " is-screenshare" : ""}`}
                ref={(el) => bindPeerVideoEl(focusedId, el)}
                autoPlay
                playsInline
                muted
              />
            )}
            {focusedCameraOff ? (
              <div className="call-video-fallback is-stage">
                <Avatar name={focusedName} size={112} />
              </div>
            ) : null}
            <div className="call-focus-meta">
              <span className="call-focus-name">{focusedName}</span>
              {focusedMicMuted ? (
                <span className="call-focus-mic" aria-label="Muted">
                  <CallIcon name="microphoneOff" />
                </span>
              ) : null}
            </div>
            {focusedId !== LOCAL_FOCUS_ID ? (
              <div className="call-focus-pip">
                <video
                  className={`call-video call-pip-self${screenSharing ? " is-screenshare" : ""}`}
                  ref={(el) => setLocalVideoEl(el)}
                  autoPlay
                  playsInline
                  muted
                />
                {cameraOff && !screenSharing ? (
                  <div className="call-video-fallback">
                    <Avatar name={t("chat.you")} size={36} />
                  </div>
                ) : null}
                <span className="call-focus-pip-label">{t("chat.you")}</span>
              </div>
            ) : null}
          </div>
        )}

        {(qualityDegraded || reconnecting) && (
          <div className="call-quality-hint call-group-hint" role="status">
            {reconnecting
              ? "Network interrupted — reconnecting…"
              : "Connection unstable — check your network or move closer to Wi‑Fi."}
          </div>
        )}
        {showCallStats && (
          <div className="call-stats call-group-stats" aria-live="polite">
            <div>Quality: {qualityLabel(connectionQuality)}</div>
            <div>RTT: {callStats?.rttMs != null ? `${callStats.rttMs} ms` : "—"}</div>
            <div>Jitter: {callStats?.jitterMs != null ? `${callStats.jitterMs} ms` : "—"}</div>
            <div>Lost: {callStats?.packetsLost != null ? callStats.packetsLost : "—"}</div>
          </div>
        )}
        {!audioPlaybackOk && (
          <button
            type="button"
            className="btn call-enable-sound call-group-sound"
            onClick={() => enableSound().catch(() => {})}
          >
            Tap to enable sound
          </button>
        )}
        {error && <div className="error-text call-group-error">{error}</div>}
        {floatingControls}
      </div>

      <aside className="call-group-sidebar" aria-label={t("call.participants")}>
        <div className="call-sidebar-header">
          {t("call.participants")} · {remotePeers.length + 1}
        </div>
        <div className="call-sidebar-list">
          <button
            type="button"
            className={`call-sidebar-row ${focusedId === LOCAL_FOCUS_ID && layout === "focus" ? "is-focused" : ""}`}
            onClick={() => selectFocus(LOCAL_FOCUS_ID)}
          >
            <Avatar name={t("chat.you")} size={40} />
            <div className="call-sidebar-meta">
              <div className="call-sidebar-name">{t("chat.you")}</div>
              <div className="call-sidebar-status">
                {micMuted ? <CallIcon name="microphoneOff" /> : <CallIcon name="microphone" />}
                {cameraOff ? <CallIcon name="cameraOff" /> : <CallIcon name="camera" />}
                <span>{peerStatusText({ micMuted, cameraOff }, t)}</span>
              </div>
            </div>
          </button>
          {remotePeers.map((p) => (
            <div key={p.identity} className="call-sidebar-row-wrap">
              <button
                type="button"
                className={`call-sidebar-row ${focusedId === p.identity && layout === "focus" ? "is-focused" : ""}`}
                onClick={() => selectFocus(p.identity)}
              >
                <Avatar name={p.name} size={40} />
                <div className="call-sidebar-meta">
                  <div className="call-sidebar-name">{p.name}</div>
                  <div className="call-sidebar-status">
                    {p.micMuted ? <CallIcon name="microphoneOff" /> : <CallIcon name="microphone" />}
                    {p.cameraOff ? <CallIcon name="cameraOff" /> : <CallIcon name="camera" />}
                    <span>{peerStatusText(p, t)}</span>
                  </div>
                </div>
              </button>
              {active.isHost ? (
                <button
                  type="button"
                  className="call-kick-btn call-sidebar-kick"
                  title={t("call.kick")}
                  onClick={() => kickFromCall(p.userId).catch(() => {})}
                >
                  {t("call.kick")}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

/** Incoming ring overlay + in-call panel (Calls UI placement). */
export default function CallOverlay({
  call,
  onInviteClick,
  variant = "main",
}: {
  call: CallApi;
  /** Open member picker to invite more people (group calls). */
  onInviteClick?: () => void;
  /** `popout` = Telegram-style dedicated video chat window. */
  variant?: "main" | "popout";
}) {
  const { t } = useLocale();
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
    screenSharing,
    remotePeers,
    poppedOut,
    setRemoteVideoEl,
    setLocalVideoEl,
    setRemoteAudioEl,
    answerCall,
    declineCall,
    hangup,
    kickFromCall,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    enableSound,
    toggleCallStats,
    audioPlaybackOk,
    focusPopout,
  } = call;

  const [embedGroupVideo, setEmbedGroupVideo] = useState(true);
  const lastGroupVideoCallId = useRef<string | null>(null);

  const isGroupVideoActive =
    Boolean(active?.isGroup) &&
    active?.kind === "video" &&
    active?.status === "active";

  // Group video stays in this window (fullscreen stage). No OS/browser pop-out.
  useEffect(() => {
    if (variant !== "main") return;
    if (!isGroupVideoActive || !active?.callId) {
      if (!isGroupVideoActive) lastGroupVideoCallId.current = null;
      return;
    }
    if (lastGroupVideoCallId.current !== active.callId) {
      lastGroupVideoCallId.current = active.callId;
      setEmbedGroupVideo(true);
    }
  }, [variant, isGroupVideoActive, active?.callId]);

  const statusTitle =
    active?.status === "ringing"
      ? `Calling… (${active.kind})`
      : reconnecting
        ? "Reconnecting…"
        : connecting
          ? "Connecting…"
          : active?.isGroup
            ? `${active.kind === "video" ? "Group video" : "Group voice"} · ${remotePeers.length + 1}`
            : `${active?.kind === "video" ? "Video" : "Voice"} call`;

  const audioEl = (
    <audio
      ref={(el) => setRemoteAudioEl(el)}
      autoPlay
      playsInline
      style={{ display: "none" }}
    />
  );

  const incomingUi = incoming ? (
    <div className="call-overlay incoming" role="dialog" aria-label="Incoming call">
      <div className="call-overlay-card call-ringing-card">
        <div className="call-peer-avatar" aria-hidden>
          <Avatar
            name={incoming.initiatorName || "Someone"}
            url={incoming.initiatorAvatar}
            size={CALL_AVATAR_SIZE}
          />
        </div>
        <div className="call-overlay-title">
          Incoming {incoming.kind === "video" ? "video" : "voice"} call
        </div>
        <div className="call-overlay-name">{incoming.initiatorName || "Someone"}</div>
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
  ) : null;

  // Dedicated /call window — video stage + participant list only.
  if (variant === "popout") {
    if (!active || active.status !== "active") {
      return (
        <div className="call-overlay call-group-fullscreen call-popout-window">
          {audioEl}
          <div className="call-popout-loading muted">
            {connecting ? "Connecting…" : "Starting video chat…"}
          </div>
        </div>
      );
    }
    return (
      <div className="call-overlay call-group-fullscreen call-popout-window">
        {audioEl}
        <GroupVideoStage
          call={call}
          popoutMode
          onInviteClick={onInviteClick}
          onMinimize={() => {
            focusMainChatWindow();
          }}
        />
      </div>
    );
  }

  return (
    <>
      {audioEl}
      {incomingUi}

      {/* Compact dock while user is chatting during an in-window group video call */}
      {isGroupVideoActive && !poppedOut && !embedGroupVideo && (
        <div className="call-dock" role="status">
          <div className="call-dock-text">
            <strong>{t("call.inProgress")}</strong>
            <span className="muted">
              {" "}
              · {remotePeers.length + 1} {t("call.participants").toLowerCase()}
            </span>
          </div>
          <div className="call-dock-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setEmbedGroupVideo(true)}
            >
              {t("call.expand")}
            </button>
            {onInviteClick ? (
              <button type="button" className="btn-ghost" onClick={onInviteClick}>
                {t("call.invite")}
              </button>
            ) : null}
            <button
              type="button"
              className="call-control danger call-dock-hangup"
              aria-label="End call"
              title="Hang up"
              onClick={() => hangup().catch(() => {})}
            >
              <CallIcon name="phoneEnd" />
            </button>
          </div>
        </div>
      )}

      {/* Legacy pop-out dock (only if a separate /call window was opened) */}
      {poppedOut && active && active.status === "active" && (
        <div className="call-dock" role="status">
          <div className="call-dock-text">
            <strong>{t("call.inProgress")}</strong>
            <span className="muted">
              {" "}
              · {remotePeers.length + 1} {t("call.participants").toLowerCase()}
            </span>
          </div>
          <div className="call-dock-actions">
            <button type="button" className="btn" onClick={() => focusPopout()}>
              {t("call.openWindow")}
            </button>
            {onInviteClick ? (
              <button type="button" className="btn-ghost" onClick={onInviteClick}>
                {t("call.invite")}
              </button>
            ) : null}
            <button
              type="button"
              className="call-control danger call-dock-hangup"
              aria-label="End call"
              title="Hang up"
              onClick={() => hangup().catch(() => {})}
            >
              <CallIcon name="phoneEnd" />
            </button>
          </div>
        </div>
      )}

      {/* In-window fullscreen group video (same window as chat) */}
      {isGroupVideoActive && !poppedOut && embedGroupVideo && (
        <div className="call-overlay call-group-fullscreen">
          <GroupVideoStage
            call={call}
            onInviteClick={onInviteClick}
            onMinimize={() => setEmbedGroupVideo(false)}
          />
        </div>
      )}

      {active && !poppedOut && !isGroupVideoActive && (
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
                <Avatar
                  name={active.peerName || "Calling"}
                  url={active.peerAvatar}
                  size={CALL_AVATAR_SIZE}
                />
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
            {(active.kind === "video" || screenSharing) &&
              active.status === "active" &&
              !isGroupVideoActive && (
                <div className="call-videos">
                  <video
                    className={`call-video remote${
                      remotePeers.some((p) => p.screenSharing) ? " is-screenshare" : ""
                    }`}
                    ref={(el) => setRemoteVideoEl(el)}
                    autoPlay
                    playsInline
                    muted
                  />
                  <video
                    className={`call-video local${screenSharing ? " is-screenshare" : ""}`}
                    ref={(el) => setLocalVideoEl(el)}
                    autoPlay
                    playsInline
                    muted
                  />
                </div>
              )}
            {active.kind === "voice" && active.status === "active" && active.isGroup && (
              <div className="call-voice-group">
                {remotePeers.map((p) => (
                  <div key={p.identity} className="call-voice-peer">
                    <Avatar name={p.name} size={56} />
                    <div className="call-overlay-name" style={{ fontSize: 13 }}>
                      {p.name}
                    </div>
                    {active.isHost ? (
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ fontSize: 12 }}
                        onClick={() => kickFromCall(p.userId).catch(() => {})}
                      >
                        {t("call.kick")}
                      </button>
                    ) : null}
                  </div>
                ))}
                <div className="call-voice-peer">
                  <Avatar name={t("chat.you")} size={56} />
                  <div className="call-overlay-name" style={{ fontSize: 13 }}>
                    {t("chat.you")}
                  </div>
                </div>
              </div>
            )}
            {active.kind === "voice" && active.status === "active" && !active.isGroup && (
              <div className="call-voice-stage">
                <div className="call-peer-avatar" aria-hidden>
                  <Avatar
                    name={active.peerName || t("chat.voiceCallTitle")}
                    url={active.peerAvatar}
                    size={CALL_AVATAR_SIZE}
                  />
                </div>
                <div className="call-overlay-name">
                  {active.peerName || t("chat.voiceCallTitle")}
                </div>
                <div className="call-voice-placeholder muted">
                  {reconnecting
                    ? "Reconnecting media…"
                    : connecting
                      ? "Setting up media…"
                      : "Voice connected"}
                </div>
              </div>
            )}
            {active.status === "active" && !connecting && !isGroupVideoActive && (
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
            {error &&
              (error.startsWith("MIC_INSECURE_ORIGIN:") ? (
                <div className="error-text call-mic-help">
                  <div>Microphone needs HTTPS (secure context).</div>
                  <ol className="call-mic-steps">
                    <li>
                      Open this app over HTTPS:{" "}
                      <a
                        href={error
                          .slice("MIC_INSECURE_ORIGIN:".length)
                          .replace(/^http:/, "https:")}
                      >
                        {error
                          .slice("MIC_INSECURE_ORIGIN:".length)
                          .replace(/^http:/, "https:")}
                      </a>{" "}
                      (accept the self-signed certificate warning once).
                    </li>
                    <li>
                      Local only:{" "}
                      <a href="http://localhost:3000">http://localhost:3000</a> (mic
                      allowed on localhost without TLS).
                    </li>
                  </ol>
                </div>
              ) : (
                <div className="error-text">{error}</div>
              ))}
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
                  {active.isGroup && onInviteClick ? (
                    <button
                      type="button"
                      className="call-control"
                      aria-label={t("call.invite")}
                      title={t("call.invite")}
                      onClick={onInviteClick}
                    >
                      <CallIcon name="phone" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`call-control ${screenSharing ? "active" : ""}`}
                    aria-label={screenSharing ? "Stop sharing screen" : "Share screen"}
                    title={screenSharing ? "Stop share" : "Share screen"}
                    onClick={() => toggleScreenShare().catch(() => {})}
                  >
                    <CallIcon name={screenSharing ? "screenShareOff" : "screenShare"} />
                  </button>
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

