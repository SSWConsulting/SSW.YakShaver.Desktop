import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { ShaveStatus } from "../types";

/**
 * After modifying this schema, must run: npm run db:generate -- --name=<migration_name> (e.g., --name=add_shave_table)
 * If don't specify the name, drizzle will generate some random string as the migration name.
 * This will generate the migration files in src/backend/db/migrations/
 */

export const videoFiles = sqliteTable("video_files", {
  id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path"),
  duration: integer("duration").notNull(), // Duration in seconds
  createdAt: text("created_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`).notNull(),
});

export const shaves = sqliteTable("shaves", {
  id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
  workItemSource: text("work_item_source").notNull(),
  title: text("title").notNull(),
  videoFileId: integer("video_file_id").references(() => videoFiles.id, { onDelete: "set null" }),
  projectName: text("project_name"),
  workItemUrl: text("work_item_url"),
  shaveStatus: text("shave_status").$type<ShaveStatus>().default(ShaveStatus.Unknown).notNull(),
  createdAt: text("created_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`).notNull(),
  updatedAt: text("updated_at")
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`)
    .$onUpdate(() => sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  videoEmbedUrl: text("video_embed_url"),
});

export type VideoFile = typeof videoFiles.$inferSelect;
export type NewVideoFile = typeof videoFiles.$inferInsert;

export type Shave = typeof shaves.$inferSelect;
export type NewShave = typeof shaves.$inferInsert;
