---
name: Epic Cleanup — Cluster PBIs into Smaller Epics
description: |
  Analyses the three large YakShaver epics in the Product Backlog, clusters ALL their
  PBIs (open and closed) thematically into focused smaller epics — all created in
  SSWConsulting/SSW.YakShaver.Desktop — for better sprint planning and progress tracking.

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
    max: 12
  add-comment:
    max: 6
    target: "*"
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

For each cluster identified in Step 2, create a new epic issue using `create-issue`.

⚠️ **Set `target-repo: SSWConsulting/SSW.YakShaver.Desktop` on every `create-issue` call.**

**Issue fields:**

- **title**: `[Emoji] [Cluster Name]`
  - Example: `🔌 MCP & AI Pipeline`
- **issue_type**: `Epic`
- **labels**: `Type: Feature` for feature/AI clusters; `Type: Bug` for bug clusters; `Type: Refactor` for refactor clusters
- **target-repo**: `SSWConsulting/SSW.YakShaver.Desktop`
- **body**: Use the template below exactly

**Body template for each new epic:**

```markdown
Consolidates PBIs from:
- [source epic 1 title] — [SourceOrg/SourceRepo]#[number]
- [source epic 2 title] — [SourceOrg/SourceRepo]#[number]  (if this cluster spans multiple source epics)

### Scope
[2–3 sentences describing what this epic covers, which source epics it draws from, and the value it delivers]

### Progress

> ✅ = done · 🔲 = open / in progress

| # | Repo | Title | Status |
|---|------|-------|--------|
| [number] | SSW.YakShaver | [title] | ✅ |
| [number] | SSW.YakShaver.Desktop | [title] | 🔲 |
[... one row per PBI in this cluster, all states, all source repos ...]

**[X] / [total] done**

### Acceptance Criteria
This epic is complete when all 🔲 open PBIs in the progress table above are closed.
```

---

## Step 4 — Comment on Each Original Epic

After all new epics are created, post one summary comment on each of the three **original** epics using `add-comment`.

Target repos for comments:
- `target-repo: SSWConsulting/SSW.YakShaver` for Agent 2.0 (#2811) and Auth Migration (#3494)
- `target-repo: SSWConsulting/SSW.YakShaver.Desktop` for Desktop App (#677)

**Comment body:**

```markdown
## 🗂️ Epic Reorganised — Smaller Epics Created

This epic's PBIs have been clustered thematically (along with related PBIs from sibling epics)
into focused smaller epics in
[SSWConsulting/SSW.YakShaver.Desktop](https://github.com/SSWConsulting/SSW.YakShaver.Desktop).

### New Epics (containing PBIs from this epic)

| Epic | Open | Done | Scope |
|------|------|------|-------|
| [SSW.YakShaver.Desktop#number](link) — [name] | [X] open | [Y] done | [~10 word description] |
[... only list new epics that contain at least one PBI from *this* original epic ...]

### PBIs from This Epic → New Epic Assignment

| PBI | State | New Epic |
|-----|-------|---------|
| SSWConsulting/[repo]#[number] [title] | ✅/🔲 | [SSW.YakShaver.Desktop#number](link) |
[... all PBIs from this original epic, open and closed ...]

### 📌 Action Required

1. **Link each new epic above as a sub-issue of this epic** so the GitHub progress bar updates
2. **Re-assign each PBI as a sub-issue of its new epic** (remove from this epic → add to the smaller one)

GitHub CLI commands:

```bash
# Add a new epic as a sub-issue of this epic
gh api repos/SSWConsulting/[SOURCE_REPO]/issues/[THIS_EPIC]/sub_issues \
  --method POST -f sub_issue_id=[NEW_EPIC_NUMBER]

# Move a PBI: remove from this epic
gh api repos/SSWConsulting/[SOURCE_REPO]/issues/[THIS_EPIC]/sub_issues/[PBI_NUMBER] \
  --method DELETE
# Move a PBI: add to new epic in Desktop repo
gh api repos/SSWConsulting/SSW.YakShaver.Desktop/issues/[NEW_EPIC_NUMBER]/sub_issues \
  --method POST -f sub_issue_id=[PBI_NUMBER]
```

> ℹ️ PBIs remain in their original repos. Only the tracking epics move to SSW.YakShaver.Desktop.
```

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
