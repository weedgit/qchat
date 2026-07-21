const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const directories = ["src/main", "src/preload", "scripts"];

for (const directory of directories) {
  const directoryPath = path.join(ROOT, directory);
  for (const entry of fs.readdirSync(directoryPath)) {
    if (!entry.endsWith(".js")) continue;

    const result = spawnSync(process.execPath, ["--check", path.join(directoryPath, entry)], {
      stdio: "inherit",
    });
    if (result.status !== 0) process.exit(result.status);
  }
}

console.log("Desktop JavaScript syntax check passed.");
