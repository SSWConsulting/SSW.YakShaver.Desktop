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
        arch: ["x64"],
      },
    ],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
  },
  // Registers the custom scheme in the macOS bundle's Info.plist (CFBundleURLTypes).
  //
  // src/backend/index.ts calls app.setAsDefaultProtocolClient at startup, which is enough on
  // Windows because it writes the registry. macOS cannot work that way: Electron's docs are
  // explicit that "you can only register protocols that have been added to your app's info.plist,
  // which cannot be modified at runtime". Without this key nothing generates that entry, so
  // yakshaver-desktop:// links were silently dead on every Mac build.
  //
  // Both schemes are listed because the second-instance and open-url handlers in
  // src/backend/index.ts already accept the -dev variant alongside the production one.
  protocols: [
    {
      name: "YakShaver",
      schemes: ["yakshaver-desktop", "yakshaver-desktop-dev"],
    },
  ],
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
