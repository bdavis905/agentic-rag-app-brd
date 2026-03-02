/**
 * Internal mutations/queries for Google Drive integration.
 * Called from actions — no auth checks needed.
 */
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ─── Connection Management ──────────────────────────────────────

export const getConnection = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("googleDriveConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const upsertConnection = internalMutation({
  args: {
    userId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("googleDriveConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt: args.expiresAt,
        email: args.email,
      });
      return existing._id;
    }

    return await ctx.db.insert("googleDriveConnections", {
      userId: args.userId,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      expiresAt: args.expiresAt,
      email: args.email,
      connectedAt: Date.now(),
    });
  },
});

export const updateTokens = internalMutation({
  args: {
    userId: v.string(),
    accessToken: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const conn = await ctx.db
      .query("googleDriveConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (!conn) throw new Error("No Google Drive connection found");
    await ctx.db.patch(conn._id, {
      accessToken: args.accessToken,
      expiresAt: args.expiresAt,
    });
  },
});

export const deleteConnection = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const conn = await ctx.db
      .query("googleDriveConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (conn) {
      await ctx.db.delete(conn._id);
    }
  },
});

// ─── Document / Folder Creation (for imports) ───────────────────

export const createImportedDocument = internalMutation({
  args: {
    userId: v.string(),
    orgId: v.optional(v.string()),
    filename: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
    storageId: v.id("_storage"),
    folderId: v.optional(v.id("folders")),
    contentHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check for duplicate by content hash
    if (args.contentHash && args.orgId) {
      const existing = await ctx.db
        .query("documents")
        .withIndex("by_org_filename", (q) =>
          q.eq("orgId", args.orgId).eq("filename", args.filename)
        )
        .first();

      if (existing && existing.contentHash === args.contentHash) {
        return { documentId: existing._id, action: "skipped" as const };
      }
    } else if (args.contentHash) {
      const existing = await ctx.db
        .query("documents")
        .withIndex("by_user_filename", (q) =>
          q.eq("userId", args.userId).eq("filename", args.filename)
        )
        .first();

      if (existing && existing.contentHash === args.contentHash) {
        return { documentId: existing._id, action: "skipped" as const };
      }
    }

    const docId = await ctx.db.insert("documents", {
      userId: args.userId,
      orgId: args.orgId,
      filename: args.filename,
      fileType: args.fileType,
      fileSize: args.fileSize,
      storageId: args.storageId,
      folderId: args.folderId,
      status: "pending",
      chunkCount: 0,
      contentHash: args.contentHash,
    });

    return { documentId: docId, action: "created" as const };
  },
});

export const createImportedFolder = internalMutation({
  args: {
    userId: v.string(),
    orgId: v.optional(v.string()),
    name: v.string(),
    parentId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    // Find max order among siblings
    let siblings;
    if (args.orgId) {
      siblings = await ctx.db
        .query("folders")
        .withIndex("by_org_parent", (q) =>
          q.eq("orgId", args.orgId).eq("parentId", args.parentId)
        )
        .collect();
    } else {
      siblings = await ctx.db
        .query("folders")
        .withIndex("by_user_parent", (q) =>
          q.eq("userId", args.userId).eq("parentId", args.parentId)
        )
        .collect();
    }

    const maxOrder = siblings.reduce(
      (max, f) => Math.max(max, f.order ?? 0),
      0
    );

    const folderId = await ctx.db.insert("folders", {
      userId: args.userId,
      orgId: args.orgId,
      name: args.name,
      parentId: args.parentId,
      order: maxOrder + 1,
    });

    return folderId;
  },
});

// ─── Drive File Mapping ─────────────────────────────────────────

export const createDriveFileMapping = internalMutation({
  args: {
    userId: v.string(),
    orgId: v.optional(v.string()),
    documentId: v.id("documents"),
    driveFileId: v.string(),
    driveName: v.string(),
    driveMimeType: v.string(),
    driveModifiedTime: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("googleDriveFiles")
      .withIndex("by_drive_file", (q) =>
        q.eq("userId", args.userId).eq("driveFileId", args.driveFileId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        documentId: args.documentId,
        orgId: args.orgId,
        driveModifiedTime: args.driveModifiedTime,
        lastSyncedAt: Date.now(),
        syncStatus: "synced",
        errorMessage: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("googleDriveFiles", {
      userId: args.userId,
      orgId: args.orgId,
      documentId: args.documentId,
      driveFileId: args.driveFileId,
      driveName: args.driveName,
      driveMimeType: args.driveMimeType,
      driveModifiedTime: args.driveModifiedTime,
      lastSyncedAt: Date.now(),
      syncStatus: "synced",
    });
  },
});
