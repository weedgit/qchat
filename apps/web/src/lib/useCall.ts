"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";
import { api } from "@/lib/api";

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
};

type SubscribeFn = (handler: (type: string, payload: any) => void) => () => void;

/** If API returns ws://localhost but the page is opened via LAN IP, rewrite host. */
function resolveLiveKitUrl(url: string): string {
  if (typeof window === "undefined" || !url) return url;
  try {
    const normalized = url.replace(/^ws/i, "http");
    const u = new URL(normalized);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      u.hostname = window.location.hostname;
    }
    return u.toString().replace(/^http/i, "ws");
  } catch {
    return url;
  }
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
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [remoteVideoEl, setRemoteVideoEl] = useState<HTMLVideoElement | null>(null);
  const [localVideoEl, setLocalVideoEl] = useState<HTMLVideoElement | null>(null);
  const [remoteAudioEl, setRemoteAudioEl] = useState<HTMLAudioElement | null>(null);

  const roomRef = useRef<Room | null>(null);
  const activeRef = useRef<ActiveCall | null>(null);
  const endingRef = useRef(false);
  const intentionalDisconnectRef = useRef(false);
  activeRef.current = active;

  const disconnectRoom = useCallback(async () => {
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
  }, []);

  const hangupServer = useCallback(async (callId: string) => {
    if (!callId || endingRef.current) return;
    endingRef.current = true;
    try {
      await api(`/v1/calls/${callId}/hangup`, { method: "POST" });
    } catch {
      /* ignore — may already be ended */
    } finally {
      endingRef.current = false;
    }
  }, []);

  const attachTrack = useCallback(
    (track: RemoteTrack | LocalTrackPublication["track"], participantLocal: boolean) => {
      if (!track) return;
      if (track.kind === Track.Kind.Video) {
        const el = participantLocal ? localVideoEl : remoteVideoEl;
        if (el) track.attach(el);
      } else if (track.kind === Track.Kind.Audio && !participantLocal) {
        if (remoteAudioEl) track.attach(remoteAudioEl);
      }
    },
    [localVideoEl, remoteVideoEl, remoteAudioEl]
  );

  const connectLiveKit = useCallback(
    async (url: string, token: string, kind: CallKind, callId: string) => {
      await disconnectRoom();
      setConnecting(true);
      setError(null);
      const lkUrl = resolveLiveKitUrl(url);
      try {
        if (!lkUrl || !token) {
          throw new Error("Missing LiveKit URL or token");
        }

        // Prompt for devices before Room.connect so a permission denial does not
        // look like a mysterious SIGNAL_SOURCE_CLOSE hangup.
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: kind === "video",
          });
          stream.getTracks().forEach((t) => t.stop());
        } catch (permErr: any) {
          throw new Error(
            permErr?.name === "NotAllowedError"
              ? "Microphone/camera permission denied — allow access and try again"
              : permErr?.message || "Could not access microphone/camera"
          );
        }

        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, _p: RemoteParticipant) => {
          attachTrack(track, false);
        });
        room.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
          if (pub.track) attachTrack(pub.track, true);
        });
        room.on(RoomEvent.Disconnected, () => {
          if (intentionalDisconnectRef.current || endingRef.current) return;
          const cur = activeRef.current;
          if (cur && cur.callId === callId) {
            setError((prev) => prev || "Media disconnected — check LiveKit (port 7880) and mic permission");
          }
        });

        await room.connect(lkUrl, token);
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          setMicMuted(false);
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
            if (pub.track) attachTrack(pub.track, false);
          });
        });
        room.localParticipant.trackPublications.forEach((pub) => {
          if (pub.track) attachTrack(pub.track, true);
        });
      } catch (e: any) {
        const msg = e?.message || "Failed to connect media";
        setError(msg);
        await disconnectRoom();
        // Keep the in-call overlay so the user can Hang up / retry; ending the
        // server session here caused the "auto hangup" feeling when LiveKit/WS
        // or getUserMedia failed.
        throw e;
      } finally {
        setConnecting(false);
      }
    },
    [attachTrack, disconnectRoom]
  );

  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    room.remoteParticipants.forEach((p) => {
      p.trackPublications.forEach((pub) => {
        if (pub.track) attachTrack(pub.track, false);
      });
    });
    room.localParticipant.trackPublications.forEach((pub) => {
      if (pub.track) attachTrack(pub.track, true);
    });
  }, [attachTrack]);

  useEffect(() => {
    return subscribe((type, payload) => {
      if (type === "call.ring") {
        const callId = String(payload?.call_id ?? payload?.id ?? "");
        const initiatorId = String(payload?.initiator_id ?? "");
        if (!callId || (meId && initiatorId === meId)) return;
        setError(null);
        setIncoming({
          callId,
          conversationId: String(payload?.conversation_id ?? ""),
          kind: payload?.kind === "video" ? "video" : "voice",
          initiatorId,
          initiatorName: String(payload?.initiator_name ?? "") || undefined,
          livekitUrl: String(payload?.livekit_url ?? "") || undefined,
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
        setIncoming(null);
        setActive({
          callId,
          conversationId: convId,
          kind,
          status: "active",
          role: "caller",
        });
        connectLiveKit(url, token, kind, callId).catch(() => {});
        return;
      }
      if (type === "call.ended") {
        const callId = String(payload?.call_id ?? payload?.id ?? "");
        endingRef.current = true;
        setIncoming((prev) => (prev?.callId === callId ? null : prev));
        setActive((prev) => (prev?.callId === callId ? null : prev));
        disconnectRoom().catch(() => {});
        endingRef.current = false;
      }
    });
  }, [subscribe, meId, connectLiveKit, disconnectRoom]);

  const startCall = useCallback(
    async (conversationId: string, kind: CallKind) => {
      setError(null);
      const res = await api<any>("/v1/calls", {
        method: "POST",
        body: JSON.stringify({ conversation_id: conversationId, kind }),
      });
      const callId = String(res?.call_id ?? res?.id ?? "");
      setActive({
        callId,
        conversationId,
        kind,
        status: "ringing",
        role: "caller",
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
    });
    try {
      await connectLiveKit(url, token, kind, callId);
    } catch {
      /* error shown on overlay; user can Hang up */
    }
  }, [incoming, connectLiveKit]);

  const declineCall = useCallback(async () => {
    if (!incoming) return;
    const id = incoming.callId;
    setIncoming(null);
    await api(`/v1/calls/${id}/decline`, { method: "POST" }).catch(() => {});
  }, [incoming]);

  const hangup = useCallback(async () => {
    const cur = activeRef.current;
    if (!cur) return;
    const id = cur.callId;
    endingRef.current = true;
    setActive(null);
    setIncoming(null);
    setError(null);
    await disconnectRoom();
    await hangupServer(id);
    endingRef.current = false;
  }, [disconnectRoom, hangupServer]);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micMuted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMicMuted(next);
  }, [micMuted]);

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
    micMuted,
    cameraOff,
    setRemoteVideoEl,
    setLocalVideoEl,
    setRemoteAudioEl,
    startCall,
    answerCall,
    declineCall,
    hangup,
    toggleMic,
    toggleCamera,
  };
}
