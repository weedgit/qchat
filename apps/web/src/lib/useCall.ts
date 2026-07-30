"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LocalAudioTrack,
  RemoteAudioTrack,
  LocalTrackPublication,
  Participant,
  RemoteTrack,
  Room,
  Track,
} from "livekit-client";
import { api } from "@/lib/api";
import {
  clearCallHandoff,
  focusCallPopoutWindow,
  focusMainChatWindow,
  openCallChannel,
  openCallPopoutWindow,
  postCallChannel,
  takeCallHandoff,
  writeCallHandoff,
  type CallHandoffPayload,
} from "@/lib/callHandoff";
import {
  clearIncomingCallAlerts,
  notifyIncomingCall,
  ringForIncomingCall,
  ringForOutgoingCall,
} from "@/lib/callNotify";
import {
  DEGRADED_CALL_QUALITY_ALERT_WAIT_MS,
  friendlyCallError,
  isDegradedQuality,
  qualityFromLiveKit,
  sampleCallStats,
  type CallQualityLevel,
  type CallRtcStats,
} from "@/lib/callQuality";
import { loadLiveKit, liveKitOrThrow, prefetchLiveKit } from "@/lib/livekitRuntime";

export type CallKind = "voice" | "video";

export type IncomingCall = {
  callId: string;
  conversationId: string;
  kind: CallKind;
  initiatorId: string;
  initiatorName?: string;
  /** Initiator profile photo (call.ring initiator_avatar or conversation avatar). */
  initiatorAvatar?: string;
  livekitUrl?: string;
  isGroup?: boolean;
};

export type ActiveCall = {
  callId: string;
  conversationId: string;
  kind: CallKind;
  status: "ringing" | "active";
  role: "caller" | "callee";
  /** Remote peer display name (DM title / initiator_name / LiveKit participant name). */
  peerName?: string;
  /** Remote peer avatar URL (DM conversation avatar / initiator_avatar). */
  peerAvatar?: string;
  isGroup?: boolean;
  /** True when this user created the call (can kick). */
  isHost?: boolean;
};

export type CallRemotePeer = {
  identity: string;
  name: string;
  userId: string;
  micMuted: boolean;
  cameraOff: boolean;
  /** True when this peer is publishing a screen-share track. */
  screenSharing: boolean;
};

type SubscribeFn = (handler: (type: string, payload: any) => void) => () => void;

type VideoParticipant = {
  getTrackPublication: (source: Track.Source) => { track?: any; source?: string } | undefined;
  trackPublications?: Map<string, { kind?: string; source?: string; track?: any; isMuted?: boolean }>;
};

/** Prefer screen share over camera so partners see the full desktop, not a cropped cam tile. */
function preferredVideoTrack(participant: VideoParticipant): any {
  const screen = participant.getTrackPublication("screen_share" as Track.Source)?.track;
  if (screen) return screen;
  const camera = participant.getTrackPublication("camera" as Track.Source)?.track;
  if (camera) return camera;
  // Mobile / some SFU paths publish video without a reliable Source enum — take any live video.
  let fallback: any = null;
  participant.trackPublications?.forEach((pub) => {
    if (fallback || pub.kind !== "video" || !pub.track || pub.isMuted) return;
    if (pub.source === "screen_share") {
      fallback = pub.track;
      return;
    }
    fallback = pub.track;
  });
  return fallback;
}

function participantHasLiveVideo(participant: VideoParticipant): boolean {
  if (preferredVideoTrack(participant)) return true;
  let found = false;
  participant.trackPublications?.forEach((pub) => {
    if (pub.kind === "video" && pub.track && !pub.isMuted) found = true;
  });
  return found;
}

function isScreenSharing(participant: VideoParticipant): boolean {
  if (participant.getTrackPublication("screen_share" as Track.Source)?.track) return true;
  let found = false;
  participant.trackPublications?.forEach((pub) => {
    if (pub.kind === "video" && pub.source === "screen_share" && pub.track) found = true;
  });
  return found;
}

function attachVideoToElement(track: { attach: (el: HTMLMediaElement) => void }, el: HTMLVideoElement) {
  track.attach(el);
  // Remote audio plays on separate <audio> nodes; mute the video element so
  // browser autoplay policies cannot leave a black frame after attach.
  el.muted = true;
  el.playsInline = true;
  const play = () => {
    el.play().catch(() => {});
  };
  play();
  // adaptiveStream may see 0×0 during the first layout pass — retry after paint.
  requestAnimationFrame(() => requestAnimationFrame(play));
}

/**
 * LiveKit WS URL the browser can reach.
 * - Optional NEXT_PUBLIC_LIVEKIT_URL overrides everything (recommended for Cursor
 *   Remote: set to ws://<VM-LAN-IP>:7880 — Cursor does not tunnel UDP media).
 * - If API returns localhost but the page is on a LAN IP, rewrite to the page host.
 * - If both are loopback, keep localhost only when no env override (native local).
 */
function resolveLiveKitUrl(url: string): string {
  if (typeof window === "undefined") return url;
  const fromEnv = process.env.NEXT_PUBLIC_LIVEKIT_URL?.trim();
  let resolved = (fromEnv || url || "").trim();
  if (!resolved) return resolved;
  try {
    const normalized = resolved.replace(/^ws/i, "http");
    const u = new URL(normalized);
    const pageHost = window.location.hostname;
    const lkHost = u.hostname;
    const pageIsLoopback = pageHost === "localhost" || pageHost === "127.0.0.1";
    const lkIsLoopback = lkHost === "localhost" || lkHost === "127.0.0.1";
    if (lkIsLoopback && !pageIsLoopback) {
      u.hostname = pageHost;
    }
    // HTTPS pages cannot open ws:// (mixed content) — upgrade to wss.
    if (window.location.protocol === "https:" && u.protocol === "http:") {
      u.protocol = "https:";
      if (u.port === "7880") u.port = "7443";
    }
    return u.toString().replace(/^http/i, "ws");
  } catch {
    return resolved.replace(/^http/i, "ws");
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/**
 * Calls-style 1:1 ring → answer → LiveKit media.
 * Signaling via Qchat WS; media via LiveKit SFU.
 */
export function useCall(opts: {
  meId?: string;
  subscribe: SubscribeFn;
  /** Fallback avatar for an incoming/outgoing call conversation (e.g. DM list). */
  resolvePeerAvatar?: (conversationId: string) => string | undefined;
  /** Pop-out /call window: resume media from handoff instead of placing calls. */
  isPopoutWindow?: boolean;
}) {
  const { meId, subscribe, resolvePeerAvatar, isPopoutWindow = false } = opts;
  const resolvePeerAvatarRef = useRef(resolvePeerAvatar);
  resolvePeerAvatarRef.current = resolvePeerAvatar;
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  /** LiveKit signal/media reconnect in progress (RoomEvent.Reconnecting). */
  const [reconnecting, setReconnecting] = useState(false);
  /** Wall-clock ms when media became active (in-call timer). */
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  /** Live local mic volume 0–1 (Web Audio analyser), updated continuously while in call. */
  const [micLevel, setMicLevel] = useState(0);
  /** Remote peer audio level 0–1 — proves RTP is arriving even if speakers are silent. */
  const [remoteMicLevel, setRemoteMicLevel] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  /** False when Chrome blocks remote audio until a user gesture (LiveKit startAudio). */
  const [audioPlaybackOk, setAudioPlaybackOk] = useState(true);
 /** LiveKit ConnectionQuality for local participant (MOS-style hint). */
  const [connectionQuality, setConnectionQuality] = useState<CallQualityLevel>("unknown");
  /** True after sustained poor/lost quality (DEGRADED_CALL_QUALITY_ALERT_WAIT). */
  const [qualityDegraded, setQualityDegraded] = useState(false);
  const [showCallStats, setShowCallStats] = useState(false);
  const [callStats, setCallStats] = useState<CallRtcStats | null>(null);
  const [remoteVideoEl, setRemoteVideoElState] = useState<HTMLVideoElement | null>(null);
  const [localVideoEl, setLocalVideoElState] = useState<HTMLVideoElement | null>(null);
  const [remoteAudioEl, setRemoteAudioElState] = useState<HTMLAudioElement | null>(null);
  /** LiveKit remote participants for group (N:N) grid. */
  const [remotePeers, setRemotePeers] = useState<CallRemotePeer[]>([]);
  /** True while media runs in a separate /call window (main chat stays usable). */
  const [poppedOut, setPoppedOut] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const activeRef = useRef<ActiveCall | null>(null);
  const endingRef = useRef(false);
  const intentionalDisconnectRef = useRef(false);
  /** True once a remote peer has joined this LiveKit room (avoids hangup on brief empty room). */
  const hadRemoteRef = useRef(false);
  const micMeterStopRef = useRef<(() => void) | null>(null);
  const remoteMicMeterStopRef = useRef<(() => void) | null>(null);
  const micMutedRef = useRef(false);
  const remoteVideoElRef = useRef<HTMLVideoElement | null>(null);
  const localVideoElRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioElRef = useRef<HTMLAudioElement | null>(null);
  const peerVideoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const peerAudioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const incomingNotifyRef = useRef<Notification | null>(null);
  const degradedSinceRef = useRef<number | null>(null);
  const mediaCredsRef = useRef<{ url: string; token: string } | null>(null);
  const poppedOutRef = useRef(false);
  activeRef.current = active;
  micMutedRef.current = micMuted;
  poppedOutRef.current = poppedOut;

  const clearRingAlerts = useCallback(() => {
    clearIncomingCallAlerts(incomingNotifyRef.current);
    incomingNotifyRef.current = null;
  }, []);

  const resetMediaUi = useCallback(() => {
    setConnecting(false);
    setReconnecting(false);
    setConnectedAt(null);
    setMicLevel(0);
    setRemoteMicLevel(0);
    setConnectionQuality("unknown");
    setQualityDegraded(false);
    setShowCallStats(false);
    setCallStats(null);
    setScreenSharing(false);
    setRemotePeers([]);
    setPoppedOut(false);
    mediaCredsRef.current = null;
    peerVideoElsRef.current.clear();
    peerAudioElsRef.current.forEach((el) => {
      el.pause();
      el.srcObject = null;
    });
    peerAudioElsRef.current.clear();
    degradedSinceRef.current = null;
  }, []);

  const setRemoteVideoEl = useCallback((el: HTMLVideoElement | null) => {
    // Ignore transient null from React callback-ref remounts so we don't drop
    // the element mid-attach (common cause of a permanent black remote tile).
    if (!el) return;
    if (remoteVideoElRef.current === el) return;
    remoteVideoElRef.current = el;
    setRemoteVideoElState(el);
    const room = roomRef.current;
    if (!room) return;
    // DM stage: prefer the first remote peer's screen share over camera.
    let attached = false;
    room.remoteParticipants.forEach((p) => {
      if (attached) return;
      const track = preferredVideoTrack(p);
      if (!track || track.kind !== "video") return;
      attachVideoToElement(track, el);
      el.classList.toggle("is-screenshare", isScreenSharing(p));
      attached = true;
    });
  }, []);
  const setLocalVideoEl = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    if (localVideoElRef.current === el) return;
    localVideoElRef.current = el;
    setLocalVideoElState(el);
    const room = roomRef.current;
    if (!room) return;
    const track = preferredVideoTrack(room.localParticipant);
    if (track) {
      attachVideoToElement(track, el);
      el.classList.toggle("is-screenshare", isScreenSharing(room.localParticipant));
    }
  }, []);
  const setRemoteAudioEl = useCallback((el: HTMLAudioElement | null) => {
    remoteAudioElRef.current = el;
    setRemoteAudioElState(el);
  }, []);

  const stopMicMeter = useCallback(() => {
    micMeterStopRef.current?.();
    micMeterStopRef.current = null;
    setMicLevel(0);
  }, []);

  const stopRemoteMicMeter = useCallback(() => {
    remoteMicMeterStopRef.current?.();
    remoteMicMeterStopRef.current = null;
    setRemoteMicLevel(0);
  }, []);

  function runVolumeMeter(
    track: LocalAudioTrack | RemoteAudioTrack,
    onLevel: (v: number) => void,
    shouldZero?: () => boolean
  ): () => void {
    const { createAudioAnalyser } = liveKitOrThrow();
    const { calculateVolume, cleanup } = createAudioAnalyser(track, {
      cloneTrack: false,
      fftSize: 512,
      smoothingTimeConstant: 0.4,
      minDecibels: -90,
      maxDecibels: -25,
    });
    let stopped = false;
    let raf = 0;
    const tick = () => {
      if (stopped) return;
      if (shouldZero?.()) {
        onLevel(0);
      } else {
        onLevel(Math.min(1, calculateVolume() * 2.2));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      cleanup().catch(() => {});
    };
  }

 /** Continuous mic VU via LiveKit createAudioAnalyser (speaking feedback). */
  const startMicMeter = useCallback((track: LocalAudioTrack) => {
    stopMicMeter();
    try {
      micMeterStopRef.current = runVolumeMeter(track, setMicLevel, () => micMutedRef.current);
    } catch {
      /* AudioContext unavailable */
    }
  }, [stopMicMeter]);

  const startRemoteMicMeter = useCallback((track: RemoteAudioTrack) => {
    stopRemoteMicMeter();
    try {
      remoteMicMeterStopRef.current = runVolumeMeter(track, setRemoteMicLevel);
    } catch {
      /* AudioContext unavailable */
    }
  }, [stopRemoteMicMeter]);

  const disconnectRoom = useCallback(async () => {
    stopMicMeter();
    stopRemoteMicMeter();
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      intentionalDisconnectRef.current = true;
      try {
        await room.disconnect();
      } catch {
        /* ignore */
      }
      intentionalDisconnectRef.current = false;
    }
  }, [stopMicMeter, stopRemoteMicMeter]);

 // Notify server so peers get call.ended (call_end). Do not gate on
  // endingRef — hangup() sets that flag before calling us to suppress media noise.
  const hangupServer = useCallback(async (callId: string) => {
    if (!callId) return;
    try {
      await api(`/v1/calls/${callId}/hangup`, { method: "POST" });
    } catch {
      /* ignore — may already be ended */
    }
  }, []);

  /** Attach via refs so TrackSubscribed never misses a late-mounted <audio>/<video>. */
  const attachTrack = useCallback(
    (
      track: RemoteTrack | LocalTrackPublication["track"],
      participantLocal: boolean,
      participantIdentity?: string
    ) => {
      if (!track) return;
      if (track.kind === "video") {
        const room = roomRef.current;
        if (participantLocal) {
          const el = localVideoElRef.current;
          if (!el || !room) return;
          const preferred = preferredVideoTrack(room.localParticipant);
          // Ignore camera frames while a screen-share track is the preferred source.
          if (preferred && preferred !== track) return;
          attachVideoToElement(track, el);
          el.classList.toggle("is-screenshare", isScreenSharing(room.localParticipant));
          return;
        }
        const identity = participantIdentity || "";
        const peerEl = identity ? peerVideoElsRef.current.get(identity) : undefined;
        const el = peerEl || remoteVideoElRef.current;
        if (!el) return;
        if (room && identity) {
          const p = room.remoteParticipants.get(identity);
          if (p) {
            const preferred = preferredVideoTrack(p);
            if (preferred && preferred !== track) return;
            el.classList.toggle("is-screenshare", isScreenSharing(p));
          }
        }
        attachVideoToElement(track, el);
      } else if (track.kind === "audio" && !participantLocal) {
        const identity = participantIdentity || "default";
        let el = peerAudioElsRef.current.get(identity);
        if (!el) {
          el = new Audio();
          el.autoplay = true;
          peerAudioElsRef.current.set(identity, el);
        }
        track.attach(el);
        el.muted = false;
        el.volume = 1;
        el.play().catch(() => {
          /* Autoplay may block until a click — Accept/Mute usually unlocks it. */
        });
        // Also bind primary remote audio element for DM / unlock UX.
        const primary = remoteAudioElRef.current;
        if (primary) {
          track.attach(primary);
          primary.muted = false;
          primary.volume = 1;
          primary.play().catch(() => {});
        }
      }
    },
    []
  );

  const syncRemotePeers = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setRemotePeers([]);
      return;
    }
    const next: CallRemotePeer[] = [];
    room.remoteParticipants.forEach((p) => {
      const identity = String(p.identity || "");
      const userId = identity.split(":")[0] || identity;
      const micPub = p.getTrackPublication("microphone" as Track.Source);
      const hasMic = Boolean(micPub?.track);
      const hasScreen = isScreenSharing(p);
      const hasLiveVideo = participantHasLiveVideo(p);
      next.push({
        identity,
        name: String(p.name || userId || "User"),
        userId,
        micMuted: !hasMic || Boolean(micPub?.isMuted),
        // Screen share counts as visible video (don't cover with avatar).
        cameraOff: !hasLiveVideo,
        screenSharing: hasScreen,
      });
    });
    setRemotePeers(next);
  }, []);

  /** Bind a grid tile <video> for a remote LiveKit identity. */
  const bindPeerVideoEl = useCallback(
    (identity: string, el: HTMLVideoElement | null) => {
      if (!identity) return;
      if (!el) {
        // Keep last element through React remount churn; overwrite on next bind.
        return;
      }
      peerVideoElsRef.current.set(identity, el);
      const room = roomRef.current;
      if (!room) return;
      const p = room.remoteParticipants.get(identity);
      if (!p) return;
      const track = preferredVideoTrack(p);
      if (track && track.kind === "video") {
        attachVideoToElement(track, el);
      }
      el.classList.toggle("is-screenshare", isScreenSharing(p));
    },
    []
  );

  /** Re-bind any already-subscribed remote tracks when the <audio> element mounts. */
  const reattachRemoteMedia = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    room.remoteParticipants.forEach((p) => {
      const track = preferredVideoTrack(p);
      if (track) attachTrack(track as RemoteTrack, false, p.identity);
      p.trackPublications.forEach((pub) => {
        if (pub.track?.kind === "audio") attachTrack(pub.track, false, p.identity);
      });
    });
  }, [attachTrack]);

  const connectLiveKit = useCallback(
    async (url: string, token: string, kind: CallKind, callId: string) => {
      await disconnectRoom();
      setConnecting(true);
      setReconnecting(false);
      setConnectionQuality("unknown");
      setQualityDegraded(false);
      setCallStats(null);
      degradedSinceRef.current = null;
      setError(null);
      setMicLevel(0);
      setRemoteMicLevel(0);
      const lkUrl = resolveLiveKitUrl(url);
      mediaCredsRef.current = { url: lkUrl, token };
      try {
        if (!lkUrl || !token) {
          throw new Error("Missing LiveKit URL or token");
        }

        // Chrome only exposes mediaDevices in a secure context (HTTPS or localhost).
        // http://192.168.x.x is insecure → navigator.mediaDevices is undefined.
        const media = navigator.mediaDevices;
        if (!media?.getUserMedia) {
          const origin =
            typeof window !== "undefined" ? window.location.origin : "http://192.168.91.136:3000";
          const insecure =
            typeof window !== "undefined" && !window.isSecureContext;
          throw new Error(
            insecure
              ? `MIC_INSECURE_ORIGIN:${origin}`
              : "Microphone API unavailable in this browser"
          );
        }
        // Load WebRTC SDK in parallel with the mic permission probe.
        const lkPromise = loadLiveKit();
        try {
          // Probe mic only. Opening camera here then stopping it often causes
          // Chrome/Electron "Could not start video source" when LiveKit opens
          // the camera again immediately (device still releasing).
          const stream = await withTimeout(
            media.getUserMedia({ audio: true, video: false }),
            20_000,
            "Microphone permission"
          );
          stream.getTracks().forEach((t) => t.stop());
        } catch (permErr: any) {
          if (permErr?.message?.includes("secure context") || permErr?.message?.includes("Microphone")) {
            throw permErr;
          }
          throw new Error(
            permErr?.name === "NotAllowedError"
              ? "Microphone permission denied — allow access and try again"
              : permErr?.message || "Could not access microphone"
          );
        }

        const { Room, RoomEvent } = await lkPromise;
        const room = new Room({
          // Keep adaptive streaming, but don't stall on a zero-size first layout.
          adaptiveStream: { pixelDensity: "screen" },
          dynacast: true,
        });
        roomRef.current = room;
        hadRemoteRef.current = false;
        setAudioPlaybackOk(room.canPlaybackAudio);

        room.on(RoomEvent.AudioPlaybackStatusChanged, (playing: boolean) => {
          setAudioPlaybackOk(playing);
          if (playing) reattachRemoteMedia();
        });
        room.on(RoomEvent.TrackMuted, () => syncRemotePeers());
        room.on(RoomEvent.TrackUnmuted, () => syncRemotePeers());
        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant) => {
          hadRemoteRef.current = true;
          attachTrack(track, false, participant.identity);
          if (track.kind === "audio") {
            startRemoteMicMeter(track as RemoteAudioTrack);
          }
          syncRemotePeers();
        });
        room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant) => {
          if (track.kind === "audio") stopRemoteMicMeter();
          track.detach();
          syncRemotePeers();
          // Screen share ended → fall back to camera on that peer's tile.
          if (track.kind === "video" && participant) {
            const preferred = preferredVideoTrack(participant);
            if (preferred) attachTrack(preferred as RemoteTrack, false, participant.identity);
          }
        });
        room.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
          if (pub.track) attachTrack(pub.track, true);
          if (pub.track?.kind === "audio") {
            startMicMeter(pub.track as LocalAudioTrack);
          }
          if (pub.source === ("screen_share" as Track.Source)) {
            setScreenSharing(true);
            const el = localVideoElRef.current;
            const preferred = preferredVideoTrack(room.localParticipant);
            if (el && preferred) {
              attachVideoToElement(preferred, el);
              el.classList.add("is-screenshare");
            }
          }
        });
        room.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
          if (pub.source === ("screen_share" as Track.Source)) {
            setScreenSharing(false);
            const el = localVideoElRef.current;
            const preferred = preferredVideoTrack(room.localParticipant);
            if (el && preferred) {
              attachVideoToElement(preferred, el);
              el.classList.remove("is-screenshare");
            } else if (el) {
              el.classList.remove("is-screenshare");
            }
          }
        });
        room.on(RoomEvent.ParticipantConnected, (participant) => {
          hadRemoteRef.current = true;
          clearRingAlerts();
          const name = String(participant?.name ?? "").trim();
          if (name) {
            setActive((prev) =>
              prev && prev.callId === callId && !prev.peerName
                ? { ...prev, peerName: name }
                : prev
            );
          }
          // Peer may already be publishing — bind any existing remote tracks.
          reattachRemoteMedia();
          syncRemotePeers();
        });
        // LiveKit auto-reconnect (default); surface UX while signal/media recovers.
        room.on(RoomEvent.Reconnecting, () => {
          if (intentionalDisconnectRef.current || endingRef.current) return;
          setReconnecting(true);
        });
        room.on(RoomEvent.SignalReconnecting, () => {
          if (intentionalDisconnectRef.current || endingRef.current) return;
          setReconnecting(true);
        });
        room.on(RoomEvent.Reconnected, () => {
          if (intentionalDisconnectRef.current || endingRef.current) return;
          setReconnecting(false);
          setError(null);
          reattachRemoteMedia();
          room.startAudio().catch(() => {});
        });
        room.on(RoomEvent.ConnectionQualityChanged, (quality: string, participant: Participant) => {
          if (participant !== room.localParticipant) return;
          const level = qualityFromLiveKit(quality);
          setConnectionQuality(level);
          if (isDegradedQuality(level)) {
            if (degradedSinceRef.current == null) degradedSinceRef.current = Date.now();
            else if (Date.now() - degradedSinceRef.current >= DEGRADED_CALL_QUALITY_ALERT_WAIT_MS) {
              setQualityDegraded(true);
            }
          } else {
            degradedSinceRef.current = null;
            setQualityDegraded(false);
          }
        });
        room.on(RoomEvent.Disconnected, () => {
          if (intentionalDisconnectRef.current || endingRef.current) return;
          const cur = activeRef.current;
          if (cur && cur.callId === callId) {
            setReconnecting(false);
            stopMicMeter();
            setError((prev) => prev || "Media disconnected — check LiveKit (port 7880) and mic permission");
          }
        });
        // 1:1: peer left LiveKit after having joined → end call (tab close fallback).
        // Group: keep the room open until host hangs up / last leave via API.
        room.on(RoomEvent.ParticipantDisconnected, () => {
          syncRemotePeers();
          if (intentionalDisconnectRef.current || endingRef.current) return;
          if (!hadRemoteRef.current) return;
          if (room.remoteParticipants.size > 0) return;
          const cur = activeRef.current;
          if (!cur || cur.callId !== callId) return;
          if (cur.isGroup) return;
          endingRef.current = true;
          clearRingAlerts();
          setActive(null);
          setIncoming(null);
          setError(null);
          resetMediaUi();
          disconnectRoom().catch(() => {});
          hangupServer(callId).finally(() => {
            endingRef.current = false;
          });
        });

        // LiveKit defaults peerConnectionTimeout/websocketTimeout to 15s — that was
        // ending answered calls at "Voice call · 15s" on slow ICE (VM / Cursor).
        // Reconnect stays enabled (LiveKit default) for mid-call network blips.
        await withTimeout(
          room.connect(lkUrl, token, {
            peerConnectionTimeout: 60_000,
            websocketTimeout: 60_000,
          }),
          65_000,
          `LiveKit connect (${lkUrl})`
        );
        if (room.remoteParticipants.size > 0) {
          hadRemoteRef.current = true;
          clearRingAlerts();
          room.remoteParticipants.forEach((p) => {
            const name = String(p.name ?? "").trim();
            if (name) {
              setActive((prev) =>
                prev && prev.callId === callId && !prev.peerName
                  ? { ...prev, peerName: name }
                  : prev
              );
            }
          });
          syncRemotePeers();
        }
        // SFU is up — leave "Setting up media…" even if mic publish is slow.
        setConnecting(false);
        setConnectedAt(Date.now());
        // Unlock remote playback (Chrome autoplay). Best-effort after connect;
        // if it fails, UI shows "Tap to enable sound".
        try {
          await room.startAudio();
          setAudioPlaybackOk(true);
        } catch {
          setAudioPlaybackOk(false);
        }
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          setMicMuted(false);
          const micPub = room.localParticipant.getTrackPublication("microphone" as Track.Source);
          if (micPub?.track?.kind === "audio") {
            startMicMeter(micPub.track as LocalAudioTrack);
          }
        } catch (micErr: any) {
          setError(micErr?.message || "Microphone failed — call stays open; check browser permissions");
          setMicMuted(true);
        }
        if (kind === "video") {
          try {
            await room.localParticipant.setCameraEnabled(true);
            setCameraOff(false);
          } catch (camErr: any) {
            // Brief retry — device can still be releasing after the mic probe.
            await new Promise((r) => setTimeout(r, 400));
            try {
              await room.localParticipant.setCameraEnabled(true);
              setCameraOff(false);
            } catch {
              setCameraOff(true);
              setError((prev) => prev || friendlyCallError(camErr) || "Camera failed — voice may still work");
            }
          }
        } else {
          await room.localParticipant.setCameraEnabled(false).catch(() => {});
          setCameraOff(true);
        }

        room.remoteParticipants.forEach((p) => {
          p.trackPublications.forEach((pub) => {
            if (pub.track) {
              attachTrack(pub.track, false, p.identity);
              if (pub.track.kind === "audio") {
                startRemoteMicMeter(pub.track as RemoteAudioTrack);
              }
            }
          });
        });
        room.localParticipant.trackPublications.forEach((pub) => {
          if (pub.track) attachTrack(pub.track, true);
        });
      } catch (e: any) {
        const msg = friendlyCallError(e);
        setError(msg);
        setReconnecting(false);
        await disconnectRoom();
        // Keep the in-call overlay so the user can Hang up / retry; ending the
        // server session here caused the "auto hangup" feeling when LiveKit/WS
        // or getUserMedia failed.
        throw e;
      } finally {
        setConnecting(false);
      }
    },
    [
      attachTrack,
      clearRingAlerts,
      disconnectRoom,
      hangupServer,
      reattachRemoteMedia,
      resetMediaUi,
      startMicMeter,
      startRemoteMicMeter,
      stopMicMeter,
      stopRemoteMicMeter,
      syncRemotePeers,
    ]
  );

  useEffect(() => {
    reattachRemoteMedia();
    const room = roomRef.current;
    if (!room) return;
    room.localParticipant.trackPublications.forEach((pub) => {
      if (pub.track) attachTrack(pub.track, true);
    });
  }, [attachTrack, reattachRemoteMedia, remoteAudioEl, remoteVideoEl, localVideoEl]);

  useEffect(() => {
    return subscribe((type, payload) => {
      if (type === "call.ring") {
        const callId = String(payload?.call_id ?? payload?.id ?? "");
        const initiatorId = String(payload?.initiator_id ?? "");
        if (!callId || (meId && initiatorId === meId)) return;
        // Already in this call — ignore duplicate rings (re-invite / race).
        const cur = activeRef.current;
        if (cur && cur.callId === callId && cur.status === "active") return;
        // Busy in another call: keep media, still show incoming so user can decline.
        prefetchLiveKit();
        setError(null);
        const conversationId = String(payload?.conversation_id ?? "");
        const fromPayload = String(payload?.initiator_avatar ?? "").trim();
        const fromConv = conversationId
          ? resolvePeerAvatarRef.current?.(conversationId)?.trim()
          : undefined;
        const incomingCall = {
          callId,
          conversationId,
          kind: (payload?.kind === "video" ? "video" : "voice") as CallKind,
          initiatorId,
          initiatorName: String(payload?.initiator_name ?? "") || undefined,
          initiatorAvatar: fromPayload || fromConv || undefined,
          livekitUrl: String(payload?.livekit_url ?? "") || undefined,
          isGroup: Boolean(payload?.is_group),
        };
        setIncoming(incomingCall);
        // ringForCall + DID_NOTIFY_FOR_CALL (background tab).
        clearRingAlerts();
        ringForIncomingCall();
        incomingNotifyRef.current = notifyIncomingCall({
          callId: incomingCall.callId,
          conversationId: incomingCall.conversationId,
          kind: incomingCall.kind,
          initiatorName: incomingCall.initiatorName,
        });
        return;
      }
      if (type === "call.answered") {
        const callId = String(payload?.call_id ?? payload?.id ?? "");
        const token = String(payload?.livekit_token ?? "");
        const url = String(payload?.livekit_url ?? "");
        const kind = payload?.kind === "video" ? "video" : "voice";
        const convId = String(payload?.conversation_id ?? "");
        if (!callId || !token || !url) return;
        // Only the tab that started this call joins media (same device_id may have multiple tabs).
        const local = activeRef.current;
        if (!local || local.role !== "caller" || local.callId !== callId) return;
        clearRingAlerts();
        setIncoming(null);
        setActive((prev) => ({
          callId,
          conversationId: convId,
          kind,
          status: "active",
          role: "caller",
          peerName: prev?.peerName,
          peerAvatar: prev?.peerAvatar,
          isGroup: prev?.isGroup || Boolean(payload?.is_group),
          isHost: prev?.isHost ?? true,
        }));
        // Group host may already be connected from start — skip reconnect if room is up.
        if (local.isGroup && roomRef.current) {
          return;
        }
        connectLiveKit(url, token, kind, callId).catch(() => {});
        return;
      }
      if (type === "call.participant_kicked") {
        const callId = String(payload?.call_id ?? payload?.id ?? "");
        const kickedUser = String(payload?.user_id ?? "");
        const by = String(payload?.by ?? "");
        if (!callId) return;
        if (meId && kickedUser === meId) {
          endingRef.current = true;
          clearRingAlerts();
          setIncoming(null);
          setActive((prev) => (prev && prev.callId === callId ? null : prev));
          setError("You were removed from the call by the host");
          resetMediaUi();
          disconnectRoom().catch(() => {});
          endingRef.current = false;
          return;
        }
        // Host/others: update peer list from LiveKit events; no-op if not in call.
        if (meId && by === meId) return;
        return;
      }
      if (type === "call.taken") {
        // Another device of this user answered — clear local ring UI only.
        const callId = String(payload?.call_id ?? payload?.id ?? "");
        clearRingAlerts();
        setIncoming((prev) => {
          if (!prev) return null;
          if (!callId || prev.callId === callId) return null;
          return prev;
        });
        return;
      }
      if (type === "call.ended") {
        const callId = String(payload?.call_id ?? payload?.id ?? "");
        // Match by call id only — never tear down an active call because another
        // session in the same conversation ended (or was "replaced").
        endingRef.current = true;
        clearRingAlerts();
        setIncoming((prev) => {
          if (!prev) return null;
          if (!callId || prev.callId === callId) return null;
          return prev;
        });
        const endedActive = activeRef.current;
        const matchesActive = Boolean(
          endedActive && callId && endedActive.callId === callId
        );
        if (matchesActive && endedActive) {
          postCallChannel({ type: "call-ended", callId: endedActive.callId });
          setActive(null);
          resetMediaUi();
          setError(null);
          disconnectRoom().catch(() => {});
          if (isPopoutWindow) {
            window.setTimeout(() => window.close(), 250);
          }
        }
        endingRef.current = false;
      }
    });
  }, [subscribe, meId, connectLiveKit, disconnectRoom, clearRingAlerts, resetMediaUi, isPopoutWindow]);

  // Optional RTC stats while the stats panel is open.
  useEffect(() => {
    if (!showCallStats || !active || active.status !== "active") {
      setCallStats(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const stats = await sampleCallStats(roomRef.current);
      if (!cancelled) setCallStats(stats);
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [showCallStats, active?.callId, active?.status]);

  // Re-check degraded quality wait while still poor (ConnectionQuality may not re-fire).
  useEffect(() => {
    if (!active || active.status !== "active") return;
    if (!isDegradedQuality(connectionQuality)) return;
    const id = window.setInterval(() => {
      if (degradedSinceRef.current == null) return;
      if (Date.now() - degradedSinceRef.current >= DEGRADED_CALL_QUALITY_ALERT_WAIT_MS) {
        setQualityDegraded(true);
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [active?.callId, active?.status, connectionQuality]);

  const startCall = useCallback(
    async (
      conversationId: string,
      kind: CallKind,
      peerName?: string,
      peerAvatar?: string,
      inviteeIds?: string[]
    ) => {
      setError(null);
      prefetchLiveKit();
      const body: Record<string, unknown> = { conversation_id: conversationId, kind };
      if (inviteeIds && inviteeIds.length > 0) {
        body.invitee_ids = inviteeIds;
      }
      const res = await api<any>("/v1/calls", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const callId = String(res?.call_id ?? res?.id ?? "");
      const isGroup = Boolean(res?.is_group) || Boolean(inviteeIds?.length);
      setConnectedAt(null);
      setReconnecting(false);
      const avatar =
        peerAvatar?.trim() ||
        resolvePeerAvatarRef.current?.(conversationId)?.trim() ||
        undefined;
      setActive({
        callId,
        conversationId,
        kind,
        status: "ringing",
        role: "caller",
        peerName: peerName?.trim() || undefined,
        peerAvatar: avatar,
        isGroup,
        isHost: true,
      });
      // Phone-style ringback while waiting for answer / first peer.
      ringForOutgoingCall();
      const token = String(res?.livekit_token ?? "");
      const url = String(res?.livekit_url ?? "");
      if (isGroup && token && url) {
        setActive((prev) =>
          prev && prev.callId === callId ? { ...prev, status: "active" } : prev
        );
        connectLiveKit(url, token, kind, callId).catch(() => {});
      }
      return res;
    },
    [connectLiveKit]
  );

  const answerCall = useCallback(async () => {
    if (!incoming) return;
    setError(null);
    prefetchLiveKit();
    const kind = incoming.kind;
    const callId = incoming.callId;
    const convId = incoming.conversationId;
    const peerName = incoming.initiatorName?.trim() || undefined;
    const peerAvatar =
      incoming.initiatorAvatar?.trim() ||
      resolvePeerAvatarRef.current?.(convId)?.trim() ||
      undefined;
    const isGroup = Boolean(incoming.isGroup);
    clearRingAlerts();

    // Leaving a prior call before joining another — hangupServer leaves (non-host)
    // or ends (host/DM); never leave media half-connected across rooms.
    const prev = activeRef.current;
    if (prev && prev.callId !== callId) {
      const leaveId = prev.callId;
      setActive(null);
      resetMediaUi();
      await disconnectRoom().catch(() => {});
      await hangupServer(leaveId).catch(() => {});
    }

    const res = await api<any>(`/v1/calls/${callId}/answer`, { method: "POST" });
    const token = String(res?.livekit_token ?? "");
    const url = String(res?.livekit_url ?? incoming.livekitUrl ?? "");
    setIncoming(null);
    setActive({
      callId,
      conversationId: convId,
      kind,
      status: "active",
      role: "callee",
      peerName,
      peerAvatar,
      isGroup: isGroup || Boolean(res?.is_group),
      isHost: false,
    });
    try {
      await connectLiveKit(url, token, kind, callId);
    } catch {
      /* error shown on overlay; user can Hang up */
    }
  }, [incoming, connectLiveKit, clearRingAlerts, disconnectRoom, hangupServer, resetMediaUi]);

  const inviteToCall = useCallback(async (userIds: string[]) => {
    const cur = activeRef.current;
    if (!cur?.isGroup || !userIds.length) return;
    await api(`/v1/calls/${cur.callId}/invite`, {
      method: "POST",
      body: JSON.stringify({ invitee_ids: userIds }),
    });
  }, []);

  const kickFromCall = useCallback(async (userId: string) => {
    const cur = activeRef.current;
    if (!cur?.isGroup || !cur.isHost || !userId) return;
    await api(`/v1/calls/${cur.callId}/kick`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    });
  }, []);

  const declineCall = useCallback(async () => {
    if (!incoming) return;
    const id = incoming.callId;
    clearRingAlerts();
    setIncoming(null);
    await api(`/v1/calls/${id}/decline`, { method: "POST" }).catch(() => {});
  }, [incoming, clearRingAlerts]);

  const hangup = useCallback(async () => {
    const cur = activeRef.current;
    if (!cur) return;
    const id = cur.callId;
    endingRef.current = true;
    clearRingAlerts();
    postCallChannel({ type: "force-hangup", callId: id });
    postCallChannel({ type: "call-ended", callId: id });
    clearCallHandoff();
    setActive(null);
    setIncoming(null);
    setError(null);
    resetMediaUi();
    await disconnectRoom();
    await hangupServer(id);
    endingRef.current = false;
    if (isPopoutWindow) {
      window.setTimeout(() => window.close(), 150);
    }
  }, [disconnectRoom, hangupServer, clearRingAlerts, resetMediaUi, isPopoutWindow]);

  /** Move group/video media into a Telegram-style /call popup; chat stays in main window. */
  const popOutCall = useCallback(async () => {
    if (isPopoutWindow) return false;
    const cur = activeRef.current;
    const creds = mediaCredsRef.current;
    if (!cur || cur.status !== "active" || !creds?.url || !creds?.token) return false;
    if (poppedOutRef.current) {
      focusCallPopoutWindow();
      return true;
    }
    const payload: CallHandoffPayload = {
      v: 1,
      callId: cur.callId,
      conversationId: cur.conversationId,
      kind: cur.kind,
      role: cur.role,
      isGroup: cur.isGroup,
      isHost: cur.isHost,
      peerName: cur.peerName,
      peerAvatar: cur.peerAvatar,
      livekitUrl: creds.url,
      livekitToken: creds.token,
      createdAt: Date.now(),
    };
    writeCallHandoff(payload);
    intentionalDisconnectRef.current = true;
    await disconnectRoom();
    intentionalDisconnectRef.current = false;
    const opened = openCallPopoutWindow();
    if (!opened) {
      // Popup blocked — reclaim media in this window.
      try {
        await connectLiveKit(creds.url, creds.token, cur.kind, cur.callId);
      } catch {
        /* keep active; UI can retry */
      }
      setPoppedOut(false);
      return false;
    }
    setPoppedOut(true);
    setConnecting(false);
    setReconnecting(false);
    setRemotePeers([]);
    return true;
  }, [disconnectRoom, connectLiveKit, isPopoutWindow]);

  const focusPopout = useCallback(() => {
    focusCallPopoutWindow();
  }, []);

  /** Pop-out window: take handoff and reconnect LiveKit in this window only. */
  const resumeFromHandoff = useCallback(async () => {
    const handoff = takeCallHandoff();
    if (!handoff) return false;
    setPoppedOut(false);
    setError(null);
    setActive({
      callId: handoff.callId,
      conversationId: handoff.conversationId,
      kind: handoff.kind,
      status: "active",
      role: handoff.role,
      peerName: handoff.peerName,
      peerAvatar: handoff.peerAvatar,
      isGroup: handoff.isGroup,
      isHost: handoff.isHost,
    });
    postCallChannel({ type: "popout-ready", callId: handoff.callId });
    try {
      await connectLiveKit(handoff.livekitUrl, handoff.livekitToken, handoff.kind, handoff.callId);
      clearCallHandoff();
      return true;
    } catch (e) {
      // Keep handoff so Strict Mode remount / retry can reuse it.
      throw e;
    }
  }, [connectLiveKit]);

  /** Main window: reclaim media if pop-out closed without hanging up. */
  const reclaimCall = useCallback(async () => {
    if (isPopoutWindow) return false;
    const cur = activeRef.current;
    const creds = mediaCredsRef.current;
    if (!cur || cur.status !== "active" || !creds?.url || !creds?.token) {
      setPoppedOut(false);
      return false;
    }
    setPoppedOut(false);
    try {
      await connectLiveKit(creds.url, creds.token, cur.kind, cur.callId);
      return true;
    } catch {
      return false;
    }
  }, [connectLiveKit, isPopoutWindow]);

  // Cross-window coordination (Telegram-style call window ↔ chat).
  useEffect(() => {
    return openCallChannel((msg) => {
      const cur = activeRef.current;
      if (!cur) return;
      if (msg.callId && msg.callId !== cur.callId) return;
      if (msg.type === "force-hangup" || msg.type === "call-ended") {
        if (endingRef.current) return;
        endingRef.current = true;
        clearCallHandoff();
        setActive(null);
        setIncoming(null);
        setError(null);
        resetMediaUi();
        disconnectRoom().catch(() => {});
        endingRef.current = false;
        if (isPopoutWindow) {
          window.setTimeout(() => window.close(), 150);
        }
        return;
      }
      if (msg.type === "popout-closed" && !isPopoutWindow && poppedOutRef.current) {
        reclaimCall().catch(() => {});
        return;
      }
      if (msg.type === "popout-ready" && !isPopoutWindow) {
        setPoppedOut(true);
        return;
      }
      if (msg.type === "focus-main" && !isPopoutWindow) {
        focusMainChatWindow();
      }
    });
  }, [disconnectRoom, resetMediaUi, reclaimCall, isPopoutWindow]);

  useEffect(() => {
    if (!isPopoutWindow) return;
    const onUnload = () => {
      const cur = activeRef.current;
      if (!cur || endingRef.current) return;
      postCallChannel({ type: "popout-closed", callId: cur.callId });
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [isPopoutWindow]);

  const toggleCallStats = useCallback(() => {
    setShowCallStats((v) => !v);
  }, []);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micMuted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMicMuted(next);
    if (next) setMicLevel(0);
    // User gesture: unlock remote playback if Chrome blocked autoplay.
    try {
      await room.startAudio();
      setAudioPlaybackOk(true);
    } catch {
      /* still blocked */
    }
    remoteAudioElRef.current?.play().catch(() => {});
  }, [micMuted]);

  /** Explicit user-gesture unlock for remote call audio (LiveKit startAudio). */
  const enableSound = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.startAudio();
      setAudioPlaybackOk(true);
    } catch {
      setAudioPlaybackOk(false);
    }
    reattachRemoteMedia();
    remoteAudioElRef.current?.play().catch(() => {});
  }, [reattachRemoteMedia]);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room || active?.kind !== "video") return;
    const next = !cameraOff;
    try {
      await room.localParticipant.setCameraEnabled(!next);
      setCameraOff(next);
      if (!next) setError(null);
    } catch (err) {
      setCameraOff(true);
      setError(friendlyCallError(err) || "Camera failed — try again or check another app is not using it");
    }
  }, [cameraOff, active?.kind]);

  /** LiveKit screen share — uses getDisplayMedia (Electron: desktopCapturer handler). */
  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room || active?.status !== "active") return;
    const next = !screenSharing;
    try {
      await room.localParticipant.setScreenShareEnabled(next);
      setScreenSharing(next);
      const el = localVideoElRef.current;
      const track = preferredVideoTrack(room.localParticipant);
      if (el && track) {
        attachVideoToElement(track, el);
        el.classList.toggle("is-screenshare", next);
      }
      syncRemotePeers();
    } catch (err: any) {
      setScreenSharing(false);
      const msg = String(err?.message || err || "");
      if (/Permission|NotAllowed|denied/i.test(msg)) {
        setError("Screen share permission denied — allow display capture and try again");
      } else if (/NotSupported|getDisplayMedia/i.test(msg)) {
        setError("Screen share is not available in this environment");
      } else {
        setError(msg || "Could not start screen share");
      }
    }
  }, [screenSharing, active?.status, syncRemotePeers]);

  return {
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
    audioPlaybackOk,
    remotePeers,
    poppedOut,
    setRemoteVideoEl,
    setLocalVideoEl,
    setRemoteAudioEl,
    bindPeerVideoEl,
    startCall,
    answerCall,
    declineCall,
    hangup,
    inviteToCall,
    kickFromCall,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    enableSound,
    toggleCallStats,
    popOutCall,
    focusPopout,
    resumeFromHandoff,
    reclaimCall,
  };
}
