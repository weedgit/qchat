import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTrackVolume, VideoTrack } from "@livekit/react-native";
import type { LocalAudioTrack, RemoteAudioTrack } from "livekit-client";
import {
  GroupCallInviteSheet,
  loadGroupCallInviteMembers,
  type GroupCallInviteMember,
} from "./GroupCallInviteSheet";
import { useAuth } from "../context/AuthContext";
import { qualityLabel } from "../lib/callQuality";
import type { useCall } from "../lib/useCall";
import { useThemedStyles } from "../context/ThemeContext";
import { radius, spacing, type ColorTokens } from "../theme";

type CallApi = ReturnType<typeof useCall>;

const MIC_BAR_COUNT = 5;

function formatCallClock(elapsedMs: number): string {
  const sec = Math.max(0, Math.floor(elapsedMs / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function CallDuration({ connectedAt }: { connectedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  const styles = useThemedStyles(makeStyles);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [connectedAt]);
  return <Text style={styles.duration}>{formatCallClock(now - connectedAt)}</Text>;
}

/** VU bars — LiveKit RN useTrackVolume (mirrors web MicLevelMeter). */
function MicLevelMeter({
  track,
  muted,
  label,
}: {
  track?: LocalAudioTrack | RemoteAudioTrack | null;
  muted?: boolean;
  label: string;
}) {
  const raw = useTrackVolume(track ?? undefined);
  const styles = useThemedStyles(makeStyles);
  const level = muted ? 0 : Math.min(1, raw * 1.8);
  const lit = muted ? 0 : Math.min(MIC_BAR_COUNT, Math.round(level * MIC_BAR_COUNT));
  const tone = muted ? "muted" : lit >= 4 ? "hot" : lit >= 2 ? "mid" : "low";

  return (
    <View
      style={styles.meter}
      accessibilityLabel={muted ? `${label} muted` : `${label} level ${Math.round(level * 100)}%`}
    >
      <View style={styles.meterBars}>
        {Array.from({ length: MIC_BAR_COUNT }, (_, i) => (
          <View
            key={i}
            style={[
              styles.meterBar,
              { height: 5 + i * 3 },
              i < lit && styles.meterBarOn,
              i < lit && tone === "low" && styles.meterBarLow,
              i < lit && tone === "mid" && styles.meterBarMid,
              i < lit && tone === "hot" && styles.meterBarHot,
              muted && styles.meterBarMuted,
            ]}
          />
        ))}
      </View>
      <Text style={styles.meterLabel} numberOfLines={1}>
        {muted ? `${label} muted` : label}
      </Text>
    </View>
  );
}

function ControlBtn({
  onPress,
  danger,
  answer,
  label,
  compact,
  children,
}: {
  onPress: () => void;
  danger?: boolean;
  answer?: boolean;
  label: string;
  compact?: boolean;
  children: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={[
        styles.control,
        compact && styles.controlCompact,
        danger && styles.controlDanger,
        answer && styles.controlAnswer,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Incoming ring + in-call panel (Calls UI placement). */
export function CallOverlay({ call }: { call: CallApi }) {
  const styles = useThemedStyles(makeStyles);
  const { user } = useAuth();
  const {
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
    qualityDegraded,
    remoteVideoRef,
    localVideoRef,
    localAudioTrack,
    remoteAudioTrack,
    remotePeers,
    answerCall,
    declineCall,
    hangup,
    inviteToCall,
    kickFromCall,
    toggleMic,
    toggleCamera,
    toggleSpeaker,
  } = call;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMembers, setInviteMembers] = useState<GroupCallInviteMember[]>([]);

  const visible = Boolean(incoming || active);

  useEffect(() => {
    if (!inviteOpen || !active?.conversationId) return;
    let cancelled = false;
    setInviteLoading(true);
    const exclude = [
      user?.id ?? "",
      ...remotePeers.map((p) => p.userId),
    ].filter(Boolean);
    loadGroupCallInviteMembers(active.conversationId, exclude)
      .then((members) => {
        if (!cancelled) setInviteMembers(members);
      })
      .catch(() => {
        if (!cancelled) setInviteMembers([]);
      })
      .finally(() => {
        if (!cancelled) setInviteLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Load once when sheet opens; peer list at open time is enough for exclusions.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: open + conversation only
  }, [inviteOpen, active?.conversationId, user?.id]);

  if (!visible) return null;

  const isGroup = Boolean(incoming?.isGroup || active?.isGroup);
  const crowdedControls =
    Boolean(active?.isGroup) && active?.kind === "video" && active?.status === "active";
  const statusTitle =
    active?.status === "ringing"
      ? `Calling… (${active.kind}${active.isGroup ? " · group" : ""})`
      : connecting
        ? "Connecting…"
        : reconnecting
          ? "Reconnecting…"
          : `${active?.kind === "video" ? "Video" : "Voice"} call${
              active?.isGroup ? " · Group" : ""
            }`;
  const qualityText = qualityLabel(connectionQuality);

  const showVideo = active?.status === "active" && active.kind === "video" && !connecting;
  const showMeters =
    active?.status === "active" && !connecting && !(active.isGroup && remotePeers.length > 0);
  const showGroupPeers =
    Boolean(active?.isGroup) && active?.status === "active" && !connecting;

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" statusBarTranslucent>
      <View style={styles.root}>
        {showVideo && remoteVideoRef ? (
          <VideoTrack
            style={styles.remoteVideo}
            trackRef={remoteVideoRef}
            objectFit="cover"
            zOrder={0}
          />
        ) : (
          <View style={styles.avatarStage}>
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>
                {(
                  incoming?.initiatorName ||
                  active?.peerName ||
                  (isGroup ? "G" : "?")
                )
                  .trim()
                  .charAt(0)
                  .toUpperCase()}
              </Text>
            </View>
          </View>
        )}

        {showVideo && localVideoRef && !cameraOff ? (
          <VideoTrack
            style={styles.localVideo}
            trackRef={localVideoRef}
            objectFit="cover"
            mirror
            zOrder={1}
          />
        ) : null}

        <View style={styles.topMeta} pointerEvents="box-none">
          {incoming ? (
            <>
              <Text style={styles.title}>
                Incoming {incoming.isGroup ? "group " : ""}
                {incoming.kind === "video" ? "video" : "voice"} call
              </Text>
              <Text style={styles.name}>{incoming.initiatorName || "Someone"}</Text>
              {incoming.isGroup ? <Text style={styles.groupBadge}>Group</Text> : null}
            </>
          ) : (
            <>
              <Text style={styles.title}>{statusTitle}</Text>
              {active?.isGroup ? <Text style={styles.groupBadge}>Group</Text> : null}
              {active?.status === "ringing" ? (
                <Text style={styles.name}>{active.peerName || "Calling…"}</Text>
              ) : null}
              {active?.status === "active" && connectedAt != null && !connecting ? (
                <CallDuration connectedAt={connectedAt} />
              ) : null}
              {connecting || reconnecting ? (
                <ActivityIndicator color="#fff" style={{ marginTop: 8 }} />
              ) : null}
              {qualityText && active?.status === "active" && !connecting ? (
                <Text
                  style={[
                    styles.qualityHint,
                    qualityDegraded && styles.qualityDegraded,
                  ]}
                >
                  {qualityDegraded ? `⚠ ${qualityText}` : qualityText}
                </Text>
              ) : null}
            </>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        {showGroupPeers ? (
          <ScrollView
            horizontal
            style={styles.peersScroll}
            contentContainerStyle={styles.peersRow}
            showsHorizontalScrollIndicator={false}
          >
            {remotePeers.map((p) => (
              <View key={p.identity} style={styles.peerCard}>
                <View style={styles.peerAvatar}>
                  <Text style={styles.peerLetter}>
                    {(p.name || "?").trim().charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.peerName} numberOfLines={1}>
                  {p.name}
                </Text>
                {active?.isHost ? (
                  <Pressable
                    onPress={() =>
                      kickFromCall(p.userId).catch((e) =>
                        Alert.alert("Kick failed", e?.message || "Could not remove participant")
                      )
                    }
                    hitSlop={6}
                    style={styles.kickBtn}
                    accessibilityLabel={`Remove ${p.name}`}
                  >
                    <Text style={styles.kickText}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            <View style={styles.peerCard}>
              <View style={[styles.peerAvatar, styles.peerAvatarYou]}>
                <Text style={styles.peerLetter}>Y</Text>
              </View>
              <Text style={styles.peerName}>You</Text>
            </View>
          </ScrollView>
        ) : null}

        {showMeters ? (
          <View style={styles.metersRow}>
            <MicLevelMeter track={localAudioTrack} muted={micMuted} label="You" />
            <MicLevelMeter
              track={remoteAudioTrack}
              label={active?.peerName?.trim() || "Them"}
            />
          </View>
        ) : null}

        <View style={[styles.actions, crowdedControls ? styles.actionsCrowded : null]}>
          {incoming ? (
            <>
              <ControlBtn label="Decline" danger onPress={() => declineCall().catch(() => {})}>
                <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
              </ControlBtn>
              <ControlBtn label="Answer" answer onPress={() => answerCall().catch(() => {})}>
                <Ionicons name="call" size={28} color="#fff" />
              </ControlBtn>
            </>
          ) : (
            <>
              <ControlBtn
                label={micMuted ? "Unmute" : "Mute"}
                onPress={() => toggleMic().catch(() => {})}
                compact={crowdedControls}
              >
                <Ionicons
                  name={micMuted ? "mic-off" : "mic"}
                  size={crowdedControls ? 22 : 26}
                  color="#fff"
                />
              </ControlBtn>
              <ControlBtn
                label={speakerOn ? "Speaker on" : "Earpiece"}
                onPress={() => toggleSpeaker().catch(() => {})}
                compact={crowdedControls}
              >
                <Ionicons
                  name={speakerOn ? "volume-high" : "ear-outline"}
                  size={crowdedControls ? 22 : 26}
                  color="#fff"
                />
              </ControlBtn>
              {active?.kind === "video" ? (
                <ControlBtn
                  label={cameraOff ? "Camera on" : "Camera off"}
                  onPress={() => toggleCamera().catch(() => {})}
                  compact={crowdedControls}
                >
                  <Ionicons
                    name={cameraOff ? "videocam-off" : "videocam"}
                    size={crowdedControls ? 22 : 26}
                    color="#fff"
                  />
                </ControlBtn>
              ) : null}
              {active?.isGroup && active.status === "active" ? (
                <ControlBtn
                  label="Invite"
                  onPress={() => setInviteOpen(true)}
                  compact={crowdedControls}
                >
                  <Ionicons name="person-add" size={crowdedControls ? 20 : 24} color="#fff" />
                </ControlBtn>
              ) : null}
              <ControlBtn
                label="Hang up"
                danger
                onPress={() => hangup().catch(() => {})}
                compact={crowdedControls}
              >
                <Ionicons
                  name="call"
                  size={crowdedControls ? 24 : 28}
                  color="#fff"
                  style={{ transform: [{ rotate: "135deg" }] }}
                />
              </ControlBtn>
            </>
          )}
        </View>
      </View>

      <GroupCallInviteSheet
        visible={inviteOpen}
        title="Invite to call"
        confirmLabel="Invite"
        members={inviteMembers}
        loading={inviteLoading}
        busy={inviteBusy}
        onCancel={() => {
          if (!inviteBusy) setInviteOpen(false);
        }}
        onConfirm={(ids) => {
          void (async () => {
            setInviteBusy(true);
            try {
              await inviteToCall(ids);
              setInviteOpen(false);
            } catch (e: any) {
              Alert.alert("Invite failed", e?.message || "Could not invite");
            } finally {
              setInviteBusy(false);
            }
          })();
        }}
      />
    </Modal>
  );
}

function makeStyles(c: ColorTokens) {
  return {
  root: {
    flex: 1,
    backgroundColor: "#0f1419",
    justifyContent: "space-between" as const,
  },
  remoteVideo: {
    ...StyleSheet.absoluteFillObject,
  },
  localVideo: {
    position: "absolute" as const,
    top: 56,
    right: 16,
    width: 110,
    height: 160,
    borderRadius: radius.md,
    overflow: "hidden" as const,
    backgroundColor: "#1a1d24",
  },
  avatarStage: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: c.accent,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  avatarLetter: {
    color: "#fff",
    fontSize: 44,
    fontWeight: "700" as const,
  },
  topMeta: {
    paddingTop: 72,
    paddingHorizontal: spacing.xl,
    alignItems: "center" as const,
  },
  title: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    fontWeight: "500" as const,
  },
  name: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "700" as const,
    marginTop: 8,
    textAlign: "center" as const,
  },
  groupBadge: {
    marginTop: 8,
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    fontWeight: "600" as const,
    letterSpacing: 0.4,
    textTransform: "uppercase" as const,
    backgroundColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: "hidden" as const,
  },
  duration: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 16,
    marginTop: 10,
    fontVariant: ["tabular-nums"] as ("tabular-nums")[],
  },
  error: {
    color: "#fecaca",
    marginTop: 12,
    textAlign: "center" as const,
  },
  qualityHint: {
    marginTop: 8,
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontWeight: "600" as const,
    textAlign: "center" as const,
  },
  qualityDegraded: {
    color: "#fbbf24",
  },
  peersScroll: {
    maxHeight: 140,
    marginBottom: 8,
  },
  peersRow: {
    paddingHorizontal: spacing.xl,
    gap: 14,
    alignItems: "flex-start" as const,
  },
  peerCard: {
    width: 84,
    alignItems: "center" as const,
  },
  peerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  peerAvatarYou: {
    backgroundColor: c.accent,
  },
  peerLetter: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700" as const,
  },
  peerName: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    marginTop: 6,
    textAlign: "center" as const,
    maxWidth: 84,
  },
  kickBtn: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: "rgba(220,38,38,0.35)",
  },
  kickText: {
    color: "#fecaca",
    fontSize: 11,
    fontWeight: "600" as const,
  },
  metersRow: {
    flexDirection: "row" as const,
    justifyContent: "center" as const,
    alignItems: "flex-end" as const,
    gap: 28,
    paddingHorizontal: spacing.xl,
    marginBottom: 8,
  },
  meter: {
    alignItems: "center" as const,
    minWidth: 88,
  },
  meterBars: {
    flexDirection: "row" as const,
    alignItems: "flex-end" as const,
    gap: 4,
    height: 22,
  },
  meterBar: {
    width: 6,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  meterBarOn: {
    backgroundColor: "#22c55e",
  },
  meterBarLow: {
    backgroundColor: "#22c55e",
  },
  meterBarMid: {
    backgroundColor: "#5b9bd5",
  },
  meterBarHot: {
    backgroundColor: "#e6b422",
  },
  meterBarMuted: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  meterLabel: {
    marginTop: 6,
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
    fontWeight: "500" as const,
    maxWidth: 120,
    textAlign: "center" as const,
  },
  actions: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    alignContent: "center" as const,
    gap: 20,
    width: "100%" as const,
    paddingBottom: 56,
    paddingHorizontal: spacing.lg,
  },
  /** Group video: 5 controls — shrink so they fit one phone width. */
  actionsCrowded: {
    gap: 12,
    paddingHorizontal: spacing.md,
  },
  control: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  controlCompact: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  controlDanger: {
    backgroundColor: c.danger,
  },
  controlAnswer: {
    backgroundColor: "#16a34a",
  },
};
}
