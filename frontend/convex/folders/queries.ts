import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireOrgMembership } from "../lib/auth";

export const list = query({
  args: {
    orgId: v.string(),
    parentId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgMembership(ctx, args);

    let results;
    if (args.parentId) {
      results = await ctx.db
        .query("folders")
        .withIndex("by_org_parent", (q) =>
          q.eq("orgId", orgId).eq("parentId", args.parentId)
        )
        .collect();
    } else {
      results = await ctx.db
        .query("folders")
        .withIndex("by_org_parent", (q) =>
          q.eq("orgId", orgId).eq("parentId", undefined)
        )
        .collect();
    }

    results.sort((a, b) => {
      const orderA = a.order ?? Infinity;
      const orderB = b.order ?? Infinity;
      if (orderA !== orderB) return orderA - orderB;
      return a._creationTime - b._creationTime;
    });

    return results;
  },
});

export const getAncestors = query({
  args: { orgId: v.string(), folderId: v.id("folders") },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);

    const ancestors: { id: string; name: string }[] = [];
    let currentId: string | undefined = args.folderId;

    while (currentId) {
      const folder = await ctx.db.get(currentId as any);
      if (!folder) break;
      ancestors.unshift({ id: folder._id, name: folder.name });
      currentId = folder.parentId as string | undefined;
    }

    return ancestors;
  },
});
