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
