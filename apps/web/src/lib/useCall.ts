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
  activeRef.current = active;

  const disconnectRoom = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try {
        await room.disconnect();
      } catch {
        /* ignore */
      }
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
    async (url: string, token: string, kind: CallKind) => {
      await disconnectRoom();
      setConnecting(true);
      setError(null);
      try {
        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, _p: RemoteParticipant) => {
          attachTrack(track, false);
        });
        room.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
          if (pub.track) attachTrack(pub.track, true);
        });
        room.on(RoomEvent.Disconnected, () => {
          if (activeRef.current?.status === "active") {
            setActive(null);
          }
        });

        await room.connect(url, token);
        await room.localParticipant.setMicrophoneEnabled(true);
        if (kind === "video") {
          await room.localParticipant.setCameraEnabled(true);
          setCameraOff(false);
        } else {
          await room.localParticipant.setCameraEnabled(false);
          setCameraOff(true);
        }
        setMicMuted(false);

        // Attach already-subscribed remote tracks
        room.remoteParticipants.forEach((p) => {
          p.trackPublications.forEach((pub) => {
            if (pub.track) attachTrack(pub.track, false);
          });
        });
        room.localParticipant.trackPublications.forEach((pub) => {
          if (pub.track) attachTrack(pub.track, true);
        });
      } catch (e: any) {
        setError(e?.message || "Failed to connect media");
        await disconnectRoom();
        throw e;
      } finally {
        setConnecting(false);
      }
    },
    [attachTrack, disconnectRoom]
  );

  // Re-attach when video elements mount
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
        connectLiveKit(url, token, kind).catch(() => {});
        return;
      }
      if (type === "call.ended") {
        const callId = String(payload?.call_id ?? payload?.id ?? "");
        setIncoming((prev) => (prev?.callId === callId ? null : prev));
        setActive((prev) => (prev?.callId === callId ? null : prev));
        disconnectRoom().catch(() => {});
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
      // Stay in ringing until call.answered; keep token for when media starts.
      // Caller connects only after answer (avoids empty room wait UX).
      return res;
    },
    []
  );

  const answerCall = useCallback(async () => {
    if (!incoming) return;
    setError(null);
    const res = await api<any>(`/v1/calls/${incoming.callId}/answer`, { method: "POST" });
    const token = String(res?.livekit_token ?? "");
    const url = String(res?.livekit_url ?? incoming.livekitUrl ?? "");
    const kind = incoming.kind;
    const callId = incoming.callId;
    const convId = incoming.conversationId;
    setIncoming(null);
    setActive({
      callId,
      conversationId: convId,
      kind,
      status: "active",
      role: "callee",
    });
    await connectLiveKit(url, token, kind);
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
    setActive(null);
    setIncoming(null);
    await disconnectRoom();
    await api(`/v1/calls/${id}/hangup`, { method: "POST" }).catch(() => {});
  }, [disconnectRoom]);

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
