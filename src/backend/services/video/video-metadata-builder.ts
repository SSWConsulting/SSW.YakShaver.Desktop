import type { TranscriptSegment } from "@shared/types/transcript.js";
import { z } from "zod";
import { METADATA_SYSTEM_PROMPT } from "../../constants/prompts.js";
import type { YouTubeSnippetUpdate } from "../auth/types.js";
import { LLMClientProvider } from "../mcp/llm-client-provider.js";

const URL_REGEX_GLOBAL = /https?:\/\/[^\s)]+/gi;

const LinkCandidateSchema = z.object({
  label: z.string(),
  url: z.url(),
});

type LinkCandidate = z.infer<typeof LinkCandidateSchema>;

export const ChapterCandidateSchema = z.object({
  label: z.string(),
  timestamp: z.string(),
});

type ChapterCandidate = z.infer<typeof ChapterCandidateSchema>;

export interface MetadataBuilderInput {
  transcript: TranscriptSegment[];
  intermediateOutput: string;
  executionHistory: string;
  finalResult?: string | null;
}

export const MetadataModelResponseSchema = z.object({
  title: z.string().max(100).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  chapters: z.array(ChapterCandidateSchema).optional(),
});

type MetadataModelResponse = z.infer<typeof MetadataModelResponseSchema>;

export interface MetadataBuilderResult {
  snippet: YouTubeSnippetUpdate;
  metadata: Required<MetadataModelResponse>;
}

const DEFAULT_TAGS = ["yakshaver", "automation", "workflow"];
const MIN_CHAPTER_GAP_SECONDS = 5;

export class VideoMetadataBuilder {
  async build(input: MetadataBuilderInput): Promise<MetadataBuilderResult> {
    const transcriptForPrompt = buildTranscriptExcerpt(input.transcript);
    const executionHistorySnippet = truncateText(input.executionHistory, 6000);

    const fallbackLinks = dedupeLinks([
      ...extractLinksFromText(input.intermediateOutput),
      ...extractLinksFromText(input.finalResult ?? ""),
      ...extractLinksFromText(executionHistorySnippet),
      ...extractLinksFromStructuredData(input.intermediateOutput),
      ...extractLinksFromStructuredData(input.finalResult ?? ""),
      ...extractLinksFromStructuredData(executionHistorySnippet),
    ]);

    const promptPayload = [
      "Generate the JSON object based on the following information:",
      "### Execution History",
      executionHistorySnippet || "No execution history available.",
      "",
      "### Transcript (timestamp + text)",
      transcriptForPrompt || "No transcript available.",
      "",
      "### Final Result JSON (if available)",
      input.finalResult ?? "No final result provided.",
      "",
      "### Link Candidates (use entire URLs exactly as provided)",
      fallbackLinks.length
        ? fallbackLinks.map((link) => `- ${link.label}: ${link.url}`).join("\n")
        : "None",
    ].join("\n");

    const llmClientProvider = await LLMClientProvider.getInstanceAsync();
    if (!llmClientProvider) {
      throw new Error("LLM Client Provider is not initialized");
    }

    const response = await llmClientProvider.generateJson(promptPayload, METADATA_SYSTEM_PROMPT);

    const parsedResponse = safeJsonParse<MetadataModelResponse>(response) || {};

    const metadata = normalizeModelResponse(
      parsedResponse,
      fallbackLinks,
      input.transcript,
      executionHistorySnippet,
    );
    const snippet: YouTubeSnippetUpdate = {
      title: metadata.title,
      description: appendChapters(metadata.description, metadata.chapters),
      tags: metadata.tags.slice(0, 10),
      categoryId: "28", // Science & Technology
    };

    return { snippet, metadata };
  }
}

function timestampToSeconds(timestamp: string): number {
  if (!timestamp) return 0;
  const sanitized = timestamp.replace(",", ".");
  const parts = sanitized.split(":").map((part) => Number.parseFloat(part));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  while (parts.length < 3) {
    parts.unshift(0);
  }
  const [hours, minutes, seconds] = parts;
  return hours * 3600 + minutes * 60 + seconds;
}

function secondsToTimestamp(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(
    2,
    "0",
  )}`;
}

function buildTranscriptExcerpt(segments: TranscriptSegment[], limit = 60): string {
  if (!segments.length) return "";
  return segments
    .slice(0, limit)
    .map(
      (segment) =>
        `${secondsToTimestamp(segment.startSecond)}-${secondsToTimestamp(segment.endSecond)} ${segment.text}`,
    )
    .join("\n");
}

function extractLinksFromText(text: string): LinkCandidate[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX_GLOBAL) || [];
  return matches.map((url) => ({
    url: url.replace(/[.,;:!?]+$/, ""), // Strip trailing punctuation,
    label: deriveLabelFromUrl(url),
  }));
}

function extractLinksFromStructuredData(raw: string): LinkCandidate[] {
  if (!raw) return [];
  const candidates: LinkCandidate[] = [];
  const parsed = safeJsonParse<unknown>(raw);
  if (!parsed) return candidates;

  const walk = (value: unknown, path: string[]) => {
    if (typeof value === "string") {
      const urls = value.match(URL_REGEX_GLOBAL);
      if (urls) {
        for (const url of urls) {
          candidates.push({
            url,
            label: path[path.length - 1] || deriveLabelFromUrl(url),
          });
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, String(index)]));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, val]) => walk(val, [...path, key]));
    }
  };

  walk(parsed, []);
  return candidates;
}

function deriveLabelFromUrl(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname.includes("github.com")) {
      const parts = pathname.split("/").filter(Boolean);
      const issueNumber = parts[3];
      if (parts[2] === "issues" && issueNumber) {
        return `Issue #${issueNumber}`;
      }
    }
    return hostname;
  } catch {
    return "Link";
  }
}

function dedupeLinks(links: LinkCandidate[]): LinkCandidate[] {
  const seen = new Set<string>();
  const result: LinkCandidate[] = [];
  for (const link of links) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    result.push(link);
  }
  return result;
}

function normalizeModelResponse(
  response: MetadataModelResponse,
  fallbackLinks: LinkCandidate[],
  segments: TranscriptSegment[],
  executionHistory: string,
): Required<MetadataModelResponse> {
  const title = (response.title || deriveFallbackTitle(fallbackLinks)).slice(0, 90);
  const description =
    response.description || deriveFallbackDescription(executionHistory, fallbackLinks);
  const tags = dedupeTags([...(response.tags ?? []), ...DEFAULT_TAGS]);
  const chapters = buildChapters(response.chapters ?? [], segments);

  return {
    title,
    description,
    tags,
    chapters,
  };
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const normalized = tag.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function deriveFallbackTitle(links: LinkCandidate[]): string {
  if (links.length) {
    const first = links[0];
    if (/issue/i.test(first.label)) {
      return `${first.label} walkthrough`;
    }
  }
  return "YakShaver Project Update";
}

function deriveFallbackDescription(executionHistory: string, links: LinkCandidate[]): string {
  const lines: string[] = [];
  const historySnippet = truncateText(executionHistory, 400);
  if (historySnippet) {
    lines.push("Quick summary:", historySnippet.trim());
  } else {
    lines.push(
      "This YakShaver recording walks through the latest fixes, open issues, and debugging steps.",
    );
  }

  if (links.length) {
    lines.push("", "Resources:");
    for (const link of links) {
      lines.push(`- ${link.label}: ${link.url}`);
    }
  }

  return lines.join("\n").trim();
}

function buildChapters(
  rawChapters: ChapterCandidate[],
  segments: TranscriptSegment[],
): ChapterCandidate[] {
  const normalized: ChapterCandidate[] = [];
  const addChapter = (label: string, seconds: number) => {
    if (!label) return;
    if (!normalized.length && seconds !== 0) {
      normalized.push({ label: "Introduction", timestamp: "00:00" });
    }
    const last = normalized[normalized.length - 1];
    if (last) {
      const lastSeconds = timestampToSeconds(last.timestamp);
      if (seconds - lastSeconds < MIN_CHAPTER_GAP_SECONDS) return;
    }
    normalized.push({
      label: label.trim(),
      timestamp: secondsToTimestamp(seconds),
    });
  };

  addChapter("Overview", 0);

  for (const chapter of rawChapters) {
    if (!chapter?.timestamp || !chapter?.label) continue;
    const seconds = timestampToSeconds(normalizeTimestamp(chapter.timestamp));
    if (Number.isNaN(seconds) || seconds < 0) continue;
    addChapter(chapter.label, seconds);
  }

  if (normalized.length < 2 && segments.length) {
    const midpoint = segments[Math.floor(segments.length / 2)];
    if (midpoint) {
      addChapter("Deep Dive", midpoint.startSecond);
    }
    const last = segments[segments.length - 1];
    if (last) {
      addChapter("Wrap-up", last.startSecond);
    }
  }

  return normalized;
}

function normalizeTimestamp(timestamp: string): string {
  if (/^\d{1,2}:\d{2}$/.test(timestamp)) {
    return `00:${timestamp}`;
  }
  if (/^\d{1,2}:\d{2}:\d{2}(?:\.\d+)?$/.test(timestamp)) {
    const [h, m, s] = timestamp.split(".")[0].split(":");
    return `${h.padStart(2, "0")}:${m.padStart(2, "0")}:${s.padStart(2, "0")}`;
  }
  return "00:00:00";
}

function appendChapters(description: string, chapters: ChapterCandidate[]): string {
  const lines: string[] = [];
  if (description) {
    lines.push(description.trim());
  }

  if (chapters.length) {
    lines.push("", "Chapters:");
    chapters.forEach((chapter, i) => {
      const start = chapter.timestamp.replace(/^00:/, "");
      const end = chapters[i + 1]?.timestamp.replace(/^00:/, "");
      const time = end ? `${start}-${end}` : start;
      lines.push(`${time} - ${chapter.label}`);
    });
  }

  return lines.join("\n").trim();
}

function truncateText(text: string | undefined, maxLength: number): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function safeJsonParse<T>(value?: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
