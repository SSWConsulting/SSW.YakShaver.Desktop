import { beforeEach, describe, expect, it } from "vitest";
import { VideoHostingProvider } from "../../types";
import { createTestDb } from "../client";
import {
  createVideoSource,
  deleteVideoSource,
  findVideoSourceByUrl,
  getAllVideoSources,
  getVideoSourceById,
  updateVideoSource,
} from "./video-source-service";

describe("VideoSourceService", () => {
  // Create fresh database before each test for complete isolation
  beforeEach(() => {
    createTestDb({ forceNew: true });
  });

  const testVideoSource = {
    sourceUrl: "https://example.com/video1.mp4",
    externalProvider: VideoHostingProvider.YOUTUBE,
    externalId: "test123",
    title: "Test Video",
    description: "Test Description",
  };

  describe("createVideoSource", () => {
    it("should create a new video source", () => {
      const result = createVideoSource(testVideoSource);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.sourceUrl).toBe(testVideoSource.sourceUrl);
      expect(result.externalProvider).toBe(testVideoSource.externalProvider);
      expect(result.externalId).toBe(testVideoSource.externalId);
      expect(result.title).toBe(testVideoSource.title);
      expect(result.description).toBe(testVideoSource.description);
      expect(result.createdAt).toBeDefined();
    });

    it("should create video source with minimal data", () => {
      const minimalData = {
        sourceUrl: "https://example.com/video2.mp4",
        externalProvider: VideoHostingProvider.YOUTUBE,
        externalId: "test456",
      };

      const result = createVideoSource(minimalData);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.sourceUrl).toBe(minimalData.sourceUrl);
      expect(result.title).toBeNull();
      expect(result.description).toBeNull();
    });
  });

  describe("getVideoSourceById", () => {
    it("should retrieve a video source by ID", () => {
      const created = createVideoSource(testVideoSource);
      const retrieved = getVideoSourceById(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.sourceUrl).toBe(testVideoSource.sourceUrl);
    });

    it("should return undefined for non-existent ID", () => {
      const result = getVideoSourceById("non-existent-id");
      expect(result).toBeUndefined();
    });
  });

  describe("getAllVideoSources", () => {
    it("should return empty array when no video sources exist", () => {
      const result = getAllVideoSources();
      expect(result).toEqual([]);
    });

    it("should return all video sources ordered by most recent first", () => {
      const source1 = createVideoSource({
        ...testVideoSource,
        sourceUrl: "https://example.com/video1.mp4",
      });

      const source2 = createVideoSource({
        ...testVideoSource,
        sourceUrl: "https://example.com/video2.mp4",
        externalId: "test456",
      });

      const result = getAllVideoSources();

      expect(result).toHaveLength(2);
      // Check both sources are returned
      const ids = result.map((s) => s.id);
      expect(ids).toContain(source1.id);
      expect(ids).toContain(source2.id);
    });
  });

  describe("findVideoSourceByUrl", () => {
    it("should find video source by URL", () => {
      const created = createVideoSource(testVideoSource);
      const found = findVideoSourceByUrl(testVideoSource.sourceUrl);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.sourceUrl).toBe(testVideoSource.sourceUrl);
    });

    it("should return undefined for non-existent URL", () => {
      const result = findVideoSourceByUrl("https://example.com/nonexistent.mp4");
      expect(result).toBeUndefined();
    });
  });

  describe("updateVideoSource", () => {
    it("should update video source fields", () => {
      const created = createVideoSource(testVideoSource);

      const updateData = {
        title: "Updated Title",
        description: "Updated Description",
      };

      const updated = updateVideoSource(created.id, updateData);

      expect(updated).toBeDefined();
      expect(updated?.title).toBe(updateData.title);
      expect(updated?.description).toBe(updateData.description);
      expect(updated?.sourceUrl).toBe(testVideoSource.sourceUrl);
    });

    it("should return undefined when updating non-existent video source", () => {
      const result = updateVideoSource("non-existent-id", { title: "New Title" });
      expect(result).toBeUndefined();
    });
  });

  describe("deleteVideoSource", () => {
    it("should delete an existing video source", () => {
      const created = createVideoSource(testVideoSource);
      const deleted = deleteVideoSource(created.id);

      expect(deleted).toBe(true);

      const retrieved = getVideoSourceById(created.id);
      expect(retrieved).toBeUndefined();
    });

    it("should return false when deleting non-existent video source", () => {
      const result = deleteVideoSource("non-existent-id");
      expect(result).toBe(false);
    });
  });
});
