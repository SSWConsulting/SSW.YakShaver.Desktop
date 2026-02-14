# SSW YakShaver Desktop - AI Agent

## Agent Information

- **Name**: SSW YakShaver Desktop
- **Type**: Desktop Application (Electron)
- **Description**: An AI agent that helps you trim the fluff and get straight to the point
- **Author**: SSW Consulting
- **License**: AGPL-3.0-only
- **Repository**: https://github.com/SSWConsulting/SSW.YakShaver.Desktop

## Capabilities

YakShaver is a desktop AI agent with the following capabilities:

### Core Features

- **AI-Powered Content Processing**: Leverages OpenAI and Azure AI models to analyze and summarize content
- **YouTube Integration**: Process and extract insights from YouTube videos
- **Audio Processing**: Support for audio loopback and transcription using FFmpeg
- **Multi-LLM Support**: Compatible with OpenAI, Azure OpenAI, and DeepSeek models
- **MCP Server Integration**: Model Context Protocol (MCP) server configuration for extended capabilities
- **Screen Recording**: Native Electron screen capture with control UI and camera overlay

### Technical Capabilities

- Cross-platform desktop application (Windows, macOS, Linux)
- Secure API key storage using OS-level encryption
- Real-time content analysis and summarization
- YouTube video transcription and processing
- Graph API integration for Microsoft services
- Audio recording and processing capabilities

## Technical Stack

| Layer              | Technology                      | Version                |
| ------------------ | ------------------------------- | ---------------------- |
| Runtime            | Electron                        | 39.x                   |
| Language           | TypeScript                      | 5.6 (strict mode)      |
| Frontend           | React                           | 19                     |
| Build (Frontend)   | Vite                            | 5                      |
| Styling            | Tailwind CSS                    | v4 (OKLCH color space) |
| UI Components      | Radix UI + shadcn/ui            | Latest                 |
| Forms              | React Hook Form + Zod           | v7 / v4                |
| Database           | SQLite + Drizzle ORM            | -                      |
| Linting/Formatting | Biome                           | Latest                 |
| Testing            | Vitest (co-located `*.test.ts`) | Latest                 |
| Notifications      | Sonner                          | 2.x                    |

### Key Dependencies

- **AI/LLM**: `@ai-sdk/openai`, `@ai-sdk/azure`, `@ai-sdk/deepseek`, `@ai-sdk/mcp`, `ai`, `openai`
- **MCP**: `@modelcontextprotocol/sdk`
- **Database**: `drizzle-orm`, `better-sqlite3`
- **APIs**: `googleapis`, `@microsoft/microsoft-graph-client`, `google-auth-library`, `@azure/msal-node`
- **Video/Media**: `@ffmpeg-installer/ffmpeg`, `youtube-dl-exec`
- **Telemetry**: `applicationinsights`

## Project Structure

### High-Level Architecture

```
Frontend (React/Vite)  <-->  IPC Bridge  <-->  Backend (Electron/Node.js)
     src/ui/                                       src/backend/
  Renderer Process          Messages            Main Process
```

The frontend communicates **exclusively through IPC** channels. All backend functionality is exposed through 40+ typed IPC channels organized by feature.

### Directory Tree

```
SSW.YakShaver.Desktop/
├── src/
│   ├── backend/                       # Electron main process
│   │   ├── index.ts                   # Main entry point (app.whenReady)
│   │   ├── preload.ts                 # Security boundary (contextBridge)
│   │   ├── config/                    # Environment configuration
│   │   ├── constants/                 # Error messages, AI prompt templates
│   │   ├── db/                        # SQLite + Drizzle ORM layer
│   │   │   ├── schema.ts             # Database schema definitions
│   │   │   ├── migrate.ts            # Migration runner with backup/rollback
│   │   │   └── services/             # Database query services (functions)
│   │   ├── ipc/                       # IPC channel handlers (one class per domain)
│   │   │   └── channels.ts           # All IPC channel name constants
│   │   ├── services/                  # Business logic services
│   │   │   ├── auth/                  # YouTube & Microsoft OAuth
│   │   │   ├── ffmpeg/                # Video codec conversion
│   │   │   ├── mcp/                   # MCP orchestration (central AI hub)
│   │   │   ├── recording/             # Screen capture (singleton + EventEmitter)
│   │   │   ├── storage/               # Encrypted credential storage (BaseSecureStorage)
│   │   │   ├── telemetry/             # Application Insights telemetry service
│   │   │   ├── video/                 # Video metadata & YouTube service
│   │   │   └── workflow/              # Workflow state tracking
│   │   ├── events/                    # Service events -> IPC bridge
│   │   ├── types/                     # Backend type definitions
│   │   └── utils/                     # Error formatting, async helpers, path utils
│   │
│   ├── shared/                        # Shared types between frontend & backend
│   │   ├── types/                     # LLM, workflow, MCP, user-settings, telemetry types
│   │   ├── llm/                       # Provider factory configuration
│   │   └── constants/                 # Shared error messages
│   │
│   └── ui/                            # React frontend (Vite)
│       ├── vite.config.mts            # Vite build config (multi-entry)
│       ├── tsconfig.json              # Frontend TypeScript config
│       └── src/
│           ├── App.tsx                # Root component with providers
│           ├── App.css                # Tailwind theme + CSS variables
│           ├── components/            # Feature-based components
│           │   ├── ui/                # Radix UI primitives (shadcn/ui)
│           │   ├── auth/              # Authentication UI
│           │   ├── recording/         # Screen recording feature
│           │   ├── workflow/          # AI workflow visualization
│           │   ├── settings/          # Settings panels (llm/, mcp/, custom-prompt/, etc.)
│           │   ├── common/            # Shared components
│           │   └── dialogs/           # Reusable dialog components
│           ├── contexts/              # React Context providers (auth, settings)
│           ├── hooks/                 # Custom React hooks
│           ├── services/
│           │   └── ipc-client.ts      # Type-safe IPC wrapper (40+ endpoints)
│           ├── lib/utils.ts           # cn() helper for Tailwind classes
│           ├── types/                 # Frontend type definitions & enums
│           └── utils/                 # formatErrorMessage, helpers
│
├── docs/adr/                          # Architecture Decision Records
├── .github/workflows/                 # CI/CD (biome-check, release, build)
├── package.json                       # Root config & scripts
├── tsconfig.json                      # Backend TypeScript config
├── biome.json                         # Linting/formatting (2-space, 100 width)
├── drizzle.config.ts                  # DB migration config
├── vitest.config.ts                   # Test config
└── .env.example                       # Environment variable template
```

## Development Rules

### Rule 1: Only Edit Related Code

**Do not refactor, reformat, or move lines of code not related to the current issue.** This is the most important rule. Changes should be minimal and focused.

### Rule 2: Follow Good Practices Over Existing Patterns

Before writing new code, check how similar functionality is implemented in the codebase. If existing patterns follow good practices, match them. If existing patterns are suboptimal or violate good practices defined in this document, follow the good practices instead and add a `// TODO: Refactor to follow good practice - [describe what needs to change]` comment on the existing code so it can be improved later. Never silently propagate bad patterns.

### Rule 3: Use Context7 for Code Generation

When generating code, always use the Context7 MCP tools to resolve library IDs and get up-to-date documentation. Do not rely on memorized API signatures.

### Rule 4: Strict TypeScript

TypeScript strict mode is enabled everywhere. Never use `any`. Use `unknown` with type guards when the type is truly unknown.

### Rule 5: Biome Formatting

All code must pass Biome linting and formatting:

- **2-space indentation** (mandatory)
- **100-character line width** (mandatory)
- **Import organization** is automatic via Biome

```bash
npm run lint     # Auto-fix linting issues
npm run format   # Auto-format code
```

### Rule 6: Keep AGENTS.md Up to Date

When making changes that affect features, technical stack, architecture patterns, project structure, or development workflows, update this `AGENTS.md` file as part of the same PR. This includes adding/removing dependencies, introducing new patterns, changing directory structure, or modifying build/dev commands. This file is the source of truth for how the project works.

### Rule 7: Check Before Creating

Before adding new IPC channels, handlers, services, or utility functions, check if a similar one already exists. Specifically:

- **IPC channels**: Search `src/backend/ipc/channels.ts` for an existing domain (e.g., `youtube:`, `mcp:`, `llm:`) before creating a new one. Add to the existing domain if it fits.
- **Handler classes**: Check if a handler class for that domain already exists in `src/backend/ipc/`. Extend the existing class instead of creating a new file.
- **Services & utils**: Search for existing functions that do something similar. Modify or extend them rather than duplicating logic in a new function.
- **Components & hooks**: Check if an existing component or hook already covers the use case before creating a new one.

Prefer extending existing code over creating new files. Duplicated logic is harder to maintain than a slightly larger existing module.

### Rule 8: DRY and KISS

- **DRY (Don't Repeat Yourself)**: If the same logic appears in more than one place, extract it into a shared function, hook, or utility. Duplicated code leads to bugs when one copy is updated but the other is forgotten.
- **KISS (Keep It Simple, Stupid)**: Choose the simplest solution that works. Don't over-abstract, over-engineer, or add layers of indirection for hypothetical future needs. A few lines of straightforward code is better than a clever abstraction that's hard to follow.

## Good Practices

### General

- **Single Responsibility**: Each file, function, and class should do one thing well. If a function exceeds ~50 lines, consider extracting logic into helper functions.
- **Early Returns**: Use guard clauses to reduce nesting. Return early for error/edge cases instead of deep if-else chains.
- **Descriptive Names**: Variable and function names should describe their purpose. Avoid abbreviations (`btn` -> `button`, `msg` -> `message`) except for well-known acronyms (URL, API, IPC).
- **Constants Over Literals**: Extract string/number literals into named constants. Use `IPC_CHANNELS.YOUTUBE_START_AUTH` not `"youtube:start-auth"` directly.
- **Fail Explicitly**: Throw meaningful error messages with context. `throw new Error(\`Failed to load config for provider ${name}: ${formatErrorMessage(error)}\`)`is better than`throw error`.
- **Clean Imports**: Remove unused imports. Use `import type { X }` for type-only imports to avoid bundling unnecessary code.

### TypeScript

- **Prefer `interface` for object shapes**, `type` for unions/intersections. This follows TypeScript best practices and gives better error messages.
- **Use discriminated unions** for state that has different shapes depending on a status field:

  ```typescript
  // GOOD
  type Result =
    | { success: true; data: string }
    | { success: false; error: string };

  // BAD
  interface Result {
    success: boolean;
    data?: string;
    error?: string;
  }
  ```

- **Use `unknown` over `any`** and narrow with type guards. This forces explicit type checking at call sites.
- **Use `readonly` for arrays and objects** that should not be mutated after creation:
  ```typescript
  const PROVIDERS: readonly string[] = ["openai", "azure", "deepseek"];
  ```
- **Avoid type assertions (`as`)** - use type guards and narrowing. If you must assert, add a comment explaining why.
- **Use `satisfies`** for type checking without widening:
  ```typescript
  const config = { port: 3000, host: "localhost" } satisfies ServerConfig;
  ```

### React

- **Keep components small and focused**. If a component file exceeds ~200 lines, extract sub-components or move logic to custom hooks.
- **Extract business logic into custom hooks**. Components should focus on rendering; hooks should handle state, side effects, and IPC calls.
- **Use `useCallback` for callbacks passed to child components** to avoid unnecessary re-renders. Don't memoize inline handlers that aren't passed down.
- **Always provide cleanup in `useEffect`**. Every subscription, timer, or listener must be cleaned up:
  ```typescript
  useEffect(() => {
    const cleanup = ipcClient.workflow.onProgress(handleProgress);
    return cleanup;
  }, [handleProgress]);
  ```
- **Prevent state updates after unmount** in async operations:
  ```typescript
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const data = await ipcClient.service.getData();
      if (!cancelled) setState(data);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);
  ```
- **Use `useId()` for form element IDs**, not `Math.random()` or hardcoded strings.
- **Co-locate related code**: Keep Zod schemas (`schema.ts`), local types (`types.ts`), and sub-components in the same feature directory.

### Error Handling

- **Always wrap IPC calls in try-catch** with user feedback via toast:
  ```typescript
  try {
    await ipcClient.service.doAction();
    toast.success("Action completed");
  } catch (error) {
    toast.error(`Failed: ${formatErrorMessage(error)}`);
  }
  ```
- **Use `formatAndReportError()`** in backend catch blocks to track errors to Application Insights (see Telemetry section).
- **Use `formatErrorMessage()`** for simple error formatting without telemetry (e.g., frontend toasts).
- **Return structured results from IPC handlers**, not raw throws:

  ```typescript
  // GOOD - caller can check success
  return { success: true, data: result };
  return { success: false, error: formatAndReportError(error, "my_handler") };

  // BAD - forces try-catch on every call
  throw new Error("Something failed");
  ```

### Telemetry (Application Insights)

The app uses Azure Application Insights for telemetry. All telemetry is subject to user consent - data is only sent if the user has granted permission in Settings.

#### Tracking Errors

Use `formatAndReportError()` from `src/backend/utils/error-utils.ts` in backend catch blocks:

```typescript
import { formatAndReportError } from "../../utils/error-utils";

catch (error) {
  const message = formatAndReportError(error, "context_identifier", { userId: "123" });
  throw new Error(`Operation failed: ${message}`);
}
```

This both formats the error message and sends it to Application Insights.

#### Tracking Custom Events

```typescript
import { TelemetryService } from "../services/telemetry/telemetry-service";

TelemetryService.getInstance().trackEvent({
  name: "FeatureUsed",
  properties: { featureName: "videoExport" },
  measurements: { duration: 5000 },
});
```

#### Available Methods

| Method               | Purpose                                      | Required Setting        |
| -------------------- | -------------------------------------------- | ----------------------- |
| `trackEvent`         | Custom events (button clicks, feature usage) | `allowUsageMetrics`     |
| `trackWorkflowStage` | Workflow stages (started, completed, failed) | `allowWorkflowTracking` |
| `trackError`         | Exceptions/errors                            | `allowErrorReporting`   |
| `trackMetric`        | Numeric metrics                              | `allowUsageMetrics`     |

#### Configuration

Set via environment variable:

```
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...;IngestionEndpoint=...
```

### Backend

- **Use the singleton pattern consistently** for services that should have a single instance. Use `getInstanceAsync()` if initialization is async, `getInstance()` if sync.
- **Never mix async/await with database operations** - better-sqlite3 is synchronous. DB service functions should be plain synchronous functions.
- **Encrypt all sensitive data** via `BaseSecureStorage` subclasses. Never store API keys, tokens, or credentials in plain text.
- **Define IPC channels as constants** in `channels.ts` and reference them everywhere. Never use string literals for channel names.
- **Check window validity before Electron API calls**: Always verify `!window.isDestroyed() && !window.webContents.isDestroyed()` before calling methods on BrowserWindow instances.

### Styling

- **Use semantic color tokens**: `bg-background`, `text-foreground`, `border-border`, `bg-card`, `text-muted-foreground` etc. These adapt to light/dark mode automatically.
- **Use `cn()` from `@/lib/utils`** for conditional class composition. Never use ternary string concatenation for classes.
- **Test in both light and dark mode**. The app defaults to dark mode but all components must work in both.
- **Follow the spacing system**: Use Tailwind spacing utilities (`p-4`, `gap-2`, `space-y-4`) consistently. Don't mix custom pixel values with the Tailwind system.

### Testing

- **Co-locate test files** with their source: `shave-service.ts` and `shave-service.test.ts` should be in the same directory.
- **Test file naming**: Use `*.test.ts` or `*.spec.ts` suffix.
- **Test behavior, not implementation**: Assert on outputs and side effects, not internal state.
- **Use the DB test setup** (`src/backend/db/setup-tests.ts`) for database-dependent tests - it provides an in-memory SQLite instance.

## Architecture Patterns

### Backend Patterns

#### Singleton Pattern (Services)

Most backend services use the singleton pattern. Use `getInstanceAsync()` for async initialization (e.g., `MCPServerManager`, `MCPOrchestrator`), or `getInstance()` with nullish coalescing for sync (e.g., `RecordingService`, all `*Storage` classes). See any storage class for the sync pattern.

#### IPC Handler Pattern (Class-based)

All IPC handlers are one class per domain. Each class registers handlers in the constructor via `Object.entries().forEach()` with `ipcMain.handle()`. Handler methods are private and return structured `{ success, data?, error? }` results. See `src/backend/ipc/auth-handlers.ts` for a reference implementation.

#### IPC Channel Naming

Channels are defined as constants in `src/backend/ipc/channels.ts`:

- Format: `"domain:action"` (e.g., `"youtube:start-auth"`, `"llm:set-config"`, `"mcp:process-message"`)
- All channels use `ipcMain.handle()` for request-response (Promise-based)

#### Secure Storage Pattern (Inheritance)

All encrypted credential storage extends `BaseSecureStorage` (which uses Electron's `safeStorage` API). Each storage class is a singleton with `encryptAndStore()`/`decryptAndLoad()` methods. Classes: `LlmStorage`, `YoutubeStorage`, `GitHubTokenStorage`, `McpStorage`, `McpOAuthTokenStorage`, `CustomPromptStorage`, `UserSettingsStorage`, `ReleaseChannelStorage`.

#### Database Service Pattern (Functions, Not Classes)

Database services use plain exported functions (not classes) because better-sqlite3 is synchronous. No `async/await` in DB services. Use Drizzle ORM methods: `.get()` for single row, `.all()` for multiple rows, `.run()` for mutations. See `src/backend/db/services/shave-service.ts` for the pattern.

#### Event Emitter Pattern

`RecordingService` extends `EventEmitter` for internal state propagation. Events are bridged to Electron IPC via `event-forwarder.ts`, which subscribes to service events and forwards them to renderer via `webContents.send()`.

#### Error Handling Pattern

Always use `formatAndReportError()` from `src/backend/utils/error-utils.ts` for backend errors. IPC handlers return structured `{ success, error }` results.### Frontend Patterns

#### Component Organization (Feature-Based)

Components are organized by **feature domain**, not by component type. Each feature directory co-locates its container, sub-components, `schema.ts` (Zod), and `types.ts`. Example: `components/settings/custom-prompt/` contains `CustomPromptManager.tsx`, `PromptForm.tsx`, `PromptCard.tsx`, `schema.ts`, `types.ts`.

#### Component Structure Order

Follow this order within components:

1. Imports (React -> External libs -> UI components -> Services -> Hooks -> Utils -> Types)
2. Props interface (PascalCase with `Props` suffix)
3. Component definition (named export, function declaration)
4. Inside component: context hooks -> custom hooks -> local state -> derived state -> effects (with cleanup) -> callbacks (`useCallback` when passed to children) -> render

#### Named Exports Only

Always use `export function MyComponent()`. Never use default exports.

#### IPC Communication Rules

1. **Always use `ipcClient`** from `@/services/ipc-client` - never call `window.electronAPI` directly (except in `control-bar.tsx`)
2. **Always `await` IPC calls** - they return Promises
3. **Always wrap in try-catch** with `toast.error(\`Failed: ${formatErrorMessage(error)}\`)` feedback
4. **Always cleanup subscriptions** - return the unsubscribe function from `useEffect`

#### State Management

| Tier           | Tool          | When to Use                                                    |
| -------------- | ------------- | -------------------------------------------------------------- |
| Local          | `useState`    | Component-specific state (loading, form values, UI toggles)    |
| Shared         | React Context | State shared across 3+ components (auth, settings)             |
| Business Logic | Custom Hooks  | Complex operations with IPC calls (recording, prompts, shaves) |

Only 2 contexts exist: `YouTubeAuthContext` and `AdvancedSettingsContext`. Create new contexts sparingly. Custom hooks live in `src/ui/src/hooks/` and return an object with state and methods.

#### Form Handling (React Hook Form + Zod)

1. Define Zod schema in a separate `schema.ts` file, infer type with `z.infer<typeof schema>`
2. Use `zodResolver` with `useForm` from React Hook Form
3. Use shadcn/ui `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage` components
4. Validate with `await form.trigger()` before `form.getValues()`

See `src/ui/src/components/settings/custom-prompt/PromptForm.tsx` and its `schema.ts` for the reference implementation.

#### Styling with Tailwind CSS v4

- **Use semantic color names**: `bg-background`, `text-foreground`, `border-border`, `bg-card`, `text-muted-foreground`, `bg-destructive`
- **Use `cn()` helper** from `@/lib/utils` for conditional classes
- **Support dark mode**: all components must work in both light and dark mode (default is dark)
- **Never write custom CSS** outside `App.css`; never use inline `style` attributes (except Electron-specific like `WebkitAppRegion`)
- **SSW brand color**: `bg-ssw-red` / `text-ssw-red` (`#cc4141`)
- **Common patterns**: glass morphism (`bg-black/85 backdrop-blur-xl border-white/20`), cards (`bg-black/20 backdrop-blur-md border-white/10`), opacity modifiers (`bg-white/10`, `text-white/70`)

#### UI Component Library

20 shadcn/ui components in `src/ui/src/components/ui/`: `accordion`, `alert-dialog`, `avatar`, `badge`, `button`, `card`, `checkbox`, `code-block`, `dialog`, `drawer`, `dropdown-menu`, `empty`, `form`, `input`, `label`, `progress`, `scroll-area`, `select`, `separator`, `spinner`, `switch`, `textarea`

Button variants: `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`

## Naming Conventions

| Element                  | Convention                                                 | Example                                      |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------- |
| Files (backend)          | kebab-case                                                 | `workflow-state-manager.ts`                  |
| Files (React components) | PascalCase                                                 | `WorkflowProgressPanel.tsx`                  |
| Files (hooks)            | camelCase with `use` prefix                                | `useScreenRecording.ts`                      |
| React components         | PascalCase, named export                                   | `export function ScreenRecorder()`           |
| Props interfaces         | PascalCase with `Props` suffix                             | `ScreenRecorderProps`                        |
| Functions/Variables      | camelCase                                                  | `getUserInfo`, `authStatus`                  |
| Constants                | SCREAMING_SNAKE_CASE                                       | `MCP_CALLBACK_PORT`, `IPC_CHANNELS`          |
| Interfaces/Types         | PascalCase                                                 | `UserInfo`, `AuthResult`                     |
| Enums                    | PascalCase name, PascalCase or SCREAMING_SNAKE_CASE values | `AuthStatus.AUTHENTICATED`                   |
| IPC channels             | `domain:action` kebab-case                                 | `"youtube:start-auth"`                       |
| Handler classes          | `{Domain}IPCHandlers`                                      | `AuthIPCHandlers`                            |
| Service classes          | `{Name}Service`                                            | `RecordingService`                           |
| Storage classes          | `{Name}Storage`                                            | `LlmStorage`                                 |
| Manager classes          | `{Name}Manager`                                            | `MCPServerManager`                           |
| Handler methods          | `handle{Action}`                                           | `handleStartRecording`                       |
| Async query methods      | `{verb}{Noun}Async`                                        | `getMcpClientAsync`                          |
| Path aliases             | `@shared/*` (backend+frontend), `@/*` (frontend only)      | `import type { X } from "@shared/types/llm"` |

## Common Workflows

### Adding a New IPC Channel

1. Define channel name in `src/backend/ipc/channels.ts`
2. Add handler in the appropriate `*-handlers.ts` file (or create new handler class)
3. Expose in `src/backend/preload.ts` via `contextBridge`
4. Add to `ipcClient` in `src/ui/src/services/ipc-client.ts`
5. Use in React components via `ipcClient`

### Adding a New React Component

1. Create in the appropriate feature directory under `src/ui/src/components/{feature}/`
2. Define props interface with `Props` suffix
3. Use named export (not default)
4. Follow the standard component structure (imports -> interface -> function)
5. Style with Tailwind CSS using `cn()` for conditionals
6. Handle IPC calls with try-catch and toast notifications

### Adding a New Custom Hook

1. Create in `src/ui/src/hooks/use{FeatureName}.ts`
2. Extract complex state and IPC operations
3. Return object with state and methods
4. Use `useCallback` for methods to prevent unnecessary re-renders

### Adding a Database Table

1. Define schema in `src/backend/db/schema.ts` using Drizzle ORM
2. Generate migration: `npm run db:generate -- --name=descriptive_name`
3. Create query service in `src/backend/db/services/`
4. Migrations auto-run on app startup via `migrate.ts`

### Adding an MCP Server

- **External**: Configure via Settings UI (persisted to `mcp-servers.json`)
- **Internal**: Add to `src/backend/services/mcp/internal/` and register in MCP orchestrator

## Configuration

### Environment Setup

1. Copy `.env.example` to `.env`
2. Add YouTube OAuth credentials from SSW Password Keeper
3. LLM API keys are configured via the app UI (not environment variables)

### Key Environment Variables

```
PORTAL_API_URL=http://localhost:7009/api
MCP_CALLBACK_PORT=8090
MCP_AUTH_TIMEOUT_MS=60000
AZURE_ENTRA_APP_CLIENT_ID=...
AZURE_TENANT_ID=...
AZURE_AUTH_SCOPE=User.Read
AZURE_AUTH_CUSTOM_PROTOCOL=yakshaver-desktop-dev
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...;IngestionEndpoint=...
```

### Storage Locations

- **Windows**: `%APPDATA%\SSW.YakShaver\`
- **macOS**: `~/Library/Application Support/SSW.YakShaver/`
- **Linux**: `~/.config/SSW.YakShaver/`

Encrypted tokens: `yakshaver-tokens/*.enc`
Database: `database.sqlite` (dev: `./data/database.sqlite`)

### Development Commands

```bash
npm run setup          # Install dependencies (backend + frontend)
npm run dev            # Start dev mode (Vite on port 3000 + Electron)
npm run build          # Compile TypeScript backend
npm run make           # Create distributable packages
npm run test           # Run Vitest test suite
npm run lint           # Biome linter (auto-fix)
npm run format         # Biome formatter (auto-fix)
npm run db:generate    # Generate Drizzle ORM migrations
```

## Guardrails & Constraints

### Forbidden Patterns

#### TypeScript

- **Never use `any` type** - use `unknown` with type guards, or explicit types
- **Avoid type assertions (`as`)** - use type guards and narrowing instead
- **No unused variables** - remove or prefix with underscore if intentionally unused
- **No implicit returns** in non-trivial functions

#### React

- **No default exports** - always use named exports
- **No direct `window.electronAPI` calls** - use `ipcClient` wrapper
- **No IPC subscriptions without cleanup** - always return unsubscribe from `useEffect`
- **No prop drilling** - use Context for state shared across 3+ components
- **No direct DOM manipulation** - use React refs and declarative patterns

#### Styling

- **No custom CSS in components** - use Tailwind utility classes only
- **No inline `style` attributes** - except for Electron-specific properties
- **No hardcoded colors** - use semantic color variables (`bg-background`, not `bg-white`)
- **No components without dark mode support**

#### General

- **No `console.log` in production code** - use proper logging utilities
- **No commented-out code** - use version control
- **No magic numbers** - define named constants
- **No synchronous file operations** in backend (except DB which uses better-sqlite3)

### Security & Privacy

- **Never commit API keys** - use `.env` file (gitignored)
- **Never hardcode secrets** - even placeholder values like `"sk-..."`
- **Use Electron's `safeStorage` API** - for all token/credential encryption
- **Encrypt all stored credentials** - via `BaseSecureStorage` subclasses
- **Use HTTPS for all non-local/external API calls** (HTTP is only acceptable for `localhost` in local development)
- **Validate and sanitize user input** before processing
- **No telemetry without consent**
- **No logging of sensitive data** (API keys, user tokens, personal data)

### Scope Creep Prevention

- **Only edit files directly related to the current issue**
- **Do not reformat unrelated code** - don't move lines or change formatting of untouched code
- **Follow established patterns** - don't introduce new patterns unless explicitly approved
- **No unnecessary new dependencies** - justify any new package
- **Test only what you change** - focus tests on modified functionality
- **Update only relevant documentation**

## Important Documentation

- [Architecture Decision Records](/docs/adr/README.md) - Historical context for key technical decisions
- [Release Notes](RELEASE.md) - Version history and release workflow
- [Release Settings](/docs/release-settings.md) - Release channel configuration
