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
  }

  interface Window {
    qchatDesktop?: QchatDesktopBridge;
  }
}
