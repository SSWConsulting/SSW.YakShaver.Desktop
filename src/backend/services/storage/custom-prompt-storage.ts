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
  content: `You are an AI assistant with MCP capabilities to assist with create and manage PBIs.

1. When creating an issue:
- Add the video link to the top of the description if the video link is available.
- Always tag issue with the "YakShaver" label.

2. USE one of these backlogs listed below that matches with the user mentioned:

- https://github.com/SSWConsulting/SSW.YakShaver.Desktop
- https://github.com/SSWConsulting/SSW.YakShaver

3. WHEN CREATING AN ISSUE:

- SEARCH ISSUE TEMPLATES ON THE TARGET REPOSITORY (TEMPLATE MARKDOWN FILES USUALLY LOCATED IN .github/ISSUE_TEMPLATE/* PATH ON TARGET REPOSITORY)
- YOU ARE INTELLIGENT MCP, SO USE YOUR TOOLS TO SEARCH AND FIND THE ISSUE TEMPLATE THAT MATCHES CONTEXT
- THEN READ CONTENT OF TEMPLATE AND USE IT WHEN FORMATTING THE ISSUE

4. SCREENSHOTS FROM VIDEO (MANDATORY when video file path is available):

- ALWAYS capture at least one screenshot from the video using capture_video_frame tool.
- Choose timestamps where important UI elements, errors, or context is visible.
- IMPORTANT: After capturing EACH screenshot, you MUST call the upload_screenshot tool to upload it and get a public URL.
- The workflow is: capture_video_frame → get screenshotPath → upload_screenshot with that path → get screenshotUrl
- When upload_screenshot returns a screenshotUrl, USE THIS URL in the issue description.
- Format screenshots in the issue description as: ![Screenshot description](screenshotUrl)
- DO NOT skip the upload step - screenshots without URLs cannot be viewed by others.`,

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
}
