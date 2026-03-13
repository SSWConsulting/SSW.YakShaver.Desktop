# Custom Prompt Manager UI Improvements

## Problem

The Custom Prompt Manager list view has several layout and content display issues.

## Requirements

1. **Search + Add at top** — The search bar and "Add New Prompt" button must appear at the very top of the list view, above both the Templates section and the My Prompts section.
2. **Remove Template badge** — The "Template" badge inside `TemplateCard` is redundant (it's already in a "Templates" section) and should be removed.
3. **My Prompts section header** — User prompts need a "My Prompts" section heading styled the same as the "Templates" heading (`text-sm font-semibold text-white/70 uppercase tracking-wide`).
4. **Template shows prompt instructions** — `TemplateCard` currently shows only name and description. It must also show a preview of the prompt instructions content (project placeholder part + default prompt body).
5. **User prompts show prompt instructions** — `PromptCard` similarly shows only name and description. It must also show a preview of the prompt instructions content.

Concepts After Redesign

2.1  Template (built-in, read-only)
A single built-in prompt provided by YakShaver. Users cannot edit or delete it. It serves as a reference and starting point for creating their own prompts.
Visible in the UI as a distinct card, separate from user prompts
Contains: prompt text with «placeholder» markers + recommended MCP server list
Actions: Preview (read full prompt), Use (pre-fill a new prompt form)
If more templates are added in future, a selection step is added before the form — current single-template flow needs no changes

2.2  User Prompts
Prompts created and owned by the user. No concept of "active" — all prompts are equal candidates during processing.
User can create, edit, and delete any prompt
During recording processing, YakShaver auto-matches the best prompt based on the transcription
User confirms or overrides the matched prompt before anything is created
Deleting the last prompt does not revert to "default" — the system falls back to the built-in template behavior

3. UI Structure

3.1  Prompt list page
Two sections, clearly separated:

Section
Contents
Built-in template
Single card with name, description, MCP server tags. Preview + Use buttons.
My prompts
User-created prompts. Each row shows name, connected MCP servers, Edit + Delete actions. No "Active" badge.


The page title changes from "Custom Prompt Manager" to "Custom Prompts". Subtitle explains: "Prompts are matched automatically from your recordings. You can confirm or override during processing."

3.2  Creating a new prompt — two entry points






3.3  Prompt form fields

Field
Notes
Name
Free text. Required. User gives the prompt a meaningful name, e.g. "Backend issues – acme-api".
Prompt instructions
Full textarea. No length limit. Supports «placeholder» markers (see §4). The template is never auto-applied — user always owns the final text.
MCP servers
Checklist of available servers. Disconnected servers shown at reduced opacity with a "(Not connected)" label. User can still select them.



4. Placeholder System

The built-in template prompt contains «placeholder» markers to indicate information the user should supply. These are informational only — they do not block saving.

4.1  Format
Placeholders use the «...» format (guillemet brackets). Example:

Example template excerpt
You are processing a video for project «your project name».Repo / board: «repo or board URL»Create an issue following these rules:1) Embed the video link at the top...


4.2  Rendering in the editor
Placeholders are visually highlighted in orange within the textarea
A hint bar appears below the textarea when placeholders are detected: "«…» marks are prompts to fill in — replace them with your own content, or leave as-is"
If the prompt has no placeholders, the hint bar does not appear

4.3  Which prompts have required placeholders?





4.4  No validation on save
Saving is never blocked by unfilled placeholders. The system trusts the user to fill in what is relevant. A user with no repo simply deletes that line.

Why not a structured form with labeled inputs?
Project info varies too much between users — some prompts have no repo, some have multiple, some reference a board URL instead. A free-text prompt with visual hints is more flexible than a form with fixed fields.


5. MCP Server Selection

Each prompt carries a list of MCP servers it is allowed to use during processing. This replaces the current "active prompt → server filter" mechanism.

State
Appearance
Connected
Normal opacity, checkbox enabled
Not connected
50% opacity, label shows "(Not connected)", checkbox still enabled so user can pre-configure
Built-in
Shown with "(Built-in)" label, always available


When using the template, recommended servers are pre-checked. User can uncheck any they do not need.

6. Removing the "Active" Concept

The "Active" prompt concept is removed entirely. Rationale:
The active prompt's content field is never injected into the MCP system prompt — only its selectedMcpServerIds is read, and even that filter is not currently applied
Removing it simplifies the data model and eliminates the confusing "Select" button
The UI loses nothing functional

Code changes required:









7. Default Prompt → Backend Only

The built-in "Default Prompt" is hidden from the UI list. It continues to exist as the defaultCustomPrompt constant and is used as a backend fallback only.

Safe way to hide it
Filter in getAllPrompts(): return settings.prompts.filter(p => !p.isDefault). Remove activePromptId entirely, replacing all fallback logic with null. The template card in the UI replaces the role the default prompt played as a user-facing reference.



## Proposed Layout (list view)

```
[ Search prompts...    ] [ Add New Prompt ]
─────────────────────────────────────────
TEMPLATES
  ┌─ TemplateCard ──────────────────────┐
  │  Name                               │
  │  Description                        │
  │                       [View] [Use]  │
  └─────────────────────────────────────┘

─────────────── (my-4 spacing) ──────────
MY PROMPTS
  ┌─ PromptCard ────────────────────────┐
  │  Name                               │
  │  Description                        │
  │                   [Select] [Edit]   │
  └─────────────────────────────────────┘

Note: Prompt Instructions are shown in the form/view, NOT as a card preview.
```

## Approach

### Files to change

| File | Change |
|------|--------|
| `src/shared/mcp/preset-servers.ts` | **NEW** — single source of truth for preset server IDs and default configs |
| `mcp-server-manager.ts` | `mergeWithInternalServers()` now appends preset servers not yet in storage |
| `mcp-github-card.tsx` / `mcp-devops-card.tsx` / `mcp-jira-card.tsx` | Import ID from `@shared/mcp/preset-servers` instead of hardcoding |
| `CustomPromptManager.tsx` | Move search+add controls above Templates; add "MY PROMPTS" heading; "Template" singular heading; `pt-2` spacing after search bar; pass `selectAllServersForNewPrompt` when creating from template |
| `PromptListView.tsx` | Remove search+add from inside this component (they move up); keep only the filtered list of PromptCards |
| `TemplateCard.tsx` | Remove `<Badge>Template</Badge>` |
| `PromptCard.tsx` | No content preview on cards |
| `PromptForm.tsx` | Remove "cannot be changed" messages; remove redundant FormDescriptions; add `selectAllServersForNewPrompt` prop; fix "(Disconnected)" → "(Not connected)" |
| `HighlightedTextarea.tsx` | Change `bg-black/40` → `bg-transparent dark:bg-input/30`; fixed height `h-64` |

### Search/Add refactor

Currently `PromptListView` owns the search bar and button internally. The cleanest change is to **lift the search state** up to `CustomPromptManager` and render the search+add row at the very top of the list view, before the Templates section. `PromptListView` becomes a pure presentational component that receives `filteredPrompts`.

Alternatively, keep the search state in `PromptListView` but pass a render-slot or move the search+add row to be rendered by `CustomPromptManager` directly above the full list.

The simplest approach: **lift search state to `CustomPromptManager`**, pass `searchQuery` + `onSearchChange` as props to `PromptListView`, and render the search+add row in `CustomPromptManager` above the full sections block.

### Prompt instructions preview

**Cards do NOT show a prompt instructions preview.** Only name and description are shown on the card.
Prompt instructions are visible only inside the form (View/Edit) — the `HighlightedTextarea` in `PromptForm` shows the full content with a fixed `h-64` height so it is always visible inside the `ScrollArea`.

Root cause of invisible textarea: the form used `h-full` + `flex-1` on a `FormItem` inside a `ScrollArea`. `ScrollArea` content has unbounded height, so `h-full` resolves to 0 — making the textarea invisible. Fix: removed `h-full` from the `<form>`, simplified `FormItem` class, and set `containerClassName="h-64"` on `HighlightedTextarea`.

## Implementation Todos

### Layout & Structure

1. **`search-top`** — Lift `searchQuery` state from `PromptListView` to `CustomPromptManager`. Render `[SearchBar + Add New Prompt]` row at the very top of the list view, above the Templates section. `PromptListView` becomes a pure list renderer receiving `filteredPrompts` as a prop.

2. **`template-remove-badge`** — `TemplateCard.tsx`: remove `<Badge variant="secondary">Template</Badge>` and its wrapping div. Redundant since the card is already inside a "TEMPLATES" section.

3. **`my-prompts-header`** *(depends on `search-top`)* — `CustomPromptManager.tsx`: add a "MY PROMPTS" section heading above `PromptListView`, styled identically to the "TEMPLATES" heading (`text-sm font-semibold text-white/70 uppercase tracking-wide`).

4. **`template-show-content`** ✅ — No card preview (revised). Prompt instructions are shown in `PromptForm` via `HighlightedTextarea` with fixed `h-64` height. Fixed invisible textarea bug: removed `h-full` from `<form>` and simplified `FormItem` class.

5. **`prompt-show-content`** ✅ — No card preview (revised). Same fix as above applies. Added `Separator className="my-4"` between Templates and My Prompts sections for extra spacing.

### Page Title

6. **`page-title`** — `CustomPromptManager.tsx`: change `<h2>` from "Custom Prompt Manager" to "Custom Prompts". Update subtitle to: *"Prompts are matched automatically from your recordings. You can confirm or override during processing."*

### Remove Active Concept

7. **`remove-active`** — Remove the "active prompt" concept from the frontend entirely (§6):
   - `PromptCard.tsx`: remove `isActive` prop, Active badge, Select button
   - `PromptListView.tsx`: remove `activePromptId` prop and `onSetActive` prop
   - `CustomPromptManager.tsx`: remove `handleSetActive`, stop passing `activePromptId` / `onSetActive`
   - `usePromptManager.ts`: remove `activePromptId` state, stop calling `getActivePrompt()` and `setActivePrompt()`
   - `PromptForm.tsx`: remove "Save & Use" button (only keep "Save")

### Placeholder Format

8. **`placeholder-format`** — Change placeholder style from `<REPLACE_...>` to `«...»` guillemet brackets (§4):
   - `default-custom-prompt.ts`: replace `<REPLACE_WITH_PROJECT_NAME>` → `«your project name»`, `<REPLACE_WITH_PROJECT_URL>` → `«repo or board URL»`
   - `custom-prompt-storage.ts` `TEMPLATE_PROMPT.content`: same replacements in the template header
   - `HighlightedTextarea.tsx`: update `PLACEHOLDER_PATTERN` from `/<REPLACE_[A-Z0-9_]+>/g` to `/«[^»]+»/g`
   - `PromptForm.tsx`: update `hasPlaceholders` regex to `/«[^»]+»/`; change hint text to *"«…» marks are prompts to fill in — replace them with your own content, or leave as-is"*; **remove save-blocking validation** on placeholders (saving must never be blocked)

### MCP Labels

9. **`mcp-label-fix`** — `PromptForm.tsx` MCP server list: change label text from "(Disconnected)" to "(Not connected)". Checkboxes already stay enabled — only the label text changes.

### Backend

10. **`hide-default-backend`** — `custom-prompt-storage.ts` `getAllPrompts()`: add `!p.isDefault` filter so the backend default prompt is never exposed to the UI list (currently only `!p.isTemplate` is filtered). The default prompt remains as a backend-only constant fallback.
