/**
 * Temporary Test Component - Execute Task from Transcript Text
 *
 * This component provides a quick way to test the "Executing Task" stage
 * by providing transcript text directly and skipping download/transcription.
 *
 * Note: The real flow passes transcriptText (not JSON) to the MCP orchestrator.
 * To use: Add <TestExecuteTaskButton /> to your App.tsx
 */

import { useState } from "react";
import { toast } from "sonner";

const DEFAULT_TRANSCRIPT_TEXT = `Hi, this is a test feature for the Yaxue Desktop app. We need a skip button in the workflow that we can start from every stage and test the result.`;

export function TestExecuteTaskButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [transcriptText, setTranscriptText] = useState(DEFAULT_TRANSCRIPT_TEXT);
  const [videoUrl, setVideoUrl] = useState("https://www.youtube.com/watch?v=test-123");
  const [isExecuting, setIsExecuting] = useState(false);

  const handleExecute = async () => {
    if (!transcriptText.trim()) {
      toast.error("Please enter transcript text");
      return;
    }

    try {
      setIsExecuting(true);
      toast.info("Starting task execution from transcript text...");

      // Call the IPC handler to execute task from intermediate output
      // This will trigger progress events that display the workflow panel
      const result = await window.electronAPI.pipelines.executeTaskFromIntermediate(
        transcriptText,
        {
          videoUrl: videoUrl.trim() || undefined,
        },
      );

      if (result.success) {
        toast.success("Task execution completed!");
        console.log("Final Result:", result.finalOutput);
      } else {
        toast.error(`Task execution failed: ${result.error}`);
      }
    } catch (error) {
      console.error("Error executing task:", error);
      toast.error("Failed to execute task");
    } finally {
      setIsExecuting(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-20 right-4 z-50 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg shadow-lg font-mono text-sm"
        title="Test: Execute task from transcript text"
      >
        🧪 Test Execute
      </button>
    );
  }

  return (
    <div className="fixed bottom-20 right-4 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-4 w-[500px] max-h-[600px] overflow-auto">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-white font-bold">🧪 Test: Execute from Transcript</h3>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="text-gray-400 hover:text-white"
        >
          ✕
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="transcript-text" className="block text-sm text-gray-400 mb-1">
            Transcript Text:
          </label>
          <textarea
            id="transcript-text"
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            className="w-full h-64 bg-gray-800 text-white border border-gray-700 rounded p-2 font-mono text-xs"
            placeholder="Paste your transcript text here..."
          />
        </div>

        <div>
          <label htmlFor="video-url" className="block text-sm text-gray-400 mb-1">
            Video URL (optional):
          </label>
          <input
            id="video-url"
            type="text"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            className="w-full bg-gray-800 text-white border border-gray-700 rounded p-2 text-sm"
            placeholder="https://www.youtube.com/watch?v=..."
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExecute}
            disabled={isExecuting}
            className={`flex-1 px-4 py-2 rounded font-medium ${
              isExecuting
                ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                : "bg-purple-600 hover:bg-purple-700 text-white"
            }`}
          >
            {isExecuting ? "Executing..." : "▶️ Execute Task"}
          </button>
          <button
            type="button"
            onClick={() => setTranscriptText(DEFAULT_TRANSCRIPT_TEXT)}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
          >
            Reset
          </button>
        </div>

        <div className="text-xs text-gray-500 bg-gray-800 p-2 rounded">
          <strong>How to use:</strong>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li>Paste your transcript text above (plain text, not JSON)</li>
            <li>Optionally provide a video URL</li>
            <li>Click "Execute Task" to start</li>
            <li>Watch the workflow progress panel</li>
            <li>Check backend logs for details</li>
          </ul>
          <div className="mt-2 text-[10px] text-gray-600">
            Note: This uses transcript text just like the real flow. The MCP orchestrator receives
            the transcript text directly, not the intermediate JSON.
          </div>
        </div>
      </div>
    </div>
  );
}
