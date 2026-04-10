# Chinafy YakShaver Desktop — Specification

- Status: draft
- Deciders: @tino-liu @calumjs @ricksu978 @adamcogan @ZenoWang1999
- Date: 2026-04-09
- Tags: localization, china, i18n, llm, git-hosting, prompts

Technical Story: [✨ Chinafy - Spec out required changes to fully support China usage](https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/810)

---

## Final Decisions

China Accessible Model:

Option 1 - Not hard coded, can swap between models. Vercel AI SDK compatible? Tanstack AI?

Localization Strategy

Option 1

Chinese Prompt Engineering

Option 1 - Somewhere in the README file to tell devs to update both prompts... Some mechanism that ensures application can test whether the prompt changes

github action that automatically translates the English propmpt changes... then auto do a new PR.

China-Based Git Hosting

Option 1 - Need to do MCP wrapper... this would take most of the time

Microsoft Graph / Entra auth - We're switching over to IdentityServer, and it supports WeChat login out of the box.


### Infra

Zeno already has a working version of a "China" curated version of YakShaver, an official Chinafy YakShaver could be built off from this existing KB


## Context

YakShaver Desktop is not currently "China-ready". Users in mainland China cannot reliably use the app because:

1. **AI providers** — OpenAI and Azure OpenAI are blocked or unstable behind the Great Firewall. Only DeepSeek (already integrated) is accessible, and it has no vision/video capability on its default `deepseek-chat` model.
2. **Localization** — There is **zero** i18n infrastructure. All UI text and system prompts are hardcoded English strings.
3. **Prompt quality** — The default system prompt at `src/backend/services/workflow/prompts.ts:1` is English-only and assumes English video transcriptions, lowering quality for Chinese-speaking users.
4. **Git hosting** — Only GitHub, Azure DevOps, and Jira are wired up via MCP presets (`src/shared/mcp/preset-servers.ts:53`). None are a good fit for teams that host code on Gitee or other China-based platforms.

## Decision Drivers

- **Accessibility from mainland China** — every dependency must be reachable without a VPN.
- **Chinese fluency (bilingual)** — per @ZenoWang1999's comment on #810, Chinese users mix English technical terms; models and prompts must handle both.
- **Video understanding** — YakShaver's core workflow captures video; the chosen model must support frame/video analysis or work cleanly with the existing `capture_video_frame` tool at `src/backend/services/mcp/internal/video-tools-server.ts`.

## China-Accessible AI Model

**Requirement (AC1):** List at least 3 China-accessible LLM options and evaluate against Chinese fluency, video processing, cost, latency, and integration effort.

> **Hard constraint:** YakShaver's core workflow is video-based. Every option below must support **native video input** — not just static-image vision. Models that only accept individual frames (e.g. DeepSeek-VL2) are excluded.

### Option 1 — Alibaba Qwen3-VL (通义千问) via DashScope *(recommended)*

Qwen3-VL is Alibaba Cloud's flagship vision-language model, served via DashScope (Model Studio). DashScope exposes an **OpenAI-compatible endpoint** at `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, so integration reuses the existing `createOpenAI` factory with only a `baseURL` override. Video input is supported via an `fps` parameter that controls frame extraction.

- ✅ **Native video understanding** — Qwen3-VL (and Qwen2.5-VL) accept video input directly with a configurable `fps` parameter; the model handles temporal frame extraction internally.
- ✅ **Best bilingual fluency** — trained heavily on Chinese + English; handles mixed technical terminology well (addresses @ZenoWang1999's concern).
- ✅ **OpenAI-compatible API** — fits the existing `LLM_PROVIDER_CONFIGS` factory at `src/shared/llm/llm-providers.ts:7`; ~15 lines to add. Streaming, tool calling, and LangChain SDK supported.
- ✅ **Hosted in China** — DashScope endpoints are in mainland China data centres, low latency for Chinese users. International endpoint also available.
- ✅ **Enterprise-ready** — SSW China customers likely already have Alibaba Cloud accounts.
- ✅ **Could eventually replace `capture_video_frame`** — current workflow extracts a single frame via FFmpeg; Qwen3-VL ingests the whole clip directly, simplifying `src/backend/services/mcp/internal/video-tools-server.ts`.
- ❌ Pricing is per-token in CNY; billing/invoicing separate from existing OpenAI/Azure billing.
- ❌ Vision/video pricing higher than text-only models.

### Option 2 — Moonshot Kimi K2.5

Kimi K2.5, released January 27, 2026, is Moonshot AI's flagship native multimodal agentic model. Built on continual pretraining over ~15 trillion mixed visual + text tokens, it scores 86.6% on VideoMMMU and supports video input via the official API (currently flagged as experimental).

- ✅ **Native multimodal architecture** — text, image, and video input in a single model; not a frame-based bolt-on.
- ✅ **Strong video benchmarks** — VideoMMMU 86.6%, processes temporal information across frames natively.
- ✅ **OpenAI-compatible API** — drop-in via `createOpenAI` with `baseURL` override; same integration shape as Option 1.
- ✅ **Long-context heritage** — Kimi has been the long-context leader in the Chinese ecosystem; useful for long video transcripts without chunking.
- ✅ **Thinking + non-thinking modes** — controllable reasoning depth, useful for cost/latency tuning.
- ✅ **Latest model (Jan 2026)** — strongest momentum among Chinese frontier models right now.
- ❌ **Video input is "experimental"** in the official API as of release — production-readiness unclear; may break or change without notice.
- ❌ Smaller enterprise footprint than Alibaba; less likely SSW China customers already have accounts.
- ❌ Pricing model less predictable than Qwen for sustained heavy video workloads.

### Option 3 — Zhipu GLM-4.5V / GLM-4.6V (智谱) via BigModel

Zhipu AI's GLM-4.5V (and the newer GLM-4.6V) is a multimodal reasoning model with native long-video understanding.

- ✅ **Native long-video understanding** — purpose-built for continuous video via 3D convolutions; arguably the most video-focused option.
- ✅ **Long context** — 128k on GLM-4.6V handles long video transcripts.
- ✅ **OpenAI-compatible** — drop-in via `createOpenAI` with `baseURL` override.
- ✅ **Transparent pricing** — $2/M input tokens, $6/M output tokens (USD) for GLM-4.5V.
- ✅ **Open-weight** — Hugging Face availability gives a self-hosting fallback if needed.
- ❌ **Smaller English ecosystem** — documentation primarily Chinese; community adapters less battle-tested.
- ❌ **Less name-recognition** with enterprise procurement than Alibaba.
- ❌ Reasoning/thinking-mode toggle behaviour differs from OpenAI conventions; may need extra parameter handling.

### Recommendation — Area 1

**Ship Option 1 (Qwen3-VL) as the primary China provider. This is what Zeno did.** It's the only option that combines (a) production-grade native video, (b) a fully stable OpenAI-compatible API, (c) enterprise-ready Alibaba Cloud distribution, and (d) the best bilingual fluency for code-switched Chinese/English technical content.

---

## Localization Strategy

**Requirement (AC2):** Document a localization plan including language selection UX and Simplified Chinese scope.

### Option 1 — `react-i18next` + JSON namespace files *(recommended)*

Industry-standard React i18n library. Pairs with `i18next` core. Works cleanly with Vite and Electron; supports lazy-loading namespaces, which keeps bundle size down.

- ✅ **De facto standard** for React+Vite; widely documented, low ramp-up.
- ✅ **Namespace support** — split translations per feature (settings, workflow, home) to avoid monolithic JSON files.
- ✅ **Runtime language switching** — fits a language dropdown in `SettingsDialog.tsx` without app restart.
- ✅ **Works with Electron renderer** — no SSR concerns.
- ✅ Has mature tooling: `i18next-parser` can auto-extract keys from source.
- ❌ Requires touching every UI component that renders user-facing text (~100+ files).

### Option 2 — `next-intl`

Modern ICU-first library, originally for Next.js but works standalone with React.

- ✅ First-class ICU MessageFormat for plurals, dates, numbers.
- ✅ Cleaner TypeScript ergonomics than `react-i18next`.
- ❌ **Designed for Next.js** — some features assume SSR; Electron renderer is pure CSR.
- ❌ Smaller community in non-Next.js React apps; fewer Electron examples.
- ❌ Switching later is costlier than picking the industry default now.

### Language Selection UX (applies to all options)

- Add a **Language** row to the General tab of `SettingsDialog.tsx`, above "Keyboard Shortcuts".
- Persist the choice via the existing `electron-store`-based settings storage.
- Default to `navigator.language` on first run; fall back to `en` if unsupported.
- Initial supported locales: `en` (English), `zh-CN` (Simplified Chinese). `zh-TW` out of scope for phase 1.

### Simplified Chinese Translation Scope

| Surface | In scope | Notes |
|---|---|---|
| Settings dialog (all tabs) | ✅ | ~60 strings |
| Home page empty states | ✅ | `HomePage.tsx:22` — ~10 strings |
| Workflow page | ✅ | User-facing status, errors |
| Toast / error messages | ✅ | From IPC handlers |
| Onboarding / first-run | ✅ | Critical for comprehension |
| Menu bar / tray menu | ✅ | Electron native menus |
| Keyboard shortcut labels | ⚠️ Partial | Shortcut keys stay English |
| Telemetry copy | ❌ Out of scope | Backend only |

---

## Chinese Prompt Engineering

**Requirement (AC3):** Document baseline system prompts and key prompt patterns for YakShaver workflows in Simplified Chinese.

### Option 1 — Bilingual prompt file, locale-driven selection *(recommended)*

Refactor `src/backend/services/workflow/prompts.ts` from a single `defaultProjectPrompt` export to a locale-keyed map (`{ en: ..., 'zh-CN': ... }`). The active locale from the i18n system selects the correct prompt at workflow execution time. Each locale has its own hand-crafted, native prompt — not a machine translation.

- ✅ **Consistent with Area 2 architecture** — same locale source of truth drives UI and prompts.
- ✅ **Native-quality prompts** — a bilingual engineer writes the Chinese prompt with idiomatic phrasing, not a translation.
- ✅ **Per-language optimisation** — Chinese prompt can include guidance specific to Chinese video content (e.g. instruction to preserve technical terms in English, per @ZenoWang1999's feedback).
- ✅ **No runtime cost** — selection is a dictionary lookup.
- ❌ Doubles the prompt maintenance surface — every prompt tweak must be made in both locales.
- ❌ Requires a bilingual reviewer in the PR loop.


### Option 2 — Runtime prompt injection based on detected input language

Detect the language of the video transcription (via a cheap classifier or the transcription model itself) and prepend language-specific instructions to the existing English base prompt.

- ✅ No user setting needed — "just works".
- ✅ Handles mixed-team scenarios where the UI is English but the video is Chinese.
- ❌ **Fragile detection** — code-switched speech (Chinese with English terms) is hard to classify.
- ❌ Instructions stacked on top of English base prompt still carry English bias.
- ❌ Adds a detection step to every workflow run — latency and failure mode.

### Option 3 — Fully localized prompt library with per-language task templates

Go beyond translating the system prompt: build a library of locale-specific task templates, examples, few-shot demonstrations, and issue body patterns.

- ✅ Highest output quality for each locale.
- ✅ Enables locale-specific workflows (e.g. Chinese-flavoured PBI templates).
- ❌ **Very high maintenance cost** — every workflow change now needs multi-locale updates.
- ❌ Out of scope for an MVP; better as a phase 3 enhancement.

---

## China-Based Git Hosting

**Requirement (AC4):** List at least 2 China-based Git hosting options and identify workflow changes needed.

Current integrations live at `src/shared/mcp/preset-servers.ts:53`. Adding a new preset is mechanically simple — the hard parts are (a) whether an MCP server exists for the target platform and (b) generalising the GitHub-specific token storage at `src/backend/ipc/github-token-handlers.ts`.

### Option 1 — Gitee (码云) via a new MCP preset *(recommended)*

Gitee is the de facto Chinese GitHub. It has a REST API similar in shape to GitHub's and is the most likely destination for SSW China customers' code.

- ✅ **Closest parity with the existing GitHub workflow** — Gitee's API covers issues, PRs, labels, and templates the same way.
- ✅ **Largest Chinese developer community** — most SSW China customers already use it.
- ✅ **Minimal preset changes** — add a `GITEE_PRESET_CONFIG` entry alongside the existing three in `preset-servers.ts`.
- ✅ **Fast domestic access** from mainland China.
- ❌ **No official Gitee MCP server exists today** — we'd need to either use a community MCP (unvetted) or build a thin MCP wrapper around Gitee's REST API. This is the main investment.
- ❌ `github-token-handlers.ts` is GitHub-specific; need to generalise token storage (e.g. `git-token-handlers.ts` keyed by provider).
- ❌ Issue template conventions on Gitee differ slightly from GitHub; prompt may need provider-aware instructions.

### Option 2 — GitCode (CSDN)

GitCode is CSDN's Git hosting platform, growing fast as a domestic alternative.

- ✅ Rapidly growing community.
- ✅ REST API available.
- ❌ **Smaller ecosystem** than Gitee; fewer enterprise customers.
- ❌ No known MCP server; same build/wrap investment as Gitee but with less payoff.
- ❌ API stability less proven than Gitee's.

### Option 3 — Coding.net (Tencent CloudBase DevOps)

Now part of Tencent Cloud's enterprise DevOps suite.

- ✅ Strong enterprise features (pipelines, artifact management).
- ✅ Backed by Tencent — stable funding.
- ❌ **Enterprise-locked** — individual/small-team access is awkward.
- ❌ Complex setup; users must be in a Tencent Cloud org.

### Workflow Changes Required (for any option)

1. Add new preset config in `src/shared/mcp/preset-servers.ts`, following the shape of `GITHUB_PRESET_CONFIG`.
2. Generalise `src/backend/ipc/github-token-handlers.ts` into a provider-aware token handler, or add a parallel `gitee-token-handlers.ts`.
3. Update `src/backend/services/workflow/prompts.ts` to make platform detection explicit (currently lists "GitHub, Azure DevOps, Jira" — add Gitee).
4. Add a settings card under `src/ui/src/components/settings/mcp/` mirroring `mcp-github-card.tsx`.
5. Decide on auth: Gitee supports personal access tokens (mirror the GitHub flow) and OAuth (higher effort).

---

## Cross-Cutting Concerns (not in the original ACs, but required to ship)

These are blockers that surfaced during codebase review and must be resolved for the app to actually run from mainland China:

| Concern | Issue | Action |
|---|---|---|
| **Auto-update endpoint** | `docs/release-settings.md` indicates updates come from GitHub Releases — blocked in China. | Add a mirror release channel (Aliyun OSS or Tencent COS). Make the update URL configurable. |
| **npm registry** | Build pipeline uses public npm — slow/blocked in China. | Document the `npmmirror.com` registry for China developers. Not a runtime concern. |
| **Microsoft Graph / Entra auth** | `src/backend/services/auth/microsoft-auth.ts` uses Azure AD — some tenants are restricted in China. | Flag as known limitation; Entra China cloud (`login.partner.microsoftonline.cn`) may be needed for enterprise. Scope: **out of phase 1**. |
| **Telemetry endpoints** | Backend sends telemetry — confirm destinations are reachable from China. | Audit `src/backend/services/telemetry/`; add China-mirror or disable-by-default for `zh-CN` locale. |
| **Screenshot upload** | `upload_screenshot` in `video-tools-server.ts` uploads to Azure Blob. | Verify Azure Blob endpoint reachability from China, or add an alternative (Aliyun OSS) for the `zh-CN` build. |
| **FFmpeg binary download** | FFmpeg binaries may be fetched from a blocked CDN at install time. | Verify and mirror if needed. |

These should be tracked as separate issues but linked from the Chinify epic.

---

## Links

- [Issue #810 — Chinafy spec](https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/810)
- [Vercel AI SDK — OpenAI-compatible providers](https://sdk.vercel.ai/providers/ai-sdk-providers/openai)
- [Alibaba DashScope — OpenAI compatibility mode](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)
- [Qwen3-VL — Video understanding via Model Studio](https://www.alibabacloud.com/help/en/model-studio/vision)
- [Kimi K2.5 — Moonshot AI Platform](https://platform.moonshot.ai/docs/guide/kimi-k2-5-quickstart)
- [Zhipu BigModel / GLM-4.5V open platform](https://bigmodel.cn/pricing)
- [react-i18next](https://react.i18next.com/)
- [Gitee OpenAPI](https://gitee.com/api/v5/swagger)
- [SSW Rule — Acceptance Criteria](https://www.ssw.com.au/rules/acceptance-criteria)
