# Test Button Usage Guide

## What's Been Added

A temporary test button (🧪 Test Execute) has been added to the app UI that allows you to:
1. **Paste analyzed transcript (intermediate output)** directly
2. **Skip download and transcription** stages
3. **Start from "Executing Task" stage**
4. **See all logs in the backend console**

## How to Use

### Step 1: Build and Run the App

```bash
npm run build
cd src/ui && npm run build && cd ../..
npm run dev
```

### Step 2: Find the Test Button

Look for the purple **"🧪 Test Execute"** button in the bottom-right corner of the app (above the version info).

### Step 3: Click the Button

A panel will open with:
- **Intermediate Output** textarea (pre-filled with your example)
- **Video URL** input (optional)
- **Execute Task** button

### Step 4: Paste Your Analyzed Transcript

The panel comes pre-filled with your example:

```json
{
  "taskType": "feature_request",
  "detectedLanguage": "en-US",
  "formattedContent": "Hi, this is a test feature for the Yaxue Desktop app...",
  "mentionedEntities": ["Yaxue Desktop app"],
  "contextKeywords": [...],
  "uncertainTerms": [...]
}
```

**You can modify this or paste different analyzed transcripts!**

### Step 5: Click "▶️ Execute Task"

The app will:
1. ✅ Skip download stage
2. ✅ Skip transcription stage
3. ✅ Start directly at "Executing Task" stage
4. ✅ Show progress in the workflow panel
5. ✅ Log everything in the backend console

### Step 6: Watch the Logs

In your terminal where you ran `npm run dev`, you'll see:
- `[MCPOrchestrator] ===== SESSION STARTED =====`
- Tool calls
- Tool approvals
- Tool results
- Final result

### Step 7: See Results

- The **Workflow Progress Panel** will show the execution progress
- The **Final Result Panel** will show the completion
- **Backend console** will have all detailed logs

## What Happens Behind the Scenes

```
User Clicks Execute
    ↓
Frontend: window.electronAPI.pipelines.executeTaskFromIntermediate()
    ↓
IPC: EXECUTE_TASK_FROM_INTERMEDIATE
    ↓
Backend: process-video-handlers.ts
    ↓
Notify: ProgressStage.EXECUTING_TASK
    ↓
MCPOrchestrator.manualLoopAsync()
    ↓
Tool execution with full logging
    ↓
Notify: ProgressStage.COMPLETED
    ↓
Result shown in UI
```

## Modify the Intermediate Output

You can test different scenarios by modifying the JSON:

### Bug Report Example
```json
{
  "taskType": "bug",
  "detectedLanguage": "en-US",
  "formattedContent": "Login button not working on mobile",
  "mentionedEntities": ["login button", "mobile"],
  "contextKeywords": ["bug", "not working", "mobile"],
  "uncertainTerms": []
}
```

### Feature Request Example
```json
{
  "taskType": "feature_request",
  "detectedLanguage": "en-US",
  "formattedContent": "Add dark mode support to the application",
  "mentionedEntities": ["dark mode"],
  "contextKeywords": ["feature", "dark mode", "support"],
  "uncertainTerms": []
}
```

## Tips

- **Reset Button**: Click "Reset" to restore the default example
- **Video URL**: Add a URL if your workflow needs it
- **Multiple Tests**: You can execute multiple times with different inputs
- **Close Panel**: Click the ✕ to close and reopen later
- **Backend Logs**: Keep terminal open to see all MCP orchestrator logs

## Remove When Done Testing

To remove the test button, simply delete or comment out this line in `App.tsx`:

```tsx
{/* Temporary test button - remove when done testing */}
<TestExecuteTaskButton />
```

## Files Modified

- ✅ `src/backend/ipc/channels.ts` - Added new IPC channel
- ✅ `src/backend/ipc/process-video-handlers.ts` - Added handler for executing from intermediate
- ✅ `src/backend/preload.ts` - Exposed IPC to frontend
- ✅ `src/ui/src/services/ipc-client.ts` - Added TypeScript types
- ✅ `src/ui/src/components/test/TestExecuteTaskButton.tsx` - The test button component
- ✅ `src/ui/src/App.tsx` - Added button to UI

Enjoy testing! 🎉
