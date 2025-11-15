import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FFmpegService } from "../../ffmpeg/ffmpeg-service.js";
import { OpenAIService } from "../../openai/openai-service.js";
import type { MCPServerConfig } from "../types.js";
import { InternalMcpTransportRegistry } from "./internal-mcp-transport-registry.js";

const activeServers: McpServer[] = [];

const captureInputShape = {
  videoPath: z.string().min(1).describe("Absolute path to the source video"),
  timestamp: z
    .union([z.number().nonnegative(), z.string().min(1)])
    .describe("Timestamp to capture (seconds or HH:MM:SS.mmm)"),
  outputPath: z.string().optional().describe("Optional output path for the screenshot"),
};
const captureInputSchema = z.object(captureInputShape);

const describeInputShape = {
  imagePath: z.string().min(1).describe("Absolute path to the screenshot/image"),
  prompt: z.string().optional().describe("Optional custom prompt for the vision model"),
};
const describeInputSchema = z.object(describeInputShape);

export async function createInternalVideoToolsServer(): Promise<MCPServerConfig> {
  const ffmpegService = FFmpegService.getInstance();
  const openAIService = OpenAIService.getInstance();
  const serverId = `yak-video-tools-${randomUUID()}`;

  const mcpServer = new McpServer({
    name: "YakShaver Video Tools",
    version: "1.0.0",
    instructions:
      "Built-in YakShaver utilities for extracting frames from videos and describing screenshots.",
  });

  mcpServer.registerTool(
    "capture_video_frame",
    {
      description: "Capture a PNG screenshot from a local video at the specified timestamp.",
      inputSchema: captureInputShape,
    },
    async (input) => {
      const { videoPath, timestamp, outputPath } = captureInputSchema.parse(input);
      await ensureFileExists(videoPath, "video");

      const resolvedOutput =
        outputPath?.trim() ||
        join(tmpdir(), `yakshaver-frame-${Date.now()}-${randomUUID().slice(0, 8)}.png`);
      const timestampSeconds = parseTimestamp(timestamp);

      await ffmpegService.captureFrameAtTimestamp(videoPath, resolvedOutput, timestampSeconds);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              screenshotPath: resolvedOutput,
              timestampSeconds,
            }),
          },
        ],
      };
    },
  );

  mcpServer.registerTool(
    "describe_image",
    {
      description:
        "Use the configured multimodal LLM to describe the contents of a screenshot or image.",
      inputSchema: describeInputShape,
    },
    async (input) => {
      const { imagePath, prompt } = describeInputSchema.parse(input);
      await ensureFileExists(imagePath, "image");
      const description = await openAIService.describeImage(
        imagePath,
        prompt ?? "Provide a concise description of this screenshot.",
      );

      return {
        content: [
          {
            type: "text",
            text: description || "No description returned by the model.",
          },
        ],
      };
    },
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  activeServers.push(mcpServer);

  InternalMcpTransportRegistry.registerClientTransport(serverId, clientTransport);

  return {
    name: "Yak Video Tools",
    description: "Built-in video frame capture and screenshot interpretation tools.",
    transport: "inMemory",
    inMemoryServerId: serverId,
    version: "1.0.0",
    enabled: true,
    builtin: true,
  };
}

async function ensureFileExists(filePath: string, label: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`The specified ${label} file does not exist: ${filePath}`);
  }
}

function parseTimestamp(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Timestamp cannot be empty");
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number.parseFloat(trimmed);
  }

  const parts = trimmed.split(":").map((part) => Number.parseFloat(part));
  if (parts.some((part) => Number.isNaN(part))) {
    throw new Error(`Invalid timestamp format: ${value}`);
  }

  while (parts.length < 3) {
    parts.unshift(0);
  }

  const [hours, minutes, seconds] = parts;
  return hours * 3600 + minutes * 60 + seconds;
}

