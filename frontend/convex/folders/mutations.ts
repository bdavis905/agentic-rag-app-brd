import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireOrgMembership } from "../lib/auth";

export const create = mutation({
  args: {
    orgId: v.string(),
    name: v.string(),
    parentId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgMembership(ctx, args);

    const siblings = await ctx.db
      .query("folders")
      .withIndex("by_org_parent", (q) =>
        q.eq("orgId", orgId).eq("parentId", args.parentId)
      )
      .collect();

    const maxOrder = siblings.reduce(
      (max, f) => Math.max(max, f.order ?? 0),
      0
    );

    const folderId = await ctx.db.insert("folders", {
      userId,
      orgId,
      name: args.name,
      parentId: args.parentId,
      order: maxOrder + 1,
    });

    return await ctx.db.get(folderId);
  },
});

export const rename = mutation({
  args: {
    orgId: v.string(),
    folderId: v.id("folders"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);

    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.orgId !== args.orgId) {
      throw new Error("Folder not found");
    }

    await ctx.db.patch(args.folderId, { name: args.name });
    return await ctx.db.get(args.folderId);
  },
});

export const remove = mutation({
  args: { orgId: v.string(), folderId: v.id("folders") },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgMembership(ctx, args);

    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.orgId !== orgId) {
      throw new Error("Folder not found");
    }

    // Recursively delete subfolders
    const children = await ctx.db
      .query("folders")
      .withIndex("by_parent", (q) => q.eq("parentId", args.folderId))
      .collect();

    for (const child of children) {
      const childDocs = await ctx.db
        .query("documents")
        .withIndex("by_org_folder", (q) =>
          q.eq("orgId", orgId).eq("folderId", child._id)
        )
        .collect();
      for (const doc of childDocs) {
        await ctx.db.patch(doc._id, { folderId: undefined });
      }
      await ctx.db.delete(child._id);
    }

    // Unfile documents in this folder
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_org_folder", (q) =>
        q.eq("orgId", orgId).eq("folderId", args.folderId)
      )
      .collect();
    for (const doc of docs) {
      await ctx.db.patch(doc._id, { folderId: undefined });
    }

    await ctx.db.delete(args.folderId);
  },
});

export const move = mutation({
  args: {
    orgId: v.string(),
    folderId: v.id("folders"),
    newParentId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgMembership(ctx, args);

    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.orgId !== orgId) {
      throw new Error("Folder not found");
    }

    if (folder.parentId === args.newParentId) return;
    if (args.newParentId === args.folderId) {
      throw new Error("Cannot move a folder into itself");
    }

    if (args.newParentId) {
      let ancestorId = args.newParentId as string | undefined;
      while (ancestorId) {
        if (ancestorId === (args.folderId as string)) {
          throw new Error("Cannot move a folder into one of its descendants");
        }
        const ancestor = await ctx.db.get(ancestorId as any) as any;
        ancestorId = ancestor?.parentId as string | undefined;
      }
    }

    const newSiblings = await ctx.db
      .query("folders")
      .withIndex("by_org_parent", (q) =>
        q.eq("orgId", orgId).eq("parentId", args.newParentId)
      )
      .collect();

    const maxOrder = newSiblings.reduce(
      (max, f) => Math.max(max, f.order ?? 0),
      0
    );

    await ctx.db.patch(args.folderId, {
      parentId: args.newParentId,
      order: maxOrder + 1,
    });
  },
});

export const reorder = mutation({
  args: {
    orgId: v.string(),
    folderId: v.id("folders"),
    newIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgMembership(ctx, args);

    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.orgId !== orgId) {
      throw new Error("Folder not found");
    }

    const siblings = await ctx.db
      .query("folders")
      .withIndex("by_org_parent", (q) =>
        q.eq("orgId", orgId).eq("parentId", folder.parentId)
      )
      .collect();

    siblings.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const withoutDragged = siblings.filter((f) => f._id !== args.folderId);
    const clampedIndex = Math.max(0, Math.min(args.newIndex, withoutDragged.length));
    withoutDragged.splice(clampedIndex, 0, folder);

    for (let i = 0; i < withoutDragged.length; i++) {
      if (withoutDragged[i].order !== i + 1) {
        await ctx.db.patch(withoutDragged[i]._id, { order: i + 1 });
      }
    }
  },
});
