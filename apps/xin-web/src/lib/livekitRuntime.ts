/** Lazy-load livekit-client so chat boot does not pay for WebRTC until a call. */

type LiveKitModule = typeof import("livekit-client");

let mod: LiveKitModule | null = null;
let loading: Promise<LiveKitModule> | null = null;

export function loadLiveKit(): Promise<LiveKitModule> {
  if (mod) return Promise.resolve(mod);
  if (!loading) {
    loading = import("livekit-client").then((m) => {
      mod = m;
      return m;
    });
  }
  return loading;
}

export function liveKitOrThrow(): LiveKitModule {
  if (!mod) throw new Error("LiveKit not loaded");
  return mod;
}

/** Warm the async chunk (incoming ring / dial). */
export function prefetchLiveKit(): void {
  void loadLiveKit();
}
