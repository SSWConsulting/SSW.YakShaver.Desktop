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
  extraResources: [".env", "src/ui/public/**"],
  asar: true,
  asarUnpack: ["src/ui/dist/**", "**/@ffmpeg-installer/**"],
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
    allowToChangeInstallationDirectory: true,
  },
  mac: {
    icon: "src/ui/public/icons/icon.icns",
    target: ["zip"],
  },
  linux: {
    icon: "src/ui/public/icons/icon.png",
    target: ["deb"],
  },
  generateUpdatesFilesForAllChannels: true,
  publish: [
    {
      provider: "github",
      owner: "babakamyljanovssw",
      repo: "SSW.YakShaver.Desktop",
      private: false,
      releaseType: process.env.RELEASE_TYPE || "release",
      channel: process.env.CHANNEL || "latest",
    },
  ],
};
