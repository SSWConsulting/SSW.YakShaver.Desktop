# PBI-1: Session Auto-approve & Continue UX

**Priority:** P1 — Current sprint  
**Module:** Recording Preview, Session State, Approval Logic  
**Dependencies:** None (standalone)

---

## User Story

As a user, I want to choose "auto-approve everything" before processing starts, so that AI can run without interrupting me for confirmations during the session.

---

## Background

After recording, the user sees a Recording Preview modal and clicks Continue to start AI processing. During execution, two types of confirmation dialogs interrupt the flow:
- Project Prompt selection confirmation
- Third-party MCP tool call confirmations

Users want a way to skip all of these upfront without changing their global settings.

> **Scope note:** This PBI only covers session-level temporary auto-approve and Recording Preview UX changes. It does not modify the global Approval Mode scope or Settings page (see PBI-2).

---

## Functional Requirements

### FR-1-01: Recording Preview — Add Checkbox & Rename Button

**Changes:**
- Rename "Continue" button to "Shave it" (keep → icon)
- Add a checkbox above the Re-record / Shave it buttons:
  - `☐  Auto-approve all confirmations`
- Checkbox is unchecked by default

**UI layout:**

```
[ video preview area ]

Duration: 0:02                         Size: 0.54 MB

☐  Auto-approve all confirmations

        [ ↺ Re-record ]    [ → Shave it ]
```

**Acceptance Criteria:**
- AC-1-01-1: Button label updated to "Shave it" with → icon.
- AC-1-01-2: Checkbox appears above buttons in Ask Mode and Wait Mode, with label "Auto-approve all confirmations".
- AC-1-01-3: Checkbox is not rendered in YOLO Mode.
- AC-1-01-4: Checkbox is unchecked by default; resets to unchecked on every Recording Preview open.
- AC-1-01-5: Checkbox is visually secondary (smaller font than button text).

---

# FR-1-02: Checkbox Behavior — Session-level Auto-approve

## Trigger

User checks "Auto-approve all confirmations" and clicks "Shave it".

## Behavior

- Sets `sessionAutoApprove = true` (in-memory boolean, not persisted)
- For the current video's processing lifecycle, automatically skips:
  - **Project Prompt Selection** confirmation → uses AI-recommended prompt without showing dialog
  - **All third-party MCP tool** confirmation dialogs → silently approved
- Does NOT modify the global Approval Mode in Settings

## Scope: Per-video, not per-app-session

`sessionAutoApprove` is scoped to the current video task (identified by shave ID), not the app session:

- Resets to `false` every time the user enters Recording Preview (before a shave ID exists)
- Once set to `true`, persists across retries and reprocesses of the **same video** (same shave ID)
- Starting a new video (entering a new Recording Preview) resets `sessionAutoApprove` to `false`

> **Tech spike needed:** Confirm at which point in the flow the shave ID is created (on "Shave it" click? or when backend starts processing?), to determine when `sessionAutoApprove` should be bound to the shave ID.

## What is NOT auto-approved

- Built-in YakShaver tools (video upload, audio conversion, transcription, etc.) — these are always auto-approved via hardcoded whitelist, independent of this flag
- Global Approval Mode in Settings is never modified by this flag

---

### FR-1-03: Built-in YakShaver Tools — Always Whitelisted

**Definition:** Built-in YakShaver tools are tools required for the product itself to function (e.g. tools used in Uploading Video, Converting Audio, Transcribing steps). These are not user-integrated third-party MCP servers.

**Behavior:**
- Hardcoded whitelist constant (single config file)
- Always auto-approved — no confirmation dialog, ever
- Not affected by Ask / Wait / YOLO Approval Mode
- Not affected by `sessionAutoApprove` (already always automatic)
- No UI to edit the whitelist in this release

**Acceptance Criteria:**
- AC-1-03-1: Built-in tools never trigger a confirmation dialog regardless of global Approval Mode.
- AC-1-03-2: Built-in tools still do not trigger dialogs when global mode is Ask.

---

## Approval Logic Decision Tree

```
Tool call triggered
        │
        ▼
Is it a built-in YakShaver tool?
   YES → auto-approve, no dialog
   NO  ↓
        ▼
Is sessionAutoApprove = true?
   YES → auto-approve, no dialog
   NO  ↓
        ▼
Apply global Approval Mode:
  Ask  → show confirmation dialog, pause workflow
  Wait → show confirmation dialog, auto-approve after 15s
  YOLO → auto-approve, no dialog
```

---

## Key User Flows

**Flow A: User checks auto-approve (happy path)**
1. Recording completes, Recording Preview modal opens (Ask or Wait Mode).
2. User previews video, decides not to re-record.
3. User checks "Auto-approve all confirmations".
4. User clicks "Shave it" → `sessionAutoApprove = true`, AI starts processing.
5. AI selects Project Prompt automatically, no confirmation dialog.
6. All MCP tool calls are silently approved, no dialogs shown.
7. Task completes, session ends, `sessionAutoApprove` resets.

**Flow B: User does not check (existing behavior unchanged)**
1. User clicks "Shave it" without checking the checkbox.
2. Project Prompt confirmation dialog appears as normal.
3. MCP tool confirmation dialogs appear as normal.

---

## Engineering Tasks

**Frontend**
- `FEAT-UI-01`: ✅ Rename "Continue" → "Shave it" (keep → icon) in Recording Preview modal.
- `FEAT-UI-02`: ✅ Add checkbox "Auto-approve all confirmations" above buttons in Recording Preview modal.
- `FEAT-UI-03`: ✅ Conditionally hide checkbox when global Approval Mode is YOLO.

**State Management**
- `FEAT-STATE-01`: ✅ Add `sessionAutoApprove: boolean`, default `false`, lives in session memory only (in `UserInteractionService`).
- `FEAT-STATE-02`: ✅ Bind checkbox to `sessionAutoApprove`; write `true` on Shave it click if checked (via `session:set-auto-approve` IPC).
- `FEAT-STATE-03`: ✅ Clear `sessionAutoApprove` on session end (reset in `cancelAllPending()`).

**Approval Logic**
- `FEAT-LOGIC-01`: ✅ Built-in tool detection via `MCPServerManager.isBuiltinTool()` — checks `builtin: true` flag on server config, no hardcoded list needed.
- `FEAT-LOGIC-02`: ✅ Approval decision order: (1) built-in server tool → pass; (2) user whitelist → pass; (3) global mode YOLO → pass; (4) sessionAutoApprove → pass silently; (5) otherwise Ask/Wait dialog.
- `FEAT-LOGIC-03`: ✅ Project Prompt confirmation skipped when `sessionAutoApprove = true`.

**Tests**
- `TEST-01`: Checkbox renders in Ask/Wait Mode, does not render in YOLO Mode.
- `TEST-02`: "Shave it" button label.
- `TEST-03`: Integration — `sessionAutoApprove` active → Project Prompt dialog does not appear.
- `TEST-04`: Integration — `sessionAutoApprove` active → MCP tool dialog does not appear.
- `TEST-05`: `sessionAutoApprove` resets after session ends.
- `TEST-06`: Built-in tool whitelist bypasses approval in all three modes (3 cases).

---

## Open Questions

- What is the complete list of built-in YakShaver tools for the whitelist? (needs engineering + product alignment)
- Should the Shave it button keep the → arrow icon or use a different one?