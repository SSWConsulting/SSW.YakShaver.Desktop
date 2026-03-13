import { join } from "node:path";
import { BaseSecureStorage } from "./base-secure-storage";
import { defaultCustomPrompt } from "./default-custom-prompt";

export interface CustomPrompt {
  id: string;
  name: string;
  description?: string;
  content: string;
  isTemplate?: boolean;
  selectedMcpServerIds?: string[];
  createdAt: number;
  updatedAt: number;
}

interface CustomPromptData {
  prompts: CustomPrompt[];
}

const SETTINGS_FILE = "custom-settings.enc";

const TEMPLATE_PROMPT: CustomPrompt = {
  id: "default",
  name: "Create Issues Template",
  description: "Template for creating issues from video recordings",
  content: `Project Name: <REPLACE WITH YOUR PROJECT NAME>\nProject URL: <REPLACE WITH REPO OR BOARD URL>\n${defaultCustomPrompt}`,
  isTemplate: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const DEFAULT_SETTINGS: CustomPromptData = {
  prompts: [TEMPLATE_PROMPT],
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

    // Migrate the built-in template prompt when content or metadata changes
    if (this.cache) {
      const templateIndex = this.cache.prompts.findIndex((p) => p.id === "default");
      if (templateIndex !== -1) {
        const current = this.cache.prompts[templateIndex];
        const needsUpdate =
          current.content !== TEMPLATE_PROMPT.content ||
          current.name !== TEMPLATE_PROMPT.name ||
          !current.isTemplate;
        if (needsUpdate) {
          this.cache.prompts[templateIndex] = {
            ...current,
            content: TEMPLATE_PROMPT.content,
            name: TEMPLATE_PROMPT.name,
            description: TEMPLATE_PROMPT.description,
            isTemplate: true,
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
    return settings.prompts.filter((p) => !p.isTemplate);
  }

  async getTemplates(): Promise<CustomPrompt[]> {
    const settings = await this.loadSettings();
    return settings.prompts.filter((p) => p.isTemplate);
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
    updates: Partial<
      Pick<CustomPrompt, "name" | "content" | "description" | "selectedMcpServerIds">
    >,
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

    // Prevent deleting template or default prompts
    if (!prompt || prompt.isTemplate) return false;

    settings.prompts = settings.prompts.filter((p) => p.id !== id);

    await this.saveSettings(settings);
    return true;
  }

  async clearCustomPrompts(): Promise<void> {
    const settings = await this.loadSettings();

    settings.prompts = [TEMPLATE_PROMPT];

    await this.saveSettings(settings);
  }
}
