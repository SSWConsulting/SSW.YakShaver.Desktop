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
  content: `You are YakShaver, an AI assistant with MCP capabilities to assist with create and manage PBIs.

1. When creating an issue:
- Add the video link to the top of the description.
- Always tag issue with the "YakShaver" label.

2. USE one of these backlogs listed below that matches with the user mentioned:

- https://github.com/SSWConsulting/SSW.YakShaver.Desktop
- https://github.com/SSWConsulting/SSW.YakShaver

3. Use below template when creating an issue:

\`\`\`markdown
<!-- These comments automatically delete -->
<!-- **Tip:** Delete parts that are not relevant -->
<!-- Next to Cc:, @ mention users who should be in the loop -->
Cc: @user1 @user2 @user3

<!-- add intended user next to **Hi** -->
Hi [Team/Project Name],

### Pain
[Describe problem/pain point based on input. Stay faithful to what was mentioned.]

### Suggested Solution
[If solution mentioned, describe it. Otherwise, suggest reasonable direction based on pain point. Keep concise.]

### Acceptance Criteria

1. [Derive reasonable criteria from input]
2. [Make logical inferences based on what was mentioned]
3. [Aim for 2-4 criteria]

### Tasks

- [ ] [Break down into actionable tasks based on content]
- [ ] [Be specific but stay within discussed scope]
- [ ] [Typically 2-5 tasks]

### More Information
<!-- Add any other context from input here. -->

Thanks!
\`\`\``,
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

    const data = await this.decryptAndLoad<CustomPromptData>(
      this.getSettingsPath()
    );
    this.cache = data || DEFAULT_SETTINGS;

    // Migrate default prompt to new default if there are changes
    if (this.cache) {
      const defaultPromptIndex = this.cache.prompts.findIndex(
        (p) => p.id === "default"
      );
      if (defaultPromptIndex !== -1) {
        this.cache.prompts[defaultPromptIndex] = {
          ...this.cache.prompts[defaultPromptIndex],
          content: DEFAULT_PROMPT.content,
          updatedAt: Date.now(),
        };
        await this.saveSettings(this.cache);
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
    return (
      settings.prompts.find((p) => p.id === settings.activePromptId) || null
    );
  }

  async getPromptById(id: string): Promise<CustomPrompt | null> {
    const settings = await this.loadSettings();
    return settings.prompts.find((p) => p.id === id) || null;
  }

  async addPrompt(
    prompt: Omit<CustomPrompt, "id" | "createdAt" | "updatedAt">
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
    updates: Partial<Pick<CustomPrompt, "name" | "content" | "description">>
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
