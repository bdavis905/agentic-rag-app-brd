/**
 * Settings actions — server-side HTTP calls (e.g., fetching model lists).
 */
"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
}

/**
 * Fetch available models from the configured LLM provider (e.g., OpenRouter).
 * Returns a simplified list of models sorted by name.
 */
export const fetchModels = action({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx): Promise<{
    models: Array<{
      id: string;
      name: string;
      contextLength: number;
      promptPricing: string;
      completionPricing: string;
    }>;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const settings = await ctx.runQuery(
      internal.settings.queries.getFullSettings,
      {},
    );

    const apiKey =
      settings?.llmApiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    const baseUrl =
      settings?.llmBaseUrl || process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";

    if (!apiKey) {
      return { models: [] };
    }

    const modelsUrl = baseUrl.replace(/\/+$/, "") + "/models";

    try {
      const response = await fetch(modelsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        console.error(`Failed to fetch models: ${response.status} ${response.statusText}`);
        return { models: [] };
      }

      const data = await response.json();
      const rawModels: OpenRouterModel[] = data.data || data.models || [];

      const models = rawModels
        .map((m) => ({
          id: m.id,
          name: m.name || m.id,
          contextLength: m.context_length || 0,
          promptPricing: m.pricing?.prompt || "0",
          completionPricing: m.pricing?.completion || "0",
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return { models };
    } catch (err) {
      console.error("Error fetching models:", err);
      return { models: [] };
    }
  },
});
