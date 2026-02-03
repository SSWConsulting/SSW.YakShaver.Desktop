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
  ],
  extraResources: [
    ".env",
    "src/ui/public/**",
    "src/ui/successTemplate.html",
    "src/ui/errorTemplate.html",
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
        arch: ["x64"],
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
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"],
      },
      {
        target: "zip",
        arch: ["x64", "arm64"],
      },
    ],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "assets/entitlements.mac.plist",
    entitlementsInherit: "assets/entitlements.mac.plist",
  },
  dmg: {
    sign: false, // Only sign the app bundle, not the DMG itself (saves time/complexity if notarization is skipped)
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
