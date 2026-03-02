import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { requireOrgMembership } from "../lib/auth";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    orgId: v.string(),
    filename: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
    storageId: v.id("_storage"),
    folderId: v.optional(v.id("folders")),
    contentHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgMembership(ctx, args);

    // Check for duplicate by content hash
    if (args.contentHash) {
      const existing = await ctx.db
        .query("documents")
        .withIndex("by_org_filename", (q) =>
          q.eq("orgId", orgId).eq("filename", args.filename)
        )
        .first();

      if (existing && existing.contentHash === args.contentHash) {
        return { ...existing, action: "skipped" as const };
      }

      if (existing) {
        // Same filename, different content — delete old chunks first
        const oldChunks = await ctx.db
          .query("chunks")
          .withIndex("by_document", (q) => q.eq("documentId", existing._id))
          .collect();
        for (const chunk of oldChunks) {
          await ctx.db.delete(chunk._id);
        }

        await ctx.storage.delete(existing.storageId);

        await ctx.db.patch(existing._id, {
          storageId: args.storageId,
          fileSize: args.fileSize,
          fileType: args.fileType,
          contentHash: args.contentHash,
          status: "pending",
          chunkCount: 0,
          errorMessage: undefined,
          folderId: args.folderId,
        });

        await ctx.scheduler.runAfter(
          0,
          internal.documents.actions.processDocument,
          { documentId: existing._id },
        );

        const updated = await ctx.db.get(existing._id);
        return { ...updated!, action: "updated" as const };
      }
    }

    // New document
    const docId = await ctx.db.insert("documents", {
      userId,
      orgId,
      filename: args.filename,
      fileType: args.fileType,
      fileSize: args.fileSize,
      storageId: args.storageId,
      folderId: args.folderId,
      status: "pending",
      chunkCount: 0,
      contentHash: args.contentHash,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.documents.actions.processDocument,
      { documentId: docId },
    );

    const doc = await ctx.db.get(docId);
    return { ...doc!, action: "created" as const };
  },
});

export const updateStatus = mutation({
  args: {
    documentId: v.id("documents"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
    chunkCount: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { documentId, ...updates } = args;
    await ctx.db.patch(documentId, {
      status: updates.status,
      ...(updates.chunkCount !== undefined && {
        chunkCount: updates.chunkCount,
      }),
      ...(updates.errorMessage !== undefined && {
        errorMessage: updates.errorMessage,
      }),
      ...(updates.metadata !== undefined && { metadata: updates.metadata }),
    });
  },
});

export const rename = mutation({
  args: {
    orgId: v.string(),
    documentId: v.id("documents"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);

    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.orgId !== args.orgId) {
      throw new Error("Document not found");
    }

    const existingMetadata = (doc.metadata as Record<string, any>) ?? {};
    await ctx.db.patch(args.documentId, {
      metadata: { ...existingMetadata, title: args.title },
    });
  },
});

export const remove = mutation({
  args: { orgId: v.string(), documentId: v.id("documents") },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);

    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.orgId !== args.orgId) {
      throw new Error("Document not found");
    }

    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();

    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }

    await ctx.storage.delete(doc.storageId);
    await ctx.db.delete(args.documentId);
  },
});
