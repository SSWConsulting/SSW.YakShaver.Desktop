---
name: Epic Cleanup — Cluster PBIs into Smaller Sub-Epics
description: |
  Analyses the three large YakShaver epics in the Product Backlog, clusters their
  open PBIs thematically, and creates focused smaller sub-epics — all in
  SSWConsulting/SSW.YakShaver.Desktop — for better sprint planning.

on:
  workflow_dispatch:

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

safe-outputs:
  github-token: ${{ secrets.GH_AW_CROSS_REPO_PAT }}
  create-issue:
    max: 15
  add-comment:
    max: 6
    target: "*"
---

# Epic Cleanup — Cluster PBIs into Smaller Sub-Epics

You are an expert product backlog manager. Your task is to reorganise three large, unwieldy epics in the YakShaver Product Backlog by clustering their open PBIs into smaller, focused sub-epics.

**All new sub-epic issues must be created in `SSWConsulting/SSW.YakShaver.Desktop`**, regardless of which repo the original epic lives in. This centralises the Desktop product's backlog in one place.

## Epics to Reorganise

| Epic | Source Repo | Issue |
|------|-------------|-------|
| ✨ YakShaver Agent 2.0 | SSWConsulting/SSW.YakShaver | #2811 |
| ✨ YakShaver Desktop App | SSWConsulting/SSW.YakShaver.Desktop | #677 |
| ♻️ Auth Migration | SSWConsulting/SSW.YakShaver | #3494 |

## Step 1 — Read the Epics

For each epic listed above, use the GitHub MCP tools to:

1. Get the epic issue details (title, body, labels) — use the `github-token` configured for cross-repo access to read from both `SSWConsulting/SSW.YakShaver` and `SSWConsulting/SSW.YakShaver.Desktop`
2. Get all sub-issues of the epic
3. For each **open** sub-issue, read its title, labels, and body to understand its theme and functional area

Skip any sub-issues that are already closed/completed.

## Step 2 — Cluster Open PBIs Thematically

Analyse all **open** sub-issues for each epic and group them into 2–4 thematic clusters.

**Clustering guidelines:**
- Group by functional area (e.g., authentication, MCP integration, UI/UX, infrastructure)
- Group by issue type only if that is the dominant distinction (e.g., a large batch of bugs)
- Aim for 3–8 PBIs per cluster — not too fine-grained, not too broad
- A PBI that clearly spans two clusters goes in the most relevant one

**Suggested starting clusters (validate against actual PBI content and adjust):**

### YakShaver Agent 2.0 (SSWConsulting/SSW.YakShaver #2811)
- `🔌 MCP Integration` — MCP service configuration, default services, fallback/error handling for MCP
- `🏗️ Core Infrastructure` — database redesign, configurable settings, architecture/roadmap items

### YakShaver Desktop App (SSWConsulting/SSW.YakShaver.Desktop #677)
- `🐛 Bug Fixes` — all defects (camera/audio, auth errors, recording issues, UI glitches, sign-in failures)
- `✨ Features & UX` — new capabilities (stop button, project selection, transcript optimisation, system prompts)
- `🏗️ Platform & Infrastructure` — code signing, centralised logging, onboarding wizard refactor, LLM provider support, Intel macOS installer

### Auth Migration (SSWConsulting/SSW.YakShaver #3494)
- `♻️ Scope 1: Enterprise Auth Simplification` — Make Entra permission optional, ADR revision, Better-Auth spike follow-up, implementation
- `🌐 Scope 2: Extended Login Providers` — Non-Entra tenant policy, invitation system for external users

## Step 3 — Create Smaller Sub-Epic Issues

For each cluster, create a new sub-epic issue using `create-issue`.

⚠️ **All new sub-epics must be created in `SSWConsulting/SSW.YakShaver.Desktop`** — always set `target-repo: SSWConsulting/SSW.YakShaver.Desktop` on every `create-issue` call.

**Required fields for each new sub-epic:**

- **title**: Format — `[Emoji] [Cluster Name] — [Parent Epic Short Name]`
  - Example: `🔌 MCP Integration — YakShaver Agent 2.0`
- **issue_type**: `Epic`
- **labels**: `Type: Feature` for feature/agent clusters; `Type: Bug` for bug clusters; `Type: Refactor` for refactor clusters
- **target-repo**: `SSWConsulting/SSW.YakShaver.Desktop` _(always)_
- **body**: Use the template below

**Body template:**

```
Part of [Parent Epic Title] [SourceOrg/SourceRepo]#[ParentIssueNumber]

### Scope
[1–2 sentences describing what this sub-epic covers and why it is grouped together]

### PBIs
<!-- These existing PBIs should be linked here as sub-issues -->
- [SourceOrg/SourceRepo]#[number] — [title]
- [SourceOrg/SourceRepo]#[number] — [title]
[... list all open PBIs in this cluster with their source repo prefix ...]

### Acceptance Criteria
This sub-epic is complete when all listed PBIs above are done.
```

## Step 4 — Comment on Each Original Epic

After creating all new sub-epics, use `add-comment` to post a reorganisation summary on each of the three **original** epics.

Use `target-repo` to direct comments to the correct repository:
- `target-repo: SSWConsulting/SSW.YakShaver` for Agent 2.0 (#2811) and Auth Migration (#3494)
- `target-repo: SSWConsulting/SSW.YakShaver.Desktop` for Desktop App (#677)

**Comment template:**

```markdown
## 🗂️ Epic Reorganised into Smaller Sub-Epics

This epic was too large for effective sprint planning. It has been split into smaller,
focused sub-epics in [SSWConsulting/SSW.YakShaver.Desktop](https://github.com/SSWConsulting/SSW.YakShaver.Desktop).
Each sub-epic groups related PBIs by functional area.

### New Sub-Epics Created

| Sub-Epic | Scope |
|----------|-------|
| SSWConsulting/SSW.YakShaver.Desktop#[number] — [name] | [brief scope, ~8 words] |
| SSWConsulting/SSW.YakShaver.Desktop#[number] — [name] | [brief scope, ~8 words] |

### PBI Assignments

| PBI | Moved to Sub-Epic |
|-----|------------------|
| #[number] [title] | SSWConsulting/SSW.YakShaver.Desktop#[sub_epic_number] |
[... list all open PBIs and their assigned sub-epic ...]

### 📌 Action Required — Complete the Sub-Issue Linking

The new sub-epics have been created. To finish the reorganisation:

1. **Open each new sub-epic in SSW.YakShaver.Desktop and set this issue as its parent**
2. **Move each PBI to be a sub-issue of its new sub-epic** (remove from this epic → add to sub-epic)

Or complete in bulk via GitHub CLI:

```bash
# For each new sub-epic — reference it as a sub-issue of this epic (cross-repo)
gh api repos/SSWConsulting/[SOURCE_REPO]/issues/[THIS_EPIC_NUMBER]/sub_issues \
  --method POST -f sub_issue_id=[NEW_DESKTOP_SUB_EPIC_NUMBER]

# For each PBI — remove from this epic, link to new sub-epic in Desktop repo
gh api repos/SSWConsulting/[SOURCE_REPO]/issues/[THIS_EPIC_NUMBER]/sub_issues/[PBI_NUMBER] \
  --method DELETE
```

> ℹ️ Replacing the sub-issue links is a manual step because the PBIs remain in their original
> repos — only the sub-epic tracking issues have moved to SSW.YakShaver.Desktop.
```

## Important Notes

- Only process **open** PBIs — do not touch closed/completed sub-issues
- The three original epics must remain open and unmodified
- Every new sub-epic goes in `SSWConsulting/SSW.YakShaver.Desktop` — no exceptions
- The `GH_AW_CROSS_REPO_PAT` secret is required for:
  - Reading issues in `SSWConsulting/SSW.YakShaver` (Agent 2.0, Auth Migration)
  - Creating all new sub-epics in `SSWConsulting/SSW.YakShaver.Desktop`
  - Posting comments on `SSWConsulting/SSW.YakShaver` issues
- If the secret is missing, warn clearly in a comment on each epic that the PAT must be configured at **Settings → Secrets → Actions → `GH_AW_CROSS_REPO_PAT`** in `SSWConsulting/SSW.YakShaver.Desktop`
