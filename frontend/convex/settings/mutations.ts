/**
 * Settings mutations — public, auth-checked.
 * Upserts a single settings row per org.
 */
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireOrgMembership } from "../lib/auth";

/** Keys that should be skipped if they contain a mask pattern. */
const API_KEY_FIELDS = ["llmApiKey", "embeddingApiKey", "rerankApiKey", "webSearchApiKey"] as const;

/** Fields that are locked once chunks exist. */
const EMBEDDING_FIELDS = ["embeddingModel", "embeddingBaseUrl", "embeddingApiKey", "embeddingDimensions"] as const;

export const update = mutation({
  args: {
    orgId: v.string(),
    llmModel: v.optional(v.string()),
    llmBaseUrl: v.optional(v.string()),
    llmApiKey: v.optional(v.string()),
    embeddingModel: v.optional(v.string()),
    embeddingBaseUrl: v.optional(v.string()),
    embeddingApiKey: v.optional(v.string()),
    embeddingDimensions: v.optional(v.number()),
    rerankModel: v.optional(v.string()),
    rerankBaseUrl: v.optional(v.string()),
    rerankApiKey: v.optional(v.string()),
    rerankTopN: v.optional(v.number()),
    webSearchEnabled: v.optional(v.boolean()),
    webSearchProvider: v.optional(v.string()),
    webSearchApiKey: v.optional(v.string()),
    chatSystemPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgMembership(ctx, args);

    // Check embedding lock: if chunks exist, reject embedding field changes
    const hasEmbeddingChange = EMBEDDING_FIELDS.some(
      (f) => args[f] !== undefined,
    );
    if (hasEmbeddingChange) {
      const chunk = await ctx.db
        .query("chunks")
        .withIndex("by_org", (q: any) => q.eq("orgId", orgId))
        .first();
      if (chunk) {
        const existing = await ctx.db
          .query("settings")
          .withIndex("by_org", (q: any) => q.eq("orgId", orgId))
          .first();
        for (const field of EMBEDDING_FIELDS) {
          const newVal = args[field];
          if (newVal === undefined) continue;
          if (typeof newVal === "string" && newVal.includes("***")) continue;
          const existingVal = existing?.[field];
          if (newVal !== existingVal) {
            throw new Error(
              "Embedding settings are locked because documents have already been processed. Delete all documents and chunks first to change embedding configuration.",
            );
          }
        }
      }
    }

    // Build update object, skipping masked API keys
    const updates: Record<string, any> = {};
    for (const [key, value] of Object.entries(args)) {
      if (key === "orgId") continue;
      if (value === undefined) continue;
      if (
        API_KEY_FIELDS.includes(key as any) &&
        typeof value === "string" &&
        value.includes("***")
      ) {
        continue;
      }
      updates[key] = value;
    }

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_org", (q: any) => q.eq("orgId", orgId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, updates);
      return existing._id;
    } else {
      return await ctx.db.insert("settings", { orgId, ...updates });
    }
  },
});
