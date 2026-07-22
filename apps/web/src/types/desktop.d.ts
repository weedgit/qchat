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
    }) => Promise<boolean>;
    showAbout: () => Promise<boolean>;
    fetchCaptcha: () => Promise<{ captcha_id: string; image: string }>;
    setUnreadStatus?: (payload: {
      unread?: number | boolean;
      mentions?: number;
    }) => Promise<boolean>;
    signalReady: () => void;
    onOpenConversation: (handler: (conversationId: string) => void) => () => void;
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
  }

  interface Window {
    qchatDesktop?: QchatDesktopBridge;
  }
}
