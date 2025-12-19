CREATE TABLE `shaves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_item_source` text NOT NULL,
	`title` text NOT NULL,
	`video_file` text,
	`project_name` text,
	`work_item_url` text,
	`shave_status` text DEFAULT 'Pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	`video_embed_url` text
);
