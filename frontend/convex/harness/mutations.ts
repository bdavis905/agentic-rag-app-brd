/**
 * Public and internal harness mutations -- start and cancel harness runs.
 */
import { mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

/**
 * Start a harness run. Creates the run record, phases, todos,
 * and schedules the first worker action.
 */
export const startHarness = mutation({
  args: startHarnessArgs,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return startHarnessHandler(ctx, args);
  },
});

/**
 * Internal version of startHarness -- called from HTTP action (already authenticated).
 */
const startHarnessArgs = {
  threadId: v.id("threads"),
  orgId: v.optional(v.string()),
  userId: v.string(),
  harnessType: v.string(),
  definition: v.any(),
  offerSlug: v.optional(v.string()),
  input: v.optional(v.string()),
};

async function startHarnessHandler(ctx: any, args: any) {
  const definition = args.definition;

  const runId = await ctx.db.insert("harnessRuns", {
    threadId: args.threadId,
    orgId: args.orgId,
    userId: args.userId,
    harnessType: args.harnessType,
    status: "running",
    currentPhase: 0,
    phaseResults: {},
    definition,
    offerSlug: args.offerSlug,
  });

  const phases = definition.phases ?? [];
  for (let i = 0; i < phases.length; i++) {
    await ctx.db.insert("harnessPhases", {
      runId,
      phaseIndex: i,
      phaseName: phases[i].name,
      phaseDescription: phases[i].description,
      status: "pending",
    });
  }

  const existingTodos = await ctx.db
    .query("todos")
    .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
    .collect();
  for (const t of existingTodos) {
    await ctx.db.delete(t._id);
  }
  for (let i = 0; i < phases.length; i++) {
    await ctx.db.insert("todos", {
      threadId: args.threadId,
      orgId: args.orgId,
      content: phases[i].name,
      status: "pending" as const,
      position: i,
    });
  }

  if (args.input) {
    await ctx.runMutation(internal.workspace.internals.writeFile, {
      threadId: args.threadId,
      orgId: args.orgId,
      filePath: "input.txt",
      content: args.input,
      contentType: "text/plain",
      source: "user",
    });
  }

  await ctx.scheduler.runAfter(0, internal.harness.worker.runPhase, {
    runId,
    phaseIndex: 0,
  });

  return runId;
}

export const internalStartHarness = internalMutation({
  args: startHarnessArgs,
  handler: startHarnessHandler,
});

/**
 * Cancel a running harness. Sets cancelRequested flag;
 * workers check this at the start of each phase/round.
 */
export const cancelRun = mutation({
  args: { runId: v.id("harnessRuns") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running") return;

    await ctx.db.patch(args.runId, { cancelRequested: true, status: "cancelled" });

    // Mark any running phases as cancelled
    const phases = await ctx.db
      .query("harnessPhases")
      .withIndex("by_run", (q: any) => q.eq("runId", args.runId))
      .collect();
    for (const phase of phases) {
      if (phase.status === "running" || phase.status === "pending") {
        await ctx.db.patch(phase._id, { status: "cancelled" });
      }
    }
  },
});
