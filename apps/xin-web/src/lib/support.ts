/** Platform operator contact (env at build time). */
export type PlatformSupport = {
  email?: string;
  url?: string;
};

export function getPlatformSupport(): PlatformSupport | null {
  const email = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "").trim();
  const url = (process.env.NEXT_PUBLIC_SUPPORT_URL || "").trim();
  if (!email && !url) return null;
  return {
    email: email || undefined,
    url: url || undefined,
  };
}
