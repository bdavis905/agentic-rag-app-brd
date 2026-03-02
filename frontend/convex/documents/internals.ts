/**
 * Internal mutations and queries for the ingestion pipeline.
 * Called from processDocument action — no auth checks needed.
 */
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const updateDocumentStatus = internalMutation({
  args: {
    documentId: v.id("documents"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    chunkCount: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(v.any()),
    fullText: v.optional(v.string()),
    processingStep: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, any> = { status: args.status };
    if (args.chunkCount !== undefined) updates.chunkCount = args.chunkCount;
    if (args.errorMessage !== undefined)
      updates.errorMessage = args.errorMessage;
    if (args.metadata !== undefined) updates.metadata = args.metadata;
    if (args.fullText !== undefined) updates.fullText = args.fullText;
    if (args.processingStep !== undefined) updates.processingStep = args.processingStep;
    await ctx.db.patch(args.documentId, updates);
  },
});

export const insertChunks = internalMutation({
  args: {
    chunks: v.array(
      v.object({
        documentId: v.id("documents"),
        userId: v.string(),
        orgId: v.optional(v.string()),
        content: v.string(),
        chunkIndex: v.number(),
        embedding: v.array(v.float64()),
        metadata: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const chunk of args.chunks) {
      await ctx.db.insert("chunks", chunk);
    }
  },
});

export const getDocument = internalQuery({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.documentId);
  },
});

export const getSettings = internalQuery({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.orgId) {
      return await ctx.db
        .query("settings")
        .withIndex("by_org", (q: any) => q.eq("orgId", args.orgId))
        .first();
    }
    // Fallback: get first settings record (backward compat)
    return await ctx.db.query("settings").first();
  },
});
