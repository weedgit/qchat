/**
 * PACK-05 — notarize the signed macOS .app after electron-builder signs it.
 * No-op unless Apple credentials are present so unsigned local/CI builds keep working.
 *
 * Env (app-specific password flow):
 *   APPLE_ID
 *   APPLE_APP_SPECIFIC_PASSWORD
 *   APPLE_TEAM_ID
 *
 * Or API key flow:
 *   APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER (+ APPLE_TEAM_ID)
 */
const path = require("path");

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  const apiKey = process.env.APPLE_API_KEY;
  const apiKeyId = process.env.APPLE_API_KEY_ID;
  const apiIssuer = process.env.APPLE_API_ISSUER;

  const hasPasswordAuth = Boolean(appleId && appleIdPassword && teamId);
  const hasApiKeyAuth = Boolean(apiKey && apiKeyId && apiIssuer && teamId);

  if (!hasPasswordAuth && !hasApiKeyAuth) {
    console.log(
      "[qchat-desktop afterSign] notarize skipped (set APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or API key env)"
    );
    return;
  }

  // Skip if nothing was signed (no Developer ID identity / CSC_*).
  if (!process.env.CSC_LINK && !process.env.CSC_NAME) {
    console.log(
      "[qchat-desktop afterSign] notarize skipped (no CSC_LINK / CSC_NAME — app likely unsigned)"
    );
    return;
  }

  let notarize;
  try {
    ({ notarize } = require("@electron/notarize"));
  } catch (err) {
    console.warn(
      "[qchat-desktop afterSign] @electron/notarize missing:",
      err?.message || err
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[qchat-desktop afterSign] notarizing ${appPath} …`);

  /** @type {Record<string, string>} */
  const opts = { appPath, teamId };
  if (hasApiKeyAuth) {
    opts.appleApiKey = apiKey;
    opts.appleApiKeyId = apiKeyId;
    opts.appleApiIssuer = apiIssuer;
  } else {
    opts.appleId = appleId;
    opts.appleIdPassword = appleIdPassword;
  }

  await notarize(opts);
  console.log("[qchat-desktop afterSign] notarize complete");
};
