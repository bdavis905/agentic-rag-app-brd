import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireOrgMembership } from "../lib/auth";

export const list = query({
  args: {
    orgId: v.string(),
    folderId: v.optional(v.union(v.id("folders"), v.literal("unfiled"))),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgMembership(ctx, args);

    if (args.folderId === "unfiled") {
      return await ctx.db
        .query("documents")
        .withIndex("by_org_folder", (q) =>
          q.eq("orgId", orgId).eq("folderId", undefined)
        )
        .order("desc")
        .collect();
    }

    if (args.folderId) {
      return await ctx.db
        .query("documents")
        .withIndex("by_org_folder", (q) =>
          q.eq("orgId", orgId).eq("folderId", args.folderId as any)
        )
        .order("desc")
        .collect();
    }

    return await ctx.db
      .query("documents")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { orgId: v.string(), documentId: v.id("documents") },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);

    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.orgId !== args.orgId) return null;
    return doc;
  },
});
