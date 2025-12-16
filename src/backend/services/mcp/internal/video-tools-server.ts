import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path, { extname, join } from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { MicrosoftAuthService } from "../../auth/microsoft-auth.js";
import { FFmpegService } from "../../ffmpeg/ffmpeg-service.js";
import { UploadScreenshotToPortal } from "../../portal/actions.js";
import { LLMClientProvider } from "../llm-client-provider.js";
import type { MCPServerConfig } from "../types.js";
import type { InternalMcpServerRegistration } from "./internal-server-types.js";

const captureInputShape = {
  videoPath: z.string().min(1).describe("Absolute path to the source video"),
  timestamp: z
    .string()
    .min(1)
    .describe(
      "Timestamp to capture - accepts seconds as string (e.g. '30', '90.5') or HH:MM:SS.mmm format",
    ),
  outputPath: z.string().optional().describe("Optional output path for the screenshot"),
};
const captureInputSchema = z.object(captureInputShape);

const describeInputShape = {
  imagePath: z.string().min(1).describe("Absolute path to the screenshot/image"),
  prompt: z.string().optional().describe("Optional custom prompt for the vision model"),
};
const describeInputSchema = z.object(describeInputShape);

const uploadScreenshotInputShape = {
  screenshotPath: z
    .string()
    .min(1)
    .describe("Absolute path to the screenshot/image file to upload"),
};
const uploadScreenshotInputSchema = z.object(uploadScreenshotInputShape);

type CaptureInput = z.infer<typeof captureInputSchema>;
type DescribeInput = z.infer<typeof describeInputSchema>;
type UploadScreenshotInput = z.infer<typeof uploadScreenshotInputSchema>;

export async function createInternalVideoToolsServer(): Promise<InternalMcpServerRegistration> {
  const ffmpegService = FFmpegService.getInstance();
  const llmClientProvider = await LLMClientProvider.getInstanceAsync();
  const serverId = `yak-video-tools-${randomUUID()}`;

  const mcpServer = new McpServer({
    name: "YakShaver Video Tools",
    version: "1.0.0",
  });

  mcpServer.registerTool(
    "capture_video_frame",
    {
      description:
        "Capture a PNG screenshot from a local video at the specified timestamp. Returns the local file path of the captured screenshot. Use upload_screenshot tool to upload it and get a public URL.",
      inputSchema: captureInputShape,
    },
    async (input: CaptureInput) => {
      validatePath(input.videoPath);
      const { videoPath, timestamp, outputPath } = captureInputSchema.parse(input);
      await ensureFileExists(videoPath, "video");

      const resolvedOutput =
        outputPath?.trim() ||
        join(tmpdir(), `yakshaver-frame-${Date.now()}-${randomUUID().slice(0, 8)}.png`);
      validatePath(resolvedOutput);
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
    "upload_screenshot",
    {
      description:
        "Upload a screenshot/image to the portal and get a public URL. Requires user to be authenticated with Microsoft. Use this URL when creating issues to include visual context.",
      inputSchema: uploadScreenshotInputShape,
    },
    async (input: UploadScreenshotInput) => {
      validatePath(input.screenshotPath);
      const { screenshotPath } = uploadScreenshotInputSchema.parse(input);
      await ensureFileExists(screenshotPath, "screenshot");

      const msAuth = MicrosoftAuthService.getInstance();
      if (!(await msAuth.isAuthenticated())) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error:
                  "User is not authenticated with Microsoft. Screenshot upload requires authentication.",
              }),
            },
          ],
        };
      }

      const uploadResult = await UploadScreenshotToPortal(screenshotPath);
      if (uploadResult.success) {
        console.log("[upload_screenshot] Screenshot uploaded to portal:", uploadResult.url);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                screenshotUrl: uploadResult.url,
              }),
            },
          ],
        };
      }

      console.warn("[upload_screenshot] Failed to upload screenshot:", uploadResult.error);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: uploadResult.error,
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
    async (input: DescribeInput) => {
      validatePath(input.imagePath);
      const { imagePath, prompt } = describeInputSchema.parse(input);
      await ensureFileExists(imagePath, "image");
      const imageBuffer = await fs.readFile(imagePath);
      const mimeType = detectImageMimeType(imagePath);
      const dataUri = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
      if (!llmClientProvider) {
        throw new Error("[describe_image]: LLM client not initialized");
      }
      const description = await llmClientProvider.generateText([
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
    name: "Yak_Video_Tools",
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

function parseTimestamp(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Timestamp cannot be empty");
  }

  // Check if it's a plain number (seconds)
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number.parseFloat(trimmed);
  }

  // Parse HH:MM:SS.mmm format
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

function validatePath(filePath: string, allowedDirs: string[] = [tmpdir()]): void {
  const normalized = path.resolve(filePath);
  const isWindows = process.platform === "win32";

  const expandedAllowedDirs = [...allowedDirs];

  if (isWindows) {
    expandedAllowedDirs.push(tmpdir());
    expandedAllowedDirs.push("C:\\Windows\\Temp");
  } else {
    expandedAllowedDirs.push("/tmp", "/private/tmp", "/private/var/folders");
  }

  const isAllowed = expandedAllowedDirs.some((dir) => {
    const resolvedDir = path.resolve(dir);

    if (isWindows) {
      return normalized.toLowerCase().startsWith(resolvedDir.toLowerCase());
    }

    return (
      normalized.startsWith(resolvedDir) ||
      normalized.startsWith(`/private${resolvedDir}`) ||
      normalized.replace("/private", "").startsWith(resolvedDir)
    );
  });

  if (!isAllowed) {
    throw new Error(`Access denied: Path must be within allowed directories`);
  }
}
