/**
 * Public workspace queries — used by frontend useQuery hooks.
 * Auth-checked: requires valid user identity.
 */
import { query } from "../_generated/server";
import { v } from "convex/values";

/**
 * List all workspace files for a thread.
 */
export const listFiles = query({
  args: {
    threadId: v.id("threads"),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    // Verify thread access
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return [];

    if (args.orgId) {
      if (thread.orgId !== args.orgId) return [];
    } else if (thread.userId !== identity.subject) {
      return [];
    }

    const files = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .collect();

    return files
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((f) => ({
        id: f._id,
        filePath: f.filePath,
        contentType: f.contentType,
        source: f.source,
        sizeBytes: f.sizeBytes,
        storageId: f.storageId ?? null,
      }));
  },
});

/**
 * Get a single workspace file's content.
 */
export const getFile = query({
  args: {
    threadId: v.id("threads"),
    filePath: v.string(),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    // Verify thread access
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return null;

    if (args.orgId) {
      if (thread.orgId !== args.orgId) return null;
    } else if (thread.userId !== identity.subject) {
      return null;
    }

    const file = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_thread_path", (q: any) =>
        q.eq("threadId", args.threadId).eq("filePath", args.filePath)
      )
      .first();

    if (!file) return null;

    // For image files with storageId, generate a URL instead of returning content
    let imageUrl: string | null = null;
    if (file.storageId && file.contentType?.startsWith("image/")) {
      imageUrl = await ctx.storage.getUrl(file.storageId);
    }

    return {
      id: file._id,
      filePath: file.filePath,
      content: file.content ?? null,
      contentType: file.contentType,
      source: file.source,
      sizeBytes: file.sizeBytes,
      storageId: file.storageId ?? null,
      imageUrl,
    };
  },
});

/**
 * Get a storage URL for a file (images, binary files).
 */
export const getFileUrl = query({
  args: {
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.storage.getUrl(args.storageId);
  },
});
