-- Migration: Schema V2 with Data Migration
-- This migration:
-- 1. Creates new tables (users, user_identities, video_sources, prompts, shave_attempts, etc.)
-- 2. Migrates existing video_files: converts integer id to text, creates video_source, moves duration
-- 3. Migrates existing shaves: converts integer id to text, maps workItemSource → clientOrigin, links to video_source

-- ============================================================================
-- PHASE 1: Create new tables (no dependencies on existing data)
-- ============================================================================

CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`is_anonymous` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
--> statement-breakpoint

CREATE TABLE `user_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`provider_metadata` text,
	`email` text,
	`display_name` text,
	`avatar_url` text,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE `video_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`type` text,
	`external_provider` text,
	`external_id` text,
	`source_url` text,
	`title` text,
	`description` text,
	`duration_seconds` integer,
	`metadata_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

CREATE TABLE `prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`instruction` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`activated_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_prompts_active` ON `prompts` (`is_active`);
--> statement-breakpoint

-- ============================================================================
-- PHASE 2: Migrate video_files to video_sources + Prepare shaves migration
-- CRITICAL: Must read shaves.video_file_id BEFORE dropping video_files table
--           because DROP TABLE triggers ON DELETE SET NULL in transactions
-- ============================================================================

-- Step 2.1: Create video_sources from video_files
INSERT INTO `video_sources` (`id`, `type`, `duration_seconds`, `created_at`)
SELECT 
    'vs-' || CAST(`id` AS TEXT),
    'local_recording',
    `duration`,
    `created_at`
FROM `video_files`;
--> statement-breakpoint

-- Step 2.2: Create new video_files table structure
CREATE TABLE `__new_video_files` (
	`id` text PRIMARY KEY NOT NULL,
	`video_source_id` text,
	`file_name` text,
	`local_path` text,
	`is_deleted` integer DEFAULT false,
	`deleted_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`video_source_id`) REFERENCES `video_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- Step 2.3: Copy data to new video_files
INSERT INTO `__new_video_files`(`id`, `video_source_id`, `file_name`, `local_path`, `is_deleted`, `deleted_at`, `created_at`) 
SELECT 
    CAST(`id` AS TEXT),
    'vs-' || CAST(`id` AS TEXT),
    `file_name`,
    `file_path`,
    false,
    NULL,
    `created_at`
FROM `video_files`;
--> statement-breakpoint

-- Step 2.4: Create new shaves table structure
CREATE TABLE `__new_shaves` (
	`id` text PRIMARY KEY NOT NULL,
	`video_source_id` text,
	`requester_user_id` text,
	`latest_attempt_id` text,
	`client_origin` text,
	`prompt_snapshot` text,
	`final_output` text,
	`error_code` text,
	`error_message` text,
	`total_duration_ms` integer,
	`title` text NOT NULL,
	`project_name` text,
	`work_item_url` text,
	`shave_status` text DEFAULT 'Unknown' NOT NULL,
	`video_embed_url` text,
	`total_tokens` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	FOREIGN KEY (`video_source_id`) REFERENCES `video_sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint

-- Step 2.5: CRITICAL - Copy shaves data NOW while video_file_id is still valid!
INSERT INTO `__new_shaves`(
    `id`, 
    `video_source_id`, 
    `requester_user_id`, 
    `latest_attempt_id`, 
    `client_origin`,
    `prompt_snapshot`, 
    `final_output`, 
    `error_code`, 
    `error_message`, 
    `total_duration_ms`, 
    `title`, 
    `project_name`, 
    `work_item_url`, 
    `shave_status`, 
    `video_embed_url`, 
    `total_tokens`, 
    `created_at`, 
    `updated_at`
) 
SELECT 
    CAST(s.`id` AS TEXT),
    CASE 
        WHEN s.`video_file_id` IS NOT NULL THEN 'vs-' || CAST(s.`video_file_id` AS TEXT)
        ELSE NULL 
    END,
    NULL,
    NULL,
    s.`work_item_source`,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    s.`title`,
    s.`project_name`,
    s.`work_item_url`,
    s.`shave_status`,
    s.`video_embed_url`,
    NULL,
    s.`created_at`,
    s.`updated_at`
FROM `shaves` s;
--> statement-breakpoint

-- ============================================================================
-- PHASE 3: Drop old tables and rename new ones (safe now - data already copied)
-- ============================================================================

-- Step 3.1: Drop old video_files (shaves data already extracted above)
DROP TABLE `video_files`;
--> statement-breakpoint
ALTER TABLE `__new_video_files` RENAME TO `video_files`;
--> statement-breakpoint
CREATE INDEX `idx_video_files_video_source` ON `video_files` (`video_source_id`);
--> statement-breakpoint

-- Step 3.2: Drop old shaves and rename new one
DROP TABLE `shaves`;
--> statement-breakpoint
ALTER TABLE `__new_shaves` RENAME TO `shaves`;
--> statement-breakpoint

-- Verify foreign key integrity after migration
PRAGMA foreign_key_check;
--> statement-breakpoint

CREATE INDEX `idx_shaves_video_embed_url` ON `shaves` (`video_embed_url`);
--> statement-breakpoint

-- ============================================================================
-- PHASE 4: Create remaining new tables
-- ============================================================================

CREATE TABLE `shave_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`shave_id` text NOT NULL,
	`run_type` text NOT NULL,
	`parent_attempt_id` text,
	`started_from_stage` text,
	`prompt_snapshot` text,
	`final_output_json` text,
	`token_consumption` integer,
	`status` text NOT NULL,
	`error_message` text,
	`portal_sync_status` text DEFAULT 'pending',
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`completed_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	FOREIGN KEY (`shave_id`) REFERENCES `shaves`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_shave_attempts_shave_id` ON `shave_attempts` (`shave_id`);
--> statement-breakpoint

CREATE TABLE `process_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`shave_attempt_id` text NOT NULL,
	`stage` text NOT NULL,
	`payload_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`shave_attempt_id`) REFERENCES `shave_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_process_steps_attempt` ON `process_steps` (`shave_attempt_id`);
--> statement-breakpoint

CREATE TABLE `ai_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`shave_attempt_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`context_stage` text,
	`input_json` text,
	`output_json` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`shave_attempt_id`) REFERENCES `shave_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ai_completions_attempt` ON `ai_completions` (`shave_attempt_id`);
--> statement-breakpoint

CREATE TABLE `tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`shave_attempt_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`service_name` text,
	`user_input_required` integer DEFAULT false,
	`args_json` text,
	`result_json` text,
	`success` integer,
	`duration_ms` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`shave_attempt_id`) REFERENCES `shave_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tool_calls_attempt` ON `tool_calls` (`shave_attempt_id`);
--> statement-breakpoint
CREATE INDEX `idx_tool_calls_tool` ON `tool_calls` (`tool_name`);
--> statement-breakpoint

CREATE TABLE `transcripts` (
	`id` text PRIMARY KEY NOT NULL,
	`shave_attempt_id` text NOT NULL,
	`language_code` text,
	`content` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`shave_attempt_id`) REFERENCES `shave_attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_transcripts_attempt` ON `transcripts` (`shave_attempt_id`);