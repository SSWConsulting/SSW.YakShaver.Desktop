module.exports = (() => {
  const region = process.env.BUILD_REGION === "china" ? "china" : "global";
  const isChina = region === "china";

  return {
    appId: isChina ? "com.ssw.yakshaver.cn" : "com.ssw.yakshaver",
    productName: isChina ? "YakShaver China" : "YakShaver",
    directories: {
      output: isChina ? "build/china" : "build",
      buildResources: "src/ui/public/icons",
    },
    files: [
      "**/*",
      "!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}",
      "!src/ui/**",
      "src/ui/dist/**",
      "!src/backend/**",
      "!**/*.ts",
      "!**/*.test.js",
      "!**/*.spec.js",
      "!**/node_modules/**/*.md",
    ],
    extraResources: [
      ".env",
      // Ship the region-specific URL constants under a fixed name so the
      // backend's loadEnv() can find it without knowing the region in advance.
      { from: isChina ? ".env.china" : ".env.global", to: ".env.region" },
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
      ...(isChina && { artifactName: "YakShaver-China-Setup-${version}.${ext}" }),
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
      ...(isChina && { artifactName: "YakShaver-China-${version}-${arch}.${ext}" }),
    },
    linux: {
      icon: "src/ui/public/icons/icon.png",
      target: ["deb"],
      ...(isChina && { artifactName: "YakShaver-China-${version}.${ext}" }),
    },
    generateUpdatesFilesForAllChannels: true,
    publish: isChina
      ? null
      : [
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
})();
