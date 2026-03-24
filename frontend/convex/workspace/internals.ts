/**
 * Internal workspace file functions — called from HTTP Action handler.
 * No auth checks needed (caller is trusted server-side code).
 */
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ─── Path Validation ────────────────────────────────────────────

function validatePath(filePath: string): string | null {
  if (!filePath || filePath.length === 0) return "File path cannot be empty";
  if (filePath.length > 500) return "File path too long (max 500 chars)";
  if (filePath.includes("..")) return "Path traversal not allowed";
  if (filePath.includes("\\")) return "Backslashes not allowed in paths";
  if (filePath.startsWith("/")) return "Path must be relative (no leading /)";
  return null;
}

function inferContentType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const mimeMap: Record<string, string> = {
    md: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    csv: "text/csv",
    html: "text/html",
    xml: "text/xml",
    yaml: "text/yaml",
    yml: "text/yaml",
    py: "text/x-python",
    js: "text/javascript",
    ts: "text/typescript",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
  };
  return mimeMap[ext] || "text/plain";
}

// ─── Write File (Upsert) ────────────────────────────────────────

export const writeFile = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.optional(v.string()),
    filePath: v.string(),
    content: v.string(),
    contentType: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const pathError = validatePath(args.filePath);
    if (pathError) throw new Error(pathError);

    const contentType = args.contentType || inferContentType(args.filePath);
    const sizeBytes = new TextEncoder().encode(args.content).length;
    const source = args.source || "agent";

    // Check for existing file (upsert)
    const existing = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_thread_path", (q: any) =>
        q.eq("threadId", args.threadId).eq("filePath", args.filePath)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        content: args.content,
        contentType,
        sizeBytes,
        source,
      });
      return { id: existing._id, filePath: args.filePath, sizeBytes, contentType };
    }

    const id = await ctx.db.insert("workspaceFiles", {
      threadId: args.threadId,
      orgId: args.orgId,
      filePath: args.filePath,
      content: args.content,
      contentType,
      source,
      sizeBytes,
    });
    return { id, filePath: args.filePath, sizeBytes, contentType };
  },
});

// ─── Write Image File (storageId-based, no inline content) ──────

export const writeImageFile = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.optional(v.string()),
    filePath: v.string(),
    storageId: v.id("_storage"),
    contentType: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const pathError = validatePath(args.filePath);
    if (pathError) throw new Error(pathError);

    const contentType = args.contentType || inferContentType(args.filePath);
    const source = args.source || "harness";

    // Get file size from storage metadata
    const metadata = await ctx.storage.getMetadata(args.storageId);
    const sizeBytes = metadata?.size ?? 0;

    // Check for existing file (upsert)
    const existing = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_thread_path", (q: any) =>
        q.eq("threadId", args.threadId).eq("filePath", args.filePath)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        storageId: args.storageId,
        contentType,
        sizeBytes,
        source,
        content: undefined, // Clear inline content if it existed
      });
      return { id: existing._id, filePath: args.filePath, sizeBytes, contentType };
    }

    const id = await ctx.db.insert("workspaceFiles", {
      threadId: args.threadId,
      orgId: args.orgId,
      filePath: args.filePath,
      storageId: args.storageId,
      contentType,
      source,
      sizeBytes,
    });
    return { id, filePath: args.filePath, sizeBytes, contentType };
  },
});

// ─── Read File ──────────────────────────────────────────────────

export const readFile = internalQuery({
  args: {
    threadId: v.id("threads"),
    filePath: v.string(),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_thread_path", (q: any) =>
        q.eq("threadId", args.threadId).eq("filePath", args.filePath)
      )
      .first();

    if (!file) return null;
    return file.content ?? null;
  },
});

// ─── List Files ─────────────────────────────────────────────────

export const listFiles = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .collect();

    return files.map((f) => ({
      id: f._id,
      filePath: f.filePath,
      contentType: f.contentType,
      source: f.source,
      sizeBytes: f.sizeBytes,
      storageId: f.storageId ?? null,
    }));
  },
});

// ─── Append File ────────────────────────────────────────────────

export const appendFile = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.optional(v.string()),
    filePath: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const pathError = validatePath(args.filePath);
    if (pathError) throw new Error(pathError);

    const existing = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_thread_path", (q: any) =>
        q.eq("threadId", args.threadId).eq("filePath", args.filePath)
      )
      .first();

    if (existing) {
      const newContent = (existing.content ?? "") + args.content;
      const sizeBytes = new TextEncoder().encode(newContent).length;
      await ctx.db.patch(existing._id, { content: newContent, sizeBytes });
      return { id: existing._id, filePath: args.filePath, sizeBytes };
    }

    // Create new file
    const contentType = inferContentType(args.filePath);
    const sizeBytes = new TextEncoder().encode(args.content).length;
    const id = await ctx.db.insert("workspaceFiles", {
      threadId: args.threadId,
      orgId: args.orgId,
      filePath: args.filePath,
      content: args.content,
      contentType,
      source: "agent",
      sizeBytes,
    });
    return { id, filePath: args.filePath, sizeBytes };
  },
});

// ─── Edit File (Find/Replace) ───────────────────────────────────

export const editFile = internalMutation({
  args: {
    threadId: v.id("threads"),
    filePath: v.string(),
    edits: v.array(
      v.object({
        find: v.string(),
        replace: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const pathError = validatePath(args.filePath);
    if (pathError) throw new Error(pathError);

    const existing = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_thread_path", (q: any) =>
        q.eq("threadId", args.threadId).eq("filePath", args.filePath)
      )
      .first();

    if (!existing) throw new Error(`File not found: ${args.filePath}`);

    let content = existing.content ?? "";
    for (const edit of args.edits) {
      content = content.replace(edit.find, edit.replace);
    }

    const sizeBytes = new TextEncoder().encode(content).length;
    await ctx.db.patch(existing._id, { content, sizeBytes });
    return { id: existing._id, filePath: args.filePath, sizeBytes };
  },
});
