# Entity Relationship Diagram

erDiagram
    %% ==========================================
    %% 0. Identity Context
    %% ==========================================
    users {
        string id PK "UUID"
        string auth_provider "local, microsoft"
        string display_name
        string created_at
    }

    %% ==========================================
    %% 1. Core Entities
    %% ==========================================
    
    video_files {
        string id PK "UUID"
        string file_name "NOT NULL"
        string file_path "Nullable"
        string file_hash "Nullable (to track moved files)"
        int duration "NOT NULL"
        string created_at "NOT NULL"
    }

    projects {
        string id PK "UUID"
        string user_id FK "NOT NULL"
        string name "NOT NULL"
        string description "Nullable"
        string backlog_url "Nullable"
        boolean is_active "NOT NULL Default TRUE"
        string source "NOT NULL"
        string custom_prompt "Nullable"
        string created_at "NOT NULL"
        string updated_at "Nullable"
    }

    shaves {
        string id PK "UUID"
        string title "NOT NULL"
        string video_file_id FK "NOT NULL"
        string requester_id FK "NOT NULL"
        string project_id FK "Nullable"
        string shave_status "Enum: Pending, etc"
        string work_item_url "Nullable"
        string work_item_source "NOT NULL"
        string video_embed_url "Nullable"
        string created_at "NOT NULL"
        string updated_at "Nullable"
    }

    %% ==========================================
    %% 2. Process & Workflow
    %% ==========================================

    process_steps {
        string id PK "UUID"
        string shave_id FK "NOT NULL"
        string step_name "NOT NULL"
        string process_status "NOT NULL"
        string started_at "NOT NULL"
        string completed_at "Nullable"
        string error_message "Nullable"
    }

    %% ==========================================
    %% 3. Technical Logs & Content
    %% ==========================================

    ai_logs {
        string id PK "UUID"
        string shave_id FK "NOT NULL"
        string process_step_id FK "Nullable"
        string model_name "NOT NULL"
        string prompt_text "Nullable"
        string response_text "Nullable"
        int duration_ms "Nullable"
        string created_at "NOT NULL"
    }

    tool_calls {
        string id PK "UUID"
        string shave_id FK "NOT NULL"
        string process_step_id FK "Nullable"
        string ai_log_id FK "Nullable"
        string tool_call_id "NOT NULL"
        string tool_name "NOT NULL"
        string service_name "NOT NULL"
        string args_json "Nullable"
        string result_json "Nullable"
        boolean success "NOT NULL"
        int duration_ms "Nullable"
        string created_at "NOT NULL"
    }

    transcripts {
        string id PK "UUID"
        string shave_id FK "NOT NULL"
        string text "NOT NULL"
        string created_at "NOT NULL"
    }

    %% ==========================================
    %% 4. User Interaction
    %% ==========================================

    user_activities {
        string id PK "UUID"
        string shave_id FK "NOT NULL"
        string user_id "Nullable"
        string activity_type "NOT NULL"
        string target_table "Nullable"
        string target_id "Nullable (UUID)"
        string details_json "Nullable"
        string created_at "NOT NULL"
    }

    %% ==========================================
    %% Relationships
    %% ==========================================
    
    users ||--o{ projects : "owns"
    users ||--o{ shaves : "owns"
    projects ||--o{ shaves : "contains"
    video_files ||--o| shaves : "source for"
    
    shaves ||--o{ process_steps : "tracks via"
    shaves ||--o{ ai_logs : "triggers"
    shaves ||--o{ tool_calls : "uses"
    shaves ||--o{ transcripts : "has"
    shaves ||--o{ user_activities : "audited by"
    
    process_steps ||--o{ ai_logs : "contains"