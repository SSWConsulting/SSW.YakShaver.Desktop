const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");
const path = require("node:path");

module.exports = async (context) => {
  const { electronPlatformName, appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  let appPath;

  if (electronPlatformName === "darwin") {
    appPath = path.join(appOutDir, `${appName}.app/Contents/MacOS/${appName}`);
  } else if (electronPlatformName === "win32") {
    appPath = path.join(appOutDir, `${appName}.exe`);
  } else if (electronPlatformName === "linux") {
    appPath = path.join(appOutDir, appName);
  } else {
    console.warn(`Skipping fuse configuration for unsupported platform: ${electronPlatformName}`);
    return;
  }

  try {
    await flipFuses(appPath, {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      resetAdHocDarwinSignature: electronPlatformName === "darwin", // For macOS, especially ARM
    });
  } catch (error) {
    console.error("Failed to flip fuses:", error);
  }
  
};
