import { randomUUID } from "node:crypto";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { LanguageModelProvider } from "../language-model-provider.js";
import type { MCPServerConfig } from "../types.js";
import type { InternalMcpServerRegistration } from "./internal-server-types.js";

const fillTemplateInputShape = {
  template: z
    .string()
    .min(1)
    .describe("Markdown template with {{ placeholder }} placeholders to be filled"),
  context: z
    .string()
    .optional()
    .describe("Additional context to help the LLM generate appropriate values for placeholders"),
};
const fillTemplateInputSchema = z.object(fillTemplateInputShape);

type FillTemplateInput = z.infer<typeof fillTemplateInputSchema>;

const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*\}\}/g;

function extractPlaceholders(template: string): string[] {
  const placeholders = new Set<string>();

  for (const match of template.matchAll(PLACEHOLDER_REGEX)) {
    placeholders.add(match[1]);
  }

  return Array.from(placeholders);
}

function generateDynamicSchema(placeholders: string[]) {
  const shape: Record<string, z.ZodString> = {};
  for (const placeholder of placeholders) {
    shape[placeholder] = z.string().describe(`Value for the "${placeholder}" placeholder`);
  }
  return z.object(shape);
}

function buildPrompt(template: string, placeholders: string[], context?: string): string {
  const placeholderList = placeholders.map((p) => `- ${p}`).join("\n");

  let prompt = `You are filling in a template. Here is the template:

---
${template}
---

The placeholders to fill are:
${placeholderList}

Generate appropriate values for each placeholder based on the template content and structure.`;

  if (context) {
    prompt += `\n\nAdditional context:\n${context}`;
  }

  return prompt;
}

const SYSTEM_PROMPT = `You are a helpful assistant that fills in template placeholders with appropriate values.
Your task is to analyze the template and generate contextually appropriate values for each placeholder.
Consider:
- The surrounding text and format of the template
- The names of the placeholders as hints for what content is expected
- Any additional context provided by the user
Generate concise, relevant values that fit naturally into the template.`;

function fillTemplate(template: string, values: Record<string, string>): string {
  let result = template;

  for (const [key, value] of Object.entries(values)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
    result = result.replace(regex, value);
  }

  return result;
}

export async function createInternalFillTemplateServer(): Promise<InternalMcpServerRegistration> {
  const languageModelProvider = await LanguageModelProvider.getInstance();
  const serverId = `yak-fill-template-${randomUUID()}`;

  const mcpServer = new McpServer({
    name: "YakShaver Fill Template",
    version: "1.0.0",
  });

  mcpServer.registerTool(
    "fill_template",
    {
      description:
        "Fill a markdown template containing {{ placeholder }} style placeholders using an LLM. The LLM will generate appropriate values for each placeholder based on the template content and optional context.",
      inputSchema: fillTemplateInputShape,
    },
    async (input: FillTemplateInput) => {
      const { template, context } = fillTemplateInputSchema.parse(input);

      const placeholders = extractPlaceholders(template);

      // Handle case where no placeholders found
      if (placeholders.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                filledTemplate: template,
                placeholdersFound: 0,
                placeholders: [],
                generatedValues: {},
                note: "No placeholders found in template - returning original template",
              }),
            },
          ],
        };
      }

      try {
        const schema = generateDynamicSchema(placeholders);
        const prompt = buildPrompt(template, placeholders, context);

        const generatedValues = await languageModelProvider.generateObject(
          prompt,
          schema,
          SYSTEM_PROMPT,
        );

        const filledTemplate = fillTemplate(template, generatedValues);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                filledTemplate,
                placeholdersFound: placeholders.length,
                placeholders,
                generatedValues,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
                placeholdersFound: placeholders.length,
                placeholders,
              }),
            },
          ],
        };
      }
    },
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);

  const config: MCPServerConfig = {
    id: "yak_fill_template",
    name: "Yak_Fill_Template",
    description: "Built-in tool to fill markdown templates with LLM-generated content.",
    transport: "inMemory",
    inMemoryServerId: serverId,
    builtin: true,
  };

  return { config, clientTransport };
}
