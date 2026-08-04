/**
 * Download chat media to a local cache file, then let the user save/share it.
 * Mirrors voice-note caching (expo-file-system) so received images work offline
 * of the original sender device.
 */

import { Alert, Platform, Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { mediaAuthURL } from "./api";

function extFromUri(uri: string, fallback = "bin"): string {
  try {
    const path = uri.split("?")[0] || uri;
    const m = path.match(/\.([a-z0-9]+)$/i);
    return (m?.[1] || fallback).toLowerCase();
  } catch {
    return fallback;
  }
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "m4a":
      return "audio/mp4";
    case "mp3":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
  }
}

function defaultExtForType(type?: string): string {
  if (type === "image") return "jpg";
  if (type === "voice") return "m4a";
  if (type === "video") return "mp4";
  return "bin";
}

export async function saveChatMedia(opts: {
  mediaUrl: string;
  type?: string;
  fileName?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const authed = mediaAuthURL(opts.mediaUrl) || opts.mediaUrl;
  if (!authed) return { ok: false, reason: "missing_url" };

  const ext = extFromUri(authed, defaultExtForType(opts.type));
  const fileName =
    (opts.fileName && opts.fileName.trim()) ||
    `rchat-${opts.type || "media"}-${Date.now()}.${ext}`;
  const mime = mimeFromExt(ext);
  const dest = `${FileSystem.cacheDirectory || ""}${fileName}`;

  try {
    const downloaded = await FileSystem.downloadAsync(authed, dest);
    if (downloaded.status && downloaded.status >= 400) {
      return { ok: false, reason: `http_${downloaded.status}` };
    }
    const localUri = downloaded.uri;

    // Android: let the user pick a folder (Downloads / Pictures) and write there.
    if (Platform.OS === "android" && FileSystem.StorageAccessFramework) {
      try {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (perm.granted) {
          const base64 = await FileSystem.readAsStringAsync(localUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const created = await FileSystem.StorageAccessFramework.createFileAsync(
            perm.directoryUri,
            fileName,
            mime
          );
          await FileSystem.writeAsStringAsync(created, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          return { ok: true };
        }
      } catch {
        /* fall through to Share */
      }
    }

    await Share.share(
      Platform.OS === "ios"
        ? { url: localUri }
        : { url: localUri, message: fileName, title: fileName }
    );
    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      reason: err?.message || "save_failed",
    };
  }
}

export function alertSaveResult(result: { ok: boolean; reason?: string }) {
  if (result.ok) return;
  Alert.alert("Could not save", result.reason || "Try again");
}
