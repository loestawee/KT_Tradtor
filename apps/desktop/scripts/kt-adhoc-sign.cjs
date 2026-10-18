// KT: without a Developer ID, electron-builder leaves the macOS bundle with
// Electron's original (now invalid) signature, and Apple Silicon refuses to run
// it ("damaged"). Re-sign ad-hoc so local and side-loaded builds launch.
// Skipped automatically when a real identity is supplied (CSC_NAME / CSC_LINK).
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_NAME || process.env.CSC_LINK) return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const entitlements = path.join(__dirname, "..", "build", "entitlements.mac.plist");
  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", "--entitlements", entitlements, appPath],
    { stdio: "inherit" },
  );
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log(`  • ad-hoc signed ${appPath}`);
};
