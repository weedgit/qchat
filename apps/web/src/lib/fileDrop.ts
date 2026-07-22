/** Mattermost file_upload-style drag helpers. */

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

/** Images from Ctrl+V / clipboard paste (Mattermost createFileFromClipboard). */
export function imagesFromClipboard(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const out: File[] = [];
  const items = dt.items ? Array.from(dt.items) : [];
  for (const item of items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const blob = item.getAsFile();
    if (!blob) continue;
    const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const name =
      blob.name && blob.name !== "image.png"
        ? blob.name
        : `clipboard-${Date.now()}.${ext}`;
    out.push(new File([blob], name, { type: blob.type || "image/png" }));
  }
  if (out.length) return out;
  // Fallback: some browsers only expose Files on paste.
  return Array.from(dt.files || []).filter((f) => f.type.startsWith("image/"));
}
