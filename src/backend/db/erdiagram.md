---
config:
  theme: default
---
erDiagram
    direction TB
    users {
        text id PK "UUID via randomUUID()"
        integer is_anonymous "boolean mode, default true, NOT NULL"
        text created_at "ISO 8601 UTC, NOT NULL"
        text updated_at "ISO 8601 UTC, auto-update"
    }

    user_identities {
        text id PK "UUID via randomUUID()"
        text user_id FK "NOT NULL, cascade delete"
        text provider "AuthProvider enum, NOT NULL"
        text provider_user_id "NOT NULL"
        text provider_metadata "json mode, nullable"
        text email "nullable"
        text display_name "nullable"
        text avatar_url "nullable"
        text last_login_at "nullable"
        text created_at "ISO 8601 UTC"
    }
    
    video_sources {
        text id PK "UUID via randomUUID()"
        text owner_user_id FK "cascade delete"
        text type "VideoSourceType enum: local_recording | external_url"
        text external_provider "VideoHostingProvider enum"
        text external_id "e.g. youtube videoId"
        text source_url "original user input URL"
        text title "nullable"
        text description "nullable"
        integer duration_seconds "nullable"
        text metadata_json "json mode"
        text created_at "ISO 8601 UTC, NOT NULL"
        text updated_at "ISO 8601 UTC, auto-update"
    }

    video_files {
        text id PK "UUID via randomUUID()"
        text video_source_id FK "cascade delete"
        text file_name "nullable"
        text local_path "nullable"
        integer is_deleted "boolean mode, default false"
        text deleted_at "nullable"
        text created_at "ISO 8601 UTC, NOT NULL"
    }

    prompts {
        text id PK "UUID via randomUUID()"
        text user_id FK "NOT NULL, cascade delete"
        text name "NOT NULL"
        text description "nullable"
        text instruction "NOT NULL"
        integer is_active "boolean mode, default false, NOT NULL"
        text activated_at "nullable"
        text created_at "ISO 8601 UTC, NOT NULL"
        text updated_at "ISO 8601 UTC, auto-update"
    }

    shaves {
        text id PK "UUID via randomUUID()"
        text video_source_id FK "set null on delete"
        text requester_user_id FK "set null on delete"
        text latest_attempt_id "No FK, points to shave_attempts.id"
        text client_origin "e.g. desktop app"
        text prompt_snapshot "nullable"
        text final_output "nullable"
        text error_code "nullable"
        text error_message "nullable"
        integer total_duration_ms "nullable"
        text title "NOT NULL"
        text project_name "nullable"
        text work_item_url "nullable"
        text shave_status "ShaveStatus enum, default Unknown, NOT NULL"
        text video_embed_url "nullable, indexed"
        integer total_tokens "nullable"
        text created_at "ISO 8601 UTC, NOT NULL"
        text updated_at "ISO 8601 UTC, auto-update"
    }

    shave_attempts {
        text id PK "UUID via randomUUID()"
        text shave_id FK "NOT NULL, cascade delete, indexed"
        text run_type "ShaveAttemptRunType: initial | retry, NOT NULL"
        text parent_attempt_id "No FK, self-reference to previous attempt"
        text started_from_stage "ProgressStage enum"
        text prompt_snapshot "Full prompt config"
        text final_output_json "json mode"
        integer token_consumption "nullable"
        text status "ShaveAttemptStatus: running | completed | error, NOT NULL"
        text error_message "nullable"
        text portal_sync_status "PortalSyncStatus: PENDING | SYNCED | FAILED | SKIPPED, default PENDING"
        text created_at "ISO 8601 UTC, NOT NULL"
        text completed_at "nullable"
        text updated_at "ISO 8601 UTC, auto-update"
    }

    process_steps {
        text id PK "UUID via randomUUID()"
        text shave_attempt_id FK "NOT NULL, cascade delete, indexed"
        text stage "ProgressStage enum, NOT NULL"
        text payload_json "json mode"
        text created_at "ISO 8601 UTC, NOT NULL"
    }

    ai_completions {
        text id PK "UUID via randomUUID()"
        text shave_attempt_id FK "NOT NULL, cascade delete, indexed"
        text provider "ModelProvider enum: openai | azure_openai | deepseek, NOT NULL"
        text model "NOT NULL"
        text context_stage "nullable"
        text input_json "json mode"
        text output_json "json mode"
        integer input_tokens "nullable"
        integer output_tokens "nullable"
        integer duration_ms "nullable"
        text created_at "ISO 8601 UTC, NOT NULL"
    }

    tool_calls {
        text id PK "UUID via randomUUID()"
        text shave_attempt_id FK "NOT NULL, cascade delete, indexed"
        text tool_name "NOT NULL, indexed, e.g. mcp.github.createIssue"
        text service_name "nullable"
        integer user_input_required "boolean mode, default false"
        text args_json "json mode"
        text result_json "json mode"
        integer success "boolean mode"
        integer duration_ms "nullable"
        text created_at "ISO 8601 UTC, NOT NULL"
    }

    transcripts {
        text id PK "UUID via randomUUID()"
        text shave_attempt_id FK "NOT NULL, cascade delete, indexed"
        text language_code "nullable"
        text content "NOT NULL"
        text created_at "ISO 8601 UTC, NOT NULL"
    }

    users ||--o{ user_identities : has
    users ||--o{ video_sources : owns
    users ||--o{ prompts : creates
    users ||--o{ shaves : requests

    video_sources ||--o{ video_files : contains
    video_sources ||--o{ shaves : analyzed_by

    prompts ||--o{ shaves : snapshot_used_in

    shaves ||--o{ shave_attempts : history    
    shave_attempts ||--o{ process_steps : emits_ui_updates
    shave_attempts ||--o{ ai_completions : incurs_cost
    shave_attempts ||--o{ tool_calls : invokes_tools
    shave_attempts ||--o{ shave_attempts : retries_from
    shave_attempts ||--o{ transcripts : produces
