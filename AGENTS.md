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

### Technical Capabilities
- Cross-platform desktop application (Windows, macOS, Linux)
- Secure API key storage using OS-level encryption
- Real-time content analysis and summarization
- YouTube video transcription and processing
- Graph API integration for Microsoft services
- Audio recording and processing capabilities

## Project Context & Knowledge Base

### Purpose
YakShaver Desktop is an Electron-based AI agent designed to process and summarize content efficiently. It integrates with multiple AI providers and services to analyze YouTube videos, audio content, and other media formats.

### Key Components
- **Backend**: Electron main process handling IPC, database operations, and external API integrations
- **Frontend**: React-based UI with Vite build system for user interactions
- **Database**: SQLite with Drizzle ORM for local data persistence
- **MCP Integration**: Model Context Protocol servers for extended AI capabilities
- **Audio Processing**: FFmpeg-based audio loopback and transcription

### Architecture Patterns
- Event-driven architecture using Electron IPC for frontend-backend communication
- Service-oriented design with separate modules for workflows, MCP servers, and external integrations
- Repository pattern for database operations using Drizzle ORM
- Type-safe API boundaries between frontend and backend

### Important Documentation
- [Architecture Decision Records](/docs/adr/README.md) - Historical context for key technical decisions
- [Database README](/src/backend/db/README.md) - Database schema and migration information
- [Release Notes](RELEASE.md) - Version history and changelog

## Technical Stack

### Platform
- **Runtime**: Electron 39.x
- **Language**: TypeScript
- **UI Framework**: React-based (Vite)
- **Database**: SQLite with Drizzle ORM

### Key Dependencies
- `@ai-sdk/openai` - OpenAI integration
- `@ai-sdk/azure` - Azure AI integration
- `@ai-sdk/mcp` - Model Context Protocol support
- `@modelcontextprotocol/sdk` - MCP SDK
- `openai` - OpenAI API client
- `googleapis` - Google APIs integration
- `@microsoft/microsoft-graph-client` - Microsoft Graph integration

## Configuration

### API Keys
The agent requires configuration of API keys for:
- OpenAI API (user-provided through UI)
- Azure OpenAI (optional)
- YouTube Data API (configured via environment)

### Storage Locations
- **Windows**: `%APPDATA%\SSW.YakShaver\yakshaver-tokens\*.enc`
- **macOS**: `~/Library/Application Support/SSW.YakShaver/yakshaver-tokens/*.enc`
- **Linux**: `~/.config/SSW.YakShaver/yakshaver-tokens/*.enc`

### MCP Server Configuration
The agent supports custom MCP server configurations, which can be managed through the Settings UI.

## Usage

### Prerequisites
- Node.js (latest LTS version)
- npm or compatible package manager

### Installation
```bash
# Clone the repository
git clone https://github.com/SSWConsulting/SSW.YakShaver.Desktop.git

# Install dependencies
npm install -g concurrently
npm run setup

# Configure environment
cp .env.example .env

# Run the application
npm run dev
```

### Building
```bash
# Build for distribution
npm run make
```

## Agent Interfaces

### User Interface
- **Type**: Desktop GUI (Electron)
- **Access**: Native application window
- **Configuration**: Settings UI within the application

### API Integration
- OpenAI API (GPT models)
- Azure OpenAI Service
- YouTube Data API v3
- Microsoft Graph API
- Model Context Protocol (MCP) servers

## Development

### Architecture
- **Frontend**: React with Vite build system
- **Backend**: Electron main process with TypeScript
- **Database**: SQLite with Drizzle ORM
- **Code Quality**: Biome for linting and formatting

### Testing
```bash
npm run test
```

### Code Style
```bash
npm run lint
npm run format
```

## Guidelines & Standards

### Coding Standards

#### TypeScript
- **Strict Mode**: TypeScript strict mode is enabled (`"strict": true` in tsconfig.json)
- **Type Safety**: Always use explicit types; avoid implicit `any`
- **Interfaces vs Types**: Prefer `interface` for object shapes, `type` for unions/intersections
- **Null Safety**: Use optional chaining (`?.`) and nullish coalescing (`??`) operators

#### Naming Conventions
- **Files**: Use kebab-case for file names (e.g., `workflow-state-manager.ts`)
- **Components**: Use PascalCase for React components (e.g., `WorkflowProgressPanel.tsx`)
- **Functions/Variables**: Use camelCase (e.g., `getUserInfo`, `authStatus`)
- **Constants**: Use SCREAMING_SNAKE_CASE for true constants (e.g., `MCP_CALLBACK_PORT`)
- **Interfaces/Types**: Use PascalCase (e.g., `UserInfo`, `AuthResult`)
- **Enums**: Use PascalCase for enum names and SCREAMING_SNAKE_CASE for values

#### Code Organization
- **Imports**: Use path aliases (`@shared/*`) for shared code
- **Import Order**: Organize imports automatically with Biome
- **Module Structure**: Separate concerns into services, types, utils, and components directories

### Preferred Patterns

#### Error Handling
- Use try-catch blocks for asynchronous operations
- Return structured error objects with `success`, `error` properties
- Format errors consistently using utility functions (see `src/backend/utils/error-utils.ts`)
- Log errors with appropriate context before propagating

#### State Management
- Use React hooks for local component state
- Use IPC for frontend-backend communication
- Maintain workflow state in backend service layer
- Emit events for state changes that need to propagate to UI

#### Async Operations
- Use `async/await` syntax (not callbacks or raw promises)
- Handle promise rejections explicitly
- Use proper TypeScript return types for async functions

#### Database Operations
- Use Drizzle ORM schema definitions for type safety
- Perform migrations through Drizzle Kit
- Use transactions for multi-step database operations

### Code Quality Tools
- **Linter**: Biome with recommended rules enabled
- **Formatter**: Biome with 2-space indentation, 100 character line width
- **Testing**: Vitest for unit and integration tests

## Guardrails & Constraints

### Forbidden Patterns

#### TypeScript
- **Never use `any` type**: Always provide explicit types or use `unknown` with proper type guards
- **Avoid type assertions**: Use type guards and narrowing instead of `as` assertions unless absolutely necessary
- **No implicit returns**: Always explicitly return values from functions
- **No unused variables**: Remove or prefix with underscore if intentionally unused

#### React
- **No inline function definitions in JSX props**: Extract to named functions for performance
- **Avoid prop drilling**: Use context or proper state management for deeply nested props
- **No direct DOM manipulation**: Use React refs and declarative patterns

#### General
- **No console.log in production code**: Use proper logging utilities
- **No commented-out code**: Remove dead code; use version control instead
- **No magic numbers**: Define constants with descriptive names
- **No synchronous file operations**: Use async file operations to avoid blocking

### Security/Privacy

#### API Keys and Secrets
- **Never commit API keys**: Use environment variables (`.env` file, not committed)
- **Never output hardcoded API keys**: Even placeholders like `"sk-..."` should not be hardcoded
- **Use secure storage**: Store user tokens with Electron's `safeStorage` API
- **Encrypt sensitive data**: All API keys stored locally must be encrypted

#### Data Handling
- **Minimize data collection**: Only collect data necessary for functionality
- **No telemetry without consent**: Don't track user behavior without explicit permission
- **Secure API communication**: Use HTTPS for all external API calls
- **Validate input**: Always validate and sanitize user input before processing

#### Third-Party Integration
- **Transparent data flow**: Document what data is sent to external services (OpenAI, Azure, YouTube, etc.)
- **User control**: Allow users to configure which services they use
- **No data leakage**: Don't log sensitive information (API keys, user tokens, personal data)

### Scope Creep

#### Change Boundaries
- **Do not refactor unrelated files**: Only modify files directly related to the issue being addressed
- **Maintain existing patterns**: Follow established patterns in the codebase unless explicitly improving them
- **No unnecessary dependencies**: Don't add new packages without strong justification
- **Preserve backward compatibility**: Don't break existing APIs unless part of the planned change

#### Testing Requirements
- **Test only what you change**: Focus tests on modified functionality
- **Don't fix unrelated bugs**: Address only the issue at hand
- **No premature optimization**: Don't optimize code that isn't causing problems
- **Respect existing tests**: Don't remove or modify tests unless they're blocking legitimate changes

#### Documentation
- **Update relevant docs only**: Modify documentation directly affected by your changes
- **Maintain consistency**: Match existing documentation style and format
- **No over-documentation**: Document complex logic, not obvious code

## Support

- **Issues**: https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues
- **Documentation**: https://github.com/SSWConsulting/SSW.YakShaver.Desktop
- **Author**: SSW Consulting - https://www.ssw.com.au

## Architecture Decisions

For important architectural changes and decisions, see [Architecture Decision Records](/docs/adr/README.md).

## Security

- API keys are stored using Electron's safeStorage (OS-level encryption)
- No sensitive data is transmitted to third parties except configured AI providers
- Open source under AGPL-3.0-only license for transparency

## Version History

For release notes and version history, see [RELEASE.md](RELEASE.md).
