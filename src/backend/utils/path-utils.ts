import { join } from "node:path";
import { app } from "electron";

/**
 * Gets the path to the application icon, handling both development and packaged modes
 * @returns The absolute path to the icon file
 */
export function getIconPath(): string {
  // In development mode, the icon is in the source directory
  // In packaged mode, the icon is in the resources directory
  return app.isPackaged
    ? join(process.resourcesPath, "public/icons/icon.png")
    : join(__dirname, "../../../src/ui/public/icons/icon.png");
}
