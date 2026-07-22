"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionQuality,
  Room,
  RoomEvent,
  Track,
  createAudioAnalyser,
  type LocalAudioTrack,
  type RemoteAudioTrack,
  type LocalTrackPublication,
  type Participant,
  type RemoteTrack,
} from "livekit-client";
import { api } from "@/lib/api";
import {
  clearIncomingCallAlerts,
  notifyIncomingCall,
  ringForIncomingCall,
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

export type CallKind = "voice" | "video";

export type IncomingCall = {
  callId: string;
  conversationId: string;
  kind: CallKind;
  initiatorId: string;
  initiatorName?: string;
  livekitUrl?: string;
};

export type ActiveCall = {
  callId: string;
  conversationId: string;
  kind: CallKind;
  status: "ringing" | "active";
  role: "caller" | "callee";
  /** Remote peer display name (DM title / initiator_name / LiveKit participant name). */
  peerName?: string;
};

type SubscribeFn = (handler: (type: string, payload: any) => void) => () => void;

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
 * Mattermost Calls-style 1:1 ring → answer → LiveKit media.
 * Signaling via Qchat WS; media via LiveKit SFU.
 */
export function useCall(opts: {
  meId?: string;
  subscribe: SubscribeFn;
}) {
  const { meId, subscribe } = opts;
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
  /** False when Chrome blocks remote audio until a user gesture (LiveKit startAudio). */
  const [audioPlaybackOk, setAudioPlaybackOk] = useState(true);
  /** LiveKit ConnectionQuality for local participant (Mattermost MOS-style hint). */
  const [connectionQuality, setConnectionQuality] = useState<CallQualityLevel>("unknown");
  /** True after sustained poor/lost quality (DEGRADED_CALL_QUALITY_ALERT_WAIT). */
  const [qualityDegraded, setQualityDegraded] = useState(false);
  const [showCallStats, setShowCallStats] = useState(false);
  const [callStats, setCallStats] = useState<CallRtcStats | null>(null);
  const [remoteVideoEl, setRemoteVideoElState] = useState<HTMLVideoElement | null>(null);
  const [localVideoEl, setLocalVideoElState] = useState<HTMLVideoElement | null>(null);
  const [remoteAudioEl, setRemoteAudioElState] = useState<HTMLAudioElement | null>(null);

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
  const incomingNotifyRef = useRef<Notification | null>(null);
  const degradedSinceRef = useRef<number | null>(null);
  activeRef.current = active;
  micMutedRef.current = micMuted;

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
    degradedSinceRef.current = null;
  }, []);

  const setRemoteVideoEl = useCallback((el: HTMLVideoElement | null) => {
    remoteVideoElRef.current = el;
    setRemoteVideoElState(el);
  }, []);
  const setLocalVideoEl = useCallback((el: HTMLVideoElement | null) => {
    localVideoElRef.current = el;
    setLocalVideoElState(el);
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

  /** Continuous mic VU via LiveKit createAudioAnalyser (Mattermost-style speaking feedback). */
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

  // Notify server so peers get call.ended (Mattermost call_end). Do not gate on
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
    (track: RemoteTrack | LocalTrackPublication["track"], participantLocal: boolean) => {
      if (!track) return;
      if (track.kind === Track.Kind.Video) {
        const el = participantLocal ? localVideoElRef.current : remoteVideoElRef.current;
        if (el) {
          track.attach(el);
          el.play().catch(() => {});
        }
      } else if (track.kind === Track.Kind.Audio && !participantLocal) {
        const el = remoteAudioElRef.current;
        if (el) {
          track.attach(el);
          el.muted = false;
          el.volume = 1;
          el.play().catch(() => {
            /* Autoplay may block until a click — Accept/Mute usually unlocks it. */
          });
        }
      }
    },
    []
  );

  /** Re-bind any already-subscribed remote tracks when the <audio> element mounts. */
  const reattachRemoteMedia = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    room.remoteParticipants.forEach((p) => {
      p.trackPublications.forEach((pub) => {
        if (pub.track) attachTrack(pub.track, false);
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
        try {
          const stream = await withTimeout(
            media.getUserMedia({
              audio: true,
              video: kind === "video",
            }),
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
              ? "Microphone/camera permission denied — allow access and try again"
              : permErr?.message || "Could not access microphone/camera"
          );
        }

        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;
        hadRemoteRef.current = false;
        setAudioPlaybackOk(room.canPlaybackAudio);

        room.on(RoomEvent.AudioPlaybackStatusChanged, (playing: boolean) => {
          setAudioPlaybackOk(playing);
          if (playing) reattachRemoteMedia();
        });
        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          hadRemoteRef.current = true;
          attachTrack(track, false);
          if (track.kind === Track.Kind.Audio) {
            startRemoteMicMeter(track as RemoteAudioTrack);
          }
        });
        room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio) stopRemoteMicMeter();
          track.detach();
        });
        room.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
          if (pub.track) attachTrack(pub.track, true);
          if (pub.track?.kind === Track.Kind.Audio) {
            startMicMeter(pub.track as LocalAudioTrack);
          }
        });
        room.on(RoomEvent.ParticipantConnected, (participant) => {
          hadRemoteRef.current = true;
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
        room.on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant: Participant) => {
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
        // Do not hang up on never-joined / ICE flap — that caused ~15s auto-ends when
        // LiveKit peerConnectionTimeout (default 15s) dropped a side.
        room.on(RoomEvent.ParticipantDisconnected, () => {
          if (intentionalDisconnectRef.current || endingRef.current) return;
          if (!hadRemoteRef.current) return;
          if (room.remoteParticipants.size > 0) return;
          const cur = activeRef.current;
          if (!cur || cur.callId !== callId) return;
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
          const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
          if (micPub?.track?.kind === Track.Kind.Audio) {
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
          } catch {
            setCameraOff(true);
            setError((prev) => prev || "Camera failed — voice may still work");
          }
        } else {
          await room.localParticipant.setCameraEnabled(false).catch(() => {});
          setCameraOff(true);
        }

        room.remoteParticipants.forEach((p) => {
          p.trackPublications.forEach((pub) => {
            if (pub.track) {
              attachTrack(pub.track, false);
              if (pub.track.kind === Track.Kind.Audio) {
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
        setError(null);
        const incomingCall = {
          callId,
          conversationId: String(payload?.conversation_id ?? ""),
          kind: (payload?.kind === "video" ? "video" : "voice") as CallKind,
          initiatorId,
          initiatorName: String(payload?.initiator_name ?? "") || undefined,
          livekitUrl: String(payload?.livekit_url ?? "") || undefined,
        };
        setIncoming(incomingCall);
        // Mattermost ringForCall + DID_NOTIFY_FOR_CALL (background tab).
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
        clearRingAlerts();
        setIncoming(null);
        setActive((prev) => ({
          callId,
          conversationId: convId,
          kind,
          status: "active",
          role: "caller",
          peerName: prev?.peerName,
        }));
        connectLiveKit(url, token, kind, callId).catch(() => {});
        return;
      }
      if (type === "call.ended") {
        const callId = String(payload?.call_id ?? payload?.id ?? "");
        const convId = String(payload?.conversation_id ?? "");
        endingRef.current = true;
        clearRingAlerts();
        setIncoming((prev) => {
          if (!prev) return null;
          if (!callId || prev.callId === callId) return null;
          if (convId && prev.conversationId === convId) return null;
          return prev;
        });
        setActive((prev) => {
          if (!prev) return null;
          if (!callId || prev.callId === callId) return null;
          if (convId && prev.conversationId === convId) return null;
          return prev;
        });
        resetMediaUi();
        setError(null);
        disconnectRoom().catch(() => {});
        endingRef.current = false;
      }
    });
  }, [subscribe, meId, connectLiveKit, disconnectRoom, clearRingAlerts, resetMediaUi]);

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
    async (conversationId: string, kind: CallKind, peerName?: string) => {
      setError(null);
      const res = await api<any>("/v1/calls", {
        method: "POST",
        body: JSON.stringify({ conversation_id: conversationId, kind }),
      });
      const callId = String(res?.call_id ?? res?.id ?? "");
      setConnectedAt(null);
      setReconnecting(false);
      setActive({
        callId,
        conversationId,
        kind,
        status: "ringing",
        role: "caller",
        peerName: peerName?.trim() || undefined,
      });
      return res;
    },
    []
  );

  const answerCall = useCallback(async () => {
    if (!incoming) return;
    setError(null);
    const kind = incoming.kind;
    const callId = incoming.callId;
    const convId = incoming.conversationId;
    const peerName = incoming.initiatorName?.trim() || undefined;
    clearRingAlerts();
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
    });
    try {
      await connectLiveKit(url, token, kind, callId);
    } catch {
      /* error shown on overlay; user can Hang up */
    }
  }, [incoming, connectLiveKit, clearRingAlerts]);

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
    setActive(null);
    setIncoming(null);
    setError(null);
    resetMediaUi();
    await disconnectRoom();
    await hangupServer(id);
    endingRef.current = false;
  }, [disconnectRoom, hangupServer, clearRingAlerts, resetMediaUi]);

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
    await room.localParticipant.setCameraEnabled(!next);
    setCameraOff(next);
  }, [cameraOff, active?.kind]);

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
    audioPlaybackOk,
    setRemoteVideoEl,
    setLocalVideoEl,
    setRemoteAudioEl,
    startCall,
    answerCall,
    declineCall,
    hangup,
    toggleMic,
    toggleCamera,
    enableSound,
    toggleCallStats,
  };
}
