import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";

type Props = {
  uri: string;
  label: string;
  detail?: string | null;
  tint: string;
  subTint: string;
  mine: boolean;
};

const LOAD_TIMEOUT_MS = 12_000;

function extFromUri(uri: string): string {
  try {
    const path = uri.split("?")[0] || uri;
    const m = path.match(/\.([a-z0-9]+)$/i);
    return (m?.[1] || "m4a").toLowerCase();
  } catch {
    return "m4a";
  }
}

/**
 * Tap-to-play voice bubble using expo-av (mirrors web audio controls).
 * Downloads remote notes to a cache file first so Android/iOS do not hang
 * for ~20s probing streamed WebM without Range support.
 */
export function VoiceNotePlayer({ uri, label, detail, tint, subTint, mine }: Props) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const localUriRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    return () => {
      const sound = soundRef.current;
      soundRef.current = null;
      if (sound) {
        void sound.unloadAsync().catch(() => {});
      }
      const cached = localUriRef.current;
      localUriRef.current = null;
      if (cached?.startsWith(FileSystem.cacheDirectory || "file://")) {
        void FileSystem.deleteAsync(cached, { idempotent: true }).catch(() => {});
      }
    };
  }, []);

  // Reset player when the message media URL changes (list recycling).
  useEffect(() => {
    const sound = soundRef.current;
    soundRef.current = null;
    if (sound) void sound.unloadAsync().catch(() => {});
    const cached = localUriRef.current;
    localUriRef.current = null;
    if (cached?.startsWith(FileSystem.cacheDirectory || "file://")) {
      void FileSystem.deleteAsync(cached, { idempotent: true }).catch(() => {});
    }
    setPlaying(false);
    setLoading(false);
    setFailed(false);
  }, [uri]);

  const ensureLocalUri = useCallback(async (): Promise<string> => {
    if (localUriRef.current) return localUriRef.current;
    if (!uri.startsWith("http://") && !uri.startsWith("https://")) {
      localUriRef.current = uri;
      return uri;
    }
    const base = FileSystem.cacheDirectory;
    if (!base) {
      localUriRef.current = uri;
      return uri;
    }
    const dest = `${base}voice-${Date.now()}-${Math.random().toString(36).slice(2)}.${extFromUri(uri)}`;
    const result = await FileSystem.downloadAsync(uri, dest);
    localUriRef.current = result.uri;
    return result.uri;
  }, [uri]);

  const toggle = useCallback(async () => {
    if (loading) return;
    try {
      if (playing && soundRef.current) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
        return;
      }
      setLoading(true);
      setFailed(false);
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
      });
      if (!soundRef.current) {
        const playUri = await ensureLocalUri();
        const createPromise = Audio.Sound.createAsync(
          { uri: playUri },
          { shouldPlay: true }
        );
        const { sound } = await Promise.race([
          createPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Voice load timed out")), LOAD_TIMEOUT_MS)
          ),
        ]);
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
            setPlaying(false);
            void sound.setPositionAsync(0).catch(() => {});
          }
        });
        soundRef.current = sound;
        setPlaying(true);
      } else {
        await soundRef.current.playAsync();
        setPlaying(true);
      }
    } catch {
      setPlaying(false);
      setFailed(true);
      const sound = soundRef.current;
      soundRef.current = null;
      if (sound) void sound.unloadAsync().catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [ensureLocalUri, loading, playing]);

  return (
    <Pressable
      onPress={(e) => {
        e?.stopPropagation?.();
        void toggle();
      }}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={playing ? "Pause voice message" : "Play voice message"}
    >
      <View style={[styles.iconWrap, mine ? styles.iconMine : styles.iconPeer]}>
        {loading ? (
          <ActivityIndicator size="small" color={tint} />
        ) : (
          <Ionicons name={playing ? "pause" : "play"} size={20} color={tint} />
        )}
      </View>
      <View style={styles.textCol}>
        <Text style={[styles.title, { color: tint }]} numberOfLines={1}>
          {label}
        </Text>
        {detail ? (
          <Text style={[styles.detail, { color: subTint }]} numberOfLines={2}>
            {detail}
          </Text>
        ) : (
          <Text style={[styles.detail, { color: subTint }]} numberOfLines={1}>
            {failed ? "Couldn’t play — tap to retry" : playing ? "Playing…" : "Tap to play"}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 160 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  iconMine: { backgroundColor: "rgba(255,255,255,0.2)" },
  iconPeer: { backgroundColor: "rgba(0,0,0,0.06)" },
  textCol: { flexShrink: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: "600" },
  detail: { fontSize: 12 },
});
