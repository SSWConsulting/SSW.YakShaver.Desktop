import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ShaveStatus, VideoFileMetadata } from "../types";

/**
 * After modifying this schema, must run: npm run db:generate
 * This will generate the migration files in src/backend/db/migrations/
 */

export const shaves = sqliteTable("shaves", {
  id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
  workItemSource: text("work_item_source").notNull(),
  title: text("title").notNull(),
  videoFile: text("video_file", { mode: "json" }).$type<VideoFileMetadata>().notNull(),
  projectName: text("project_name"),
  workItemUrl: text("work_item_url"),
  shaveStatus: text("shave_status").$type<ShaveStatus>().default("Pending").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  videoEmbedUrl: text("video_embed_url"),
});

export type Shave = typeof shaves.$inferSelect;
export type NewShave = typeof shaves.$inferInsert;
