/**
 * Dynamic Expo config so release profiles can disable cleartext TLS,
 * the self-signed cert trust plugin, and the Expo dev client.
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
const trustCert = !isProduction && process.env.QCHAT_TRUST_CERT !== "0";
const allowCleartext =
  !isProduction && process.env.QCHAT_ALLOW_CLEARTEXT !== "0";

/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  name: "Rchat",
  slug: "qchat",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "qchat",
  userInterfaceStyle: "light",
  newArchEnabled: true,
  splash: {
    image: "./assets/icon.png",
    resizeMode: "contain",
    backgroundColor: "#2463dc",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.qchat.mobile",
    buildNumber: "1",
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#2463dc",
      foregroundImage: "./assets/adaptive-icon.png",
    },
    package: "com.qchat.mobile",
    versionCode: 1,
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    ...(isDevelopment ? ["expo-dev-client"] : []),
    [
      "expo-notifications",
      {
        icon: "./assets/icon.png",
        color: "#2463dc",
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
        microphonePermission: "Allow Rchat to record voice messages.",
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Allow Rchat to send photos from your library.",
        cameraPermission: "Allow Rchat to take photos for chat.",
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission: "Allow Rchat to scan group invite QR codes.",
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
        cameraPermission: "Allow Rchat to use your camera for video calls.",
        microphonePermission: "Allow Rchat to use your microphone for calls.",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    appEnv: profile,
    eas: {
      // Run `npx eas-cli init` in apps/mobile and set EAS_PROJECT_ID or paste id here.
      projectId: process.env.EAS_PROJECT_ID || undefined,
    },
  },
};
