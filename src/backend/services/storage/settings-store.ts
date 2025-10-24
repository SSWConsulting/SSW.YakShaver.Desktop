import Store from "electron-store";

interface StoreSchema {
  customPrompt: string;
}

interface StoreAPI<T> {
  store: T;
}

export class SettingsStore {
  private static instance: SettingsStore;
  private store: Store<StoreSchema>;

  private constructor() {
    this.store = new Store<StoreSchema>({
      name: "settings",
      defaults: { customPrompt: "" },
    });
  }

  static getInstance(): SettingsStore {
    if (!SettingsStore.instance) SettingsStore.instance = new SettingsStore();
    return SettingsStore.instance;
  }

  getCustomPrompt(): string {
    return (this.store as unknown as StoreAPI<StoreSchema>).store.customPrompt;
  }

  setCustomPrompt(prompt: string): void {
    const storeAPI = this.store as unknown as StoreAPI<StoreSchema>;
    storeAPI.store = { ...storeAPI.store, customPrompt: prompt };
  }
}
