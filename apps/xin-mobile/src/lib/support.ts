import Constants from "expo-constants";

export type PlatformSupport = {
  email?: string;
  url?: string;
};

export function getPlatformSupport(): PlatformSupport | null {
  const extra = Constants.expoConfig?.extra as
    | { supportEmail?: string; supportUrl?: string }
    | undefined;
  const email = (
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL ||
    extra?.supportEmail ||
    ""
  ).trim();
  const url = (
    process.env.EXPO_PUBLIC_SUPPORT_URL ||
    extra?.supportUrl ||
    ""
  ).trim();
  if (!email && !url) return null;
  return { email: email || undefined, url: url || undefined };
}
