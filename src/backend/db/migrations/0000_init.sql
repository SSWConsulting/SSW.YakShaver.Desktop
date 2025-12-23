CREATE TABLE `shaves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_item_source` text NOT NULL,
	`title` text NOT NULL,
	`video_file_id` integer,
	`project_name` text,
	`work_item_url` text,
	`shave_status` text DEFAULT 'Unknown' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	`video_embed_url` text,
	FOREIGN KEY (`video_file_id`) REFERENCES `video_files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `video_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_name` text NOT NULL,
	`file_path` text,
	`duration` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
