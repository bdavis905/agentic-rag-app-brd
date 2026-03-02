import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireOrgMembership } from "../lib/auth";

export const listThreads = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgMembership(ctx, args);

    return await ctx.db
      .query("threads")
      .withIndex("by_org", (q: any) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
  },
});

export const getMessages = query({
  args: { orgId: v.string(), threadId: v.id("threads") },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);

    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== args.orgId) {
      throw new Error("Thread not found");
    }

    return await ctx.db
      .query("messages")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .collect();
  },
});
