# Desktop Electron App

## Prerequisites

- [Node JS](https://nodejs.org/en/download)

## Setup

1. Copy `.env.example` → `.env`
2. Copy environment from keeper: **SSW.Yakshaver Desktop .env** (just copy YouTube client id and secret values. LLM values should be set via app itself)

## Run
In the root folder, run
1.  `npm install -g concurrently`, which will install the [`concurrently` package](https://www.npmjs.com/package/concurrently)
1. `npm run setup` – install dependencies
2. `npm run dev` – start the app

## Building

1. `npm run setup` – ensure all dependencies are installed
2. `npm run make` - this will create 2 folders

- `/out/make/{target}/{arch}` - which contains the installers/distributables for end users
- `/SSW.YakShaver-{system}-{arch}` - which contains the unpacked/portable app

## Configuration

- Keys are stored securely on your device using the opearting system's encryption (Electron safeStorage) in the app's user data directory

- **Windows**: `%APPDATA%\SSW.YakShaver\yakshaver-tokens\*.enc`
- **macOS**: `~/Library/Application Support/SSW.YakShaver/yakshaver-tokens/*.enc`
- **Linux**: `~/.config/SSW.YakShaver/yakshaver-tokens/*.enc`


### OpenAI API Key (User-provided)

You can now set your own OpenAI API key directly in the app:

- Open the app and go to the main screen toolbar.
- Click the "LLM Settings" button.
- Paste your OpenAI API key (starts with `sk-...`) and Save.

Notes:

- You can clear the stored key anytime from the same dialog.

### MCP Server Configuration

The configuration file is automatically created when you add your first MCP server through the Settings UI. The configuration persists across app restarts and updates.

## Running macOS Compiled App (`YakShaver.app`)

To run this app, you'll need to disable Apple's Gatekeeper quarantine attribute.
After dragging YakShaver.app to the Applications folder, run 
```
xattr -d com.apple.quarantine /Applications/YakShaver.app
```
in your terminal.

#### Template

The template used for this repo is from the [SSW.GitHub.Template](https://github.com/SSWConsulting/SSW.GitHub.Template) repo.
