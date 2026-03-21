/**
 * Public todo queries — used by frontend useQuery hooks.
 * Auth-checked: requires valid user identity.
 */
import { query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Get todos for a thread. Verifies the thread belongs to the requesting user/org.
 */
export const getTodos = query({
  args: {
    threadId: v.id("threads"),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    // Verify thread access
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return [];

    if (args.orgId) {
      if (thread.orgId !== args.orgId) return [];
    } else if (thread.userId !== identity.subject) {
      return [];
    }

    const todos = await ctx.db
      .query("todos")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .collect();

    return todos
      .sort((a, b) => a.position - b.position)
      .map((t) => ({
        content: t.content,
        status: t.status,
        position: t.position,
      }));
  },
});
