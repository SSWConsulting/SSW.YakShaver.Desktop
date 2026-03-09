---
name: Epic Cleanup — Cluster PBIs into Smaller Epics
description: |
  Analyses the three large YakShaver epics in the Product Backlog, clusters ALL their
  PBIs (open and closed) thematically into focused smaller epics — all created in
  SSWConsulting/SSW.YakShaver.Desktop — for better sprint planning and progress tracking.

on:
  workflow_dispatch:

runs-on: ubuntu-latest

permissions:
  contents: read
  issues: read
  pull-requests: read

tools:
  github:
    mode: remote
    toolsets: [default]
    github-token: ${{ secrets.GH_AW_CROSS_REPO_PAT }}

network: {}

steps:
  - name: Validate GH_AW_CROSS_REPO_PAT
    run: |
      if [ -z "$GH_AW_PAT" ]; then
        echo "::error::GH_AW_CROSS_REPO_PAT secret is not configured."
        BODY="## ⚠️ Epic Cleanup workflow failed to start\n\nThe \`GH_AW_CROSS_REPO_PAT\` secret is missing. This workflow needs a PAT to read issues from \`SSW.YakShaver\` and create epics in \`SSW.YakShaver.Desktop\`.\n\nGo to **Settings → Secrets → Actions → New repository secret**, add \`GH_AW_CROSS_REPO_PAT\` with a fine-grained token that has Issues Read+Write on both \`SSWConsulting/SSW.YakShaver\` and \`SSWConsulting/SSW.YakShaver.Desktop\`, then re-run this workflow."
        printf '%b' "$BODY" | gh issue comment 677 --repo SSWConsulting/SSW.YakShaver.Desktop --body-file -
        exit 1
      fi
    env:
      GH_AW_PAT: ${{ secrets.GH_AW_CROSS_REPO_PAT }}
      GH_TOKEN: ${{ github.token }}

safe-outputs:
  github-token: ${{ secrets.GH_AW_CROSS_REPO_PAT }}
  create-issue:
    max: 12
    title-prefix: "[YakShaver 2.0] "
    target-repo: SSWConsulting/SSW.YakShaver.Desktop
  add-comment:
    max: 3
    target: "*"
    target-repo: SSWConsulting/SSW.YakShaver.Desktop
---

# Epic Cleanup — Cluster PBIs into Smaller Epics

You are an expert product backlog manager. Your task is to reorganise three large, unwieldy epics in the YakShaver Product Backlog. For each epic, you will read **all** of its PBIs (open and closed), cluster them into a small number of focused themes, and create one new, smaller epic per theme.

**All new epic issues must be created in `SSWConsulting/SSW.YakShaver.Desktop`**, regardless of which repo the original epic lives in. This centralises the Desktop product's backlog.

## Epics to Reorganise

| Epic | Source Repo | Issue |
|------|-------------|-------|
| ✨ YakShaver Agent 2.0 | SSWConsulting/SSW.YakShaver | #2811 |
| ✨ YakShaver Desktop App | SSWConsulting/SSW.YakShaver.Desktop | #677 |
| ♻️ Auth Migration | SSWConsulting/SSW.YakShaver | #3494 |

---

## Step 1 — Read Every PBI in Each Epic

For each of the three epics:

1. Read the epic issue body and labels
2. Fetch **all sub-issues** — including both open and closed ones
3. For every sub-issue, record:
   - Issue number and title
   - State: `open` or `closed`
   - Labels (e.g., Type: Bug, Type: Feature, Type: Refactor)
   - A one-line summary of what it does (from title or first sentence of body)

Do **not** skip closed PBIs — they are needed to show full progress context in the new epics.

---

## Step 2 — Cluster All PBIs Holistically Across the Three Epics

After reading all PBIs from all three epics, treat them as **one unified pool** and cluster them by theme. PBIs from different source epics may end up in the same new smaller epic if they are closely related.

**Clustering rules:**

- Each cluster should represent a coherent functional area or delivery theme
- **Cross-epic clustering is encouraged** — Desktop App PBIs and Agent 2.0 PBIs that share the same theme (e.g., MCP integration, video pipeline) should be grouped together
- Target **10–20 PBIs per cluster** — coarse-grained, not fine-grained
- Aim for **5–8 clusters total** across all three epics combined — let the actual PBI themes drive the count, not the source epic structure
- It is fine for a cluster to consist entirely of closed PBIs — group by theme, not by state
- Auth Migration PBIs are self-contained (auth/identity scope) and should remain in their own cluster(s)
- A PBI that spans two themes goes in whichever is more dominant

**Suggested starting clusters — validate against actual PBI content and adjust:**

- `🔌 MCP & AI Pipeline` — MCP host/client, MCP service config, fallback/error handling, OpenAI integration, transcript pipeline (from Agent 2.0 and Desktop App)
- `🎬 Video Recording & Processing` — screen capture, local video processing, FFmpeg, upload pipeline, recording confirmation, video hosting (from Agent 2.0 and Desktop App)
- `✨ Features & UX` — stop button, project selection, transcript optimisation, fallback/system prompt, additional LLM providers, customisable prompt (from Desktop App)
- `🐛 Bug Fixes & Quality` — all defects across Desktop App: camera/audio, auth errors, sign-in failures, UI glitches, download confusion, Azure DevOps MCP bugs
- `🏗️ Platform & Infrastructure` — Tauri app init, database redesign, configurable settings, code signing, centralised logging, onboarding wizard refactor, Intel macOS installer, architecture/roadmap (from Agent 2.0 and Desktop App)
- `♻️ Auth Scope 1 — Enterprise Auth` — Make Entra permission optional, Better-Auth spike, ADR revision, implementation (from Auth Migration)
- `🌐 Auth Scope 2 — Extended Login Providers` — non-Entra tenant policy, invitation system (from Auth Migration)

---

## Step 3 — Create One New Epic per Cluster

For each cluster identified in Step 2, call the `create_issue` tool once.

The tool automatically prefixes every title with `[YakShaver 2.0]` and creates the issue in `SSWConsulting/SSW.YakShaver.Desktop`. Do **not** include `issue_type`, `repo`, or `target-repo` — those fields are not supported and will cause validation errors.

**Fields to provide:**

| Field | Value |
|-------|-------|
| `title` | `[Emoji] [Cluster Name]` — e.g. `🔌 MCP & AI Pipeline` |
| `labels` | `Type: Feature` / `Type: Bug` / `Type: Refactor` as appropriate |
| `body` | Use the template below |

Do NOT include `issue_type` or any field not listed above.

**Body template for each new epic:**

```markdown
Consolidates PBIs from:
- [source epic 1 title] — SSWConsulting/[SourceRepo]#[number]
- [source epic 2 title] — SSWConsulting/[SourceRepo]#[number]  (omit if single source)

### Scope
[2–3 sentences describing what this epic covers and the value it delivers]

### PBIs

<!-- Link these as sub-issues once this epic is created -->
- SSWConsulting/[SourceRepo]#[number] — [title]
- SSWConsulting/[SourceRepo]#[number] — [title]
[... one line per PBI in this cluster, all states (open and closed) ...]

### Acceptance Criteria
This epic is complete when all open PBIs listed above are closed.
```

Use plain `SSWConsulting/RepoName#number` references (not Markdown links) — GitHub auto-links these without counting toward the 50-link comment limit.

---

## Step 4 — Post a Summary Comment on Desktop App Epic #677

After all new epics are created, call `add_comment` **once** to post a comprehensive summary on the Desktop App epic.

**Important constraints:**
- Always provide `item_number: 677` — this workflow is triggered by `workflow_dispatch` so auto-targeting does NOT work; the tool will fail without an explicit `item_number`
- All `add_comment` calls go to `SSWConsulting/SSW.YakShaver.Desktop` (configured in frontmatter); cross-repo commenting on `SSW.YakShaver` issues #2811 and #3494 is **not supported** by the tool and must be done manually
- Use plain `SSWConsulting/RepoName#number` cross-references (not Markdown links `[text](url)`) — the tool enforces a hard limit of 50 HTTP/HTTPS links per comment; with ~60 total PBIs across the three epics, explicit links will breach this limit

**Call:**

```
add_comment(
  item_number: 677,
  body: <comment body below>
)
```

**Comment body template:**

```markdown
## 🗂️ Epic Reorganised — [N] Smaller Epics Created

The three large YakShaver epics have been clustered thematically into smaller, focused epics
(all in SSWConsulting/SSW.YakShaver.Desktop). PBIs from Desktop App and Agent 2.0 that share
the same theme have been grouped together.

### New Epics Created

| Epic | Scope |
|------|-------|
| SSWConsulting/SSW.YakShaver.Desktop#[number] | [~10 word description] |
[... one row per new epic; use plain org/repo#number, NOT markdown links ...]

### PBI Assignment — Agent 2.0 (SSWConsulting/SSW.YakShaver#2811)

| PBI | State | New Epic |
|-----|-------|---------|
| SSWConsulting/SSW.YakShaver#[number] [title] | open/closed | SSWConsulting/SSW.YakShaver.Desktop#[number] |
[... all PBIs from Agent 2.0 epic ...]

### PBI Assignment — Desktop App (SSWConsulting/SSW.YakShaver.Desktop#677)

| PBI | State | New Epic |
|-----|-------|---------|
| SSWConsulting/SSW.YakShaver.Desktop#[number] [title] | open/closed | SSWConsulting/SSW.YakShaver.Desktop#[number] |
[... all PBIs from Desktop App epic ...]

### PBI Assignment — Auth Migration (SSWConsulting/SSW.YakShaver#3494)

| PBI | State | New Epic |
|-----|-------|---------|
| SSWConsulting/SSW.YakShaver#[number] [title] | open/closed | SSWConsulting/SSW.YakShaver.Desktop#[number] |
[... all PBIs from Auth Migration epic ...]

### 📌 Action Required

1. **Link each new epic as a sub-issue of its source epic** (progress bar will update automatically)
2. **Re-assign each PBI as a sub-issue of its new smaller epic** (remove from old epic → add to new)
3. **Manually post the same summary** on SSWConsulting/SSW.YakShaver#2811 and SSWConsulting/SSW.YakShaver#3494 (cross-repo commenting is not supported by this workflow)

GitHub CLI commands for bulk re-assignment:

```bash
# Add a new epic as a sub-issue of the original epic
gh api repos/SSWConsulting/[SOURCE_REPO]/issues/[SOURCE_EPIC]/sub_issues \
  --method POST -f sub_issue_id=[NEW_EPIC_NUMBER]

# Move a PBI: remove from old epic, add to new epic
gh api repos/SSWConsulting/[SOURCE_REPO]/issues/[SOURCE_EPIC]/sub_issues/[PBI_NUMBER] \
  --method DELETE
gh api repos/SSWConsulting/SSW.YakShaver.Desktop/issues/[NEW_EPIC_NUMBER]/sub_issues \
  --method POST -f sub_issue_id=[PBI_NUMBER]
```

> ℹ️ PBIs remain in their original repos. Only the tracking epics move to SSW.YakShaver.Desktop.
```

If the comment body would exceed ~60 PBI rows, split into two `add_comment` calls (the workflow allows max 3 comments): first call covers Agent 2.0 PBIs, second covers Desktop App + Auth Migration PBIs. Always include `item_number: 677` on every call.

---

## Important Notes

- Include **all** PBIs — open and closed — so new epics show real progress
- Cluster **holistically across all three source epics** — PBIs from Desktop App and Agent 2.0 may share the same new smaller epic
- All-closed clusters are acceptable — group by theme, not state
- Each new epic body **must** include the full ✅/🔲 progress table with every PBI and its source repo
- The three original epics must stay open and untouched — do not modify or close them
- The `GH_AW_CROSS_REPO_PAT` secret must have:
  - **Read** access to `SSWConsulting/SSW.YakShaver`
  - **Read + Write** access to `SSWConsulting/SSW.YakShaver.Desktop`
- If the secret is missing or has insufficient scope, stop and post a warning comment on the Desktop App epic (#677) instructing the team to add `GH_AW_CROSS_REPO_PAT` at **Settings → Secrets → Actions** in `SSWConsulting/SSW.YakShaver.Desktop`
