/** Tenor GIF search for the composer picker. */

export type GifItem = {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
};

const TENOR_KEY =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_TENOR_API_KEY) ||
  "LIVDSRZULELA";

type TenorMedia = {
  url?: string;
  preview?: string;
  dims?: number[];
};

type TenorResult = {
  id?: string;
  title?: string;
  media_formats?: Record<string, TenorMedia>;
  media?: Array<Record<string, TenorMedia>>;
};

function pickMedia(r: TenorResult): { previewUrl: string; url: string } | null {
  const formats = r.media_formats;
  if (formats) {
    const tiny = formats.tinygif || formats.nanogif || formats.tinygifpreview;
    const full = formats.gif || formats.mediumgif || formats.tinygif;
    const previewUrl = tiny?.url || full?.url || "";
    const url = full?.url || tiny?.url || "";
    if (previewUrl && url) return { previewUrl, url };
  }
  // Legacy v1 shape
  const m0 = r.media?.[0];
  if (m0) {
    const tiny = m0.tinygif || m0.nanogif;
    const full = m0.gif || m0.mediumgif || tiny;
    const previewUrl = tiny?.url || full?.url || "";
    const url = full?.url || tiny?.url || "";
    if (previewUrl && url) return { previewUrl, url };
  }
  return null;
}

async function tenorGet(path: string, params: Record<string, string>): Promise<GifItem[]> {
  const qs = new URLSearchParams({
    key: TENOR_KEY,
    limit: "24",
    media_filter: "gif,tinygif,nanogif,mediumgif",
    ...params,
  });
  const res = await fetch(`https://tenor.googleapis.com/v2/${path}?${qs.toString()}`);
  if (!res.ok) {
    // Fallback to legacy endpoint used by many demos.
    const legacy = new URLSearchParams({
      key: TENOR_KEY,
      limit: "24",
      media_filter: "minimal",
      ...params,
    });
    const legacyPath = path === "featured" ? "trending" : path;
    const res2 = await fetch(`https://g.tenor.com/v1/${legacyPath}?${legacy.toString()}`);
    if (!res2.ok) throw new Error(`GIF search failed (${res2.status})`);
    const body2 = await res2.json();
    return mapResults(Array.isArray(body2?.results) ? body2.results : []);
  }
  const body = await res.json();
  return mapResults(Array.isArray(body?.results) ? body.results : []);
}

function mapResults(results: TenorResult[]): GifItem[] {
  const out: GifItem[] = [];
  for (const r of results) {
    const media = pickMedia(r);
    if (!media) continue;
    out.push({
      id: String(r.id ?? `${media.url}`),
      title: String(r.title || "GIF"),
      previewUrl: media.previewUrl,
      url: media.url,
    });
  }
  return out;
}

/** Search GIFs, or load trending/featured when query is empty. */
export async function searchGifs(query: string): Promise<GifItem[]> {
  const q = query.trim();
  if (!q) {
    try {
      return await tenorGet("featured", {});
    } catch {
      return await tenorGet("search", { q: "hello" });
    }
  }
  return tenorGet("search", { q });
}
