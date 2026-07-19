const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('qchatDesktop', {
  platform: process.platform,
  isDesktop: true,
});
