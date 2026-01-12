import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  type AuthProvider,
  type ModelProvider,
  PortalSyncStatus,
  type ProgressStage,
  type ShaveAttemptRunType,
  type ShaveAttemptStatus,
  ShaveStatus,
  type VideoHostingProvider,
  type VideoSourceType,
} from "../types";

/**
 * After modifying this schema, must run: npm run db:generate -- --name=<migration_name> (e.g., --name=add_shave_table)
 * If don't specify the name, drizzle will generate some random string as the migration name.
 * This will generate the migration files in src/backend/db/migrations/
 */

/** ISO 8601 UTC timestamp default for SQLite */
const timestampDefault = sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`;

// --- Users & Identity ---
export const users = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  isAnonymous: integer("is_anonymous", { mode: "boolean" }).default(true).notNull(),
  createdAt: text("created_at").default(timestampDefault).notNull(),
  updatedAt: text("updated_at")
    .default(timestampDefault)
    .$onUpdate(() => timestampDefault),
});

export const userIdentities = sqliteTable("user_identities", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  provider: text("provider").$type<AuthProvider>().notNull(), // "microsoft", "google", etc.
  providerUserId: text("provider_user_id").notNull(),
  providerMetadata: text("provider_metadata", { mode: "json" }),
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").default(timestampDefault),
});

// --- Video Sources ---
export const videoSources = sqliteTable("video_sources", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
  type: text("type").$type<VideoSourceType>(),
  externalProvider: text("external_provider").$type<VideoHostingProvider>(),
  externalId: text("external_id"), // e.g. youtube videoId
  sourceUrl: text("source_url"), // original user input URL
  title: text("title"),
  description: text("description"),
  durationSeconds: integer("duration_seconds"),
  metadataJson: text("metadata_json", { mode: "json" }),
  createdAt: text("created_at").default(timestampDefault).notNull(),
  updatedAt: text("updated_at")
    .default(timestampDefault)
    .$onUpdate(() => timestampDefault),
});

// --- Video Files ---
export const videoFiles = sqliteTable(
  "video_files",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    videoSourceId: text("video_source_id").references(() => videoSources.id, {
      onDelete: "cascade",
    }),
    fileName: text("file_name"),
    localPath: text("local_path"),
    isDeleted: integer("is_deleted", { mode: "boolean" }).default(false),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").default(timestampDefault).notNull(),
  },
  (table) => [index("idx_video_files_video_source").on(table.videoSourceId)],
);

// --- Prompts ---

export const prompts = sqliteTable(
  "prompts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    description: text("description"),
    instruction: text("instruction").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).default(false).notNull(),
    activatedAt: text("activated_at"),
    createdAt: text("created_at").default(timestampDefault).notNull(),
    updatedAt: text("updated_at")
      .default(timestampDefault)
      .$onUpdate(() => timestampDefault),
  },
  (table) => [index("idx_prompts_active").on(table.isActive)],
);

// --- Shave and Attempts---
export const shaves = sqliteTable(
  "shaves",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    videoSourceId: text("video_source_id").references(() => videoSources.id, {
      onDelete: "set null",
    }),
    requesterUserId: text("requester_user_id").references(() => users.id, { onDelete: "set null" }),
    latestAttemptId: text("latest_attempt_id"),
    clientOrigin: text("client_origin"), // "desktop app", etc.
    promptSnapshot: text("prompt_snapshot"),
    finalOutput: text("final_output"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    totalDurationMs: integer("total_duration_ms"),
    title: text("title").notNull(),
    projectName: text("project_name"),
    workItemUrl: text("work_item_url"),
    shaveStatus: text("shave_status").$type<ShaveStatus>().default(ShaveStatus.Unknown).notNull(),
    videoEmbedUrl: text("video_embed_url"),
    totalTokens: integer("total_tokens"),
    createdAt: text("created_at").default(timestampDefault).notNull(),
    updatedAt: text("updated_at")
      .default(timestampDefault)
      .$onUpdate(() => timestampDefault),
  },
  (table) => [index("idx_shaves_video_embed_url").on(table.videoEmbedUrl)],
);

export const shaveAttempts = sqliteTable(
  "shave_attempts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    shaveId: text("shave_id")
      .references(() => shaves.id, { onDelete: "cascade" })
      .notNull(),
    runType: text("run_type").$type<ShaveAttemptRunType>().notNull(),
    parentAttemptId: text("parent_attempt_id"), // If retry, points to previous attempt
    startedFromStage: text("started_from_stage").$type<ProgressStage>(),
    promptSnapshot: text("prompt_snapshot"), // Full prompt config at this moment
    finalOutputJson: text("final_output_json", { mode: "json" }),
    tokenConsumption: integer("token_consumption"),
    status: text("status").$type<ShaveAttemptStatus>().notNull(),
    errorMessage: text("error_message"),
    portalSyncStatus: text("portal_sync_status")
      .$type<PortalSyncStatus>()
      .default(PortalSyncStatus.PENDING),
    createdAt: text("created_at").default(timestampDefault).notNull(),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at")
      .default(timestampDefault)
      .$onUpdate(() => timestampDefault),
  },
  (table) => [index("idx_shave_attempts_shave_id").on(table.shaveId)],
);

// --- Process Steps (UI updates) ---

export const processSteps = sqliteTable(
  "process_steps",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    shaveAttemptId: text("shave_attempt_id")
      .references(() => shaveAttempts.id, { onDelete: "cascade" })
      .notNull(),
    stage: text("stage").$type<ProgressStage>().notNull(),
    payloadJson: text("payload_json", { mode: "json" }),
    createdAt: text("created_at").default(timestampDefault).notNull(),
  },
  (table) => [index("idx_process_steps_attempt").on(table.shaveAttemptId)],
);

// --- AI Completions (Cost tracking) ---

export const aiCompletions = sqliteTable(
  "ai_completions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    shaveAttemptId: text("shave_attempt_id")
      .references(() => shaveAttempts.id, { onDelete: "cascade" })
      .notNull(),
    provider: text("provider").$type<ModelProvider>().notNull(), // "openai", "anthropic"
    model: text("model").notNull(),
    contextStage: text("context_stage"),
    inputJson: text("input_json", { mode: "json" }),
    outputJson: text("output_json", { mode: "json" }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    durationMs: integer("duration_ms"),
    createdAt: text("created_at").default(timestampDefault).notNull(),
  },
  (table) => [index("idx_ai_completions_attempt").on(table.shaveAttemptId)],
);

// --- Tool Calls (MCP tools) ---

export const toolCalls = sqliteTable(
  "tool_calls",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    shaveAttemptId: text("shave_attempt_id")
      .references(() => shaveAttempts.id, { onDelete: "cascade" })
      .notNull(),
    toolName: text("tool_name").notNull(), // e.g. "mcp.github.createIssue"
    serviceName: text("service_name"),
    userInputRequired: integer("user_input_required", { mode: "boolean" }).default(false),
    argsJson: text("args_json", { mode: "json" }),
    resultJson: text("result_json", { mode: "json" }),
    success: integer("success", { mode: "boolean" }),
    durationMs: integer("duration_ms"),
    createdAt: text("created_at").default(timestampDefault).notNull(),
  },
  (table) => [
    index("idx_tool_calls_attempt").on(table.shaveAttemptId),
    index("idx_tool_calls_tool").on(table.toolName),
  ],
);

// --- Transcripts ---

export const transcripts = sqliteTable(
  "transcripts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    shaveAttemptId: text("shave_attempt_id")
      .references(() => shaveAttempts.id, { onDelete: "cascade" })
      .notNull(),
    languageCode: text("language_code"),
    content: text("content").notNull(),
    createdAt: text("created_at").default(timestampDefault).notNull(),
  },
  (table) => [index("idx_transcripts_attempt").on(table.shaveAttemptId)],
);

export type VideoFile = typeof videoFiles.$inferSelect;
export type NewVideoFile = typeof videoFiles.$inferInsert;
export type CreateVideoData = Omit<NewVideoFile, "id">;
export type UpdateVideoData = Partial<CreateVideoData>;

export type Shave = typeof shaves.$inferSelect;
export type NewShave = typeof shaves.$inferInsert;
export type CreateShaveData = Omit<NewShave, "id">;
export type UpdateShaveData = Partial<CreateShaveData>;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type UserIdentity = typeof userIdentities.$inferSelect;
export type NewUserIdentity = typeof userIdentities.$inferInsert;

export type VideoSource = typeof videoSources.$inferSelect;
export type NewVideoSource = typeof videoSources.$inferInsert;
export type CreateVideoSourceData = Omit<NewVideoSource, "id">;
export type UpdateVideoSourceData = Partial<CreateVideoSourceData>;

export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;

export type ShaveAttempt = typeof shaveAttempts.$inferSelect;
export type NewShaveAttempt = typeof shaveAttempts.$inferInsert;

export type ProcessStep = typeof processSteps.$inferSelect;
export type NewProcessStep = typeof processSteps.$inferInsert;

export type AiCompletion = typeof aiCompletions.$inferSelect;
export type NewAiCompletion = typeof aiCompletions.$inferInsert;

export type ToolCall = typeof toolCalls.$inferSelect;
export type NewToolCall = typeof toolCalls.$inferInsert;

export type Transcript = typeof transcripts.$inferSelect;
export type NewTranscript = typeof transcripts.$inferInsert;
