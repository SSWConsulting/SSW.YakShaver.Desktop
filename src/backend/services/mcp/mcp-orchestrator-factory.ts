import { OpenAIService } from "../openai/openai-service.js";
import { MCPOrchestrator, type MCPOrchestratorOptions } from "./mcp-orchestrator.js";

/**
 * Factory function to create a fully initialized MCPOrchestrator.
 * This ensures that loadConfig() completes before the orchestrator is used.
 */
export async function createMcpOrchestrator(
  opts: MCPOrchestratorOptions = {},
  llmClient: OpenAIService = OpenAIService.getInstance(),
): Promise<MCPOrchestrator> {
  const orchestrator = new MCPOrchestrator(opts, llmClient);
  await orchestrator.initialize();
  return orchestrator;
}
