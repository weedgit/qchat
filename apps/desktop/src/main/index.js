const { enableProductionSandbox } = require("./security/sandbox");

// PACK-07: enable Chromium sandbox before any other app setup / ready work.
enableProductionSandbox();

const { startApp } = require("./app/lifecycle");

startApp();
