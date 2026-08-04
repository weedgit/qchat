/**
 * Expo config plugin: wire 个推 (Getui) for China-mainland manufacturer push.
 *
 * Reads credentials from env / app.extra:
 *   EXPO_PUBLIC_GETUI_APP_ID | GETUI_APP_ID | extra.getui.appId
 *   EXPO_PUBLIC_GETUI_APP_KEY | GETUI_APP_KEY | extra.getui.appKey
 *   EXPO_PUBLIC_GETUI_APP_SECRET | GETUI_APP_SECRET | extra.getui.appSecret
 *
 * Android: Maven repo + GETUI_APPID meta-data.
 * iOS: Info.plist keys used by react-native-getui.
 */
const {
  withAndroidManifest,
  withProjectBuildGradle,
  withInfoPlist,
  createRunOncePlugin,
} = require("@expo/config-plugins");

function readGetui(config) {
  const extra = (config.extra && config.extra.getui) || {};
  const appId =
    process.env.EXPO_PUBLIC_GETUI_APP_ID ||
    process.env.GETUI_APP_ID ||
    extra.appId ||
    "";
  const appKey =
    process.env.EXPO_PUBLIC_GETUI_APP_KEY ||
    process.env.GETUI_APP_KEY ||
    extra.appKey ||
    "";
  const appSecret =
    process.env.EXPO_PUBLIC_GETUI_APP_SECRET ||
    process.env.GETUI_APP_SECRET ||
    extra.appSecret ||
    "";
  return {
    appId: String(appId).trim(),
    appKey: String(appKey).trim(),
    appSecret: String(appSecret).trim(),
  };
}

function withGetuiMaven(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") return cfg;
    const needle = "maven { url 'https://www.jitpack.io' }";
    const repo = `maven { url "https://mvn.getui.com/nexus/content/repositories/releases/" }`;
    if (!cfg.modResults.contents.includes("mvn.getui.com") && cfg.modResults.contents.includes("allprojects")) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /allprojects\s*\{\s*repositories\s*\{/,
        (m) => `${m}\n        ${repo}`
      );
    } else if (!cfg.modResults.contents.includes("mvn.getui.com")) {
      // Expo often uses dependencyResolutionManagement — append a comment block for operators.
      cfg.modResults.contents += `\n// Getui Maven (ensure settings.gradle repositories include):\n// ${repo}\n`;
    }
    void needle;
    return cfg;
  });
}

function withGetuiAndroidManifest(config, getui) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;
    if (!app["meta-data"]) app["meta-data"] = [];
    const metas = app["meta-data"];
    const ensure = (name, value) => {
      if (!value) return;
      const existing = metas.find((m) => m.$?.["android:name"] === name);
      if (existing) {
        existing.$["android:value"] = value;
      } else {
        metas.push({ $: { "android:name": name, "android:value": value } });
      }
    };
    ensure("GETUI_APPID", getui.appId);
    return cfg;
  });
}

function withGetuiIOS(config, getui) {
  return withInfoPlist(config, (cfg) => {
    if (getui.appId) cfg.modResults.GetuiAppId = getui.appId;
    if (getui.appKey) cfg.modResults.GetuiAppKey = getui.appKey;
    if (getui.appSecret) cfg.modResults.GetuiAppSecret = getui.appSecret;
    return cfg;
  });
}

function withGetui(config) {
  const getui = readGetui(config);
  config = withGetuiMaven(config);
  config = withGetuiAndroidManifest(config, getui);
  config = withGetuiIOS(config, getui);
  if (!config.extra) config.extra = {};
  config.extra.getui = {
    ...(config.extra.getui || {}),
    appId: getui.appId,
    appKey: getui.appKey,
    appSecret: getui.appSecret,
    enabled: Boolean(getui.appId),
  };
  return config;
}

module.exports = createRunOncePlugin(withGetui, "with-getui", "1.0.0");
