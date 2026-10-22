import { VIDEO_LINK_EMBEDDING_RULES } from "../../constants/prompts";
import { getDurationParts } from "../../utils/duration-utils";
import type { VideoUploadResult } from "../auth/types";

export const orchestratorSystemPrompt = `
    You are a helpful AI with tool-calling capabilities that helps users achieve their goals.
    You may be given a **Project Prompt**, **Project Metadata**, and a **User Video Transcription**. Make good use of the tools and information provided and do your best to fulfill the user's request.
    The user cannot reply to you. DO NOT ask for confirmation or clarification. DO NOT merely draft content; use your best judgment to proceed and execute actions as needed.

    - **Project Metadata**: Contains project information such as the project name, backlog, and associated members.
    - **Project Prompt**: Detailed instructions and requirements that you MUST follow when creating issues or PBIs. Always prioritize the Project Prompt over any other information. If there is conflicting information, the Project Prompt takes precedence.
    - **User Video Transcription**: A transcription of the user's video containing context, content, and requirements. Use this to understand the user's needs and extract relevant information to create tasks and call tools effectively.
    Note: The transcription is auto-generated and may contain typos. If there is any conflict between the transcription and the Project Prompt, prioritize the Project Prompt.
    `;

/**
 * #1062: with local storage as the video host there may be no uploaded video at all. Without
 * saying so, the model followed a repository template's "Watch the video" line and filled it with
 * a made-up link (e.g. `about:blank`).
 */
export const NO_VIDEO_LINK_RULES = `**No Video Link (CRITICAL)**: No video was uploaded for this request, so there is NO video URL.
- Do NOT add any video link or video line to the created issue or task — not even when the Project Prompt or the repository template asks for one.
- Remove the template's video line entirely (e.g. "Watch the video", "🟥/▶️ Watch the video (duration)") instead of filling it in.
- NEVER use a placeholder link such as about:blank, #, or an empty URL.`;

/**
 * Adds what the model needs to know about the recording to the orchestrator's system prompt:
 * the uploaded video's URL and duration (with the embedding rules), or that there is no video,
 * plus the local file it can capture screenshots from. Shared by both orchestrator backends.
 */
export function appendVideoInfoToSystemPrompt(
  systemPrompt: string,
  videoUploadResult?: VideoUploadResult,
  videoFilePath?: string,
): string {
  let prompt = systemPrompt;
  const videoUrl = videoUploadResult?.data?.url;
  const duration = videoUploadResult?.data?.duration;

  if (videoUrl) {
    const videoEmbeddingRules = prompt.includes(VIDEO_LINK_EMBEDDING_RULES)
      ? ""
      : `\n${VIDEO_LINK_EMBEDDING_RULES}`;

    if (typeof duration === "number" && duration > 0) {
      const outputDuration = getDurationParts(duration);
      prompt += `\n\nThis is the uploaded video URL: ${videoUrl}.
Video duration:
- totalSeconds: ${outputDuration.totalSeconds}
- hours: ${outputDuration.hours}
- minutes: ${outputDuration.minutes}
- seconds: ${outputDuration.seconds}
${videoEmbeddingRules}`;
    } else {
      prompt += `\n\nThis is the uploaded video URL: ${videoUrl}.
${videoEmbeddingRules}`;
    }
  } else {
    prompt += `\n\n${NO_VIDEO_LINK_RULES}`;
  }

  if (videoFilePath) {
    prompt += `\n\nVideo file available for screenshot capture: ${videoFilePath}.`;
  }

  return prompt;
}
