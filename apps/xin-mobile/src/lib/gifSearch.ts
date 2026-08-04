/** Composer GIF search via Qchat API → Giphy (server-side key). */

import { api, asList } from "./api";

export type GifItem = {
  id: string;
  title: string;
  /** Fast still / WebP for the picker grid. */
  previewUrl: string;
  /** Animated WebP/GIF when available (same as preview on still-only). */
  animateUrl: string;
  /** Downsized URL to send in chat. */
  url: string;
};

/** Search GIFs, or load trending when query is empty. */
export async function searchGifs(query: string): Promise<GifItem[]> {
  const q = query.trim();
  const path = q
    ? `/v1/gifs?q=${encodeURIComponent(q)}&limit=24`
    : `/v1/gifs?limit=24`;
  const body = await api<any>(path);
  return asList(body, "gifs")
    .map((g: any) => {
      const previewUrl = String(g?.preview_url ?? g?.previewUrl ?? "");
      const animateUrl = String(g?.animate_url ?? g?.animateUrl ?? previewUrl);
      return {
        id: String(g?.id ?? ""),
        title: String(g?.title || "GIF"),
        previewUrl,
        animateUrl: animateUrl || previewUrl,
        url: String(g?.url ?? ""),
      };
    })
    .filter((g: GifItem) => g.id && g.previewUrl && g.url);
}
