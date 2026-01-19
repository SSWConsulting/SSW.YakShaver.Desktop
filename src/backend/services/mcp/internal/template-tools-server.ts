import { randomUUID } from "node:crypto";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import matter from "gray-matter";
import { z } from "zod/v4";
import { MCPServerManager } from "../mcp-server-manager.js";
import type { MCPServerConfig } from "../types.js";
import type { InternalMcpServerRegistration } from "./internal-server-types.js";

// Input schema for fetching AND parsing in one atomic operation
const fetchAndParseInputShape = {
  owner: z.string().min(1).describe("GitHub repository owner (e.g., 'SSWConsulting')"),
  repo: z.string().min(1).describe("GitHub repository name (e.g., 'SSW.YakShaver.Desktop')"),
  templatePath: z
    .string()
    .min(1)
    .describe(
      "Path to the template file within the repo (e.g., '.github/ISSUE_TEMPLATE/1-bug.md')",
    ),
};
const fetchAndParseInputSchema = z.object(fetchAndParseInputShape);

type FetchAndParseInput = z.infer<typeof fetchAndParseInputSchema>;

const parseInputShape = {
  templateContent: z
    .string()
    .min(1)
    .describe(
      "Raw markdown template content from GitHub - MUST be the exact, unmodified string returned by GitHub__get_file_contents or similar tools. Includes YAML frontmatter (---), markdown headings (###), placeholders ({{ ... }}), and HTML comments. DO NOT modify, reformat, or clean this content before passing it to this tool.",
    ),
};
const parseInputSchema = z.object(parseInputShape);

const templateSectionSchema = z.object({
  heading: z.string(),
  level: z.number(),
  content: z.string(),
  hasPlaceholder: z.boolean().optional(),
  isChecklist: z.boolean().optional(),
  items: z.array(z.string()).optional(),
});

const templateBlockSchema = z.object({
  type: z.enum(["preamble", "section"]),
  rawContent: z.string().optional(),
  heading: z.string().optional(),
  level: z.number().optional(),
  content: z.string().optional(),
  hasPlaceholder: z.boolean().optional(),
  isChecklist: z.boolean().optional(),
  items: z.array(z.string()).optional(),
});

const templateStructureSchema = z
  .object({
    frontmatter: z.record(z.string(), z.unknown()),
    sections: z
      .array(templateSectionSchema)
      .optional()
      .describe("Optional - sections can be reconstructed from blocks if not provided"),
    blocks: z
      .array(templateBlockSchema)
      .optional()
      .describe("Ordered blocks preserving document structure (preamble + sections)."),
    placeholders: z.array(z.string()),
    fixedElements: z.record(z.string(), z.string()),
    preamble: z.string().optional().describe("Content before the first heading"),
  })
  .describe("Parsed template structure");

const templateStructureWithBlocksSchema = templateStructureSchema
  .extend({
    sections: z
      .array(templateSectionSchema)
      .default([])
      .describe(
        "Can be omitted if blocks are provided. The tool will reconstruct sections from blocks.",
      ),
    blocks: z
      .array(templateBlockSchema)
      .min(1)
      .describe(
        "REQUIRED: Ordered blocks preserving document structure (preamble + sections). Use this to get section headings and content.",
      ),
  })
  .describe(
    "Parsed template structure from parse_github_template. Use 'blocks' array which preserves document order.",
  );

const fillInputShape = {
  templateStructure: templateStructureWithBlocksSchema,
  fillData: z
    .object({
      title: z
        .string()
        .describe(
          "The issue title WITHOUT emoji/prefix (e.g., 'App crashes on startup', not '🐛 Bug - App crashes'). The tool adds prefixes from the template automatically.",
        ),
      sections: z
        .record(z.string(), z.string())
        .describe(
          "Map of section heading to content STRING. Keys must match section headings from blocks with type='section'. Each value must be a string. Example: {'Describe the Bug': 'The app crashes...', 'To Reproduce': '1. Open\\n2. Click'}",
        ),
      placeholders: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "Map of placeholder tokens to replacement values. Applied to BOTH preamble and sections. Keys include {{ }}, e.g., {'{{ USER }}': '@john', '{{videoUrl}}': 'https://...'}",
        ),
      preamble: z
        .string()
        .optional()
        .describe(
          "Override for preamble content. If not provided, the original preamble is used with placeholders filled.",
        ),
      additionalLabels: z
        .array(z.string())
        .optional()
        .describe("Additional labels to add (template labels are automatically included)"),
    })
    .describe("Data to fill into the template"),
};
const fillInputSchema = z.object(fillInputShape);

const validateInputShape = {
  templateStructure: templateStructureSchema,
  filledContent: z
    .object({
      title: z.string(),
      body: z.string(),
      labels: z.array(z.string()),
    })
    .describe("Filled content to validate - the OUTPUT from fill_github_template"),
};
const validateInputSchema = z.object(validateInputShape);

type ParseInput = z.infer<typeof parseInputSchema>;
type FillInput = z.infer<typeof fillInputSchema>;
type ValidateInput = z.infer<typeof validateInputSchema>;

interface TemplateSection {
  heading: string;
  level: number;
  content: string;
  hasPlaceholder?: boolean;
  isChecklist?: boolean;
  items?: string[];
}

// New: Block-based structure that preserves document order
interface TemplateBlock {
  type: "preamble" | "section";
  // For preamble blocks
  rawContent?: string;
  // For section blocks
  heading?: string;
  level?: number;
  content?: string;
  hasPlaceholder?: boolean;
  isChecklist?: boolean;
  items?: string[];
}

interface ParsedTemplateStructure {
  frontmatter: Record<string, unknown>;
  sections?: TemplateSection[]; // Optional - can be reconstructed from blocks
  blocks?: TemplateBlock[]; // Ordered blocks preserving document structure
  placeholders: string[];
  fixedElements: Record<string, string>;
  preamble?: string; // Content before first heading
}

interface FilledTemplate {
  title: string;
  body: string;
  labels: string[];
  validationErrors: string[];
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  missingPlaceholders: string[];
  missingSections: string[];
}

export async function createInternalTemplateToolsServer(): Promise<InternalMcpServerRegistration> {
  const serverId = `yak-template-tools-${randomUUID()}`;

  const mcpServer = new McpServer({
    name: "YakShaver Template Tools",
    version: "1.0.0",
  });

  mcpServer.registerTool(
    "parse_github_template",
    {
      description:
        "Parse a GitHub issue template to extract its structure, placeholders, sections, and metadata. CRITICAL: Pass the EXACT, UNMODIFIED content from GitHub (with ### headings, {{ placeholders }}, HTML comments, etc.). Do NOT reformat or summarize the template before calling this tool. This tool analyzes the template's YAML frontmatter and markdown content to provide a structured representation that can be used for validation and filling.",
      inputSchema: parseInputShape,
    },
    async (input: ParseInput) => {
      const { templateContent } = parseInputSchema.parse(input);
      console.log(`[MCP] parse_github_template called with ${templateContent.length} chars`);

      try {
        const parsed = parseTemplateStructure(templateContent);
        console.log(
          `[MCP] parse_github_template success: ${parsed.blocks?.length || 0} blocks, ${parsed.placeholders.length} placeholders`,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  frontmatter: parsed.frontmatter,
                  blocks: parsed.blocks,
                  placeholders: parsed.placeholders,
                  preamble: parsed.preamble,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        console.error(
          `[MCP] parse_github_template failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw new Error(
          `Failed to parse template: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  mcpServer.registerTool(
    "fill_github_template",
    {
      description:
        "Fill a parsed GitHub template with provided content. Takes the COMPLETE parsed template structure (with all fields: frontmatter, sections, placeholders, fixedElements) and your content data, then reconstructs a properly formatted issue. CRITICAL: Pass the entire templateStructure object from parse_github_template - do not create a partial object or omit fields. The fillData.sections must map section headings to STRING content, and fillData.placeholders (if used) must be at the top level, not nested inside sections.",
      inputSchema: fillInputShape,
    },
    async (input: FillInput) => {
      const { templateStructure, fillData } = fillInputSchema.parse(input);
      console.log(
        `[MCP] fill_github_template called with title: "${fillData.title}" and ${Object.keys(fillData.sections).length} sections`,
      );

      try {
        const filled = fillTemplate(templateStructure, fillData);
        console.log(
          `[MCP] fill_github_template success: title length ${filled.title.length}, body length ${filled.body.length}, ${filled.labels.length} labels`,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(filled, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error(
          `[MCP] fill_github_template failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw new Error(
          `Failed to fill template: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  mcpServer.registerTool(
    "validate_template_completeness",
    {
      description:
        "Validate that filled template content meets all template requirements. This checks for missing sections, unfilled placeholders, and other issues that would result in an incomplete or incorrectly formatted GitHub issue.",
      inputSchema: validateInputShape,
    },
    async (input: ValidateInput) => {
      const { templateStructure, filledContent } = validateInputSchema.parse(input);
      console.log(
        `[MCP] validate_template_completeness called with title: "${filledContent.title}"`,
      );

      try {
        const validation = validateFilledTemplate(templateStructure, filledContent);
        console.log(
          `[MCP] validate_template_completeness result: valid=${validation.isValid}, errors=${validation.errors.length}, warnings=${validation.warnings.length}`,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(validation, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error(
          `[MCP] validate_template_completeness failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw new Error(
          `Failed to validate template: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  // Combined tool: Fetch from GitHub AND parse in one atomic operation
  // This bypasses the LLM completely for data transfer, ensuring template content is never modified
  mcpServer.registerTool(
    "fetch_and_parse_github_template",
    {
      description:
        "PREFERRED: Fetch a GitHub issue template and parse it in one atomic operation. This tool directly calls the GitHub API to get the template, then parses it internally - bypassing any potential text modification. Use this instead of separate GitHub__get_file_contents + parse_github_template calls for reliable template parsing.",
      inputSchema: fetchAndParseInputShape,
    },
    async (input: FetchAndParseInput) => {
      const { owner, repo, templatePath } = fetchAndParseInputSchema.parse(input);
      console.log(`[MCP] fetch_and_parse_github_template called: ${owner}/${repo}/${templatePath}`);

      try {
        // Fetch template directly from GitHub API
        const templateContent = await fetchGitHubFileContent(owner, repo, templatePath);
        console.log(
          `[MCP] fetch_and_parse_github_template fetched ${templateContent.length} chars`,
        );

        // Parse immediately without any LLM intervention
        const parsed = parseTemplateStructure(templateContent);
        console.log(
          `[MCP] fetch_and_parse_github_template parsed: ${parsed.blocks?.length || 0} blocks, ${parsed.placeholders.length} placeholders`,
        );

        // Return simplified output structure (omit duplicate sections array in JSON output)
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  frontmatter: parsed.frontmatter,
                  blocks: parsed.blocks,
                  placeholders: parsed.placeholders,
                  preamble: parsed.preamble,
                  _meta: {
                    source: `${owner}/${repo}/${templatePath}`,
                    fetchedAt: new Date().toISOString(),
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        console.error(
          `[MCP] fetch_and_parse_github_template failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw new Error(
          `Failed to fetch and parse template: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);

  const config: MCPServerConfig = {
    id: serverId,
    name: "YakShaver Template Tools",
    transport: "inMemory",
    inMemoryServerId: serverId,
    builtin: true,
    enabled: true,
  };

  return { config, clientTransport };
}

/**
 * Parse template content to extract structure, placeholders, and metadata
 */
function parseTemplateStructure(templateContent: string): ParsedTemplateStructure {
  console.log(`[parseTemplateStructure] Parsing template with ${templateContent.length} chars`);
  // Parse YAML frontmatter
  const { data: frontmatter, content: markdownBody } = matter(templateContent);

  // Extract placeholders ({{ SOMETHING }})
  const placeholderRegex = /\{\{\s*([^}]+?)\s*\}\}/g;
  const placeholders = new Set<string>();
  let match: RegExpExecArray | null = placeholderRegex.exec(templateContent);
  while (match !== null) {
    placeholders.add(match[0]); // Keep full {{ ... }} format
    match = placeholderRegex.exec(templateContent);
  }

  // Parse into ordered blocks (preserves document structure)
  const blocks: TemplateBlock[] = [];
  const sections: TemplateSection[] = []; // Keep for backward compat
  const lines = markdownBody.split("\n");

  const preambleLines: string[] = [];
  let currentSection: TemplateSection | null = null;
  let sectionContentLines: string[] = [];
  let foundFirstHeading = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // First heading found - save preamble if we haven't yet
      if (!foundFirstHeading) {
        foundFirstHeading = true;
        const preambleContent = preambleLines.join("\n").trim();
        if (preambleContent) {
          blocks.push({
            type: "preamble",
            rawContent: preambleContent,
            hasPlaceholder: /\{\{\s*[^}]+\s*\}\}/.test(preambleContent),
          });
        }
      }

      // Save previous section if exists
      if (currentSection) {
        currentSection.content = sectionContentLines.join("\n").trim();
        currentSection.hasPlaceholder = /\{\{\s*[^}]+\s*\}\}/.test(currentSection.content);
        currentSection.isChecklist = /^[\s]*-\s+\[[\sx]\]/m.test(currentSection.content);
        if (currentSection.isChecklist) {
          const checklistMatches = currentSection.content.matchAll(/^[\s]*-\s+\[[\sx]\]\s*(.+)$/gm);
          currentSection.items = Array.from(checklistMatches, (m) => m[1].trim());
        }
        sections.push(currentSection);
        blocks.push({
          type: "section",
          heading: currentSection.heading,
          level: currentSection.level,
          content: currentSection.content,
          hasPlaceholder: currentSection.hasPlaceholder,
          isChecklist: currentSection.isChecklist,
          items: currentSection.items,
        });
        sectionContentLines = [];
      }

      // Start new section
      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();
      currentSection = {
        heading,
        level,
        content: "",
      };
    } else if (foundFirstHeading && currentSection) {
      // Content under a section
      sectionContentLines.push(line);
    } else if (!foundFirstHeading) {
      // Content before first heading (preamble)
      preambleLines.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    currentSection.content = sectionContentLines.join("\n").trim();
    currentSection.hasPlaceholder = /\{\{\s*[^}]+\s*\}\}/.test(currentSection.content);
    currentSection.isChecklist = /^[\s]*-\s+\[[\sx]\]/m.test(currentSection.content);
    if (currentSection.isChecklist) {
      const checklistMatches = currentSection.content.matchAll(/^[\s]*-\s+\[[\sx]\]\s*(.+)$/gm);
      currentSection.items = Array.from(checklistMatches, (m) => m[1].trim());
    }
    sections.push(currentSection);
    blocks.push({
      type: "section",
      heading: currentSection.heading,
      level: currentSection.level,
      content: currentSection.content,
      hasPlaceholder: currentSection.hasPlaceholder,
      isChecklist: currentSection.isChecklist,
      items: currentSection.items,
    });
  }

  // If no headings found at all, entire body is preamble
  if (!foundFirstHeading && preambleLines.length > 0) {
    const preambleContent = preambleLines.join("\n").trim();
    if (preambleContent) {
      blocks.push({
        type: "preamble",
        rawContent: preambleContent,
        hasPlaceholder: /\{\{\s*[^}]+\s*\}\}/.test(preambleContent),
      });
    }
  }

  // Extract preamble as a single string for convenience
  const preambleBlock = blocks.find((b) => b.type === "preamble");
  const preamble = preambleBlock?.rawContent || "";

  // Extract fixed elements (emoji, prefixes, etc. from title)
  const fixedElements: Record<string, string> = {};
  if (frontmatter.title && typeof frontmatter.title === "string") {
    const titlePlaceholderMatch = frontmatter.title.match(/^(.+?)\{\{.+\}\}(.*)$/);
    if (titlePlaceholderMatch) {
      // Title has placeholder: "🐛 Bug - {{ DESCRIPTION }}"
      fixedElements.titlePrefix = titlePlaceholderMatch[1].trim();
      if (titlePlaceholderMatch[2]) {
        fixedElements.titleSuffix = titlePlaceholderMatch[2].trim();
      }
    } else if (frontmatter.title.trim()) {
      // Title is just a prefix without placeholder: "🐛 "
      // Use the entire title as prefix
      fixedElements.titlePrefix = frontmatter.title;
    }
  }

  // Check for video placeholder
  if (templateContent.includes("{{VIDEO_LINK}}") || templateContent.includes("{{videoUrl}}")) {
    fixedElements.videoPlaceholder = "{{VIDEO_LINK}}";
  }

  console.log(
    `[parseTemplateStructure] Done: ${blocks.length} blocks, ${placeholders.size} placeholders, fixedElements: ${JSON.stringify(fixedElements)}`,
  );
  return {
    frontmatter,
    sections, // Keep internally for fillTemplate fallback logic
    blocks,
    placeholders: Array.from(placeholders),
    fixedElements,
    preamble,
  };
}

/**
 * Fill template with provided data
 * Uses block-based structure to preserve document order
 */
function fillTemplate(
  templateStructure: ParsedTemplateStructure,
  fillData: {
    title: string;
    sections: Record<string, string>;
    placeholders?: Record<string, string>;
    additionalLabels?: string[];
    preamble?: string; // Optional: override preamble content
  },
): FilledTemplate {
  console.log(`[fillTemplate] Filling template with title: "${fillData.title}"`);
  const validationErrors: string[] = [];

  // Construct title with emoji/prefix from template
  let fullTitle = fillData.title;
  if (templateStructure.fixedElements.titlePrefix) {
    fullTitle = `${templateStructure.fixedElements.titlePrefix}${fillData.title}`;
  }
  if (templateStructure.fixedElements.titleSuffix) {
    fullTitle = `${fullTitle}${templateStructure.fixedElements.titleSuffix}`;
  }

  // Build body by iterating through blocks in order (preserves document structure)
  const bodyParts: string[] = [];
  const blocks = templateStructure.blocks || [];

  // If blocks exist, use them (preferred)
  if (blocks.length > 0) {
    // iterate blocks in order
    for (const block of blocks) {
      if (block.type === "preamble") {
        // Use provided preamble override, or fill placeholders in original
        let preambleContent = fillData.preamble ?? block.rawContent ?? "";

        // Replace placeholders in preamble
        if (fillData.placeholders) {
          for (const [placeholder, value] of Object.entries(fillData.placeholders)) {
            preambleContent = preambleContent.replace(
              new RegExp(escapeRegex(placeholder), "g"),
              value,
            );
          }
        }

        // Remove HTML comments from preamble
        preambleContent = preambleContent.replace(/<!--[\s\S]*?-->/g, "").trim();

        if (preambleContent) {
          bodyParts.push(preambleContent);
          bodyParts.push(""); // Empty line after preamble
        }
      } else if (block.type === "section" && block.heading && block.level) {
        // Add section heading
        bodyParts.push(`${"#".repeat(block.level)} ${block.heading}`);

        // Get content for this section
        const sectionContent = fillData.sections[block.heading];

        if (sectionContent !== undefined && sectionContent !== null) {
          // Replace any remaining placeholders in the section content
          let finalContent = sectionContent;
          if (fillData.placeholders) {
            for (const [placeholder, value] of Object.entries(fillData.placeholders)) {
              finalContent = finalContent.replace(new RegExp(escapeRegex(placeholder), "g"), value);
            }
          }
          bodyParts.push(finalContent);
        } else {
          // Section not provided - include template's original content as placeholder
          const cleanContent = (block.content || "").replace(/<!--[\s\S]*?-->/g, "").trim();
          if (cleanContent) {
            bodyParts.push(cleanContent);
          } else {
            bodyParts.push("<!-- TODO: Fill this section -->");
            validationErrors.push(`Section "${block.heading}" was not provided and is empty`);
          }
        }

        bodyParts.push(""); // Empty line between sections
      }
    }
  } else if (templateStructure.sections && templateStructure.sections.length > 0) {
    // Legacy fallback: use sections array if blocks not available
    for (const section of templateStructure.sections) {
      bodyParts.push(`${"#".repeat(section.level)} ${section.heading}`);
      const sectionContent = fillData.sections[section.heading];
      if (sectionContent !== undefined && sectionContent !== null) {
        bodyParts.push(sectionContent);
      } else {
        const cleanContent = section.content.replace(/<!--[\s\S]*?-->/g, "").trim();
        if (cleanContent) {
          bodyParts.push(cleanContent);
        }
      }
      bodyParts.push("");
    }
  }

  // Replace any top-level placeholders that weren't handled
  let body = bodyParts.join("\n").trim();
  if (fillData.placeholders) {
    for (const [placeholder, value] of Object.entries(fillData.placeholders)) {
      body = body.replace(new RegExp(escapeRegex(placeholder), "g"), value);
    }
  }

  // Final cleanup of remaining HTML comments
  body = body.replace(/<!--[\s\S]*?-->/g, "").trim();

  // Collect labels from frontmatter
  const labels: string[] = [];
  if (templateStructure.frontmatter.labels) {
    if (Array.isArray(templateStructure.frontmatter.labels)) {
      labels.push(...(templateStructure.frontmatter.labels as string[]));
    } else if (typeof templateStructure.frontmatter.labels === "string") {
      labels.push(templateStructure.frontmatter.labels);
    }
  }

  // Add additional labels
  if (fillData.additionalLabels) {
    labels.push(...fillData.additionalLabels);
  }

  console.log(
    `[fillTemplate] Done: title="${fullTitle}", body=${body.length} chars, ${labels.length} labels`,
  );
  return {
    title: fullTitle,
    body,
    labels: [...new Set(labels)], // Deduplicate
    validationErrors,
  };
}

/**
 * Validate filled content against template requirements
 */
function validateFilledTemplate(
  templateStructure: ParsedTemplateStructure,
  filledContent: { title: string; body: string; labels: string[] },
): ValidationResult {
  console.log(`[validateFilledTemplate] Validating template with title: "${filledContent.title}"`);
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingPlaceholders: string[] = [];
  const missingSections: string[] = [];

  // Reconstruct sections from blocks if not provided
  const sections =
    templateStructure.sections ||
    (templateStructure.blocks || [])
      .filter((b) => b.type === "section")
      .map((b) => ({
        heading: b.heading || "",
        level: b.level || 3,
        content: b.content || "",
        hasPlaceholder: b.hasPlaceholder,
        isChecklist: b.isChecklist,
        items: b.items,
      }));

  // Check title has required prefix
  if (templateStructure.fixedElements.titlePrefix) {
    if (!filledContent.title.startsWith(templateStructure.fixedElements.titlePrefix)) {
      errors.push(
        `Title must start with "${templateStructure.fixedElements.titlePrefix}" but got "${filledContent.title}"`,
      );
    }
  }

  // Check all sections are present
  for (const section of sections) {
    const sectionRegex = new RegExp(`^#{${section.level}}\\s+${escapeRegex(section.heading)}`, "m");
    if (!sectionRegex.test(filledContent.body)) {
      missingSections.push(section.heading);
      errors.push(`Required section "${section.heading}" is missing from the body`);
    }
  }

  // Check for unfilled placeholders
  const remainingPlaceholders = filledContent.body.match(/\{\{\s*[^}]+\s*\}\}/g);
  if (remainingPlaceholders) {
    missingPlaceholders.push(...remainingPlaceholders);
    warnings.push(`Some placeholders remain unfilled: ${remainingPlaceholders.join(", ")}`);
  }

  // Check labels from template frontmatter are included
  if (templateStructure.frontmatter.labels) {
    const templateLabels = Array.isArray(templateStructure.frontmatter.labels)
      ? templateStructure.frontmatter.labels
      : [templateStructure.frontmatter.labels];

    for (const label of templateLabels) {
      if (typeof label === "string" && !filledContent.labels.includes(label)) {
        warnings.push(`Template label "${label}" is missing from the issue labels`);
      }
    }
  }

  // Check for empty sections (sections that only have comments or whitespace)
  for (const section of sections) {
    const sectionMatch = filledContent.body.match(
      new RegExp(
        `^#{${section.level}}\\s+${escapeRegex(section.heading)}\\s*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s|$)`,
        "m",
      ),
    );

    if (sectionMatch) {
      const sectionContent = sectionMatch[1].replace(/<!--[\s\S]*?-->/g, "").trim();
      if (!sectionContent || sectionContent === "...") {
        warnings.push(
          `Section "${section.heading}" appears to be empty or has only placeholder content`,
        );
      }
    }
  }

  console.log(
    `[validateFilledTemplate] Done: valid=${errors.length === 0}, errors=${errors.length}, warnings=${warnings.length}`,
  );
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    missingPlaceholders: [...new Set(missingPlaceholders)],
    missingSections: [...new Set(missingSections)],
  };
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fetch file content by calling GitHub MCP's get_file_contents tool directly
 */
async function fetchGitHubFileContent(owner: string, repo: string, path: string): Promise<string> {
  console.log(`[fetchGitHubFileContent] Fetching ${owner}/${repo}/${path} via GitHub MCP tool`);

  try {
    const serverManager = await MCPServerManager.getInstanceAsync();
    // Use the actual GitHub MCP server ID
    const GITHUB_MCP_SERVER_ID = "f12980ac-f80c-47e0-b4ac-181a54122d61";
    const githubClient = await serverManager.getMcpClientAsync(GITHUB_MCP_SERVER_ID);

    if (!githubClient) {
      console.warn("[fetchGitHubFileContent] GitHub MCP client not found or not connected");
      throw new Error(
        "GitHub MCP server not found. Please ensure GitHub MCP server is configured and connected.",
      );
    }

    // Get the tools from the GitHub MCP server
    const tools = await githubClient.listToolsAsync();
    const getFileContentsTool = tools["get_file_contents"];

    if (!getFileContentsTool) {
      console.error("[fetchGitHubFileContent] get_file_contents tool not found in GitHub MCP");
      throw new Error(
        "GitHub MCP 'get_file_contents' tool not available. Please check GitHub MCP server configuration.",
      );
    }

    if (!getFileContentsTool.execute) {
      console.error("[fetchGitHubFileContent] get_file_contents tool has no execute method");
      throw new Error(
        "GitHub MCP 'get_file_contents' tool is not executable. This may indicate an internal error.",
      );
    }

    console.log(`[fetchGitHubFileContent] Calling get_file_contents tool`);

    // Execute the tool - the tool.execute function handles the MCP call internally
    const result = await getFileContentsTool.execute(
      { owner, repo, path },
      { messages: [], toolCallId: `fetch-template-${randomUUID()}` },
    );

    console.log(`[fetchGitHubFileContent] Tool result type: ${typeof result}`);

    // Parse the result - GitHub MCP returns file content
    // The result can be a string (raw content) or an object with content property
    let content: string;

    if (typeof result === "string") {
      try {
        const parsed = JSON.parse(result) as { content?: string; encoding?: string };
        if (parsed.content && parsed.encoding === "base64") {
          content = Buffer.from(parsed.content, "base64").toString("utf-8");
        } else if (parsed.content) {
          content = parsed.content;
        } else {
          content = result;
        }
      } catch {
        content = result;
      }
    } else if (result && typeof result === "object") {
      const resultObj = result as { content?: string; encoding?: string; text?: string };
      if (resultObj.content && resultObj.encoding === "base64") {
        content = Buffer.from(resultObj.content, "base64").toString("utf-8");
      } else if (resultObj.content) {
        content = resultObj.content;
      } else if (resultObj.text) {
        content = resultObj.text;
      } else {
        content = JSON.stringify(result);
      }
    } else {
      throw new Error(`Unexpected result format from get_file_contents: ${typeof result}`);
    }

    console.log(`[fetchGitHubFileContent] Success: fetched ${content.length} chars via GitHub MCP`);
    return content;
  } catch (error) {
    console.error(
      `[fetchGitHubFileContent] Failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw new Error(
      `Failed to fetch file from GitHub: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
