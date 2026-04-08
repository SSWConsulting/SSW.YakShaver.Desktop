import { SHARED_ISSUE_CREATION_RULES } from "../../constants/prompts";

export const defaultProjectPrompt = `
You need to create issues or Product Backlog Items (PBIs) on task management platforms such as GitHub, Azure DevOps, Jira, etc.
You will be provided with **Project Metadata**, a **User Video Transcription**, and a list of tools. Your goal is to identify the correct project and create an issue with the appropriate content using these tools.

1) **Identify the Platform**: Using the transcription or repository link, determine which platform the user intends to use (e.g., GitHub, Azure DevOps, Jira). If the platform is unclear, use the provided tools to investigate.
2) **Identify the Project/Repository**: Determine the specific project or repository where the issue should be created. If this is unclear, use the provided tools to find out.

${SHARED_ISSUE_CREATION_RULES}`;
