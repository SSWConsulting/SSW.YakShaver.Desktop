PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shaves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_item_source` text,
	`title` text NOT NULL,
	`video_file` text NOT NULL,
	`project_name` text,
	`work_item_url` text,
	`shave_status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	`video_embed_url` text
);
--> statement-breakpoint
INSERT INTO `__new_shaves`("id", "work_item_source", "title", "video_file", "project_name", "work_item_url", "shave_status", "created_at", "updated_at", "video_embed_url") SELECT "id", "work_item_source", "title", "video_file", "project_name", "work_item_url", "shave_status", "created_at", "updated_at", "video_embed_url" FROM `shaves`;--> statement-breakpoint
DROP TABLE `shaves`;--> statement-breakpoint
ALTER TABLE `__new_shaves` RENAME TO `shaves`;--> statement-breakpoint
PRAGMA foreign_keys=ON;