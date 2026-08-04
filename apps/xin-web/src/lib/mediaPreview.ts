/** Build lightweight image previews so large photos don't freeze the UI. */

const PREVIEW_MAX_EDGE = 1280;
const FULL_DECODE_MAX_BYTES = 1.5 * 1024 * 1024;

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * /Telegram-style: show a downscaled bitmap for large images.
 * Small images keep a cheap object URL. Non-images return "".
 */
export async function makeImagePreviewUrl(file: File | Blob): Promise<string> {
  if (!file.type.startsWith("image/")) return "";
  await yieldToMain();

  if (file.size <= FULL_DECODE_MAX_BYTES || typeof createImageBitmap !== "function") {
    return URL.createObjectURL(file);
  }

  try {
    const bitmap = await createImageBitmap(file, {
      resizeWidth: PREVIEW_MAX_EDGE,
      resizeHeight: PREVIEW_MAX_EDGE,
      resizeQuality: "medium",
    });
    await yieldToMain();
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return URL.createObjectURL(file);
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82)
    );
    if (!blob) return URL.createObjectURL(file);
    return URL.createObjectURL(blob);
  } catch {
    return URL.createObjectURL(file);
  }
}
