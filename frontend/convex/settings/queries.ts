/**
 * Settings queries — public (auth-checked) and internal.
 */
import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { requireOrgMembership } from "../lib/auth";

/** Mask an API key for display: show only last 4 chars. */
function maskKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.length <= 4) return "***";
  return `***${key.slice(-4)}`;
}

/**
 * Public query — returns settings with API keys masked.
 * Scoped to the user's active org.
 */
export const get = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);

    const settings = await ctx.db
      .query("settings")
      .withIndex("by_org", (q: any) => q.eq("orgId", args.orgId))
      .first();
    if (!settings) return null;

    return {
      ...settings,
      llmApiKey: maskKey(settings.llmApiKey),
      embeddingApiKey: maskKey(settings.embeddingApiKey),
      rerankApiKey: maskKey(settings.rerankApiKey),
      webSearchApiKey: maskKey(settings.webSearchApiKey),
    };
  },
});

/**
 * Check if any chunks exist for this org.
 * Used to lock embedding settings once documents have been processed.
 */
export const hasChunks = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);

    const chunk = await ctx.db
      .query("chunks")
      .withIndex("by_org", (q: any) => q.eq("orgId", args.orgId))
      .first();
    return chunk !== null;
  },
});

/**
 * Internal query — returns full unmasked settings.
 * Used by ingestion pipeline, chat endpoint, and search actions.
 */
export const getFullSettings = internalQuery({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.orgId) {
      return await ctx.db
        .query("settings")
        .withIndex("by_org", (q: any) => q.eq("orgId", args.orgId))
        .first();
    }
    return await ctx.db.query("settings").first();
  },
});
