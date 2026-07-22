import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTrackVolume, VideoTrack } from "@livekit/react-native";
import type { LocalAudioTrack, RemoteAudioTrack } from "livekit-client";
import type { useCall } from "../lib/useCall";
import { colors, radius, spacing } from "../theme";

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
  children,
}: {
  onPress: () => void;
  danger?: boolean;
  answer?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={[
        styles.control,
        danger && styles.controlDanger,
        answer && styles.controlAnswer,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Incoming ring + in-call panel (Mattermost Calls UI placement). */
export function CallOverlay({ call }: { call: CallApi }) {
  const {
    incoming,
    active,
    error,
    connecting,
    connectedAt,
    micMuted,
    cameraOff,
    remoteVideoRef,
    localVideoRef,
    localAudioTrack,
    remoteAudioTrack,
    answerCall,
    declineCall,
    hangup,
    toggleMic,
    toggleCamera,
  } = call;

  const visible = Boolean(incoming || active);
  if (!visible) return null;

  const statusTitle =
    active?.status === "ringing"
      ? `Calling… (${active.kind})`
      : connecting
        ? "Connecting…"
        : `${active?.kind === "video" ? "Video" : "Voice"} call`;

  const showVideo = active?.status === "active" && active.kind === "video" && !connecting;
  const showMeters = active?.status === "active" && !connecting;

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
                  "?"
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
                Incoming {incoming.kind === "video" ? "video" : "voice"} call
              </Text>
              <Text style={styles.name}>{incoming.initiatorName || "Someone"}</Text>
            </>
          ) : (
            <>
              <Text style={styles.title}>{statusTitle}</Text>
              {active?.status === "ringing" ? (
                <Text style={styles.name}>{active.peerName || "Calling…"}</Text>
              ) : null}
              {active?.status === "active" && connectedAt != null && !connecting ? (
                <CallDuration connectedAt={connectedAt} />
              ) : null}
              {connecting ? <ActivityIndicator color="#fff" style={{ marginTop: 8 }} /> : null}
            </>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        {showMeters ? (
          <View style={styles.metersRow}>
            <MicLevelMeter track={localAudioTrack} muted={micMuted} label="You" />
            <MicLevelMeter
              track={remoteAudioTrack}
              label={active?.peerName?.trim() || "Them"}
            />
          </View>
        ) : null}

        <View style={styles.actions}>
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
              >
                <Ionicons name={micMuted ? "mic-off" : "mic"} size={26} color="#fff" />
              </ControlBtn>
              {active?.kind === "video" ? (
                <ControlBtn
                  label={cameraOff ? "Camera on" : "Camera off"}
                  onPress={() => toggleCamera().catch(() => {})}
                >
                  <Ionicons name={cameraOff ? "videocam-off" : "videocam"} size={26} color="#fff" />
                </ControlBtn>
              ) : null}
              <ControlBtn label="Hang up" danger onPress={() => hangup().catch(() => {})}>
                <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
              </ControlBtn>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0f1419",
    justifyContent: "space-between",
  },
  remoteVideo: {
    ...StyleSheet.absoluteFillObject,
  },
  localVideo: {
    position: "absolute",
    top: 56,
    right: 16,
    width: 110,
    height: 160,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: "#1a1d24",
  },
  avatarStage: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    color: "#fff",
    fontSize: 44,
    fontWeight: "700",
  },
  topMeta: {
    paddingTop: 72,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
  },
  title: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    fontWeight: "500",
  },
  name: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "700",
    marginTop: 8,
    textAlign: "center",
  },
  duration: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 16,
    marginTop: 10,
    fontVariant: ["tabular-nums"],
  },
  error: {
    color: "#fecaca",
    marginTop: 12,
    textAlign: "center",
  },
  metersRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-end",
    gap: 28,
    paddingHorizontal: spacing.xl,
    marginBottom: 8,
  },
  meter: {
    alignItems: "center",
    minWidth: 88,
  },
  meterBars: {
    flexDirection: "row",
    alignItems: "flex-end",
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
    fontWeight: "500",
    maxWidth: 120,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 28,
    paddingBottom: 56,
    paddingHorizontal: spacing.xl,
  },
  control: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  controlDanger: {
    backgroundColor: colors.danger,
  },
  controlAnswer: {
    backgroundColor: "#16a34a",
  },
});
