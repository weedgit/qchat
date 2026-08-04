/**
 * Dynamic Expo config for XinChat (same Qchat/Rchat API backend).
 *
 * Profiles (EAS_BUILD_PROFILE / APP_ENV):
 * - development — local/dev-client, cleartext + trust plugin
 * - preview — internal APK/AAB against a known host (trust optional)
 * - production — store builds: HTTPS/system CA only
 */
const profile = (
  process.env.EAS_BUILD_PROFILE ||
  process.env.APP_ENV ||
  "development"
).toLowerCase();

const isProduction = profile === "production";
const isDevelopment = profile === "development" || profile === "dev";
const trustCert = !isProduction && process.env.XINCHAT_TRUST_CERT !== "0";
const allowCleartext =
  !isProduction && process.env.XINCHAT_ALLOW_CLEARTEXT !== "0";

/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  name: "XinChat",
  slug: "xinchat",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "xinchat",
  userInterfaceStyle: "light",
  newArchEnabled: true,
  splash: {
    image: "./assets/icon.png",
    resizeMode: "contain",
    backgroundColor: "#047857",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.xinchat.mobile",
    buildNumber: "1",
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#047857",
      foregroundImage: "./assets/adaptive-icon.png",
    },
    package: "com.xinchat.mobile",
    versionCode: 1,
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    ...(isDevelopment ? ["expo-dev-client"] : []),
    "./plugins/withGetui.js",
    [
      "expo-notifications",
      {
        icon: "./assets/icon.png",
        color: "#059669",
        defaultChannel: "messages",
        sounds: [],
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          usesCleartextTraffic: allowCleartext,
        },
        ios: {
          networkInspector: false,
        },
      },
    ],
    ...(trustCert ? ["./plugins/withTrustedQchatCert.js"] : []),
    [
      "expo-audio",
      {
        microphonePermission: "Allow XinChat to record voice messages.",
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Allow XinChat to send photos from your library.",
        cameraPermission: "Allow XinChat to take photos for chat.",
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission: "Allow XinChat to scan group invite QR codes.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      "@livekit/react-native-expo-plugin",
      {
        android: {
          audioType: "communication",
        },
      },
    ],
    [
      "@config-plugins/react-native-webrtc",
      {
        cameraPermission: "Allow XinChat to use your camera for video calls.",
        microphonePermission: "Allow XinChat to use your microphone for calls.",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    appEnv: profile,
    apiUrl: (process.env.EXPO_PUBLIC_API_URL || "").trim().replace(/\/$/, ""),
    livekitUrl: (process.env.EXPO_PUBLIC_LIVEKIT_URL || "").trim().replace(/\/$/, ""),
    getui: {
      appId: (process.env.EXPO_PUBLIC_GETUI_APP_ID || process.env.GETUI_APP_ID || "").trim(),
      appKey: (process.env.EXPO_PUBLIC_GETUI_APP_KEY || process.env.GETUI_APP_KEY || "").trim(),
      appSecret: (
        process.env.EXPO_PUBLIC_GETUI_APP_SECRET ||
        process.env.GETUI_APP_SECRET ||
        ""
      ).trim(),
    },
    eas: {
      projectId: process.env.EAS_PROJECT_ID || undefined,
    },
  },
};
