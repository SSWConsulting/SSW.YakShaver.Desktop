import { join } from "node:path";
import { BaseSecureStorage } from "./base-secure-storage";

export interface CustomPrompt {
  id: string;
  name: string;
  description?: string;
  content: string;
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

interface CustomPromptData {
  prompts: CustomPrompt[];
  activePromptId: string | null;
}

const SETTINGS_FILE = "custom-settings.enc";

const DEFAULT_PROMPT: CustomPrompt = {
  id: "default",
  name: "Default Prompt",
  description: "This is the default prompt for YakShaver",
  content: `You are an AI assistant with MCP capabilities to assist with creating and managing GitHub issues (PBIs).

You MUST follow the target repository's GitHub issue templates exactly using the structured template tools.

1) When creating an issue:
- Always apply the "YakShaver" label IN ADDITION to any template-required labels.

2) Choose the correct backlog (repository):
- https://github.com/yaqi-lyu/test-repo

3) Find and apply the matching ISSUE_TEMPLATE (MANDATORY):
- Use your tools to locate issue templates in the target repo (usually .github/ISSUE_TEMPLATE/*.md).
- Pick the template that matches the context (e.g., bug vs feature).
- Once you selected the template, note its full path (e.g., ".github/ISSUE_TEMPLATE/1-bug.md")

4) PARSE the selected template (MANDATORY - Use Template Tools):
Use fetch_and_parse_github_template
- This tool fetches AND parses the template in ONE atomic operation
- It directly calls GitHub API and parses internally - no text modification possible
- Call: fetch_and_parse_github_template({ owner: "repoOwner", repo: "repoName", templatePath: "SELECTED_TEMPLATE_PATH" })
- Example: fetch_and_parse_github_template({ owner: "SSWConsulting", repo: "SSW.YakShaver.Desktop", templatePath: ".github/ISSUE_TEMPLATE/1-bug.md" })
- The result includes frontmatter, blocks (with preamble and sections), placeholders, and fixedElements ready to use
- After parsing:
  - The parse_github_template output shows you the exact template requirements.
  - Use THIS parsed structure to understand what sections, placeholders, and labels are needed.

5) Generate content based on parsed template structure (CRITICAL):
- The parsed template output shows you ALL required sections with their exact heading names in the "blocks" array.
- The "blocks" array preserves document order: preamble first, then sections.
- Generate appropriate content for EACH section from the parsed template.
- Use the transcript/video context to create meaningful content for each section.
- For sections like "Tasks" or "Acceptance Criteria", create proper checklist items.
- For placeholders like {{ USER }}, {{videoUrl}}, etc., prepare the replacement values.
- For preamble content (Cc:, Hi {{ USER }}, video links), prepare placeholder replacements.

6) Fill the template using fill_github_template (MANDATORY):
- Call fill_github_template with:
  - templateStructure: The COMPLETE output from parse_github_template or fetch_and_parse_github_template
    - Must include: frontmatter, blocks, placeholders, fixedElements
    - The "blocks" array contains the document structure in order
    - **DO NOT create a partial templateStructure** - use the entire object
  - fillData: Your generated content with:
    - title: Just the descriptive part (e.g., "App crashes on startup"), NOT the emoji/prefix
    - sections: Map of section headings to content strings
      - Keys MUST match section headings from blocks with type="section"
      - Each value must be a STRING containing the section content
      - Example: {"Describe the Bug": "The app crashes...", "To Reproduce": "1. Open\\n2. Click..."}
    - placeholders: (OPTIONAL) Map of {{ TOKENS }} to replacement values (at TOP LEVEL)
      - Example: {"{{ USER }}": "@john", "{{videoUrl}}": "https://..."}
    - preamble: (OPTIONAL) Override preamble content if needed
    - additionalLabels: ["YakShaver"] and any other relevant labels

**CORRECT STRUCTURE**:
- templateStructure: (complete object with frontmatter, blocks, placeholders, fixedElements, preamble)
- fillData.title: "App crashes on startup" (descriptive only)
- fillData.sections: {"Describe the Bug": "content string", "To Reproduce": "content string"}
- fillData.placeholders: {"{{ USER }}": "@john", "{{videoUrl}}": "https://..."} (at top level)
- fillData.additionalLabels: ["YakShaver"]

7) Validate before creating the issue (MANDATORY):
- Call validate_template_completeness with the templateStructure and filled content.
- If validation returns errors, fix the issues and fill again.
- Only proceed to create the GitHub issue once validation passes or only has warnings.

8) Issue title handling:
- The fill_github_template tool automatically adds emoji/prefixes from the template.
- You only provide the descriptive part of the title in fillData.
- Example: If template says "🐛 Bug - {{ BUG DESCRIPTION }}", you provide title: "App crashes on startup"

9) Screenshots from video (when video file path is available, recommended):
- ALWAYS capture exactly one screenshot from the video using capture_video_frame.
- Choose a timestamp where important UI elements, errors, or context is visible.
- After capturing, upload it using upload_screenshot to obtain a public URL.
- If upload_screenshot returns a screenshotUrl, include it in the issue body exactly as:
  ![Screenshot description](screenshotUrl)
- CRITICAL: Preserve the complete screenshotUrl including all query parameters.
- CRITICAL: If upload_screenshot returns an empty URL, do not mention screenshots at all.

10) Privacy and local paths (CRITICAL):
- NEVER mention local video or local screenshot file paths in the issue description.


`,

  isDefault: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const DEFAULT_SETTINGS: CustomPromptData = {
  prompts: [DEFAULT_PROMPT],
  activePromptId: "default",
};

export class CustomPromptStorage extends BaseSecureStorage {
  private static instance: CustomPromptStorage;
  private cache: CustomPromptData | null = null;

  private constructor() {
    super();
  }

  static getInstance(): CustomPromptStorage {
    if (!CustomPromptStorage.instance) {
      CustomPromptStorage.instance = new CustomPromptStorage();
    }
    return CustomPromptStorage.instance;
  }

  private getSettingsPath(): string {
    return join(this.storageDir, SETTINGS_FILE);
  }

  private async loadSettings(): Promise<CustomPromptData> {
    if (this.cache) {
      return this.cache;
    }

    const data = await this.decryptAndLoad<CustomPromptData>(this.getSettingsPath());
    this.cache = data || DEFAULT_SETTINGS;

    // Migrate default prompt to new default if there are changes
    if (this.cache) {
      const defaultPromptIndex = this.cache.prompts.findIndex((p) => p.id === "default");
      if (defaultPromptIndex !== -1) {
        const currentDefaultPrompt = this.cache.prompts[defaultPromptIndex];
        if (currentDefaultPrompt.content !== DEFAULT_PROMPT.content) {
          this.cache.prompts[defaultPromptIndex] = {
            ...currentDefaultPrompt,
            content: DEFAULT_PROMPT.content,
            updatedAt: Date.now(),
          };
          await this.saveSettings(this.cache);
        }
      }
    }

    return this.cache;
  }

  private async saveSettings(data: CustomPromptData): Promise<void> {
    this.cache = data;
    await this.encryptAndStore(this.getSettingsPath(), data);
  }

  async getAllPrompts(): Promise<CustomPrompt[]> {
    const settings = await this.loadSettings();
    return settings.prompts;
  }

  async getActivePrompt(): Promise<CustomPrompt | null> {
    const settings = await this.loadSettings();
    if (!settings.activePromptId) return null;
    return settings.prompts.find((p) => p.id === settings.activePromptId) || null;
  }

  async getPromptById(id: string): Promise<CustomPrompt | null> {
    const settings = await this.loadSettings();
    return settings.prompts.find((p) => p.id === id) || null;
  }

  async addPrompt(
    prompt: Omit<CustomPrompt, "id" | "createdAt" | "updatedAt">,
  ): Promise<CustomPrompt> {
    const settings = await this.loadSettings();

    const newPrompt: CustomPrompt = {
      ...prompt,
      id: `prompt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    settings.prompts.push(newPrompt);
    await this.saveSettings(settings);
    return newPrompt;
  }

  async updatePrompt(
    id: string,
    updates: Partial<Pick<CustomPrompt, "name" | "content" | "description">>,
  ): Promise<boolean> {
    const settings = await this.loadSettings();
    const index = settings.prompts.findIndex((p) => p.id === id);
    if (index === -1) return false;

    settings.prompts[index] = {
      ...settings.prompts[index],
      ...updates,
      updatedAt: Date.now(),
    };

    await this.saveSettings(settings);
    return true;
  }

  async deletePrompt(id: string): Promise<boolean> {
    const settings = await this.loadSettings();
    const prompt = settings.prompts.find((p) => p.id === id);

    // Prevent deleting default prompt
    if (!prompt || prompt.isDefault) return false;

    settings.prompts = settings.prompts.filter((p) => p.id !== id);

    // If deleted prompt was active, switch to default
    if (settings.activePromptId === id) {
      settings.activePromptId = "default";
    }

    await this.saveSettings(settings);
    return true;
  }

  async setActivePrompt(id: string): Promise<boolean> {
    const settings = await this.loadSettings();
    const prompt = settings.prompts.find((p) => p.id === id);
    if (!prompt) return false;

    settings.activePromptId = id;
    await this.saveSettings(settings);
    return true;
  }

  async clearCustomPrompts(): Promise<void> {
    const settings = await this.loadSettings();

    settings.prompts = [DEFAULT_PROMPT];
    settings.activePromptId = DEFAULT_PROMPT.id;

    await this.saveSettings(settings);
  }
}
