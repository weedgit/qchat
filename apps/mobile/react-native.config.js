function hasGetuiCredentials() {
  return Boolean(
    String(process.env.EXPO_PUBLIC_GETUI_APP_ID || process.env.GETUI_APP_ID || "").trim()
  );
}

/** Skip 个推 native SDK when credentials are unset (preview sideload / non-CN builds). */
module.exports = {
  dependencies: hasGetuiCredentials()
    ? {}
    : {
        "react-native-getui": {
          platforms: {
            android: null,
            ios: null,
          },
        },
      },
};
