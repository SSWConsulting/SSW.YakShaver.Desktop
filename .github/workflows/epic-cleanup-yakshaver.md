---
name: Epic Cleanup — Dry-Run Analysis of YakShaver Backlog
description: |
  Scans the YakShaver repos (Teams, Desktop, 360) for open epics whose sub-issue
  progress is below 100%, analyses their PBIs across states, and produces a single
  "Dry-Run Plan" report issue in SSWConsulting/SSW.YakShaver.Desktop. The report
  proposes smaller theme epics (tagged by product), flags open issues that look
  like duplicates of other work (open or closed) across the whole backlog, and
  suggests source epics that could themselves be closed or archived. No epics are
  created, linked, or modified — execution is deferred until a human confirms the plan.

on:
  workflow_dispatch:
    inputs:
      source_repos:
        description: "Comma-separated list of owner/repo to scan for open epics"
        required: false
        default: "SSWConsulting/SSW.YakShaver,SSWConsulting/SSW.YakShaver.Desktop,SSWConsulting/SSW.YakShaver360"
      target_repo:
        description: "Repo where the Dry-Run Plan report issue is created"
        required: false
        default: "SSWConsulting/SSW.YakShaver.Desktop"

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
  bash: true

network: {}

steps:
  - name: Validate GH_AW_CROSS_REPO_PAT
    run: |
      if [ -z "$GH_AW_PAT" ]; then
        echo "::error::GH_AW_CROSS_REPO_PAT secret is not configured."
        echo "The workflow needs a fine-grained PAT with Issues: Read on all source repos and Issues: Read+Write on the target repo."
        exit 1
      fi
    env:
      GH_AW_PAT: ${{ secrets.GH_AW_CROSS_REPO_PAT }}

safe-outputs:
  staged: true
  github-token: ${{ secrets.GH_AW_CROSS_REPO_PAT }}
  create-issue:
    max: 1
    title-prefix: ""
    target-repo: ${{ inputs.target_repo }}
---

# Epic Cleanup — Dry-Run Analysis

You are an expert product backlog manager. Your job is to **analyse** — not execute — a cleanup of the YakShaver product backlog across multiple repos and produce a single report issue that a human can review, tick off, and then separately execute.

## Inputs

- `source_repos` — comma-separated list of `owner/repo` to scan. Default: `SSWConsulting/SSW.YakShaver`, `SSWConsulting/SSW.YakShaver.Desktop`, `SSWConsulting/SSW.YakShaver360`.
- `target_repo` — where the single Dry-Run Plan report issue is created. Default: `SSWConsulting/SSW.YakShaver.Desktop`.

Parse `${{ inputs.source_repos }}` on commas and trim whitespace.

## Product mapping

Each source repo maps to a **product tag** used when labelling proposed new epics in the report:

| Repo | Product tag |
|------|-------------|
| `SSWConsulting/SSW.YakShaver` | `teams` (also hosts shared backend / portal — tag as `shared` when a PBI is clearly backend/portal work rather than Teams UX) |
| `SSWConsulting/SSW.YakShaver.Desktop` | `desktop` |
| `SSWConsulting/SSW.YakShaver360` | `360` |

When a cluster spans multiple products, pick the dominant one as the primary tag and list the others in the epic body.

---

## Step 1 — Discover in-scope epics

For each repo in `source_repos`:

1. Query issues where **issue type = "Epic"** (GitHub's native issue types, not a label) AND **state = OPEN**.
2. For each epic, read its **sub-issue progress** (`completed` / `total`).
3. **Skip epics where `completed == total`** — those are already done. Record them in the "Skipped epics" section of the report.
4. For the remaining qualifying epics, read:
   - Epic title, number, repo, labels, and body (first few paragraphs is enough)
   - **All sub-issues (both open and closed)** — for each, read title, number, state, labels, last-updated date, **and the full issue body**. The full body is required so you have enough context to cluster accurately in Step 2 and to judge duplicate similarity in Step 3.

**Closed sub-issues are in scope for clustering.** Treat them the same as open ones in Step 2 — a closed PBI still belongs in whichever new smaller epic matches its theme, so the future epic's progress bar reflects historical work. Do not drop closed sub-issues just because they are done.

---

## Step 2 — Cluster PBIs into proposed smaller epics

Treat the PBIs from all in-scope epics as one unified pool and cluster them by theme.

**Clustering rules:**
- Each cluster should represent a coherent functional area (e.g. `🔌 MCP & AI Pipeline`, `🎬 Video Recording`, `♻️ Auth Migration`, `🐛 Desktop Bug Fixes`, `🏗️ Platform & Infrastructure`, `🎨 UX Improvements`).
- **Cross-repo / cross-product clustering is encouraged** — a Teams PBI and a Desktop PBI on the same topic go in the same cluster.
- Target **10–20 PBIs per cluster** when the pool allows; let the actual themes drive the count.
- The total number of proposed new epics is **flexible** — do not force a fixed count.
- A PBI spanning two themes goes in whichever is dominant.
- All-closed clusters are acceptable — they show historical progress the future epic will inherit.

Assign each cluster a product tag based on the dominant source:
- `teams` — mostly PBIs from `SSW.YakShaver` that are clearly Teams UX
- `desktop` — mostly PBIs from `SSW.YakShaver.Desktop`
- `360` — mostly PBIs from `SSW.YakShaver360`
- `shared` — backend / portal / infrastructure work that serves multiple products

---

## Step 3 — Detect duplicate candidates (whole backlog)

Duplicate detection is **not** limited to PBIs under the in-scope epics. Scan the full backlog of each repo in `source_repos`.

**Build two pools:**
- **Left pool (candidates to flag):** every **open** issue in every `source_repos` repo — including issues that have no parent epic at all.
- **Right pool (match targets):** every issue (open **or** closed) in every `source_repos` repo.

For each open issue in the left pool, check whether it appears to duplicate an issue in the right pool:

- Compare titles and first paragraphs of bodies for semantic similarity.
- Look for explicit wording like "duplicate of", "supersedes", "same as" in either issue's body or comments.
- Flag only where the signal is strong — precision matters more than recall here, because each flag costs a human triage step.

**Do not flag** closed-vs-closed duplicates — they are historical noise and don't need action.

**Do flag:**
- Open ↔ closed — the open one may already be done, close it.
- Open ↔ open — the two open issues overlap, merge or close one.

For each flagged pair, record:
- The open issue reference and title (always on the left)
- The matched issue reference, its state (open / closed-on-date), and title
- A one-line reason (e.g. "title near-match", "explicit 'duplicate of' in #X's comment", "body describes the same acceptance criteria")

---

## Step 4 — Suggest source epics to close or archive

Review each in-scope source epic (the ones with progress < 100%) against your clustering. Suggest it for close/archive when:

- All of its remaining open PBIs are duplicates flagged in Step 3.
- All of its remaining open PBIs have been absorbed into proposed new smaller epics and the source epic adds no extra scope of its own.
- Its body describes work that has been superseded by a decision or another initiative.

Also list the 100%-done epics from Step 1 here — they are straightforward close candidates.

---

## Step 5 — Produce the Dry-Run Plan report issue

Call `create_issue` **exactly once** with:

- `title`: `🧹 Dry-Run Plan — YakShaver Backlog Cleanup (YYYY-MM-DD)` (substitute today's date)
- `labels`: `Type: Refactor`, `cleanup`
- `body`: use the template below
- `temporary_id`: `aw_cleanup_report`

Do not include `issue_type`, `repo`, or `target-repo` — the safe-output config handles the target repo.

### Body template

```markdown
# 🧹 Dry-Run Plan — YakShaver Backlog Cleanup

**Run date:** YYYY-MM-DD
**Scanned repos:** SSWConsulting/SSW.YakShaver, SSWConsulting/SSW.YakShaver.Desktop, SSWConsulting/SSW.YakShaver360
**In-scope epics:** N (open, sub-issue progress < 100%)
**Total PBIs reviewed:** M (X open, Y closed)

> This is an **analysis only** — no epics have been created, no sub-issues have been linked, and no existing issues have been modified. Tick the confirmation checklist at the bottom once you're satisfied with the plan, then trigger the execute workflow.

---

## 1. Proposed smaller epics

### 🔌 Example Cluster Name — `product: desktop`

**Consolidates PBIs from:**
- SSWConsulting/SSW.YakShaver.Desktop#677 — ✨ YakShaver Desktop App

**Scope:** 2–3 sentences describing what this epic covers and the value it delivers.

**PBIs:**
- SSWConsulting/SSW.YakShaver.Desktop#123 — [title] (open)
- SSWConsulting/SSW.YakShaver.Desktop#124 — [title] (closed)
- SSWConsulting/SSW.YakShaver#456 — [title] (open)

[... one block per cluster ...]

---

## 2. Duplicate candidates (whole backlog)

Open issues anywhere in the scanned repos (not limited to epic sub-issues) that look like they duplicate other work. Both open↔closed and open↔open pairs are included. Closed↔closed duplicates are omitted — they don't need action.

| Open issue | Matched issue (state) | Reason |
|------------|------------------------|--------|
| SSWConsulting/SSW.YakShaver.Desktop#200 — [title] | SSWConsulting/SSW.YakShaver.Desktop#120 — [title] (closed 2025-11-02) | near-identical title and scope |
| SSWConsulting/SSW.YakShaver#305 — [title] | SSWConsulting/SSW.YakShaver.Desktop#210 — [title] (open) | same acceptance criteria, cross-repo overlap |

---

## 3. Source epics suggested for close or archive

Existing epics that can likely be closed once this plan is executed.

| Epic | Reason |
|------|--------|
| SSWConsulting/SSW.YakShaver#2811 — ✨ YakShaver Agent 2.0 | All remaining open PBIs absorbed into proposed epics 1, 3, and 5 |

---

## 4. Epics skipped (already 100% complete)

These were excluded from clustering because their sub-issue progress was 100%.

- SSWConsulting/SSW.YakShaver#NNN — [title]

---

## 5. ✅ Confirmation checklist

Tick each box once you've reviewed and agree. Add comments on this issue for anything you want changed before execution.

- [ ] Proposed smaller epics (Section 1) look right
- [ ] Duplicate candidates (Section 2) are genuine duplicates
- [ ] Source epics in Section 3 should be closed/archived after execution
- [ ] Ready to trigger the execute workflow

> After all boxes are ticked, run the execute workflow (future) — it will read this issue and perform the actual epic creation, sub-issue linking, and original-epic updates.
```

Use plain `owner/repo#number` references everywhere (not Markdown links). GitHub auto-links them and this keeps the comment under GitHub's HTTP-link cap.

---

## Important notes

- **No `create-issue` beyond the single report.** Do not attempt to create theme epics or a cleanup-report-per-product — one report issue only.
- **No `link-sub-issue` calls.** Linking is deferred to the execute workflow.
- **No `add-comment` calls.** Source-epic comments are not produced in this workflow.
- The three scanned repos stay untouched — do not modify, close, or relabel any existing issue.
- Include **all** PBIs from qualifying epics in the clusters — open and closed — so the proposed-epic scope reflects full context.
- If a source repo is unreachable (e.g. PAT lacks access), note it in the report's Scope section and continue with what you can read.
- The `GH_AW_CROSS_REPO_PAT` secret must have:
  - **Read** access to every repo in `source_repos`
  - **Read + Write (Issues)** access to `target_repo`
