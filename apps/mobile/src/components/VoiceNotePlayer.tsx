import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";

type Props = {
  uri: string;
  label: string;
  detail?: string | null;
  tint: string;
  subTint: string;
  mine: boolean;
};

/**
 * Tap-to-play voice bubble using expo-av (mirrors web audio controls).
 * Unloads the sound when the bubble unmounts so FlatList recycling stays clean.
 */
export function VoiceNotePlayer({ uri, label, detail, tint, subTint, mine }: Props) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => {
      const sound = soundRef.current;
      soundRef.current = null;
      if (sound) {
        void sound.unloadAsync().catch(() => {});
      }
    };
  }, []);

  const toggle = useCallback(async () => {
    if (loading) return;
    try {
      if (playing && soundRef.current) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
        return;
      }
      setLoading(true);
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
      });
      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
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
    } finally {
      setLoading(false);
    }
  }, [loading, playing, uri]);

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
            {playing ? "Playing…" : "Tap to play"}
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
