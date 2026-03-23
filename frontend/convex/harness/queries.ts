/**
 * Public harness queries -- frontend subscribes via useQuery for reactive updates.
 */
import { query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Get the active (or most recent) harness run for a thread.
 */
export const getActiveRun = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const runs = await ctx.db
      .query("harnessRuns")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .collect();

    // Prefer running, then most recent
    const running = runs.find((r) => r.status === "running");
    if (running) return running;

    return runs.sort((a, b) => b._creationTime - a._creationTime)[0] ?? null;
  },
});

/**
 * Get all phases for a harness run, ordered by phaseIndex.
 */
export const getPhases = query({
  args: { runId: v.id("harnessRuns") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const phases = await ctx.db
      .query("harnessPhases")
      .withIndex("by_run", (q: any) => q.eq("runId", args.runId))
      .collect();

    return phases.sort((a, b) => a.phaseIndex - b.phaseIndex);
  },
});
