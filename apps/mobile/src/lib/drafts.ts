/** Per-conversation composer drafts (mirror web drafts.ts; FileSystem for RN size). */
import * as FileSystem from "expo-file-system/legacy";

const DRAFT_PATH = `${FileSystem.documentDirectory ?? ""}qchat.drafts.json`;

let cache: Record<string, string> | null = null;
let loadPromise: Promise<Record<string, string>> | null = null;

async function readAll(): Promise<Record<string, string>> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        if (!FileSystem.documentDirectory) return {};
        const info = await FileSystem.getInfoAsync(DRAFT_PATH);
        if (!info.exists) return {};
        const raw = await FileSystem.readAsStringAsync(DRAFT_PATH);
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
      } catch {
        return {};
      }
    })().then((data) => {
      cache = data;
      return data;
    });
  }
  return loadPromise;
}

async function writeAll(drafts: Record<string, string>): Promise<void> {
  cache = drafts;
  if (!FileSystem.documentDirectory) return;
  try {
    await FileSystem.writeAsStringAsync(DRAFT_PATH, JSON.stringify(drafts));
  } catch {
    /* ignore persist errors */
  }
}

export async function getDraft(convId: string): Promise<string> {
  if (!convId) return "";
  const drafts = await readAll();
  return drafts[convId] ?? "";
}

export async function saveDraft(convId: string, text: string): Promise<void> {
  if (!convId) return;
  const drafts = { ...(await readAll()) };
  if (!text.trim()) delete drafts[convId];
  else drafts[convId] = text;
  await writeAll(drafts);
}
