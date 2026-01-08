import { join } from "node:path";
import type { ToolApprovalMode, ToolApprovalSettings } from "@shared/types/tool-approval";
import { BaseSecureStorage } from "./base-secure-storage";

const DEFAULT_SETTINGS: ToolApprovalSettings = {
  toolApprovalMode: "ask",
};

const TOOL_APPROVAL_SETTINGS_FILE = "tool-approval-settings.enc";

export class ToolApprovalSettingsStorage extends BaseSecureStorage {
  private static instance: ToolApprovalSettingsStorage;

  private constructor() {
    super();
  }

  public static getInstance(): ToolApprovalSettingsStorage {
    if (!ToolApprovalSettingsStorage.instance) {
      ToolApprovalSettingsStorage.instance = new ToolApprovalSettingsStorage();
    }
    return ToolApprovalSettingsStorage.instance;
  }

  private getSettingsPath(): string {
    return join(this.storageDir, TOOL_APPROVAL_SETTINGS_FILE);
  }

  private withDefaults(settings?: Partial<ToolApprovalSettings> | null): ToolApprovalSettings {
    if (!settings) {
      return { ...DEFAULT_SETTINGS };
    }
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
    };
  }

  public async getSettingsAsync(): Promise<ToolApprovalSettings> {
    const stored = await this.decryptAndLoad<ToolApprovalSettings>(this.getSettingsPath());
    return this.withDefaults(stored);
  }

  public async setSettingsAsync(settings: ToolApprovalSettings): Promise<void> {
    await this.encryptAndStore(this.getSettingsPath(), settings);
  }

  public async setToolApprovalModeAsync(mode: ToolApprovalMode): Promise<void> {
    const current = await this.getSettingsAsync();
    await this.setSettingsAsync({ ...current, toolApprovalMode: mode });
  }
}
