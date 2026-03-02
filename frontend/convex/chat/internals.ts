/**
 * Internal chat functions — called from HTTP Action handler.
 * No auth checks needed (caller is trusted server-side code).
 */
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const addMessage = internalMutation({
  args: {
    threadId: v.id("threads"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    toolCalls: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      threadId: args.threadId,
      role: args.role,
      content: args.content,
      ...(args.toolCalls !== undefined && { toolCalls: args.toolCalls }),
    });
  },
});

export const getThreadMessages = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .collect();

    return messages.map((m) => ({
      role: m.role as string,
      content: m.content,
    }));
  },
});

export const getThread = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.threadId);
  },
});

export const updateThreadTitle = internalMutation({
  args: { threadId: v.id("threads"), title: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, { title: args.title });
  },
});

export const getMessageCount = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .collect();
    return messages.length;
  },
});

export const createThread = internalMutation({
  args: { userId: v.string(), orgId: v.optional(v.string()), title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const threadId = await ctx.db.insert("threads", {
      userId: args.userId,
      orgId: args.orgId,
      title: args.title ?? "New Chat",
    });
    return threadId;
  },
});

export const listThreadsByOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("threads")
      .withIndex("by_org", (q: any) => q.eq("orgId", args.orgId))
      .order("desc")
      .collect();
  },
});

export const listThreadsByUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("threads")
      .withIndex("by_user", (q: any) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
  },
});

export const getSettings = internalQuery({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.orgId) {
      return await ctx.db
        .query("settings")
        .withIndex("by_org", (q: any) => q.eq("orgId", args.orgId))
        .first();
    }
    return await ctx.db.query("settings").first();
  },
});
