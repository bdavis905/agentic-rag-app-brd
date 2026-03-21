/**
 * Internal todo functions — called from HTTP Action handler.
 * No auth checks needed (caller is trusted server-side code).
 */
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

/**
 * Replace all todos for a thread with a new list.
 * Deletes existing todos first, then inserts the new set.
 */
export const writeTodos = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.optional(v.string()),
    todos: v.array(
      v.object({
        content: v.string(),
        status: v.union(
          v.literal("pending"),
          v.literal("in_progress"),
          v.literal("completed")
        ),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Delete all existing todos for this thread
    const existing = await ctx.db
      .query("todos")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .collect();

    for (const todo of existing) {
      await ctx.db.delete(todo._id);
    }

    // Insert new todos with position
    const inserted = [];
    for (let i = 0; i < args.todos.length; i++) {
      const id = await ctx.db.insert("todos", {
        threadId: args.threadId,
        orgId: args.orgId,
        content: args.todos[i].content,
        status: args.todos[i].status,
        position: i,
      });
      inserted.push({
        id,
        content: args.todos[i].content,
        status: args.todos[i].status,
        position: i,
      });
    }

    return inserted;
  },
});

/**
 * Get all todos for a thread, ordered by position.
 */
export const getTodos = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
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
