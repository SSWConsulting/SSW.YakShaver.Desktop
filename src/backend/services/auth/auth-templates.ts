import * as fs from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { config } from "../../config/env";

export type AuthTemplateName =
  | "successTemplate.html"
  | "errorTemplate.html"
  | "failureTemplate.html";

/** Matched literally, so keep these in step with the markup. */
const SHARED_STYLESHEET_FILE_NAME = "auth-pages.css";
const SHARED_STYLESHEET_LINK = '<link rel="stylesheet" href="auth-pages.css" />';

function getAuthTemplateDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "src/backend/assets/auth")
    : join(__dirname, "../../../../src/backend/assets/auth");
}

/**
 * Replaces a page's stylesheet link with the stylesheet itself, inlined.
 *
 * The link is what lets the file render when opened straight from disk. It cannot survive being
 * handed to MSAL, which takes an HTML string with no base URL for a relative href to resolve
 * against, so the page would arrive unstyled.
 *
 * Throws when the link is missing: an unstyled page is far harder to notice than a failed load.
 */
function inlineSharedStyles(html: string, templateName: AuthTemplateName): string {
  if (!html.includes(SHARED_STYLESHEET_LINK)) {
    throw new Error(
      `${templateName} does not link ${SHARED_STYLESHEET_FILE_NAME} as expected ` +
        `(${SHARED_STYLESHEET_LINK}), so the shared styles cannot be inlined.`,
    );
  }

  const cssPath = join(getAuthTemplateDirectory(), SHARED_STYLESHEET_FILE_NAME);

  if (!fs.existsSync(cssPath)) {
    throw new Error(`Auth stylesheet not found: ${cssPath}`);
  }

  const css = fs.readFileSync(cssPath, "utf8");

  // A function replacer, so `$&` and friends in the CSS stay literal text.
  return html.replace(SHARED_STYLESHEET_LINK, () => `<style>\n${css}</style>`);
}

export function getMainAppAuthUri(customProtocol?: string | null): string {
  const protocol =
    customProtocol || (config.isDev() ? "yakshaver-desktop-dev" : "yakshaver-desktop");

  return `${protocol}://auth`;
}

function readAuthTemplate(templateName: AuthTemplateName): string {
  const templatePath = join(getAuthTemplateDirectory(), templateName);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Auth template not found: ${templatePath}`);
  }

  return fs.readFileSync(templatePath, "utf8");
}

export function loadAuthTemplate(templateName: AuthTemplateName): string {
  return inlineSharedStyles(readAuthTemplate(templateName), templateName);
}

export function loadSuccessAuthTemplate(customProtocol?: string | null): string {
  // Substitutes before inlining: `replace` takes the first match in the whole document, and the
  // stylesheet would otherwise sit in front of the href.
  const html = readAuthTemplate("successTemplate.html").replace(
    "redirectUrl",
    getMainAppAuthUri(customProtocol),
  );

  return inlineSharedStyles(html, "successTemplate.html");
}

/**
 * Loads the "failure" auth result page — used when the user cancels or declines the
 * authorization request (e.g. an OAuth `access_denied` response), as distinct from
 * `errorTemplate.html`, which covers a hard/unexpected technical failure.
 */
export function loadFailureAuthTemplate(): string {
  return loadAuthTemplate("failureTemplate.html");
}
