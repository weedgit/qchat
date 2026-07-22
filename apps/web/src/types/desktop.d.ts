export {};

declare global {
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
    signalReady: () => void;
    onOpenConversation: (handler: (conversationId: string) => void) => () => void;
  }

  interface Window {
    qchatDesktop?: QchatDesktopBridge;
  }
}
