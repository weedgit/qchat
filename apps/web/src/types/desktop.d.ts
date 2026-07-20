export {};

declare global {
  interface QchatDesktopBridge {
    isDesktop: true;
    platform: string;
    version: string;
    webUrl: string;
    deviceName: string;
  }

  interface Window {
    qchatDesktop?: QchatDesktopBridge;
  }
}
