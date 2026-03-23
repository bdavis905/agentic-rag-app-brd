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

// ─── Phase-Level Operations ─────────────────────────────────────

export const createPhases = internalMutation({
  args: {
    runId: v.id("harnessRuns"),
    phases: v.array(v.object({
      phaseIndex: v.number(),
      phaseName: v.string(),
      phaseDescription: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    for (const phase of args.phases) {
      await ctx.db.insert("harnessPhases", {
        runId: args.runId,
        phaseIndex: phase.phaseIndex,
        phaseName: phase.phaseName,
        phaseDescription: phase.phaseDescription,
        status: "pending",
      });
    }
  },
});

export const updatePhaseStatus = internalMutation({
  args: {
    runId: v.id("harnessRuns"),
    phaseIndex: v.number(),
    status: v.string(),
    streamingText: v.optional(v.string()),
    toolCalls: v.optional(v.any()),
    batchProgress: v.optional(v.object({
      processed: v.number(),
      total: v.number(),
    })),
    messages: v.optional(v.any()),
    currentRound: v.optional(v.number()),
    genesisBotResults: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const phase = await ctx.db
      .query("harnessPhases")
      .withIndex("by_run_phase", (q: any) =>
        q.eq("runId", args.runId).eq("phaseIndex", args.phaseIndex))
      .first();
    if (!phase) return;

    const patch: Record<string, any> = { status: args.status };
    if (args.streamingText !== undefined) patch.streamingText = args.streamingText;
    if (args.toolCalls !== undefined) patch.toolCalls = args.toolCalls;
    if (args.batchProgress !== undefined) patch.batchProgress = args.batchProgress;
    if (args.messages !== undefined) patch.messages = args.messages;
    if (args.currentRound !== undefined) patch.currentRound = args.currentRound;
    if (args.genesisBotResults !== undefined) patch.genesisBotResults = args.genesisBotResults;

    await ctx.db.patch(phase._id, patch);
  },
});

export const completePhase = internalMutation({
  args: {
    runId: v.id("harnessRuns"),
    phaseIndex: v.number(),
    output: v.any(),
  },
  handler: async (ctx, args) => {
    const phase = await ctx.db
      .query("harnessPhases")
      .withIndex("by_run_phase", (q: any) =>
        q.eq("runId", args.runId).eq("phaseIndex", args.phaseIndex))
      .first();
    if (!phase) return;

    await ctx.db.patch(phase._id, {
      status: "completed",
      output: args.output,
    });
  },
});

export const failPhase = internalMutation({
  args: {
    runId: v.id("harnessRuns"),
    phaseIndex: v.number(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const phase = await ctx.db
      .query("harnessPhases")
      .withIndex("by_run_phase", (q: any) =>
        q.eq("runId", args.runId).eq("phaseIndex", args.phaseIndex))
      .first();
    if (!phase) return;

    await ctx.db.patch(phase._id, {
      status: "failed",
      error: args.error,
    });
  },
});

export const getPhase = internalQuery({
  args: {
    runId: v.id("harnessRuns"),
    phaseIndex: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("harnessPhases")
      .withIndex("by_run_phase", (q: any) =>
        q.eq("runId", args.runId).eq("phaseIndex", args.phaseIndex))
      .first();
  },
});

export const getPhases = internalQuery({
  args: { runId: v.id("harnessRuns") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("harnessPhases")
      .withIndex("by_run", (q: any) => q.eq("runId", args.runId))
      .collect();
  },
});

export const getRun = internalQuery({
  args: { runId: v.id("harnessRuns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId);
  },
});

export const cancelRun = internalMutation({
  args: { runId: v.id("harnessRuns") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, { cancelRequested: true });
  },
});
