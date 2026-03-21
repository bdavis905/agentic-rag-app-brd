/**
 * Internal harness run CRUD — called from HTTP Action handler.
 */
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const createRun = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.optional(v.string()),
    harnessType: v.string(),
    inputFiles: v.optional(v.array(v.string())),
    config: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("harnessRuns", {
      threadId: args.threadId,
      orgId: args.orgId,
      harnessType: args.harnessType,
      status: "running",
      currentPhase: 0,
      phaseResults: {},
      inputFiles: args.inputFiles,
      config: args.config,
    });
  },
});

export const updatePhase = internalMutation({
  args: {
    runId: v.id("harnessRuns"),
    currentPhase: v.number(),
    phaseResults: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      currentPhase: args.currentPhase,
      phaseResults: args.phaseResults,
    });
  },
});

export const completeRun = internalMutation({
  args: {
    runId: v.id("harnessRuns"),
    phaseResults: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: "completed",
      phaseResults: args.phaseResults,
    });
  },
});

export const failRun = internalMutation({
  args: {
    runId: v.id("harnessRuns"),
    error: v.string(),
    currentPhase: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: "failed",
      error: args.error,
      currentPhase: args.currentPhase,
    });
  },
});

export const getActiveRun = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query("harnessRuns")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .collect();

    return runs.find((r) => r.status === "running") ?? null;
  },
});
