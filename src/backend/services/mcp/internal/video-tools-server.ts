import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { z } from "zod";
import { FFmpegService } from "../../ffmpeg/ffmpeg-service.js";
import { LLMClientProvider } from "../llm-client-provider.js";
import type { MCPServerConfig } from "../types.js";
import type { InternalMcpServerRegistration } from "./internal-server-types.js";

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

export async function createInternalVideoToolsServer(): Promise<InternalMcpServerRegistration> {
  const ffmpegService = FFmpegService.getInstance();
  const llmClientProvider = await LLMClientProvider.getInstanceAsync();
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
      console.log("capture_video_frame input:", input);
      const { videoPath, timestamp, outputPath } = captureInputSchema.parse(input);
      await ensureFileExists(videoPath, "video");

      const resolvedOutput =
        outputPath?.trim() ||
        join(tmpdir(), `yakshaver-frame-${Date.now()}-${randomUUID().slice(0, 8)}.png`);
      const timestampSeconds = parseTimestamp(timestamp);

      await ffmpegService.captureNthFrame(videoPath, resolvedOutput, timestampSeconds);

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
      console.log("describe_image input:", input);
      const { imagePath, prompt } = describeInputSchema.parse(input);
      const imageBuffer = await fs.readFile(imagePath);
      const mimeType = detectImageMimeType(imagePath);
      const dataUri = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
      await ensureFileExists(imagePath, "image");
      const description = await llmClientProvider?.generateText([
        {
          role: "user",
          content: [
            { type: "text", text: prompt ?? "Provide a concise description of this screenshot." },
            { type: "image", image: dataUri, mediaType: mimeType },
          ],
        },
      ]);

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

  const config: MCPServerConfig = {
    name: "Yak Video Tools",
    description: "Built-in video frame capture and screenshot interpretation tools.",
    transport: "inMemory",
    inMemoryServerId: serverId,
    builtin: true,
  };

  return { config, clientTransport };
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

  if (parts.length > 3) {
    throw new Error(`Invalid timestamp format: ${value}. Too many parts.`);
  }

  const [hours, minutes, seconds] = parts;
  return hours * 3600 + minutes * 60 + seconds;
}

function detectImageMimeType(imagePath: string): string {
  const ext = extname(imagePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "image/png";
  }
}
