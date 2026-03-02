import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireOrgMembership } from "../lib/auth";

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgMembership(ctx, args);

    const keys = await ctx.db
      .query("apiKeys")
      .withIndex("by_org", (q: any) => q.eq("orgId", orgId))
      .collect();

    // Strip keyHash — never expose to client
    return keys.map((k) => ({
      _id: k._id,
      name: k.name,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
    }));
  },
});
