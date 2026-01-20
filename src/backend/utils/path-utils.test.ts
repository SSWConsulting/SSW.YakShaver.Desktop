import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock electron app module
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
}));

describe("path-utils", () => {
  describe("getIconPath", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should return development path when app is not packaged", async () => {
      vi.doMock("electron", () => ({
        app: {
          isPackaged: false,
        },
      }));

      const { getIconPath } = await import("./path-utils");
      const result = getIconPath();

      expect(result).toContain(path.join("src", "ui", "public", "icons", "icon.png"));
      expect(result).not.toContain("resources");
    });

    it("should return packaged path when app is packaged", async () => {
      // Mock process.resourcesPath for packaged app
      const mockResourcesPath = path.join(path.sep, "app", "resources");
      Object.defineProperty(process, "resourcesPath", {
        value: mockResourcesPath,
        configurable: true,
      });

      vi.doMock("electron", () => ({
        app: {
          isPackaged: true,
        },
      }));

      const { getIconPath } = await import("./path-utils");
      const result = getIconPath();
      const expectedPath = path.join(mockResourcesPath, "src", "ui", "public", "icons", "icon.png");

      expect(result).toBe(expectedPath);
    });

    it("should return a path ending with icon.png", async () => {
      vi.doMock("electron", () => ({
        app: {
          isPackaged: false,
        },
      }));

      const { getIconPath } = await import("./path-utils");
      const result = getIconPath();

      expect(path.basename(result)).toBe("icon.png");
    });

    it("should return a path with icons directory", async () => {
      vi.doMock("electron", () => ({
        app: {
          isPackaged: false,
        },
      }));

      const { getIconPath } = await import("./path-utils");
      const result = getIconPath();

      expect(path.dirname(result)).toContain("icons");
    });
  });
});
