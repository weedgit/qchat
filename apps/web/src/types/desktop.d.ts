export {};

declare global {
  interface QchatDesktopSecureSession {
    accessToken: string;
    refreshToken: string;
  }

  interface QchatDesktopBridge {
    isDesktop: true;
    platform: string;
    /** Friendly OS label e.g. "Windows 11", "Ubuntu 24.04". */
    platformLabel?: string;
    version: string;
    webUrl: string;
    deviceName: string;
    notifyMessage: (payload: {
      title: string;
      body?: string;
      conversationId?: string;
      silent?: boolean;
      /** NOTI-05 — flash taskbar / bounce Dock when true. */
      mention?: boolean;
      /** True when this conversation is the open chat (main skips if OS-focused). */
      suppressIfFocused?: boolean;
    }) => Promise<boolean>;
    showAbout: () => Promise<boolean>;
    fetchCaptcha: () => Promise<{ captcha_id: string; image: string }>;
    setUnreadStatus?: (payload: {
      unread?: number | boolean;
      mentions?: number;
    }) => Promise<boolean>;
    signalReady: () => void;
    onOpenConversation: (handler: (conversationId: string) => void) => () => void;
    /** Mattermost-style OS window focus for notification gating. */
    isWindowFocused?: () => Promise<{ focused: boolean }>;
    onWindowFocusChanged?: (
      handler: (payload: { focused: boolean }) => void
    ) => () => void;
    secureSessionAvailable?: () => Promise<{ available: boolean; encryption: boolean }>;
    getSecureSession?: () => Promise<QchatDesktopSecureSession | null>;
    setSecureSession?: (tokens: {
      accessToken: string;
      refreshToken?: string;
    }) => Promise<{ ok: boolean }>;
    clearSecureSession?: () => Promise<{ ok: boolean }>;
    /** SHELL-31 — Electron nativeTheme / window chrome. */
    getNativeTheme?: () => Promise<{
      shouldUseDarkColors: boolean;
      themeSource: string;
      resolved: "dark" | "light";
    }>;
    setNativeThemeSource?: (
      source: "system" | "light" | "dark"
    ) => Promise<{ ok: boolean }>;
    onNativeThemeUpdated?: (
      handler: (payload: {
        shouldUseDarkColors: boolean;
        themeSource: string;
        resolved: "dark" | "light";
      }) => void
    ) => () => void;
    /** SHELL-32 — Electron net.isOnline() probe. */
    getNetworkOnline?: () => Promise<{ online: boolean }>;
    /** AUTH-04 — system idle / lock activity updates. */
    onUserActivity?: (
      handler: (payload: {
        userIsActive: boolean;
        idleTime: number;
        isSystemEvent?: boolean;
      }) => void
    ) => () => void;
    /** Native clipboard write (menu ID copy, etc.). */
    writeClipboardText?: (text: string) => Promise<{ ok: boolean }>;
    /** CALL-03 — Telegram-style video chat window. */
    openCallWindow?: (path?: string) => Promise<{ ok: boolean }>;
    focusCallWindow?: () => Promise<{ ok: boolean }>;
    closeCallWindow?: () => Promise<{ ok: boolean }>;
    focusMainWindow?: () => Promise<{ ok: boolean }>;
    /** Download a URL with the native Save As dialog (will-download). */
    downloadURL?: (url: string) => Promise<{ ok: boolean; error?: string }>;
  }

  interface Window {
    qchatDesktop?: QchatDesktopBridge;
  }
}
