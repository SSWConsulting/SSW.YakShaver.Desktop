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
  content: `You MUST follow the target repository's GitHub issue templates exactly.

1) When creating an issue:
- Always apply the "YakShaver" label IN ADDITION to any template-required labels.

2) Choose the correct backlog (repository):
- https://github.com/SSWConsulting/SSW.YakShaver.Desktop
- https://github.com/SSWConsulting/SSW.YakShaver

3) Find and apply the matching ISSUE_TEMPLATE (MANDATORY):
- Use your tools to locate issue templates in the target repo (usually .github/ISSUE_TEMPLATE/*.md).
- Pick the template that matches the context (e.g., bug vs feature).
- Read the full template file content.
- Follow the template structure and requirements STRICTLY when creating the issue.
- The transcript or user input is just for context.

4) Parse and enforce the template frontmatter (CRITICAL):
- Templates often start with YAML frontmatter like:
  - name:
  - about:
  - title:
  - labels:
  - assignees:
- You MUST extract and use these values exactly as specified.
- Apply all specified labels from the frontmatter to the created issue.

5) Issue title rules (STRICT):
- Title MUST follow the template frontmatter's title pattern exactly INCLUDING EMOJI.
- Replace any {{ ... }} placeholders in the title pattern (e.g., "{{ BUG DESCRIPTION }}", "{{ FEATURE NAME }}", "{{ FEATURE DESCRIPTION }}") by substituting the entire token with an appropriate short summary derived from the transcript or user request.
- Do not omit any fixed words like "🐛 Bug -" and do not use a different emoji.

6) Format the issue body to match the template (STRICT):
- call fill_template tool to fill in the template.
- Preserve the template's section headings and checklist items.
- Make sure that all sections starting with "###" in the template such as "### Tasks" are present in the final issue body.
- Do NOT invent new sections or change heading text.
- Remove template-only HTML comments like "<!-- ... -->" from the final issue body.
- Replace placeholders (e.g., "Hi {{ USER }}") with appropriate values when known; if unknown, keep the greeting minimal but keep the structure.

7) Screenshots from video (when video file path is available, recommended):
- ALWAYS capture exactly one screenshot from the video using capture_video_frame.
- Choose a timestamp where important UI elements, errors, or context is visible.
- After capturing, upload it using upload_screenshot to obtain a public URL.
- If upload_screenshot returns a screenshotUrl, include it in the issue body exactly as:
  ![Screenshot description](screenshotUrl)
- CRITICAL: Preserve the complete screenshotUrl including all query parameters.
- CRITICAL: If upload_screenshot returns an empty URL, do not mention screenshots at all.

8) Privacy and local paths (CRITICAL):
- NEVER mention local video or local screenshot file paths in the issue description.

9) Duplicate issues (CRITICAL):
- BEFORE creating any new GitHub issue, you MUST search the target repository for existing OPEN issues that match the same bug/feature.
- IGNORE closed issues completely.
- If you find a likely duplicate (very similar title/description, same UI area, same error/behavior), DO NOT create a new issue.
- ONLY comment on existing OPEN issues, never closed issues.
- Use the GitHub tools to search issues using the normalized bug description (remove the emoji prefix and fixed words like "Bug -").
- Instead, add a comment to the existing issue with:
  - A note that this is a potential duplicate created by YakShaver (STRICT).
  - CC the user who created the original GitHub issue (STRICT).
  - The video URL at the very top (if available).
  - The screenshot markdown (only if upload_screenshot returned a non-empty public URL).
  - Any new reproduction details and differences found in this new YakShave.
  - Add a 'Tasks' Markdown checklist in the comment, listing concrete follow-up items for the assignee (STRICT).
- The end state for a duplicate must be: 1 existing issue updated with a comment, 0 new issues created.
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
