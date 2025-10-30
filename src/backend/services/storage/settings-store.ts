import Store from "electron-store";

export interface CustomPrompt {
  id: string;
  name: string;
  content: string;
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

interface StoreSchema {
  prompts: CustomPrompt[];
  activePromptId: string | null;
}

type ElectronStore<T> = {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
};

const DEFAULT_PROMPT: CustomPrompt = {
  id: "default",
  name: "Default Prompt",
  content: "",
  isDefault: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

export class SettingsStore {
  private static instance: SettingsStore;
  private store: ElectronStore<StoreSchema>;

  private constructor() {
    this.store = new Store<StoreSchema>({
      name: "settings",
      defaults: {
        prompts: [DEFAULT_PROMPT],
        activePromptId: "default",
      },
    }) as unknown as ElectronStore<StoreSchema>;
  }

  static getInstance(): SettingsStore {
    if (!SettingsStore.instance) SettingsStore.instance = new SettingsStore();
    return SettingsStore.instance;
  }

  getAllPrompts(): CustomPrompt[] {
    return this.store.get("prompts");
  }

  getActivePrompt(): CustomPrompt | null {
    const activeId = this.store.get("activePromptId");
    if (!activeId) return null;
    return this.store.get("prompts").find((p) => p.id === activeId) || null;
  }

  getPromptById(id: string): CustomPrompt | null {
    return this.store.get("prompts").find((p) => p.id === id) || null;
  }

  addPrompt(prompt: Omit<CustomPrompt, "id" | "createdAt" | "updatedAt">): CustomPrompt {
    const newPrompt: CustomPrompt = {
      ...prompt,
      id: `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const prompts = this.store.get("prompts");
    prompts.push(newPrompt);
    this.store.set("prompts", prompts);
    return newPrompt;
  }

  updatePrompt(id: string, updates: Partial<Pick<CustomPrompt, "name" | "content">>): boolean {
    const prompts = this.store.get("prompts");
    const index = prompts.findIndex((p) => p.id === id);
    if (index === -1) return false;

    // Prevent updating default prompt's name
    if (prompts[index].isDefault && updates.name) {
      return false;
    }

    prompts[index] = {
      ...prompts[index],
      ...updates,
      updatedAt: Date.now(),
    };
    this.store.set("prompts", prompts);
    return true;
  }

  deletePrompt(id: string): boolean {
    const prompts = this.store.get("prompts");
    const prompt = prompts.find((p) => p.id === id);

    // Prevent deleting default prompt
    if (!prompt || prompt.isDefault) return false;

    const filtered = prompts.filter((p) => p.id !== id);
    this.store.set("prompts", filtered);

    // If deleted prompt was active, switch to default
    if (this.store.get("activePromptId") === id) {
      this.store.set("activePromptId", "default");
    }

    return true;
  }

  setActivePrompt(id: string): boolean {
    const prompt = this.store.get("prompts").find((p) => p.id === id);
    if (!prompt) return false;
    this.store.set("activePromptId", id);
    return true;
  }
}
