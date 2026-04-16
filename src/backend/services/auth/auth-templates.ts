import * as fs from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { config } from "../../config/env";

export type AuthTemplateName = "successTemplate.html" | "errorTemplate.html";

function getAuthTemplateDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "src/backend/assets/auth")
    : join(__dirname, "../../../../src/backend/assets/auth");
}

export function getMainAppAuthUri(customProtocol?: string | null): string {
  const protocol =
    customProtocol || (config.isDev() ? "yakshaver-desktop-dev" : "yakshaver-desktop");

  return `${protocol}://auth`;
}

export function loadAuthTemplate(templateName: AuthTemplateName): string {
  const templatePath = join(getAuthTemplateDirectory(), templateName);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Auth template not found: ${templatePath}`);
  }

  return fs.readFileSync(templatePath, "utf8");
}

export function loadSuccessAuthTemplate(customProtocol?: string | null): string {
  return loadAuthTemplate("successTemplate.html").replace(
    "redirectUrl",
    getMainAppAuthUri(customProtocol),
  );
}
