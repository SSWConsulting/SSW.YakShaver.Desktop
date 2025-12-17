import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export type VideoFileMetadata = {
  fileName: string;
  filePath?: string;
  createdAt: string; // ISO string date
  duration: number; // in seconds
};

export const shaves = sqliteTable("shaves", {
  id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
  workItemSource: text("work_item_source"),
  title: text("title").notNull(),
  videoFile: text("video_file", { mode: "json" }).$type<VideoFileMetadata>().notNull(),
  projectName: text("project_name"),
  workItemUrl: text("work_item_url"),
  shaveStatus: text("shave_status", {
    enum: ["Pending", "Processing", "Completed", "Failed"],
  })
    .default("Pending")
    .notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
  videoEmbedUrl: text("video_embed_url"),
});

export type Shave = typeof shaves.$inferSelect;
export type NewShave = typeof shaves.$inferInsert;
