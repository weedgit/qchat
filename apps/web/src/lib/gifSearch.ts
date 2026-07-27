/** Composer GIF search via Qchat API → Giphy (server-side key). */

import { api, asList } from "./api";

export type GifItem = {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
};

/** Search GIFs, or load trending when query is empty. */
export async function searchGifs(query: string): Promise<GifItem[]> {
  const q = query.trim();
  const path = q
    ? `/v1/gifs?q=${encodeURIComponent(q)}&limit=24`
    : `/v1/gifs?limit=24`;
  const body = await api<any>(path);
  return asList(body, "gifs").map((g: any) => ({
    id: String(g?.id ?? ""),
    title: String(g?.title || "GIF"),
    previewUrl: String(g?.preview_url ?? g?.previewUrl ?? ""),
    url: String(g?.url ?? ""),
  })).filter((g: GifItem) => g.id && g.previewUrl && g.url);
}
