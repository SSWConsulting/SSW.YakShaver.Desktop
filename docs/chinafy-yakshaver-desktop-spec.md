# Chinafy YakShaver — Specification (Desktop + Portal)

- Status: accepted
- Deciders: @tino-liu @calumjs @ricksu978 @adamcogan @ZenoWang1999
- Date: 2026-04-10
- Tags: localization, china, i18n, llm, git-hosting, prompts, payments, portal

Technical Story: [✨ Chinafy - Spec out required changes to fully support China usage](https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/810)

---

## Decision Outcome

| Area | Decision | Key Notes |
|---|---|---|
| **AI Model** | Option 1 — Qwen3-VL via DashScope | Not hardcoded to one model. Users can swap between providers. Must stay Vercel AI SDK compatible. Evaluate TanStack AI as a future alternative. |
| **Localization** | Option 1 — `react-i18next` + JSON namespaces | `en` + `zh-CN` in phase 1. |
| **Prompt Engineering** | Option 1 — Bilingual prompt file, locale-driven | Add README guidance requiring devs to update both locale prompts. Add a CI mechanism (GitHub Action) that auto-translates English prompt changes into a draft `zh-CN` PR for review. |
| **Git Hosting** | Option 1 — Gitee via MCP preset | Building the Gitee MCP wrapper is the largest time investment in this spec. |
| **Auth (cross-cutting)** | IdentityServer (replaces Entra) | Switching to IdentityServer, which supports **WeChat login** out of the box — solves the China auth problem without needing Entra China cloud. |
| **Build compliance** | Separate China build via Vite build-time substitution | Single codebase, two build outputs. All external URLs centralised in `endpoints.ts`, resolved at compile time. China binary contains **zero non-China infrastructure**. CI lint rule prevents accidental leakage. |
| | | |
| **Portal — Payments** | Add Alipay + WeChat Pay alongside Stripe | Stripe is USD-only and not usable in China. Need a China payment gateway for CNY (¥). See [Portal section](#yakshaver-portal-sswYakShaver). |
| **Portal — Auth** | IdentityServer + WeChat/DingTalk social login | NextAuth + Azure AD is the current stack. China portal needs WeChat and/or DingTalk as login providers. |
| **Portal — Hosting** | Azure China or Aliyun | Current infra is Azure Global (Bicep IaC). China portal must be hosted within China + ICP filing required. |
| **Portal — Git integrations** | Add Gitee service alongside GitHub | Backend `GitHubService.cs` and `AzureDevOpsService.cs` need a `GiteeService.cs` equivalent. |
| **Portal — i18n** | `next-intl` for the Next.js portal | No i18n exists today. `next-intl` is the standard for Next.js 15 App Router (distinct from Desktop's `react-i18next`). |

### Existing Foundation

@ZenoWang1999 already has a working "China-curated" version of YakShaver with its own knowledge base. The official Chinafy implementation should build on top of this existing KB rather than starting from scratch.


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

### Option 1 — Alibaba Qwen3-VL (通义千问) via DashScope *(decided)*

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

### Decision — AI Model

**Ship Option 1 (Qwen3-VL) as the primary China provider — this is what @ZenoWang1999 already uses in the working China-curated version.** It combines (a) production-grade native video, (b) a fully stable OpenAI-compatible API, (c) enterprise-ready Alibaba Cloud distribution, and (d) the best bilingual fluency for code-switched Chinese/English technical content.

**Important:** The implementation must **not hardcode** Qwen as the only China model. The existing `LLM_PROVIDER_CONFIGS` factory pattern at `src/shared/llm/llm-providers.ts` already supports swapping providers — Qwen ships as the default for China users, but all three options above are Vercel AI SDK-compatible via `createOpenAI` with a `baseURL` override, so users can switch freely. Evaluate TanStack AI as a potential future alternative to Vercel AI SDK.

---

## Localization Strategy

**Requirement (AC2):** Document a localization plan including language selection UX and Simplified Chinese scope.

### Option 1 — `react-i18next` + JSON namespace files *(decided)*

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

### Option 1 — Bilingual prompt file, locale-driven selection *(decided)*

Refactor `src/backend/services/workflow/prompts.ts` from a single `defaultProjectPrompt` export to a locale-keyed map (`{ en: ..., 'zh-CN': ... }`). The active locale from the i18n system selects the correct prompt at workflow execution time. Each locale has its own hand-crafted, native prompt — not a machine translation.

- ✅ **Consistent with Area 2 architecture** — same locale source of truth drives UI and prompts.
- ✅ **Native-quality prompts** — a bilingual engineer writes the Chinese prompt with idiomatic phrasing, not a translation.
- ✅ **Per-language optimisation** — Chinese prompt can include guidance specific to Chinese video content (e.g. instruction to preserve technical terms in English, per @ZenoWang1999's feedback).
- ✅ **No runtime cost** — selection is a dictionary lookup.
- ❌ Doubles the prompt maintenance surface — every prompt tweak must be made in both locales.
- ❌ Requires a bilingual reviewer in the PR loop.

**Mitigations for the maintenance cost (decided):**
1. **README / CONTRIBUTING guidance** — add a section explicitly instructing developers to update both `en` and `zh-CN` prompts when modifying `prompts.ts`.
2. **GitHub Action for auto-translation** — when a PR modifies the English prompt, a CI workflow automatically generates a draft `zh-CN` translation (via LLM) and opens a follow-up PR for bilingual review. This catches forgotten updates and reduces friction.
3. **Prompt regression tests** — add a test that asserts both locale prompts exist and contain required structural markers (e.g. issue template instructions, screenshot instructions). Fails CI if a new English prompt key is added without a `zh-CN` counterpart.

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

### Option 1 — Gitee (码云) via a new MCP preset *(decided)*

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

## China Build Compliance — No Foreign Infrastructure in Binary

> **Problem:** China's Cybersecurity Law and software distribution audits require that a China-distributed app binary contains **zero references to infrastructure outside of China**. Auditors inspect the compiled binary — not just runtime behaviour. If `api.github.com`, `login.microsoftonline.com`, or Azure Blob endpoints appear anywhere in the packaged app, it will fail.

### Audit of non-China endpoints currently baked into the binary

| Endpoint in binary | File | Purpose | China replacement |
|---|---|---|---|
| `https://api.github.com` | `release-channel-handlers.ts:33`, `github-token-handlers.ts:46` | Releases + token verification | Gitee API |
| `https://api.githubcopilot.com/mcp/` | `preset-servers.ts:17` | GitHub MCP server | Gitee MCP |
| `@azure-devops/mcp` (npx download) | `preset-servers.ts:31` | Azure DevOps MCP | Remove from China build |
| `https://mcp.atlassian.com/v1/mcp` | `preset-servers.ts:42` | Jira MCP server | Remove from China build |
| `https://login.microsoftonline.com/` | `microsoft-auth.ts:48` | Azure AD / Entra auth | IdentityServer (WeChat login) |
| Application Insights SDK | `telemetry-service.ts:1,52` | Telemetry | Aliyun ARMS or self-hosted |
| Google OAuth2 + YouTube v3 API | `youtube-oauth.ts:21`, `youtube-client.ts:74` | YouTube upload | Bilibili/Youku/Saved to AliCloud or remove |
| OpenAI + Azure OpenAI SDK endpoints | `llm-providers.ts:1-3` | LLM providers | DashScope / DeepSeek only |
| `https://www.youtube.com/watch?v=` | `youtube-url-utils.ts:59` | Video URL construction | China Video Host URL or remove |

### Option 1 — Separate China build via Vite build-time substitution *(decided)*

Create a **region-aware build pipeline** using Vite's `define` / `import.meta.env` to resolve all external endpoints at compile time. The China build literally does not contain non-China URLs in its output — they are replaced during compilation, not toggled at runtime.

**How it works:**

1. **Centralise all external endpoints** into a single `src/shared/config/endpoints.ts` module that reads from build-time constants:
   ```ts
   // src/shared/config/endpoints.ts
   export const ENDPOINTS = {
     auth:       __AUTH_URL__,        // Vite define'd at build time
     telemetry:  __TELEMETRY_URL__,
     releases:   __RELEASES_URL__,
     videoHost:  __VIDEO_HOST_URL__,
   } as const;
   ```

2. **Two `.env` files** consumed by Vite:
   - `.env.global` — contains `api.github.com`, Azure, YouTube, etc.
   - `.env.china` — contains Gitee, DashScope, IdentityServer, Aliyun, etc.

3. **Two CI build targets** in the pipeline:
   - `npm run build:global` → loads `.env.global` → global binary
   - `npm run build:china` → loads `.env.china` → China binary

4. **Conditional preset servers** — `PRESET_MCP_SERVERS` in `preset-servers.ts` is populated based on the build region (GitHub/Azure DevOps/Jira for global, Gitee for China).

5. **Conditional LLM providers** — `LLM_PROVIDER_CONFIGS` in `llm-providers.ts` only includes China-accessible providers (DashScope, DeepSeek) in the China build, and all providers in the global build.

- ✅ **Audit-proof** — the China binary physically cannot contain non-China URLs. String inspection passes.
- ✅ **Single codebase** — no fork; same source, different build output.
- ✅ **Vite-native** — Vite's `define` plugin handles this with zero runtime overhead; dead code from the other region is tree-shaken out.
- ✅ **CI-friendly** — two parallel `electron-builder` jobs in the same pipeline.
- ❌ Requires refactoring every hardcoded URL into the centralised `endpoints.ts` config (~10 files identified above).
- ❌ Two builds to test, package, sign, and distribute. QA surface area doubles.
- ❌ Risk of accidental leakage if a developer adds a new hardcoded URL without going through `endpoints.ts`. Needs a CI lint rule.

### Option 2 — Maintain a separate China fork

Fork the repo into `SSW.YakShaver.Desktop.CN` and maintain China-specific code independently.

- ✅ Maximum control — no risk of accidental foreign-infra leakage.
- ✅ China team can move independently.
- ❌ **Codebase divergence** — features, bugfixes, and security patches must be manually cherry-picked between repos. This is a maintenance nightmare at scale.
- ❌ Doubles the engineering cost for every shared feature.
- ❌ Violates DRY at the repo level.

### Decision — China Build Compliance

**Option 1 (build-time substitution)** — single codebase, two build outputs. Add a CI lint rule (`no-hardcoded-urls`) that fails the build if any `https://` literal outside of `endpoints.ts` is detected in `src/`, preventing accidental leakage by future contributors.

<!-- ### Implementation steps

1. Create `src/shared/config/endpoints.ts` as the single source of truth for all external URLs.
2. Refactor the ~10 files above to import from `endpoints.ts` instead of hardcoding URLs.
3. Create `.env.global` and `.env.china` with the region-specific values.
4. Update `vite.config.mts` to use `define` for build-time substitution based on `VITE_REGION`.
5. Add a `build:china` script to `package.json`.
6. Add a CI lint rule that greps for `https://` literals in `src/` outside of `endpoints.ts` and fails the build.
7. Update `electron-builder` config for dual packaging (global + China signing/notarisation).

--- -->

<!-- ## Other Cross-Cutting Concerns

| Concern | Issue | Action |
|---|---|---|
| **Auto-update endpoint** | `release-channel-handlers.ts` points to GitHub Releases — blocked in China. | Resolved by build-time substitution: China build uses Aliyun OSS / Tencent COS mirror. |
| **npm registry** | Build pipeline uses public npm — slow/blocked in China. | Document `npmmirror.com` for China CI runners. Not a runtime concern (not in binary). |
| **Auth — IdentityServer** | `microsoft-auth.ts` uses Azure AD / Entra — restricted in China. | **Decided:** Switch to IdentityServer with WeChat login. China build points to the China IdentityServer instance. |
| **Telemetry** | Application Insights SDK in `telemetry-service.ts` — Azure hosted. | China build replaces with Aliyun ARMS or disables telemetry. |
| **Screenshot upload** | `upload_screenshot` in `video-tools-server.ts` uploads to Azure Blob. | China build targets Aliyun OSS endpoint. |
| **FFmpeg binary** | May be fetched from a blocked CDN at install time. | Bundle FFmpeg in both builds, or mirror on Aliyun OSS for China. |
| **YouTube integration** | `youtube-oauth.ts`, `youtube-client.ts` — Google APIs blocked in China. | China build excludes YouTube entirely. Evaluate Bilibili API as a future replacement. |

These should be tracked as separate issues linked from the Chinafy epic. -->

---

## YakShaver Portal (`SSW.YakShaver`)

> The Desktop app is only half the product. The YakShaver Portal at `SSW.YakShaver/` is where users manage connected repos, subscriptions, team settings, and video hosting. If the portal isn't China-ready, the Desktop app has nowhere to point Chinese customers.

**Portal tech stack:** Next.js 15 (React 19) frontend, ASP.NET Core (.NET 8) backend, SQL Server, Azure infra (Bicep IaC), NextAuth.js + Azure AD auth, Stripe payments.

### Portal audit — non-China dependencies

| Dependency | Files | Impact |
|---|---|---|
| **Stripe (USD-only payments)** | `backend/.../StripeSubscription/` — webhook + checkout endpoints; `frontend/src/app/(portal)/settings/plan/` — plan selection UI | No CNY (¥) payment. Cannot monetise in China. |
| **NextAuth + Azure AD** | `frontend/src/app/api/auth/[...nextauth]/options.ts` — Azure AD client ID/secret/tenant | No Chinese social login (WeChat, DingTalk). Users can't sign in. |
| **GitHub service** | `backend/.../Tasks/Infrastructure/GitHub/GitHubService.cs` — Octokit, JWT via GitHub App | GitHub API blocked. Repos can't be connected. |
| **Azure DevOps service** | `backend/.../AzureDevOps/AzureDevOpsService.cs` — `dev.azure.com` hardcoded | Accessible but no Chinese user base. |
| **YouTube/Google OAuth** | `backend/.../DesktopVideoHostings/Infrastructure/DesktopYouTubeOAuthService.cs` — `oauth2.googleapis.com` | Google blocked. Video hosting broken. |
| **Azure hosting** | `backend/infra/main.bicep` — App Service, ACR, Key Vault, Service Bus | All on Azure Global. Not in China. |
| **Domain** | `api.yakshaver.ai`, `portal.yakshaver.ai` in appsettings | No ICP filing. Domain may be slow or blocked from China. |
| **Email (SendGrid)** | Email sending via SendGrid | SendGrid may have delivery issues to China email providers. |
| **i18n** | None | All strings hardcoded English. |

---

### Area 5 — China Payment Gateway (CNY ¥)

**The single biggest blocker to monetising in China.** Stripe does not support domestic Chinese payments. Chinese consumers expect to pay via Alipay or WeChat Pay — credit card penetration is very low.

#### Option 1 — Alipay + WeChat Pay via an aggregator (e.g. Ping++) *(recommended)*

Use a Chinese payment aggregator that wraps Alipay, WeChat Pay, and UnionPay behind a single API. Ping++ (now part of ReadyPay) is the "Stripe of China" — same developer experience, single SDK, handles CNY settlement.

- ✅ **Single integration covers Alipay + WeChat Pay + UnionPay** — the three payment methods that cover ~95% of Chinese consumers.
- ✅ **Stripe-like developer experience** — REST API with webhooks, similar to the existing `StripeSubscription` module pattern.
- ✅ **Handles CNY settlement** — receives ¥, settles to a Chinese bank account. No FX complexity.
- ✅ **Recurring billing support** — subscription/plan model maps to YakShaver's existing `SubscriptionPlanResponse` type.
- ✅ **Keeps Stripe for global** — the two systems run side by side; region determines which gateway is used.
- ❌ Requires a Chinese business entity or partnership to receive CNY settlement.
- ❌ New payment module in the backend (`Features/ChinaPayment/` alongside `StripeSubscription/`).
- ❌ Plan pricing must be defined in CNY — not just a currency conversion of USD plans.

#### Option 2 — Direct Alipay + WeChat Pay integration (no aggregator)

Integrate Alipay Open Platform and WeChat Pay APIs directly.

- ✅ No aggregator middleman — lower per-transaction fees.
- ✅ Direct relationship with the payment platforms.
- ❌ **Two separate integrations** — Alipay and WeChat Pay have completely different APIs, SDKs, and certification processes.
- ❌ Higher maintenance burden — two webhook handlers, two reconciliation flows.
- ❌ UnionPay would be a third integration if needed.

#### Option 3 — Stripe China (limited)

Stripe has limited support for Chinese businesses via cross-border payments.

- ✅ Same Stripe SDK — minimal code changes.
- ✅ Familiar developer experience.
- ❌ **Does not support Alipay/WeChat Pay as payment methods for domestic Chinese subscriptions** — only for cross-border one-time payments.
- ❌ Cannot settle in CNY to a Chinese bank account without a Hong Kong or Singapore entity.
- ❌ Chinese consumers will not enter credit card details for a subscription.

---

### Area 6 — Portal Auth for China

#### Option 1 — IdentityServer + WeChat social login *(recommended)*

Aligns with the Desktop decision. The portal replaces NextAuth + Azure AD with IdentityServer, adding WeChat as a social login provider. IdentityServer supports WeChat login out of the box.

- ✅ **Consistent with the Desktop auth decision** — single identity provider for the whole product.
- ✅ **WeChat login** — the most common social login in China. 1.3B+ users.
- ✅ **IdentityServer is self-hosted** — can run in Azure China or Aliyun, fully within Chinese infra.
- ✅ Can keep Azure AD / GitHub login for global users alongside WeChat for China.
- ❌ Migration from NextAuth to IdentityServer is non-trivial — session handling, token refresh, callback URLs all change.
- ❌ WeChat Open Platform requires a Chinese business entity for app registration.

#### Option 2 — Authing.cn (Chinese IDaaS)

Use a China-native identity-as-a-service platform that wraps WeChat, DingTalk, Alipay login.

- ✅ Managed service — no self-hosting.
- ✅ Pre-built connectors for all Chinese social providers.
- ❌ Vendor lock-in to a China-specific IDaaS.
- ❌ Doesn't align with the Desktop IdentityServer decision — two auth stacks.
- ❌ Data residency concerns if global users also go through Authing.

---

### Area 7 — Portal Git Integration (Gitee)

#### Option 1 — Add `GiteeService.cs` alongside `GitHubService.cs` *(recommended)*

Mirror the existing service pattern. The backend already has `GitHubService.cs` and `AzureDevOpsService.cs` under `Features/Tasks/Infrastructure/`. Add a `Gitee/GiteeService.cs` that implements the same interface using Gitee's REST API.

- ✅ **Follows the existing pattern** — same interface, different implementation.
- ✅ **Gitee's API is similar to GitHub's** — issues, PRs, labels, webhooks map closely.
- ✅ **Consistent with the Desktop Gitee MCP decision** — same platform end-to-end.
- ❌ Gitee's API has quirks vs GitHub (different pagination, different webhook payloads). Needs testing.
- ❌ Gitee App registration for OAuth is a separate process from GitHub Apps.

#### Option 2 — GitLab (self-hosted in China)

- ✅ Mature API with existing .NET clients.
- ❌ Requires each customer to self-host — not a SaaS solution.
- ❌ Doesn't match the Desktop decision.

---

### Area 8 — Portal Hosting & Infrastructure

#### Option 1 — Azure China (operated by 21Vianet) *(recommended)*

Deploy the same Bicep IaC to Azure China. Most Azure services (App Service, SQL Database, Key Vault, Service Bus, Container Registry) are available in the China regions.

- ✅ **Minimal IaC changes** — same Bicep templates, different subscription/region parameters.
- ✅ **Same operational model** — the team already knows Azure.
- ✅ **Compliance-ready** — Azure China is operated by 21Vianet, a Chinese entity. Data stays in China.
- ❌ **Separate Azure subscription** — Azure China is a completely separate cloud; different portal, different billing, different identity.
- ❌ Some services have feature gaps vs Azure Global.
- ❌ Requires ICP filing for the `.cn` or custom domain.

#### Option 2 — Aliyun (Alibaba Cloud)

- ✅ Largest China cloud provider — best domestic network performance.
- ✅ Full service parity for what YakShaver needs (ECS, RDS, OSS, Message Queue).
- ❌ **Complete IaC rewrite** — Bicep doesn't work with Aliyun; need Terraform or Pulumi.
- ❌ Different operational model — team needs to learn Aliyun console and APIs.
- ❌ Vendor diversification cost.

#### Option 3 — Tencent Cloud

- ✅ Strong in gaming/media — good CDN for video-heavy workloads.
- ❌ Same IaC rewrite problem as Aliyun.
- ❌ Smaller enterprise footprint than Aliyun for non-gaming.

### Domain & ICP Filing

Any website served to Chinese users from within China **must** have an ICP (Internet Content Provider) filing. This is not optional — hosting providers will block the domain without it.

- Register a `.cn` domain (e.g. `yakshaver.cn`) or file ICP for the existing `.ai` domain.
- ICP filing requires a Chinese business entity.
- Processing time: 1–4 weeks depending on the province.
- This is on the **critical path** — no domain, no portal.

---

### Area 9 — Portal Localization

#### Option 1 — `next-intl` for the Next.js 15 App Router *(recommended)*

The portal is Next.js 15 with App Router — `next-intl` is the standard choice here (different from the Desktop's `react-i18next` which is for Vite+Electron).

- ✅ **Built for Next.js App Router** — first-class support for Server Components, `generateMetadata`, etc.
- ✅ **ICU MessageFormat** — handles Chinese plurals, dates, numbers correctly.
- ✅ **Middleware-based locale detection** — can route `yakshaver.cn` → `zh-CN` automatically.
- ❌ Different library from the Desktop (`react-i18next`) — translation files are not directly shareable. However, the portal and desktop have very different UI surfaces so shared translations would be minimal anyway.

#### Option 2 — `react-i18next` (same as Desktop)

- ✅ Same library as Desktop — shared tooling.
- ❌ `react-i18next` in Next.js App Router requires extra wiring for Server Components. `next-intl` handles this natively.
- ❌ Going against the ecosystem recommendation for the sake of consistency isn't worth it.

---

### Portal — Summary of effort

| Area | Effort | Critical path? |
|---|---|---|
| **ICP filing + `.cn` domain** | Bureaucratic, 1–4 weeks | **YES** — must start immediately |
| **Payment gateway (Alipay/WeChat Pay)** | High — new backend module + plan pricing in CNY | **YES** — can't monetise without it |
| **Auth (IdentityServer + WeChat login)** | High — migrate from NextAuth + add WeChat provider | **YES** — can't sign in without it |
| **Azure China deployment** | Medium — same Bicep, new subscription | **YES** — no hosting = no portal |
| **Gitee service** | Medium — new service following existing pattern | Yes — repo connection is core flow |
| **Portal i18n** | High — extract all strings, `next-intl` setup | Yes — unusable without Chinese UI |
| **YouTube removal / replacement** | Low — remove or feature-flag | No — video hosting is secondary |
| **Email (SendGrid → China alternative)** | Low — swap provider config | No — not launch-blocking |

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
