import { describe, expect, it } from "vitest";
import { buildYtDlpAuthArgs, buildYtDlpCookieArgs, buildYtDlpUserAgentArgs } from "./youtube-service";

describe("buildYtDlpAuthArgs", () => {
  it("returns empty array when no auth env vars are set", () => {
    expect(buildYtDlpAuthArgs({} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("uses cookies file when provided", () => {
    const env = {
      YAKSHAVER_YTDLP_COOKIES_FILE: "/tmp/cookies.txt",
    } as NodeJS.ProcessEnv;
    expect(buildYtDlpAuthArgs(env)).toEqual(["--cookies", "/tmp/cookies.txt"]);
  });

  it("uses cookies-from-browser when provided and cookies file is not set", () => {
    const env = {
      YAKSHAVER_YTDLP_COOKIES_FROM_BROWSER: "chrome",
    } as NodeJS.ProcessEnv;
    expect(buildYtDlpAuthArgs(env)).toEqual(["--cookies-from-browser", "chrome"]);
  });

  it("prefers cookies file over cookies-from-browser when both are set", () => {
    const env = {
      YAKSHAVER_YTDLP_COOKIES_FILE: "/tmp/cookies.txt",
      YAKSHAVER_YTDLP_COOKIES_FROM_BROWSER: "chrome",
    } as NodeJS.ProcessEnv;
    expect(buildYtDlpAuthArgs(env)).toEqual(["--cookies", "/tmp/cookies.txt"]);
  });

  it("adds user-agent when provided", () => {
    const env = {
      YAKSHAVER_YTDLP_USER_AGENT: "MyUA",
    } as NodeJS.ProcessEnv;
    expect(buildYtDlpAuthArgs(env)).toEqual(["--user-agent", "MyUA"]);
  });

  it("combines cookies and user-agent", () => {
    const env = {
      YAKSHAVER_YTDLP_COOKIES_FROM_BROWSER: "chrome",
      YAKSHAVER_YTDLP_USER_AGENT: "MyUA",
    } as NodeJS.ProcessEnv;
    expect(buildYtDlpAuthArgs(env)).toEqual([
      "--cookies-from-browser",
      "chrome",
      "--user-agent",
      "MyUA",
    ]);
  });
});

describe("buildYtDlpCookieArgs", () => {
  it("prefers cookies file over cookies-from-browser when both are set", () => {
    const env = {
      YAKSHAVER_YTDLP_COOKIES_FILE: "/tmp/cookies.txt",
      YAKSHAVER_YTDLP_COOKIES_FROM_BROWSER: "chrome",
    } as NodeJS.ProcessEnv;
    expect(buildYtDlpCookieArgs(env)).toEqual(["--cookies", "/tmp/cookies.txt"]);
  });
});

describe("buildYtDlpUserAgentArgs", () => {
  it("returns user-agent args when provided", () => {
    const env = { YAKSHAVER_YTDLP_USER_AGENT: "MyUA" } as NodeJS.ProcessEnv;
    expect(buildYtDlpUserAgentArgs(env)).toEqual(["--user-agent", "MyUA"]);
  });
});
