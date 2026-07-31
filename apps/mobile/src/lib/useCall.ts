/**
 * Calls-style 1:1 ring → answer → LiveKit media (mobile).
 * Signaling via Qchat WS + REST; media via LiveKit SFU.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import Constants from "expo-constants";
import { AudioModule } from "expo-audio";
import { Camera } from "expo-camera";
import {
  ConnectionQuality,
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type LocalParticipant,
  type LocalTrackPublication,
  type Participant,
  type RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication,
} from "livekit-client";
import { AndroidAudioTypePresets, AudioSession } from "@livekit/react-native";
import type { TrackReference } from "@livekit/components-react";
import { api } from "./api";
import {
  isDegradedQuality,
  qualityFromLiveKit,
  type CallQualityLevel,
} from "./callQuality";

function asVideoTrackRef(
  participant: LocalParticipant | RemoteParticipant,
  publication: TrackPublication
): TrackReference | null {
  if (publication.kind !== Track.Kind.Video || !publication.track) return null;
  return {
    participant,
    publication,
    source: publication.source || Track.Source.Camera,
  };
}

/** Prefer screen share over camera (matches web group stage). */
function preferredVideoPublication(
  participant: LocalParticipant | RemoteParticipant
): TrackPublication | null {
  const screen = participant.getTrackPublication(Track.Source.ScreenShare);
  if (screen?.track && screen.kind === Track.Kind.Video) return screen;
  const camera = participant.getTrackPublication(Track.Source.Camera);
  if (camera?.track && camera.kind === Track.Kind.Video) return camera;
  let fallback: TrackPublication | null = null;
  participant.trackPublications.forEach((pub) => {
    if (fallback || pub.kind !== Track.Kind.Video || !pub.track || pub.isMuted) return;
    if (pub.source === Track.Source.ScreenShare) {
      fallback = pub;
      return;
    }
    fallback = pub;
  });
  return fallback;
}

function preferredVideoTrackRef(
  participant: LocalParticipant | RemoteParticipant
): TrackReference | null {
  const pub = preferredVideoPublication(participant);
  return pub ? asVideoTrackRef(participant, pub) : null;
}

function participantHasLiveVideo(participant: RemoteParticipant): boolean {
  return Boolean(preferredVideoPublication(participant));
}

function isScreenSharing(participant: RemoteParticipant): boolean {
  const screen = participant.getTrackPublication(Track.Source.ScreenShare);
  if (screen?.track) return true;
  let found = false;
  participant.trackPublications.forEach((pub) => {
    if (pub.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare && pub.track) {
      found = true;
    }
  });
  return found;
}

async function ensureCallPermissions(kind: CallKind) {
  if (Platform.OS === "android") {
    const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    if (kind === "video") perms.push(PermissionsAndroid.PERMISSIONS.CAMERA);
    await PermissionsAndroid.requestMultiple(perms);
    return;
  }
  // iOS: prompt before LiveKit getUserMedia (same APIs as chat composer / QR).
  await AudioModule.requestRecordingPermissionsAsync().catch(() => {});
  if (kind === "video") {
    await Camera.requestCameraPermissionsAsync().catch(() => {});
  }
}

function isClosedPcError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e ?? "");
  return (
    /pc manager is closed/i.test(msg) ||
    /negotiationerror/i.test(msg) ||
    /client initiated disconnect/i.test(msg) ||
    /room closed/i.test(msg)
  );
}

export type CallKind = "voice" | "video";

export type IncomingCall = {
  callId: string;
  conversationId: string;
  kind: CallKind;
  initiatorId: string;
  initiatorName?: string;
  livekitUrl?: string;
  isGroup?: boolean;
};

export type ActiveCall = {
  callId: string;
  conversationId: string;
  kind: CallKind;
  status: "ringing" | "active";
  role: "caller" | "callee";
  peerName?: string;
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

export type StartCallOpts = {
  peerName?: string;
  inviteeIds?: string[];
};

type SubscribeFn = (handler: (type: string, payload: any) => void) => () => void;

function embeddedLivekitUrl(): string {
  const extra = Constants.expoConfig?.extra as
    | { livekitUrl?: string }
    | undefined;
  return String(extra?.livekitUrl ?? "").trim();
}

function resolveLiveKitUrl(url: string): string {
  const fromEnv =
    process.env.EXPO_PUBLIC_LIVEKIT_URL?.trim() || embeddedLivekitUrl();
  let resolved = (fromEnv || url || "").trim();
  if (!resolved) return resolved;
  try {
    const normalized = resolved.replace(/^ws/i, "http");
    const u = new URL(normalized);
    const apiBase =
      process.env.EXPO_PUBLIC_API_URL?.trim() ||
      String(
        (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
          ""
      ).trim();
    if (apiBase.startsWith("https:") && u.protocol === "http:") {
      u.protocol = "https:";
      if (u.port === "7880") u.port = "7443";
    }
    return u.toString().replace(/^http/i, "ws");
  } catch {
    return resolved.replace(/^http/i, "ws");
  }
}

export function useCall(opts: { meId?: string; subscribe: SubscribeFn }) {
  const { meId, subscribe } = opts;
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [connectionQuality, setConnectionQuality] = useState<CallQualityLevel>("unknown");
  const [remoteVideoRef, setRemoteVideoRef] = useState<TrackReference | null>(null);
  const [localVideoRef, setLocalVideoRef] = useState<TrackReference | null>(null);
  /** Per-identity remote video refs — needed so group adaptiveStream keeps all members live. */
  const [peerVideoRefs, setPeerVideoRefs] = useState<Record<string, TrackReference>>({});
  const [localAudioTrack, setLocalAudioTrack] = useState<LocalAudioTrack | null>(null);
  const [remoteAudioTrack, setRemoteAudioTrack] = useState<RemoteAudioTrack | null>(null);
  /** LiveKit remote participants for group (N:N) kick / invite UX. */
  const [remotePeers, setRemotePeers] = useState<CallRemotePeer[]>([]);

  const roomRef = useRef<Room | null>(null);
  const activeRef = useRef<ActiveCall | null>(null);
  const endingRef = useRef(false);
  const intentionalDisconnectRef = useRef(false);
  const hadRemoteRef = useRef(false);
  /** Bumps on each connect/disconnect so stale async work stops cleanly. */
  const connectGenRef = useRef(0);
  activeRef.current = active;

  const resetMediaUi = useCallback(() => {
    setConnecting(false);
    setConnectedAt(null);
    setMicMuted(false);
    setCameraOff(false);
    setSpeakerOn(true);
    setReconnecting(false);
    setConnectionQuality("unknown");
    setRemoteVideoRef(null);
    setLocalVideoRef(null);
    setPeerVideoRefs({});
    setLocalAudioTrack(null);
    setRemoteAudioTrack(null);
    setRemotePeers([]);
  }, []);

  /** Rebuild peer video map + primary remoteVideoRef (1:1 / focus fallback). */
  const syncPeerVideoRefs = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setPeerVideoRefs({});
      setRemoteVideoRef(null);
      return;
    }
    const next: Record<string, TrackReference> = {};
    room.remoteParticipants.forEach((p) => {
      const identity = String(p.identity || "");
      if (!identity) return;
      const ref = preferredVideoTrackRef(p);
      if (ref) next[identity] = ref;
    });
    setPeerVideoRefs(next);
    const identities = Object.keys(next);
    setRemoteVideoRef((prev) => {
      if (prev) {
        const id = String(prev.participant?.identity ?? "");
        if (id && next[id]) return next[id];
      }
      return identities.length ? next[identities[0]] : null;
    });
  }, []);

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
      const micPub = p.getTrackPublication(Track.Source.Microphone);
      const hasMic = Boolean(micPub?.track);
      const hasScreen = isScreenSharing(p);
      const hasLiveVideo = participantHasLiveVideo(p);
      next.push({
        identity,
        name: String(p.name || userId || "User"),
        userId,
        micMuted: !hasMic || Boolean(micPub?.isMuted),
        cameraOff: !hasLiveVideo,
        screenSharing: hasScreen,
      });
    });
    setRemotePeers(next);
    syncPeerVideoRefs();
  }, [syncPeerVideoRefs]);

  const disconnectRoom = useCallback(async () => {
    connectGenRef.current += 1;
    const room = roomRef.current;
    roomRef.current = null;
    setRemoteVideoRef(null);
    setLocalVideoRef(null);
    setPeerVideoRefs({});
    setLocalAudioTrack(null);
    setRemoteAudioTrack(null);
    setRemotePeers([]);
    if (room) {
      intentionalDisconnectRef.current = true;
      try {
        room.removeAllListeners();
        await room.disconnect();
      } catch {
        /* ignore — PC may already be closed */
      }
      intentionalDisconnectRef.current = false;
    }
    try {
      await AudioSession.stopAudioSession();
    } catch {
      /* ignore */
    }
  }, []);

  const hangupServer = useCallback(async (callId: string) => {
    if (!callId) return;
    try {
      await api(`/v1/calls/${callId}/hangup`, { method: "POST" });
    } catch {
      /* ignore */
    }
  }, []);

  const connectLiveKit = useCallback(
    async (url: string, token: string, kind: CallKind, callId: string) => {
      await disconnectRoom();
      const gen = ++connectGenRef.current;
      const stillCurrent = () =>
        gen === connectGenRef.current &&
        !endingRef.current &&
        activeRef.current?.callId === callId;

      setConnecting(true);
      setError(null);
      const lkUrl = resolveLiveKitUrl(url);
      let room: Room | null = null;
      try {
        if (!lkUrl || !token) throw new Error("Missing LiveKit URL or token");

        await ensureCallPermissions(kind);
        if (!stillCurrent()) return;

        await AudioSession.configureAudio({
          android: {
            preferredOutputList: ["bluetooth", "headset", "speaker", "earpiece"],
            audioTypeOptions: AndroidAudioTypePresets.communication,
          },
          ios: { defaultOutput: kind === "video" ? "speaker" : "speaker" },
        });
        await AudioSession.startAudioSession();
        if (Platform.OS === "ios") {
          await AudioSession.setAppleAudioConfiguration({
            audioCategory: "playAndRecord",
            audioCategoryOptions: ["allowBluetooth", "defaultToSpeaker"],
            audioMode: kind === "video" ? "videoChat" : "voiceChat",
          });
        }
        // Default to speaker for both voice/video (toggle can switch to earpiece).
        try {
          if (Platform.OS === "ios") {
            await AudioSession.selectAudioOutput("force_speaker");
          } else {
            await AudioSession.selectAudioOutput("speaker");
          }
          setSpeakerOn(true);
        } catch {
          /* device may not support forced routing */
        }
        if (!stillCurrent()) return;

        // singlePeerConnection:false — avoids black video on RN with livekit-client ≥2.19.2
        room = new Room({
          adaptiveStream: true,
          dynacast: true,
          singlePeerConnection: false,
        });
        roomRef.current = room;
        hadRemoteRef.current = false;
        setReconnecting(false);
        setConnectionQuality("unknown");

        room.on(
          RoomEvent.TrackSubscribed,
          (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            if (gen !== connectGenRef.current) return;
            hadRemoteRef.current = true;
            if (track.kind === Track.Kind.Video) {
              syncPeerVideoRefs();
            } else if (track.kind === Track.Kind.Audio) {
              setRemoteAudioTrack(track as RemoteAudioTrack);
            }
            syncRemotePeers();
          }
        );
        room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          if (gen !== connectGenRef.current) return;
          if (track.kind === Track.Kind.Video) {
            syncPeerVideoRefs();
          } else if (track.kind === Track.Kind.Audio) {
            setRemoteAudioTrack((prev) => (prev === track ? null : prev));
          }
          syncRemotePeers();
        });
        room.on(RoomEvent.TrackMuted, () => {
          if (gen !== connectGenRef.current) return;
          syncRemotePeers();
        });
        room.on(RoomEvent.TrackUnmuted, () => {
          if (gen !== connectGenRef.current) return;
          syncRemotePeers();
        });
        room.on(
          RoomEvent.LocalTrackPublished,
          (pub: LocalTrackPublication, participant: LocalParticipant) => {
            if (gen !== connectGenRef.current) return;
            if (pub.track?.kind === Track.Kind.Video) {
              const ref = asVideoTrackRef(participant, pub);
              if (ref) setLocalVideoRef(ref);
            } else if (pub.track?.kind === Track.Kind.Audio) {
              setLocalAudioTrack(pub.track as LocalAudioTrack);
            }
          }
        );
        room.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
          if (gen !== connectGenRef.current) return;
          if (pub.track?.kind === Track.Kind.Audio || pub.source === Track.Source.Microphone) {
            setLocalAudioTrack(null);
          }
          if (pub.track?.kind === Track.Kind.Video || pub.source === Track.Source.Camera) {
            setLocalVideoRef(null);
          }
        });
        room.on(RoomEvent.ParticipantConnected, (participant) => {
          if (gen !== connectGenRef.current) return;
          hadRemoteRef.current = true;
          const name = String(participant?.name ?? "").trim();
          if (name) {
            setActive((prev) =>
              prev && prev.callId === callId && !prev.peerName
                ? { ...prev, peerName: name }
                : prev
            );
          }
          syncRemotePeers();
        });
        room.on(RoomEvent.Disconnected, () => {
          if (intentionalDisconnectRef.current || endingRef.current) return;
          if (gen !== connectGenRef.current) return;
          const cur = activeRef.current;
          if (cur?.callId === callId) {
            endingRef.current = true;
            setActive(null);
            resetMediaUi();
            hangupServer(callId).catch(() => {});
            endingRef.current = false;
          }
        });
        // 1:1: peer left after joining → end call. Group: keep room until API hangup.
        room.on(RoomEvent.ParticipantDisconnected, () => {
          syncRemotePeers();
          if (intentionalDisconnectRef.current || endingRef.current) return;
          if (gen !== connectGenRef.current) return;
          if (!hadRemoteRef.current) return;
          const roomNow = roomRef.current;
          if (roomNow?.state !== ConnectionState.Connected) return;
          if (roomNow.remoteParticipants.size > 0) return;
          const cur = activeRef.current;
          if (!cur || cur.callId !== callId || cur.status !== "active") return;
          if (cur.isGroup) return;
          endingRef.current = true;
          setActive(null);
          resetMediaUi();
          disconnectRoom().catch(() => {});
          hangupServer(callId).catch(() => {});
          endingRef.current = false;
        });
        room.on(RoomEvent.Reconnecting, () => {
          if (gen !== connectGenRef.current) return;
          setReconnecting(true);
        });
        room.on(RoomEvent.Reconnected, () => {
          if (gen !== connectGenRef.current) return;
          setReconnecting(false);
        });
        room.on(
          RoomEvent.ConnectionQualityChanged,
          (quality: ConnectionQuality, participant: Participant) => {
            if (gen !== connectGenRef.current) return;
            if (participant !== room?.localParticipant) return;
            setConnectionQuality(qualityFromLiveKit(quality));
          }
        );

        await room.connect(lkUrl, token, {
          websocketTimeout: 60_000,
          peerConnectionTimeout: 60_000,
        });
        if (!stillCurrent() || roomRef.current !== room) {
          try {
            room.removeAllListeners();
            await room.disconnect();
          } catch {
            /* ignore */
          }
          return;
        }

        // SFU up — show connected even if mic/cam publish is slow.
        setConnecting(false);
        setConnectedAt(Date.now());
        setActive((prev) =>
          prev && prev.callId === callId ? { ...prev, status: "active" } : prev
        );

        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          if (stillCurrent()) {
            setMicMuted(false);
            const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
            if (micPub?.track?.kind === Track.Kind.Audio) {
              setLocalAudioTrack(micPub.track as LocalAudioTrack);
            }
          }
        } catch (micErr) {
          if (!isClosedPcError(micErr) && stillCurrent()) {
            setMicMuted(true);
            setError((prev) => prev || "Microphone failed — check permissions");
          }
        }

        // Peer may already be in the room with audio published.
        if (stillCurrent()) {
          room.remoteParticipants.forEach((p) => {
            hadRemoteRef.current = true;
            p.trackPublications.forEach((pub) => {
              if (pub.track?.kind === Track.Kind.Audio) {
                setRemoteAudioTrack(pub.track as RemoteAudioTrack);
              }
            });
          });
          syncRemotePeers();
          const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
          if (camPub) {
            const ref = asVideoTrackRef(room.localParticipant, camPub);
            if (ref) setLocalVideoRef(ref);
          }
        }

        if (kind === "video") {
          try {
            if (stillCurrent() && roomRef.current === room) {
              await room.localParticipant.setCameraEnabled(true);
              if (stillCurrent()) setCameraOff(false);
            }
          } catch (camErr) {
            if (!isClosedPcError(camErr) && stillCurrent()) {
              setCameraOff(true);
              setError((prev) => prev || "Camera failed — voice may still work");
            }
          }
        } else {
          setCameraOff(true);
        }
      } catch (e: any) {
        if (isClosedPcError(e) || !stillCurrent()) {
          setConnecting(false);
          return;
        }
        setConnecting(false);
        setError(e?.message || "Could not connect call media");
        await disconnectRoom();
      }
    },
    [disconnectRoom, hangupServer, resetMediaUi, syncPeerVideoRefs, syncRemotePeers]
  );

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
          isGroup: Boolean(payload?.is_group),
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
        const local = activeRef.current;
        if (!local || local.role !== "caller" || local.callId !== callId) return;
        setIncoming(null);
        setActive((prev) => ({
          callId,
          conversationId: convId,
          kind,
          status: "active",
          role: "caller",
          peerName: prev?.peerName,
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
          setIncoming(null);
          setActive((prev) => (prev && prev.callId === callId ? null : prev));
          setError("You were removed from the call by the host");
          resetMediaUi();
          disconnectRoom().catch(() => {});
          endingRef.current = false;
          return;
        }
        if (meId && by === meId) return;
        return;
      }
      if (type === "call.taken") {
        const callId = String(payload?.call_id ?? payload?.id ?? "");
        const convId = String(payload?.conversation_id ?? "");
        setIncoming((prev) => {
          if (!prev) return null;
          if (!callId || prev.callId === callId) return null;
          if (convId && prev.conversationId === convId) return null;
          return prev;
        });
        return;
      }
      if (type === "call.ended") {
        const callId = String(payload?.call_id ?? payload?.id ?? "");
        const convId = String(payload?.conversation_id ?? "");
        endingRef.current = true;
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
  }, [subscribe, meId, connectLiveKit, disconnectRoom, resetMediaUi]);

  const startCall = useCallback(
    async (conversationId: string, kind: CallKind, opts?: StartCallOpts) => {
      setError(null);
      endingRef.current = false;
      const inviteeIds = opts?.inviteeIds;
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
      setActive({
        callId,
        conversationId,
        kind,
        status: "ringing",
        role: "caller",
        peerName: opts?.peerName?.trim() || undefined,
        isGroup,
        isHost: true,
      });
      const token = String(res?.livekit_token ?? "");
      const url = String(res?.livekit_url ?? "");
      // Group / multi-invite: connect LiveKit immediately (caller does not wait for answer).
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
    endingRef.current = false;
    const kind = incoming.kind;
    const callId = incoming.callId;
    const convId = incoming.conversationId;
    const peerName = incoming.initiatorName?.trim() || undefined;
    const isGroup = Boolean(incoming.isGroup);
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
      isGroup: isGroup || Boolean(res?.is_group),
      isHost: false,
    });
    await connectLiveKit(url, token, kind, callId);
  }, [incoming, connectLiveKit]);

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
    resetMediaUi();
    await disconnectRoom();
    await hangupServer(id);
    endingRef.current = false;
  }, [disconnectRoom, hangupServer, resetMediaUi]);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;
    const next = !micMuted;
    try {
      await room.localParticipant.setMicrophoneEnabled(!next);
      setMicMuted(next);
    } catch (e) {
      if (!isClosedPcError(e)) {
        setError((prev) => prev || "Could not toggle microphone");
      }
    }
  }, [micMuted]);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room || active?.kind !== "video" || room.state !== ConnectionState.Connected) return;
    const next = !cameraOff;
    try {
      await room.localParticipant.setCameraEnabled(!next);
      setCameraOff(next);
    } catch (e) {
      if (!isClosedPcError(e)) {
        setError((prev) => prev || "Could not toggle camera");
      }
    }
  }, [cameraOff, active?.kind]);

  const toggleSpeaker = useCallback(async () => {
    const next = !speakerOn;
    try {
      if (Platform.OS === "ios") {
        await AudioSession.selectAudioOutput(next ? "force_speaker" : "default");
      } else {
        await AudioSession.selectAudioOutput(next ? "speaker" : "earpiece");
      }
      setSpeakerOn(next);
    } catch {
      setError((prev) => prev || "Could not switch speaker");
    }
  }, [speakerOn]);

  return {
    incoming,
    active,
    error,
    connecting,
    connectedAt,
    micMuted,
    cameraOff,
    speakerOn,
    reconnecting,
    connectionQuality,
    qualityDegraded: isDegradedQuality(connectionQuality),
    remoteVideoRef,
    localVideoRef,
    peerVideoRefs,
    localAudioTrack,
    remoteAudioTrack,
    remotePeers,
    startCall,
    answerCall,
    declineCall,
    hangup,
    inviteToCall,
    kickFromCall,
    toggleMic,
    toggleCamera,
    toggleSpeaker,
  };
}
