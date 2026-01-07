---
config:
  theme: default
---
erDiagram
    direction TB
    users {
        string id PK "Internal UUID"
        boolean is_anonymous
        timestamp created_at
        timestamp updated_at
    }

    user_identities {
        string id PK
        string user_id FK
        string provider "microsoft, google, etc"
        string provider_user_id 
        json provider_metadata "Nullable"
        string email "Nullable"
        string display_name 
        string avatar_url "Nullable"
        timestamp last_login_at 
        timestamp created_at
    }
    
    video_sources {
        string id PK
        string owner_user_id FK

        string type "local_recording | external_url"

        string external_provider "youtube, bilibili, local"
        string external_id "e.g. youtube videoId"

        string source_url "original user input URL"

        string title
        string description
        int duration_seconds

        json metadata_json

        timestamp created_at
        timestamp updated_at
    }

    video_files {
        string id PK
        string video_source_id FK
        string file_name
        string local_path
        boolean is_deleted
        timestamp deleted_at
        timestamp created_at
    }

    prompts {
        string id PK
        string user_id FK
        string name
        string description
        text instruction
        boolean is_active
        timestamp activated_at
        timestamp created_at
        timestamp updated_at
    }
    shaves {
        string id PK
        string video_source_id FK
        string requester_user_id FK
        string latest_attempt_id FK "Points to the most recent attempt"
        string client_origin "desktop ap, etc"
        string shave_status "processing, completed, failed"
        text prompt_snapshot
        text final_output
        text title
        text project_name
        text work_item_url
        text videoEmbedUrl
        string error_code
        text error_message

        int total_duration_ms

        timestamp created_at
        timestamp updated_at
    }

    shave_attempts {
        text id PK
        text shave_id FK
        string run_type "initial | retry"
        string parent_attempt_id FK "If retry, points to previous attempt"        string started_from_stage "e.g. EXECUTING_TASK"
        text prompt_snapshot "Full prompt config at this moment"
        text final_output_json 
        
        text status "running, completed, error"
        text error_message
        
        text portal_sync_status "pending, synced, failed, skipped"

        integer created_at
        integer completed_at
    }

    process_steps {
        string id PK
        string shave_attempt_id FK

        string stage "TRANSCRIBING, EXECUTING_TASK, ERROR"
        json payload_json
    
        timestamp created_at
    }
    ai_completions {
        string id PK
        string shave_attempt_id FK

        string provider "openai, anthropic"
        string model
        string context_stage "Tag: TRANSCRIBING | MCP_LOOP"
        json input_json
        json output_json

        int input_tokens
        int output_tokens
        int duration_ms

        timestamp created_at
    }

    tool_calls {
        string id PK
        string shave_attempt_id FK

        string tool_name "mcp.github.createIssue"
        string service_name
        boolean user_input_required
        json args_json
        json result_json

        boolean success
        int duration_ms

        timestamp created_at
    }

    transcripts {
        string id PK
        string shave_attempt_id FK
        string language_code
        text content
        timestamp created_at
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
