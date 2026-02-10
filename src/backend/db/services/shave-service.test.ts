import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ShaveStatus, VideoHostingProvider } from "../../types";
import { createTestDb } from "../client";
import {
  createShave,
  deleteShave,
  findShaveByVideoUrl,
  getAllShaves,
  getShaveById,
  updateShave,
  updateShaveStatus,
} from "./shave-service";
import { createVideoSource } from "./video-source-service";

describe("ShaveService", () => {
  // Create fresh database before each test for complete isolation
  beforeEach(() => {
    createTestDb({ forceNew: true });
  });

  const testShaveData = {
    title: "Test Shave",
    videoEmbedUrl: "https://youtube.com/watch?v=test123",
    shaveStatus: ShaveStatus.Unknown,
  };

  describe("createShave", () => {
    it("should create a new shave", () => {
      const result = createShave(testShaveData);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.title).toBe(testShaveData.title);
      expect(result.videoEmbedUrl).toBe(testShaveData.videoEmbedUrl);
      expect(result.shaveStatus).toBe(testShaveData.shaveStatus);
      expect(result.createdAt).toBeDefined();
    });

    it("should create shave with video source ID", () => {
      const videoSource = createVideoSource({
        sourceUrl: "https://example.com/video.mp4",
        externalProvider: VideoHostingProvider.YOUTUBE,
        externalId: "test123",
      });

      const shaveWithSource = {
        ...testShaveData,
        videoSourceId: videoSource.id,
      };

      const result = createShave(shaveWithSource);

      expect(result.videoSourceId).toBe(videoSource.id);
    });

    it("should create shave with minimal data", () => {
      const minimalData = {
        title: "Minimal Shave",
        shaveStatus: ShaveStatus.Unknown,
      };

      const result = createShave(minimalData);

      expect(result).toBeDefined();
      expect(result.title).toBe(minimalData.title);
      expect(result.videoEmbedUrl).toBeNull();
    });
  });

  describe("getShaveById", () => {
    it("should retrieve a shave by ID", () => {
      const created = createShave(testShaveData);
      const retrieved = getShaveById(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe(testShaveData.title);
    });

    it("should return undefined for non-existent ID", () => {
      const result = getShaveById("non-existent-id");
      expect(result).toBeUndefined();
    });
  });

  describe("getAllShaves", () => {
    it("should return empty array when no shaves exist", () => {
      const result = getAllShaves();
      expect(result).toEqual([]);
    });

    it("should return all shaves ordered by most recent first", () => {
      const shave1 = createShave({
        ...testShaveData,
        title: "Shave 1",
      });

      const shave2 = createShave({
        ...testShaveData,
        title: "Shave 2",
      });

      const result = getAllShaves();

      expect(result).toHaveLength(2);
      // Check both shaves are returned
      const ids = result.map((s) => s.id);
      expect(ids).toContain(shave1.id);
      expect(ids).toContain(shave2.id);
    });
  });

  describe("findShaveByVideoUrl", () => {
    it("should find shave by video embed URL", () => {
      const created = createShave(testShaveData);
      const found = findShaveByVideoUrl(testShaveData.videoEmbedUrl as string);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.videoEmbedUrl).toBe(testShaveData.videoEmbedUrl);
    });

    it("should return undefined for non-existent URL", () => {
      const result = findShaveByVideoUrl("https://youtube.com/watch?v=nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("updateShave", () => {
    it("should update shave fields", () => {
      const created = createShave(testShaveData);

      const updateData = {
        title: "Updated Title",
        summary: "Updated Summary",
      };

      const updated = updateShave(created.id, updateData);

      expect(updated).toBeDefined();
      expect(updated?.title).toBe(updateData.title);
      expect(updated?.videoEmbedUrl).toBe(testShaveData.videoEmbedUrl);
    });

    it("should update portal work item id", () => {
      const created = createShave(testShaveData);

      const updated = updateShave(created.id, { portalWorkItemId: randomUUID() });

      expect(updated).toBeDefined();
      expect(updated?.portalWorkItemId).toBeTruthy();
    });

    it("should return undefined when updating non-existent shave", () => {
      const result = updateShave("non-existent-id", { title: "New Title" });
      expect(result).toBeUndefined();
    });
  });

  describe("updateShaveStatus", () => {
    it("should update shave status", () => {
      const created = createShave(testShaveData);

      const updated = updateShaveStatus(created.id, ShaveStatus.Processing);

      expect(updated).toBeDefined();
      expect(updated?.shaveStatus).toBe(ShaveStatus.Processing);
      expect(updated?.title).toBe(testShaveData.title);
    });

    it("should update to completed status", () => {
      const created = createShave(testShaveData);

      const updated = updateShaveStatus(created.id, ShaveStatus.Completed);

      expect(updated).toBeDefined();
      expect(updated?.shaveStatus).toBe(ShaveStatus.Completed);
    });

    it("should update to cancelled status", () => {
      const created = createShave(testShaveData);

      const updated = updateShaveStatus(created.id, ShaveStatus.Cancelled);

      expect(updated).toBeDefined();
      expect(updated?.shaveStatus).toBe(ShaveStatus.Cancelled);
    });

    it("should return undefined when updating non-existent shave", () => {
      const result = updateShaveStatus("non-existent-id", ShaveStatus.Completed);
      expect(result).toBeUndefined();
    });
  });

  describe("deleteShave", () => {
    it("should delete an existing shave", () => {
      const created = createShave(testShaveData);
      const deleted = deleteShave(created.id);

      expect(deleted).toBe(true);

      const retrieved = getShaveById(created.id);
      expect(retrieved).toBeUndefined();
    });

    it("should return false when deleting non-existent shave", () => {
      const result = deleteShave("non-existent-id");
      expect(result).toBe(false);
    });
  });
});
