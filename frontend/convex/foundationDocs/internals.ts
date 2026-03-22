/**
 * Internal foundation docs CRUD -- called from harness engine.
 *
 * Foundation docs are per-org persistent knowledge documents
 * (Build-A-Buyer, Copy Blocks, Offer Brief, etc.) that are
 * built once and reused across harness runs.
 */
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const upsert = internalMutation({
  args: {
    orgId: v.string(),
    docType: v.string(),
    content: v.string(),
    sourceBot: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("foundationDocs")
      .withIndex("by_org_doc", (q: any) =>
        q.eq("orgId", args.orgId).eq("docType", args.docType)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        content: args.content,
        sourceBot: args.sourceBot,
        version: existing.version + 1,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("foundationDocs", {
      orgId: args.orgId,
      docType: args.docType,
      content: args.content,
      sourceBot: args.sourceBot,
      version: 1,
      updatedAt: Date.now(),
    });
  },
});

export const getByOrgDoc = internalQuery({
  args: {
    orgId: v.string(),
    docType: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("foundationDocs")
      .withIndex("by_org_doc", (q: any) =>
        q.eq("orgId", args.orgId).eq("docType", args.docType)
      )
      .first();
  },
});

export const listByOrg = internalQuery({
  args: {
    orgId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("foundationDocs")
      .withIndex("by_org", (q: any) => q.eq("orgId", args.orgId))
      .collect();
  },
});
