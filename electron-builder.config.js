module.exports = {
  appId: "com.ssw.yakshaver",
  productName: "YakShaver",
  directories: {
    output: "build",
    buildResources: "src/ui/public/icons",
  },
  files: [
    "**/*",
    "!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}",
    "!src/ui/**",
    "src/ui/dist/**",
    "!src/backend/**",
    "!**/*.ts",
    "!**/node_modules/**/*.md",
    // Windows gets ffmpeg via win.extraResources instead, so both the x64 and arm64
    // payloads share one copy. Mac and Linux keep resolving @ffmpeg-installer normally.
    "!**/node_modules/@ffmpeg-installer/win32-*/**",
  ],
  extraResources: [
    ".env",
    "src/ui/public/**",
    "src/backend/assets/auth/**",
    {
      from: "src/backend/db/migrations",
      to: "migrations",
      filter: ["**/*"],
    },
  ],
  asar: true,
  asarUnpack: [
    "src/ui/dist/**",
    "**/@ffmpeg-installer/**",
    "**/youtube-dl-exec/**",
    "**/better-sqlite3/**",
  ],
  afterPack: "./afterPack.js",
  win: {
    icon: "src/ui/public/icons/icon.ico",
    target: [
      {
        target: "nsis",
        // Both arches in one NSIS installer, which picks the right payload at install
        // time. electron-updater's findFile() takes the first .exe in latest.yml with no
        // regard for architecture, so separate installers would hand ARM users the x64 update.
        arch: ["x64", "arm64"],
      },
    ],
    // @ffmpeg-installer publishes no win32-arm64 package, so ship the x64 binary for both
    // arches. Windows runs it under emulation on ARM.
    extraResources: [
      {
        from: "node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe",
        to: "ffmpeg.exe",
      },
    ],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
  },
  mac: {
    icon: "src/ui/public/icons/icon.icns",
    target: {
      target: "default",
      arch: ["arm64", "x64"],
    },
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "assets/entitlements.mac.plist",
    entitlementsInherit: "assets/entitlements.mac.plist",
  },
  linux: {
    icon: "src/ui/public/icons/icon.png",
    target: ["deb"],
  },
  generateUpdatesFilesForAllChannels: true,
  publish: [
    {
      provider: "github",
      owner: "SSWConsulting",
      repo: "SSW.YakShaver.Desktop",
      private: false,
      releaseType: process.env.RELEASE_TYPE || "release",
      channel: process.env.CHANNEL || "latest",
    },
  ],
};
