/**
 * Manual Test Runner - Start from "Executing Task" Stage
 *
 * This script lets you manually test the task execution process
 * starting from the "Executing task" stage with a provided transcript.
 *
 * HOW TO USE:
 * 1. Paste your transcript text below (around line 30)
 * 2. Build the project: npm run build
 * 3. Run: node dist/backend/services/mcp/run-manual-test.js
 *    Or: npx tsx src/backend/services/mcp/run-manual-test.ts (if tsx is installed)
 * 4. Watch the logs in the console
 * 5. See the final result
 */

import { buildTaskExecutionPrompt, INITIAL_SUMMARY_PROMPT } from "../../constants/prompts";
import { CustomPromptStorage } from "../storage/custom-prompt-storage";
import { LanguageModelProvider } from "./language-model-provider";
import { MCPOrchestrator } from "./mcp-orchestrator";

// ============================================================
// 👇 PASTE YOUR TRANSCRIPT TEXT HERE 👇
// ============================================================
const TRANSCRIPT_TEXT = `
Overview
Hi, this is a test feature request for
Yakshaver desktop app and
we need to make the stop recording
Non-YouTube video links: remove arrow-to-toast and add clear validation
button bigger
and also remove the
um when user
provides an
a video link that is not the YouTube, we
should use the arrow to toast some
message to tell them that they're you're
using the wrong link.
`;

// ============================================================
// 👇 OPTIONAL: Configure video details 👇
// ============================================================
const VIDEO_URL = "https://youtu.be/-eM0CwmmJh8";
const VIDEO_DURATION = 38; // seconds

// ============================================================
// Main execution function
// ============================================================
async function runManualTest() {
  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║   MANUAL TEST - Starting from 'Executing Task'       ║");
  console.log("╚═══════════════════════════════════════════════════════╝\n");

  try {
    // Step 1: Prepare transcript text
    const transcriptText = TRANSCRIPT_TEXT.trim();
    console.log("📝 Transcript Text:");
    console.log("─────────────────────────────────────────────────────────");
    console.log(transcriptText);
    console.log("─────────────────────────────────────────────────────────\n");

    // Step 2: Generate intermediate output (like the app does)
    console.log("🔄 Stage: GENERATING_TASK (Creating intermediate output)...\n");
    const languageModelProvider = await LanguageModelProvider.getInstance();
    const userPrompt = `Process the following transcript into a structured JSON object:
    
    ${transcriptText}`;

    const intermediateOutput = await languageModelProvider.generateJson(
      userPrompt,
      INITIAL_SUMMARY_PROMPT,
    );

    console.log("✅ Intermediate Output Generated:");
    console.log("─────────────────────────────────────────────────────────");
    console.log(intermediateOutput);
    console.log("─────────────────────────────────────────────────────────\n");

    // Step 3: Create mock video upload result
    const videoUploadResult = {
      success: true,
      origin: "external" as const,
      data: {
        videoId: "test-video-id",
        title: "Test Video",
        description: "Manual test video",
        url: VIDEO_URL,
        duration: VIDEO_DURATION,
      },
    };

    console.log("🎥 Video Upload Result:");
    console.log("─────────────────────────────────────────────────────────");
    console.log(JSON.stringify(videoUploadResult, null, 2));
    console.log("─────────────────────────────────────────────────────────\n");

    // Step 4: Get system prompt (like the app does)
    const customPromptStorage = CustomPromptStorage.getInstance();
    const customPrompt = await customPromptStorage.getActivePrompt();
    const systemPrompt = buildTaskExecutionPrompt(customPrompt?.content);

    console.log("📋 System Prompt:");
    console.log("─────────────────────────────────────────────────────────");
    console.log(systemPrompt.substring(0, 200) + "...");
    console.log("─────────────────────────────────────────────────────────\n");

    // Step 5: Execute task with MCP Orchestrator (THE MAIN STAGE)
    console.log("🚀 Stage: EXECUTING_TASK (Starting MCP Orchestrator)...\n");
    console.log("═════════════════════════════════════════════════════════");
    console.log("  MCP Orchestrator will now process the transcript");
    console.log("  You will see detailed logs below from the orchestrator");
    console.log("═════════════════════════════════════════════════════════\n");

    const orchestrator = await MCPOrchestrator.getInstanceAsync();
    const mcpResult = await orchestrator.manualLoopAsync(transcriptText, videoUploadResult, {
      systemPrompt,
      maxToolIterations: 20,
    });

    // Step 6: Display final result
    console.log("\n╔═══════════════════════════════════════════════════════╗");
    console.log("║              FINAL RESULT                             ║");
    console.log("╚═══════════════════════════════════════════════════════╝\n");
    console.log(mcpResult);
    console.log("\n✅ Test completed successfully!\n");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error during test execution:");
    console.error(error);
    process.exit(1);
  }
}

// ============================================================
// Run the test
// ============================================================
runManualTest();
