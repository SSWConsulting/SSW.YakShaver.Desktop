import { beforeEach, describe, expect, it } from "vitest";
import { VideoHostingProvider } from "../../types";
import { createTestDb } from "../client";
import {
  createVideoFile,
  deleteVideoFile,
  findVideoFileByName,
  getVideoFileById,
  getVideoFilesByVideoSourceId,
  markVideoFileAsDeleted,
  updateVideoFile,
} from "./video-files-service";
import { createVideoSource } from "./video-source-service";

describe("VideoFilesService", () => {
  // Create fresh database before each test for complete isolation
  beforeEach(() => {
    createTestDb({ forceNew: true });
  });

  const setupVideoSource = () => {
    const videoSource = createVideoSource({
      sourceUrl: "https://example.com/video.mp4",
      externalProvider: VideoHostingProvider.YOUTUBE,
      externalId: "test123",
    });
    return videoSource.id;
  };

  describe("createVideoFile", () => {
    it("should create a new video file", () => {
      const testVideoSourceId = setupVideoSource();

      const testVideoFile = {
        fileName: "test-video.mp4",
        localPath: "/path/to/test-video.mp4",
        videoSourceId: testVideoSourceId,
      };

      const result = createVideoFile(testVideoFile);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.fileName).toBe(testVideoFile.fileName);
      expect(result.localPath).toBe(testVideoFile.localPath);
      expect(result.videoSourceId).toBe(testVideoSourceId);
      expect(result.isDeleted).toBe(false);
      expect(result.deletedAt).toBeNull();
      expect(result.createdAt).toBeDefined();
    });

    it("should create video file with minimal data", () => {
      const minimalData = {
        fileName: "minimal.mp4",
        localPath: "/path/to/minimal.mp4",
      };

      const result = createVideoFile(minimalData);

      expect(result).toBeDefined();
      expect(result.fileName).toBe(minimalData.fileName);
      expect(result.localPath).toBe(minimalData.localPath);
      expect(result.videoSourceId).toBeNull();
    });
  });

  describe("getVideoFileById", () => {
    it("should retrieve a video file by ID", () => {
      const testVideoSourceId = setupVideoSource();

      const created = createVideoFile({
        fileName: "test.mp4",
        localPath: "/path/to/test.mp4",
        videoSourceId: testVideoSourceId,
      });

      const retrieved = getVideoFileById(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.fileName).toBe("test.mp4");
    });

    it("should return undefined for non-existent ID", () => {
      const result = getVideoFileById("non-existent-id");
      expect(result).toBeUndefined();
    });
  });

  describe("findVideoFileByName", () => {
    it("should find video file by name", () => {
      const testVideoSourceId = setupVideoSource();

      const created = createVideoFile({
        fileName: "unique-name.mp4",
        localPath: "/path/to/unique.mp4",
        videoSourceId: testVideoSourceId,
      });

      const found = findVideoFileByName("unique-name.mp4");

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.fileName).toBe("unique-name.mp4");
    });

    it("should return undefined for non-existent file name", () => {
      const result = findVideoFileByName("nonexistent.mp4");
      expect(result).toBeUndefined();
    });
  });

  describe("getVideoFilesByVideoSourceId", () => {
    it("should return all video files for a video source", () => {
      const testVideoSourceId = setupVideoSource();

      createVideoFile({
        fileName: "file1.mp4",
        localPath: "/path/to/file1.mp4",
        videoSourceId: testVideoSourceId,
      });

      createVideoFile({
        fileName: "file2.mp4",
        localPath: "/path/to/file2.mp4",
        videoSourceId: testVideoSourceId,
      });

      const result = getVideoFilesByVideoSourceId(testVideoSourceId);

      expect(result).toHaveLength(2);
      expect(result[0].videoSourceId).toBe(testVideoSourceId);
      expect(result[1].videoSourceId).toBe(testVideoSourceId);
    });

    it("should return empty array for video source with no files", () => {
      const testVideoSourceId = setupVideoSource();
      const result = getVideoFilesByVideoSourceId(testVideoSourceId);
      expect(result).toEqual([]);
    });

    it("should exclude soft-deleted files", () => {
      const testVideoSourceId = setupVideoSource();

      const active = createVideoFile({
        fileName: "active.mp4",
        localPath: "/path/to/active.mp4",
        videoSourceId: testVideoSourceId,
      });

      const deleted = createVideoFile({
        fileName: "deleted.mp4",
        localPath: "/path/to/deleted.mp4",
        videoSourceId: testVideoSourceId,
      });

      markVideoFileAsDeleted(deleted.id);

      const result = getVideoFilesByVideoSourceId(testVideoSourceId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(active.id);
    });
  });

  describe("markVideoFileAsDeleted", () => {
    it("should soft delete a video file", () => {
      const testVideoSourceId = setupVideoSource();

      const created = createVideoFile({
        fileName: "to-delete.mp4",
        localPath: "/path/to/delete.mp4",
        videoSourceId: testVideoSourceId,
      });

      expect(created.isDeleted).toBe(false);
      expect(created.deletedAt).toBeNull();

      const deleted = markVideoFileAsDeleted(created.id);

      expect(deleted).toBeDefined();
      expect(deleted?.isDeleted).toBe(true);
      expect(deleted?.deletedAt).toBeDefined();
      expect(deleted?.deletedAt).not.toBeNull();

      // Verify it still exists in database
      const retrieved = getVideoFileById(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.isDeleted).toBe(true);
    });

    it("should return undefined when marking non-existent file as deleted", () => {
      const result = markVideoFileAsDeleted("non-existent-id");
      expect(result).toBeUndefined();
    });

    it("should be idempotent (can mark already deleted file)", () => {
      const testVideoSourceId = setupVideoSource();

      const created = createVideoFile({
        fileName: "idempotent.mp4",
        localPath: "/path/to/idempotent.mp4",
        videoSourceId: testVideoSourceId,
      });

      // First deletion
      const firstDelete = markVideoFileAsDeleted(created.id);
      expect(firstDelete?.isDeleted).toBe(true);

      // Second deletion - should still work
      const secondDelete = markVideoFileAsDeleted(created.id);
      expect(secondDelete?.isDeleted).toBe(true);
      expect(secondDelete?.deletedAt).toBeDefined();
    });
  });

  describe("updateVideoFile", () => {
    it("should update video file fields", () => {
      const testVideoSourceId = setupVideoSource();

      const created = createVideoFile({
        fileName: "original.mp4",
        localPath: "/path/to/original.mp4",
        videoSourceId: testVideoSourceId,
      });

      const updateData = {
        fileName: "updated.mp4",
      };

      const updated = updateVideoFile(created.id, updateData);

      expect(updated).toBeDefined();
      expect(updated?.fileName).toBe(updateData.fileName);
      expect(updated?.localPath).toBe("/path/to/original.mp4");
    });

    it("should return undefined when updating non-existent video file", () => {
      const result = updateVideoFile("non-existent-id", { fileName: "test.mp4" });
      expect(result).toBeUndefined();
    });
  });

  describe("deleteVideoFile", () => {
    it("should hard delete a video file", () => {
      const testVideoSourceId = setupVideoSource();

      const created = createVideoFile({
        fileName: "to-hard-delete.mp4",
        localPath: "/path/to/hard-delete.mp4",
        videoSourceId: testVideoSourceId,
      });

      const deleted = deleteVideoFile(created.id);

      expect(deleted).toBe(true);

      // Verify it no longer exists
      const retrieved = getVideoFileById(created.id);
      expect(retrieved).toBeUndefined();
    });

    it("should return false when deleting non-existent video file", () => {
      const result = deleteVideoFile("non-existent-id");
      expect(result).toBe(false);
    });
  });
});
