/**
 * Internal queries and actions for search.
 * vectorSearch is only available in actions (not queries) in Convex.
 */
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

/**
 * Vector search — must be an action because ctx.vectorSearch is action-only.
 * Filters by orgId. Falls back to userId for backward compat.
 */
export const vectorSearchAction = internalAction({
  args: {
    embedding: v.array(v.float64()),
    userId: v.optional(v.string()),
    orgId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const filter = args.orgId
      ? (q: any) => q.eq("orgId", args.orgId)
      : (q: any) => q.eq("userId", args.userId);

    const results = await ctx.vectorSearch("chunks", "by_embedding", {
      vector: args.embedding,
      limit: args.limit ?? 20,
      filter,
    });

    // Fetch full chunk data via internal query
    const chunks = await ctx.runQuery(
      internal.search.internals.getChunksByIds,
      { ids: results.map((r: any) => r._id) },
    );

    return results
      .map((result: any) => {
        const chunk = chunks.find((c: any) => c?._id === result._id);
        if (!chunk) return null;
        return { ...chunk, _score: result._score };
      })
      .filter(Boolean);
  },
});

/**
 * Fetch chunks by IDs — internal query used by vectorSearchAction.
 */
export const getChunksByIds = internalQuery({
  args: {
    ids: v.array(v.id("chunks")),
  },
  handler: async (ctx, args) => {
    const chunks = await Promise.all(
      args.ids.map(async (id) => {
        const chunk = await ctx.db.get(id);
        if (!chunk) return null;
        const { embedding, ...rest } = chunk;
        return rest;
      }),
    );
    return chunks;
  },
});

/**
 * Text search — uses search index (available in queries).
 * Filters by orgId. Falls back to userId for backward compat.
 */
export const textSearchQuery = internalQuery({
  args: {
    query: v.string(),
    userId: v.optional(v.string()),
    orgId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let results;
    if (args.orgId) {
      results = await ctx.db
        .query("chunks")
        .withSearchIndex("search_content", (q: any) =>
          q.search("content", args.query).eq("orgId", args.orgId),
        )
        .take(args.limit ?? 20);
    } else {
      results = await ctx.db
        .query("chunks")
        .withSearchIndex("search_content", (q: any) =>
          q.search("content", args.query).eq("userId", args.userId),
        )
        .take(args.limit ?? 20);
    }

    return results.map((chunk) => {
      const { embedding, ...rest } = chunk;
      return rest;
    });
  },
});
