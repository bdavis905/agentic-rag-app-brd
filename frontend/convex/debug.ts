// V8 runtime version (no "use node")
import { action } from "./_generated/server";

export const checkEnvVars = action({
  args: {},
  handler: async () => {
    return {
      hasEmbeddingKey: !!process.env.EMBEDDING_API_KEY,
      hasLlmKey: !!process.env.LLM_API_KEY,
      hasOpenaiKey: !!process.env.OPENAI_API_KEY,
      hasE2bKey: !!process.env.E2B_API_KEY,
      hasGenesisKey: !!process.env.GENESIS_API_KEY,
      hasGenesisAnthropicKey: !!process.env.GENESIS_ANTHROPIC_API_KEY,
      genesisKeyPrefix: process.env.GENESIS_API_KEY?.slice(0, 8) || "NOT SET",
      embeddingKeyPrefix: process.env.EMBEDDING_API_KEY?.slice(0, 8) || "NOT SET",
    };
  },
});
