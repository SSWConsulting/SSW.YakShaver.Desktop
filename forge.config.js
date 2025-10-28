const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

module.exports = {
  packagerConfig: {
    icon: 'src/ui/public/icons/icon', // no file extension required
    asar: {
      unpack: "{**/src/ui/dist/**,**/@ffmpeg-installer/**}", // Unpack UI dist and ffmpeg binaries from asar
    },
    extraResource: [
      "./src/ui/public", // Copy UI public folder to resources (for icons, fonts, etc.)
      "./.env", // Include .env in packaged resources so production can load it
    ],
    ignore: [
      /^\/src\/ui\/(?!dist)/, // Include only src/ui/dist
      /^\/src\/backend/, // Don't include source files
      /\.ts$/, // Don't include TypeScript files
      // /\.env$/, // Don't include .env // TODO: uncomment this line after this is done: https://github.com/SSWConsulting/SSW.YakShaver/issues/3095
      /node_modules\/.*\.md$/, // Skip markdown in node_modules
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          icon: 'src/ui/public/icons/icon.png'
        }
      }
    },
    {
      name: "@electron-forge/maker-squirrel",
      config: {},
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
      config: {
        icon: 'src/ui/public/icons/icon.icns'
      }
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "SSWConsulting",
          name: "SSW.YakShaver.Desktop",
        },
        prerelease: false,
      },
    },
  ],
};
