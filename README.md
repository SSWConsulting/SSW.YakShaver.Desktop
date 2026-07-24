# Desktop Electron App

This is the YakShaver Desktop Electron app, designed to help you create the perfect PBI in 30 seconds, with built-in MCP support.

For more information, visit our website at [yakshaver.ai](https://yakshaver.ai)

We also offer a **web version** [YakShaver 360](https://360.yakshaver.ai)

## Prerequisites

- [Node JS](https://nodejs.org/en/download)

## Setup

1. Copy `.env.example` → `.env`
2. Copy environment from keeper: **SSW.Yakshaver Desktop .env** (just copy YouTube client id and secret values. LLM values should be set via app itself)

## Run
In the root folder, run
1. `npm install -g concurrently`, which will install the [`concurrently` package](https://www.npmjs.com/package/concurrently)
1. `npm run setup` – install dependencies
2. `npm run dev` – start the app

On Windows and macOS, `npm run setup` also installs the standalone `yt-dlp` binary used
for YouTube downloads. This avoids relying on the operating system's Python.

## Install Python for video downloader (Mac & Windows)

[▶️ Watch the video (01:02)](https://www.youtube.com/watch?v=cW9aLi-8igc)

`npm run setup` installs a standalone `yt-dlp` binary automatically (see [Run](#run)), so most
users don't need to install Python at all. If you hit an issue with the bundled binary, or you're
running the video downloader outside the app, you can install Python and `yt-dlp` yourself with
the commands below.

### macOS

Install [Homebrew](https://brew.sh/) (skip this if you already have it) and then Python, in one line:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" && brew install python
```

If Homebrew is already installed:

```bash
brew install python
```

### Windows

Install [Chocolatey](https://chocolatey.org/install) (skip this if you already have it) and then
Python, in one PowerShell command (run PowerShell **as Administrator**):

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1')); choco install python -y
```

If Chocolatey is already installed:

```powershell
choco install python -y
```

### Verify the installation

**macOS** (Homebrew installs Python as `python3`/`pip3`):

```bash
python3 --version
pip3 --version
```

**Windows** (Chocolatey installs Python as `python`/`pip`):

```powershell
python --version
pip --version
```

### Install the video downloader (yt-dlp)

**macOS**:

```bash
python3 -m pip install -U yt-dlp
```

**Windows**:

```powershell
python -m pip install -U yt-dlp
```

Once installed, you can run the video downloader from the command line, e.g.:

```bash
yt-dlp "https://www.youtube.com/watch?v=example"
```

### Common PATH issues

- **macOS**: if `python3`/`pip3` aren't found after installing via Homebrew, open a new terminal
  window (or run `source ~/.zprofile` / `source ~/.bash_profile`) so your shell picks up
  Homebrew's PATH changes, or confirm your Homebrew `bin` directory (`brew --prefix`) is on
  `PATH`.
- **Windows**: if `python`/`pip` aren't recognised after installing via Chocolatey, close and
  reopen your terminal so the updated `PATH` environment variable is picked up. If it's still not
  found, verify the Python install directory and its `Scripts` folder were added to `PATH` (the
  Chocolatey package does this automatically, but a prior manual Python install without the "Add
  Python to PATH" option can shadow it — reinstall with that option checked, or add the paths
  manually via System Properties → Environment Variables).
- On both OSes, restarting your terminal (or your machine, if PATH still doesn't refresh) after
  installation resolves most "command not found" issues.

## Building

1. `npm run setup` – ensure all dependencies are installed
2. `npm run make` - this will create 2 folders

- `/out/make/{target}/{arch}` - which contains the installers/distributables for end users
- `/SSW.YakShaver-{system}-{arch}` - which contains the unpacked/portable app

## Configuration

- Keys are stored securely on your device using the operating system's encryption (Electron safeStorage) in the app's user data directory

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

# 📓Architecture Decision Records
We use ADRs to track important architectural changes. See the full history in [/docs/adr](./docs/adr/README.md)
