export {};

declare global {
  interface QchatDesktopBridge {
    isDesktop: true;
    platform: string;
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
    fetchCaptcha: () => Promise<{ captcha_id: string; challenge: string }>;
    signalReady: () => void;
    onOpenConversation: (handler: (conversationId: string) => void) => () => void;
  }

  interface Window {
    qchatDesktop?: QchatDesktopBridge;
  }
}
