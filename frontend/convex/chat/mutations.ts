import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireOrgMembership } from "../lib/auth";

export const createThread = mutation({
  args: { orgId: v.string(), title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId, orgId } = await requireOrgMembership(ctx, args);

    const threadId = await ctx.db.insert("threads", {
      userId,
      orgId,
      title: args.title ?? "New Chat",
    });

    return await ctx.db.get(threadId);
  },
});

export const deleteThread = mutation({
  args: { orgId: v.string(), threadId: v.id("threads") },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);

    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== args.orgId) {
      throw new Error("Thread not found");
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .collect();

    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    await ctx.db.delete(args.threadId);
  },
});

export const updateTitle = mutation({
  args: { orgId: v.string(), threadId: v.id("threads"), title: v.string() },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);

    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== args.orgId) {
      throw new Error("Thread not found");
    }

    await ctx.db.patch(args.threadId, { title: args.title });
  },
});
