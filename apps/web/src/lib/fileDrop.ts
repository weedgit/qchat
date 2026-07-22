/** file_upload-style drag helpers. */

export function dataTransferHasFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt?.types) return false;
  const types = Array.from(dt.types as ArrayLike<string>);
  return types.includes("Files") || types.includes("application/x-moz-file");
}

/** Collect dropped File entries (skip empty / directory placeholders when possible). */
export function filesFromDataTransfer(dt: DataTransfer): File[] {
  const items = dt.items ? Array.from(dt.items) : [];
  const raw = Array.from(dt.files || []);
  const files: File[] = [];
  raw.forEach((file, index) => {
    const item = items[index];
    if (item?.webkitGetAsEntry) {
      const entry = item.webkitGetAsEntry();
      if (entry && entry.isDirectory) return;
    }
    if (file && file.size >= 0) files.push(file);
  });
  return files;
}

/** Content fingerprint — name is ignored (browsers reuse image.png). */
export function clipboardImageKey(file: File | Blob): string {
  const type = file.type || "image/png";
  return `${type}:${file.size}`;
}

/**
 * Images from Ctrl+V / clipboard paste (createFileFromClipboard).
 * Prefer FileList; fall back to items. Never return the same bitmap twice
 * (Chrome often exposes the same paste via both items and files).
 */
export function imagesFromClipboard(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const seen = new Set<string>();
  const out: File[] = [];
  let seq = 0;

  const pushBlob = (blob: File | Blob | null) => {
    if (!blob) return;
    const type = blob.type || "image/png";
    if (!type.startsWith("image/")) return;
    const key = clipboardImageKey(blob);
    if (seen.has(key)) return;
    seen.add(key);
    const ext = type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const name = `clipboard-${Date.now()}-${seq++}.${ext}`;
    out.push(blob instanceof File ? new File([blob], name, { type }) : new File([blob], name, { type }));
  };

  // FileList first — usually the complete set when pasting multiple files from Explorer.
  const files = Array.from(dt.files || []);
  if (files.length) {
    files.forEach((f) => pushBlob(f));
    return out;
  }

  const items = dt.items ? Array.from(dt.items) : [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    pushBlob(item.getAsFile());
  }
  return out;
}

/**
 * Async clipboard read — only as a fallback when the paste event has no files.
 * Do not merge with paste-event files (same image, different wrapper → duplicates).
 */
export async function imagesFromClipboardApi(): Promise<File[]> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) return [];
  try {
    const items = await navigator.clipboard.read();
    const seen = new Set<string>();
    const out: File[] = [];
    let seq = 0;
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      const key = clipboardImageKey(blob);
      if (seen.has(key)) continue;
      seen.add(key);
      const ext = imageType.split("/")[1]?.replace("jpeg", "jpg") || "png";
      out.push(new File([blob], `clipboard-${Date.now()}-${seq++}.${ext}`, { type: imageType }));
    }
    return out;
  } catch {
    return [];
  }
}
