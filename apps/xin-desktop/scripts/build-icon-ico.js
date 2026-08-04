/**
 * Rebuild assets/icon.ico from sized PNGs.
 * The previous hand-rolled .ico had a corrupt 256px directory entry and
 * crashed electron-builder (resedit: Offset is outside the bounds of the DataView).
 *
 * Usage: node scripts/build-icon-ico.js
 */
const fs = require("fs");
const path = require("path");

async function main() {
  let pngToIco;
  try {
    pngToIco = require("png-to-ico");
  } catch {
    console.error("Install png-to-ico first: npm install -D png-to-ico");
    process.exit(1);
  }

  const root = path.join(__dirname, "..");
  const assets = path.join(root, "assets");
  const inputs = [
    "icon-16.png",
    "icon-32.png",
    "icon-48.png",
    "icon-64.png",
    "icon-128.png",
    "icon-256.png",
  ].map((name) => path.join(assets, name));

  for (const file of inputs) {
    if (!fs.existsSync(file)) {
      console.error("missing", file);
      process.exit(1);
    }
  }

  const buf = await pngToIco(inputs);
  const out = path.join(assets, "icon.ico");
  fs.writeFileSync(out, buf);
  console.log("wrote", out, `(${buf.length} bytes, ${inputs.length} sizes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
