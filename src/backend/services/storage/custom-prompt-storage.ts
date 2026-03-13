import { join } from "node:path";
import { BaseSecureStorage } from "./base-secure-storage";
import { defaultCustomPrompt } from "./default-custom-prompt";

export interface CustomPrompt {
  id: string;
  name: string;
  description?: string;
  content: string;
  isDefault?: boolean;
  isTemplate?: boolean;
  selectedMcpServerIds?: string[];
  createdAt: number;
  updatedAt: number;
}

interface CustomPromptData {
  prompts: CustomPrompt[];
  activePromptId: string | null;
}

const SETTINGS_FILE = "custom-settings.enc";

const TEMPLATE_PROMPT: CustomPrompt = {
  id: "default",
  name: "Create Issues from Video Recordings",
  description: "Template for creating issues from video recordings",
  content: `Project Name: <REPLACE WITH PROJECT NAME>\nProject URL: <REPLACE WITH YOUR REPO OR BOARD URL>\n${defaultCustomPrompt}`,
  isDefault: true,
  isTemplate: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const DEFAULT_SETTINGS: CustomPromptData = {
  prompts: [TEMPLATE_PROMPT],
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
            isDefault: true,
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
    return settings.prompts.filter((p) => !p.isTemplate && !p.isDefault);
  }

  async getTemplates(): Promise<CustomPrompt[]> {
    const settings = await this.loadSettings();
    return settings.prompts.filter((p) => p.isTemplate);
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
    if (!prompt || prompt.isDefault || prompt.isTemplate) return false;

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

    settings.prompts = [TEMPLATE_PROMPT];
    settings.activePromptId = TEMPLATE_PROMPT.id;

    await this.saveSettings(settings);
  }
}
