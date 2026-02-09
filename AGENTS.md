# SSW YakShaver Desktop - AI Agent

## Agent Information

- **Name**: SSW YakShaver Desktop
- **Version**: 0.6.0
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

Current version: 0.6.0

For release notes and version history, see [RELEASE.md](RELEASE.md).
