/**
 * Background harness worker -- executes phases as self-chaining scheduled actions.
 *
 * Each phase and each tool-calling round runs as its own action,
 * staying well under the 10-minute Convex limit.
 * State is persisted to harnessRuns/harnessPhases tables between actions.
 */
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import {
  streamLlmCall,
  executeHarnessTool,
  substituteTemplate,
  parseStructuredOutput,
  generatePhaseMarkdown,
  type HarnessContext,
} from "./engine";

// Bot slug -> foundation doc type mapping
const BOT_SLUG_TO_DOC_TYPE: Record<string, string> = {
  "build-a-buyer-elite-": "build-a-buyer",
  "pain-matrix-core-wound-bot-copy": "pain-matrix",
  "universal-mechanism-bot": "mechanism",
  "copy-blocks-extract": "copy-blocks",
  "deep-dive-voice-analyzer": "voice-profile",
};

// ─── Phase Runner ───────────────────────────────────────────────

export const runPhase = internalAction({
  args: {
    runId: v.id("harnessRuns"),
    phaseIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const { runId, phaseIndex } = args;

    // Load run record
    const run: any = await ctx.runQuery(internal.harness.internals.getRun, { runId });
    if (!run || run.cancelRequested || run.status === "cancelled") {
      return; // Cancelled -- stop
    }

    const definition = run.definition;
    if (!definition?.phases || phaseIndex >= definition.phases.length) {
      // All phases complete
      await ctx.runMutation(internal.harness.internals.completeRun, {
        runId,
        phaseResults: {},
      });
      // Update all todos to completed
      const allPhases: any[] = await ctx.runQuery(internal.harness.internals.getPhases, { runId });
      const todos = allPhases
        .sort((a: any, b: any) => a.phaseIndex - b.phaseIndex)
        .map((p: any) => ({
          content: p.phaseName,
          status: "completed" as const,
        }));
      await ctx.runMutation(internal.todos.internals.writeTodos, {
        threadId: run.threadId,
        orgId: run.orgId,
        todos,
      });

      // Generate a rich summary and store it on the run record
      const summary = await generateRunSummary(ctx, run, definition, allPhases);
      await ctx.runMutation(internal.harness.internals.setSummary, {
        runId,
        summary,
      });
      return;
    }

    const phase = definition.phases[phaseIndex];

    // Mark phase as running
    await ctx.runMutation(internal.harness.internals.updatePhaseStatus, {
      runId,
      phaseIndex,
      status: "running",
    });

    // Update todo status
    const allPhases: any[] = await ctx.runQuery(internal.harness.internals.getPhases, { runId });
    const todos = allPhases
      .sort((a: any, b: any) => a.phaseIndex - b.phaseIndex)
      .map((p: any) => ({
        content: p.phaseName,
        status: (p.phaseIndex === phaseIndex ? "in_progress" : p.status === "completed" ? "completed" : "pending") as "pending" | "in_progress" | "completed",
      }));
    await ctx.runMutation(internal.todos.internals.writeTodos, {
      threadId: run.threadId,
      orgId: run.orgId,
      todos,
    });

    // Update run's current phase
    await ctx.runMutation(internal.harness.internals.updatePhase, {
      runId,
      currentPhase: phaseIndex,
      phaseResults: {},
    });

    try {
      if (phase.type === "llm_single") {
        if (phase.tools?.length > 0) {
          // Phase with tools -- start tool-calling loop
          // Build initial messages and persist to phase
          const { messages, foundationDocsLoaded } = await buildPhaseContext(ctx, run, phase, phaseIndex);

          // Log foundation docs as tool call entries so the UI shows them
          const foundationToolCalls = foundationDocsLoaded.map(({ docType, contentLength }) => ({
            toolName: "foundation_doc",
            arguments: JSON.stringify({ docType }),
            status: "completed",
            resultSummary: `Loaded ${docType} (${Math.round(contentLength / 1024)}KB)`,
          }));

          await ctx.runMutation(internal.harness.internals.updatePhaseStatus, {
            runId,
            phaseIndex,
            status: "running",
            messages,
            currentRound: 0,
            ...(foundationToolCalls.length > 0 ? { toolCalls: foundationToolCalls } : {}),
          });

          // Schedule the first tool round
          await ctx.scheduler.runAfter(0, internal.harness.worker.runToolRound, {
            runId,
            phaseIndex,
            round: 0,
          });
        } else {
          // Phase without tools -- single LLM call
          const phaseCtx = await buildPhaseContext(ctx, run, phase, phaseIndex);

          // Log foundation docs as tool call entries so the UI shows them
          if (phaseCtx.foundationDocsLoaded.length > 0) {
            const foundationToolCalls = phaseCtx.foundationDocsLoaded.map(({ docType, contentLength }) => ({
              toolName: "foundation_doc",
              arguments: JSON.stringify({ docType }),
              status: "completed",
              resultSummary: `Loaded ${docType} (${Math.round(contentLength / 1024)}KB)`,
            }));
            await ctx.runMutation(internal.harness.internals.updatePhaseStatus, {
              runId,
              phaseIndex,
              status: "running",
              toolCalls: foundationToolCalls,
            });
          }

          const noopEmit = () => {};
          const result = await streamLlmCall(
            phaseCtx.llmUrl, phaseCtx.apiKey,
            { model: phaseCtx.model, messages: phaseCtx.messages, stream: true },
            noopEmit, false,
          );

          const output = parseStructuredOutput(result.content);
          await completePhaseAndContinue(ctx, run, phase, phaseIndex, output);
        }
      } else if (phase.type === "llm_batch_agents") {
        // Batch phase -- run inline since each item is a quick LLM call
        const output = await runBatchPhase(ctx, run, phase, phaseIndex);
        await completePhaseAndContinue(ctx, run, phase, phaseIndex, output);
      } else if (phase.type === "executor") {
        // Code-driven phase -- no LLM, just run the executor function directly
        // Schedule the executor action which handles its own batching/timeouts
        await ctx.scheduler.runAfter(0, internal.harness.worker.runExecutor, {
          runId,
          phaseIndex,
        });
      }
    } catch (e: any) {
      await ctx.runMutation(internal.harness.internals.failPhase, {
        runId,
        phaseIndex,
        error: e.message,
      });
      await ctx.runMutation(internal.harness.internals.failRun, {
        runId,
        error: `Phase ${phaseIndex} failed: ${e.message}`,
        currentPhase: phaseIndex,
      });
    }
  },
});

// ─── Tool-Calling Round ─────────────────────────────────────────

export const runToolRound = internalAction({
  args: {
    runId: v.id("harnessRuns"),
    phaseIndex: v.number(),
    round: v.number(),
  },
  handler: async (ctx, args) => {
    const { runId, phaseIndex, round } = args;

    // Check cancellation
    const run: any = await ctx.runQuery(internal.harness.internals.getRun, { runId });
    if (!run || run.cancelRequested || run.status === "cancelled") return;

    const definition = run.definition;
    const phase = definition.phases[phaseIndex];
    const maxRounds = phase.maxRounds ?? 10;

    if (round >= maxRounds) {
      // Max rounds reached -- complete with whatever we have
      const phaseRecord: any = await ctx.runQuery(internal.harness.internals.getPhase, { runId, phaseIndex });
      const output = parseStructuredOutput(phaseRecord?.streamingText ?? "");
      await completePhaseAndContinue(ctx, run, phase, phaseIndex, output);
      return;
    }

    // Load persisted state
    const phaseRecord: any = await ctx.runQuery(internal.harness.internals.getPhase, { runId, phaseIndex });
    if (!phaseRecord) return;

    const messages = phaseRecord.messages ?? [];
    const genesisBotResults = phaseRecord.genesisBotResults ?? {};

    // Get LLM config
    const settings: any = await ctx.runQuery(internal.chat.internals.getSettings, { orgId: run.orgId });
    const apiKey = settings?.llmApiKey || "";
    const baseUrl = settings?.llmBaseUrl || "https://api.openai.com/v1";
    const model = phase.model || settings?.llmModel || "gpt-4o";
    const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

    try {
      // Make LLM call
      const noopEmit = () => {};
      const body: any = { model, messages, tools: phase.tools, stream: true };
      const result = await streamLlmCall(url, apiKey, body, noopEmit, false);

      // Update streaming text
      if (result.content) {
        await ctx.runMutation(internal.harness.internals.updatePhaseStatus, {
          runId,
          phaseIndex,
          status: "running",
          streamingText: (phaseRecord.streamingText ?? "") + result.content,
        });
      }

      // If LLM returned tool calls, execute them
      if (result.finishReason === "tool_calls" && result.toolCalls.length > 0) {
        // Build assistant message
        const assistantMsg = {
          role: "assistant",
          content: result.content || null,
          tool_calls: result.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
        const updatedMessages = [...messages, assistantMsg];

        // Separate concurrent calls (Genesis + image gen) from sequential others
        const genesisCalls = result.toolCalls.filter((tc) => {
          try {
            const a = JSON.parse(tc.arguments || "{}");
            return tc.name === "call_genesis_bot" && a.bot_slug;
          } catch { return false; }
        });
        const imageGenCalls = result.toolCalls.filter((tc) => tc.name === "generate_image");
        const otherCalls = result.toolCalls.filter((tc) => !genesisCalls.includes(tc) && !imageGenCalls.includes(tc));

        // Build hctx for tool execution
        const hctx: HarnessContext = {
          ctx,
          threadId: run.threadId,
          orgId: run.orgId,
          userId: run.userId,
          apiKey,
          baseUrl,
          model,
          emit: noopEmit,
          genesisBotResults,
        };

        const toolCallLog = [...(phaseRecord.toolCalls ?? [])];
        const toolMessages: any[] = [];

        // Run Genesis calls concurrently
        if (genesisCalls.length > 0) {
          for (const tc of genesisCalls) {
            toolCallLog.push({ toolName: tc.name, arguments: tc.arguments, status: "running" });
          }
          await ctx.runMutation(internal.harness.internals.updatePhaseStatus, {
            runId, phaseIndex, status: "running", toolCalls: toolCallLog,
          });

          const genesisResults = await Promise.all(
            genesisCalls.map(async (tc) => {
              const parsedArgs = JSON.parse(tc.arguments || "{}");
              return executeHarnessTool(hctx, tc.name, parsedArgs);
            }),
          );

          for (let i = 0; i < genesisCalls.length; i++) {
            const tc = genesisCalls[i];
            const toolResult = genesisResults[i];
            toolMessages.push({ role: "tool", tool_call_id: tc.id, content: toolResult.length > 2000 ? toolResult.slice(0, 2000) + "\n[truncated]" : toolResult });

            // Update tool call status
            const idx = toolCallLog.findIndex((t: any) => t.arguments === tc.arguments && t.status === "running");
            if (idx >= 0) {
              toolCallLog[idx] = {
                ...toolCallLog[idx],
                status: "completed",
                resultSummary: toolResult.length > 200 ? toolResult.slice(0, 200) + "..." : toolResult,
              };
            }

            // Append bot result to progress file so user can see output in real-time
            if (toolResult && !toolResult.startsWith("Error:")) {
              try {
                const parsedArgs = JSON.parse(tc.arguments || "{}");
                const botSlug = parsedArgs.bot_slug || "unknown";
                const botLabel = botSlug.replace(/-+$/g, "").replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
                const separator = `\n\n---\n\n## ${botLabel}\n\n`;
                await ctx.runMutation(internal.workspace.internals.appendFile, {
                  threadId: run.threadId,
                  orgId: run.orgId,
                  filePath: "progress.md",
                  content: separator + toolResult,
                });
              } catch {
                // Non-critical
              }
            }
          }

          // Short-circuit: If ALL tool calls were Genesis AND this phase saves foundation docs,
          // complete immediately (bot output IS the final output for foundation builder phases).
          // Otherwise, feed results back to the LLM so it can make follow-up calls.
          const hasFoundationOutputs = phase.foundationOutputs?.length > 0;
          if (otherCalls.length === 0 && genesisCalls.length > 0 && hasFoundationOutputs) {
            // Save foundation docs directly from Genesis results
            const offerSlug = run.offerSlug || "default";
            if (run.orgId && hctx.genesisBotResults) {
              for (const [slug, result] of Object.entries(hctx.genesisBotResults)) {
                const docType = BOT_SLUG_TO_DOC_TYPE[slug];
                if (!docType || !result || (result as string).startsWith("Error:")) continue;
                await ctx.runMutation(internal.foundationDocs.internals.upsert, {
                  orgId: run.orgId,
                  offerSlug,
                  docType,
                  content: result as string,
                  sourceBot: slug,
                });
              }
            }

            const output = hctx.genesisBotResults ?? {};
            await ctx.runMutation(internal.harness.internals.updatePhaseStatus, {
              runId, phaseIndex, status: "running",
              toolCalls: toolCallLog,
              genesisBotResults: hctx.genesisBotResults,
            });
            await completePhaseAndContinue(ctx, run, phase, phaseIndex, output);
            return;
          }
        }

        // Run image generation calls concurrently (each takes 30-60s via Kie.ai)
        // Process in batches of 5 to stay under the Convex action timeout
        if (imageGenCalls.length > 0) {
          const BATCH_SIZE = 5;
          for (let batchStart = 0; batchStart < imageGenCalls.length; batchStart += BATCH_SIZE) {
            const batch = imageGenCalls.slice(batchStart, batchStart + BATCH_SIZE);

            for (const tc of batch) {
              toolCallLog.push({ toolName: tc.name, arguments: tc.arguments, status: "running" });
            }
            await ctx.runMutation(internal.harness.internals.updatePhaseStatus, {
              runId, phaseIndex, status: "running", toolCalls: toolCallLog,
            });

            const batchResults = await Promise.all(
              batch.map(async (tc) => {
                try {
                  const parsedArgs = JSON.parse(tc.arguments || "{}");
                  return await executeHarnessTool(hctx, tc.name, parsedArgs);
                } catch (e: any) {
                  return `Error: ${e.message}`;
                }
              }),
            );

            for (let i = 0; i < batch.length; i++) {
              const tc = batch[i];
              const toolResult = batchResults[i];
              toolMessages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });

              const idx = toolCallLog.findIndex((t: any) => t.arguments === tc.arguments && t.status === "running");
              if (idx >= 0) {
                toolCallLog[idx] = {
                  ...toolCallLog[idx],
                  status: "completed",
                  resultSummary: toolResult.length > 200 ? toolResult.slice(0, 200) + "..." : toolResult,
                };
              }
            }

            // Persist progress after each batch so state isn't lost on timeout
            await ctx.runMutation(internal.harness.internals.updatePhaseStatus, {
              runId, phaseIndex, status: "running", toolCalls: toolCallLog,
            });
          }

          // If ALL calls were image gen (no other calls), persist and schedule next round
          if (otherCalls.length === 0 && genesisCalls.length === 0) {
            const finalMessages = [...updatedMessages, ...toolMessages];
            await ctx.runMutation(internal.harness.internals.updatePhaseStatus, {
              runId, phaseIndex, status: "running",
              messages: finalMessages,
              currentRound: round + 1,
              toolCalls: toolCallLog,
            });
            await ctx.scheduler.runAfter(0, internal.harness.worker.runToolRound, {
              runId, phaseIndex, round: round + 1,
            });
            return;
          }
        }

        // Run other tool calls sequentially
        for (const tc of otherCalls) {
          const parsedArgs = JSON.parse(tc.arguments || "{}");
          toolCallLog.push({ toolName: tc.name, arguments: tc.arguments, status: "running" });

          const toolResult = await executeHarnessTool(hctx, tc.name, parsedArgs);
          toolMessages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });

          const idx = toolCallLog.length - 1;
          toolCallLog[idx] = {
            ...toolCallLog[idx],
            status: "completed",
            resultSummary: toolResult.length > 200 ? toolResult.slice(0, 200) + "..." : toolResult,
          };
        }

        // Persist updated state and schedule next round
        const finalMessages = [...updatedMessages, ...toolMessages];
        await ctx.runMutation(internal.harness.internals.updatePhaseStatus, {
          runId,
          phaseIndex,
          status: "running",
          messages: finalMessages,
          currentRound: round + 1,
          toolCalls: toolCallLog,
          genesisBotResults: hctx.genesisBotResults,
        });

        await ctx.scheduler.runAfter(0, internal.harness.worker.runToolRound, {
          runId,
          phaseIndex,
          round: round + 1,
        });
      } else {
        // LLM finished without tool calls -- phase complete
        const output = parseStructuredOutput(result.content);
        await completePhaseAndContinue(ctx, run, phase, phaseIndex, output);
      }
    } catch (e: any) {
      await ctx.runMutation(internal.harness.internals.failPhase, {
        runId,
        phaseIndex,
        error: e.message,
      });
      await ctx.runMutation(internal.harness.internals.failRun, {
        runId,
        error: `Phase ${phaseIndex}, round ${round} failed: ${e.message}`,
        currentPhase: phaseIndex,
      });
    }
  },
});

// ─── Executor: Code-Driven Phase (No LLM) ───────────────────────

/**
 * Execute a code-driven phase. Currently supports:
 * - "Image Generation": reads image_concepts from prior phase, generates images via Kie.ai
 *
 * Runs in batches to stay under Convex action timeout.
 * Self-chains if there are more items to process.
 */
export const runExecutor = internalAction({
  args: {
    runId: v.id("harnessRuns"),
    phaseIndex: v.number(),
    batchOffset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { runId, phaseIndex } = args;
    const batchOffset = args.batchOffset ?? 0;
    const BATCH_SIZE = 5;

    const run: any = await ctx.runQuery(internal.harness.internals.getRun, { runId });
    if (!run || run.cancelRequested || run.status === "cancelled") return;

    const definition = run.definition;
    const phase = definition.phases[phaseIndex];

    // Get prior phase outputs
    const allPhases: any[] = await ctx.runQuery(internal.harness.internals.getPhases, { runId });
    const priorPhase = allPhases.find((p: any) => p.phaseIndex === phaseIndex - 1);
    const priorOutput = priorPhase?.output;

    if (!priorOutput) {
      await ctx.runMutation(internal.harness.internals.failPhase, {
        runId, phaseIndex, error: "No output from prior phase",
      });
      return;
    }

    // Get existing tool calls (from prior batches)
    const currentPhase: any = await ctx.runQuery(internal.harness.internals.getPhase, { runId, phaseIndex });
    const toolCallLog = [...(currentPhase?.toolCalls ?? [])];

    // ── Image Generation Executor ──
    // Extract image prompts from prior phase output
    const concepts = priorOutput.image_concepts ?? [];
    if (concepts.length === 0) {
      await completePhaseAndContinue(ctx, run, phase, phaseIndex, {
        generated_images: [],
        summary: { total_generated: 0, total_failed: 0 },
      });
      return;
    }

    // Get the batch to process
    const batch = concepts.slice(batchOffset, batchOffset + BATCH_SIZE);
    if (batch.length === 0) {
      // All batches done — complete the phase
      const generatedImages = toolCallLog
        .filter((t: any) => t.toolName === "generate_image" && t.status === "completed")
        .map((t: any) => {
          try { return JSON.parse(t.resultSummary || "{}"); } catch { return null; }
        })
        .filter(Boolean);

      await completePhaseAndContinue(ctx, run, phase, phaseIndex, {
        generated_images: generatedImages,
        summary: {
          total_generated: generatedImages.length,
          total_failed: toolCallLog.filter((t: any) => t.status === "error").length,
        },
      });
      return;
    }

    // Log batch as running
    for (let i = 0; i < batch.length; i++) {
      const concept = batch[i];
      toolCallLog.push({
        toolName: "generate_image",
        arguments: JSON.stringify({
          brief_id: concept.brief_id || `image-${batchOffset + i}`,
          concept_index: concept.concept_index ?? batchOffset + i + 1,
        }),
        status: "running",
      });
    }
    await ctx.runMutation(internal.harness.internals.updatePhaseStatus, {
      runId, phaseIndex, status: "running", toolCalls: toolCallLog,
    });

    // Generate images concurrently
    const results = await Promise.all(
      batch.map(async (concept: any, i: number) => {
        const prompt = concept.image_prompt || concept.visual_description || "";
        if (!prompt) return { error: "No image prompt", briefId: concept.brief_id };

        const briefId = concept.brief_id || `image`;
        const conceptIdx = concept.concept_index ?? batchOffset + i + 1;
        const uniqueId = `${briefId}-${conceptIdx}`;

        try {
          const result = await ctx.runAction(internal.harness.imageGenAction.generateImage, {
            prompt,
            aspectRatio: concept.aspect_ratio || "1:1",
            resolution: "1K",
            orgId: run.orgId,
          });

          // Save as workspace file
          const filePath = `images/${uniqueId}.png`;
          await ctx.runMutation(internal.workspace.internals.writeImageFile, {
            threadId: run.threadId,
            orgId: run.orgId,
            filePath,
            storageId: result.storageId as any,
            contentType: "image/png",
            source: "harness",
          });

          return {
            brief_id: uniqueId,
            storageId: result.storageId,
            filePath,
            costTime: result.costTime,
          };
        } catch (e: any) {
          return { error: e.message, briefId: uniqueId };
        }
      }),
    );

    // Update tool call statuses
    for (let i = 0; i < batch.length; i++) {
      const result = results[i];
      const idx = toolCallLog.length - batch.length + i;
      if (result.error) {
        toolCallLog[idx] = { ...toolCallLog[idx], status: "error", resultSummary: result.error };
      } else {
        toolCallLog[idx] = {
          ...toolCallLog[idx],
          status: "completed",
          resultSummary: JSON.stringify({ storageId: result.storageId, filePath: result.filePath }),
        };
      }
    }

    await ctx.runMutation(internal.harness.internals.updatePhaseStatus, {
      runId, phaseIndex, status: "running", toolCalls: toolCallLog,
    });

    // Schedule next batch
    const nextOffset = batchOffset + BATCH_SIZE;
    if (nextOffset < concepts.length) {
      await ctx.scheduler.runAfter(0, internal.harness.worker.runExecutor, {
        runId, phaseIndex, batchOffset: nextOffset,
      });
    } else {
      // All done — complete phase
      const generatedImages = results.filter((r: any) => !r.error);
      const failedCount = results.filter((r: any) => r.error).length;
      // Include results from prior batches too
      const priorResults = toolCallLog
        .slice(0, -batch.length)
        .filter((t: any) => t.toolName === "generate_image" && t.status === "completed")
        .map((t: any) => {
          try { return JSON.parse(t.resultSummary || "{}"); } catch { return null; }
        })
        .filter(Boolean);

      await completePhaseAndContinue(ctx, run, phase, phaseIndex, {
        generated_images: [...priorResults, ...generatedImages],
        summary: {
          total_generated: priorResults.length + generatedImages.length,
          total_failed: failedCount,
        },
      });
    }
  },
});

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Build the initial messages array for a phase.
 * Reads prior phase outputs from DB, loads workspace/foundation context.
 */
interface PhaseContext {
  messages: any[];
  llmUrl: string;
  apiKey: string;
  model: string;
  foundationDocsLoaded: Array<{ docType: string; contentLength: number }>;
}

/**
 * Generate a rich summary of a completed harness run using the LLM.
 * Summarizes what was produced, what bots were used, and key outputs.
 */
async function generateRunSummary(
  ctx: any,
  run: any,
  definition: any,
  allPhases: any[],
): Promise<string> {
  const sorted = allPhases.sort((a: any, b: any) => a.phaseIndex - b.phaseIndex);
  const lines: string[] = [`## ${definition.name} — Complete\n`];

  // Summarize each phase
  for (const p of sorted) {
    const toolCalls = (p as any).toolCalls ?? [];
    const genesisCalls = toolCalls.filter((t: any) => t.toolName === "call_genesis_bot");
    const imageGens = toolCalls.filter((t: any) => t.toolName === "generate_image");
    const foundationDocs = toolCalls.filter((t: any) => t.toolName === "foundation_doc");
    const output = (p as any).output;

    lines.push(`### ${(p as any).phaseName}\n`);

    if (foundationDocs.length > 0) {
      lines.push(`- **Foundation docs loaded:** ${foundationDocs.length}`);
    }
    if (genesisCalls.length > 0) {
      const botSlugs = new Set<string>();
      for (const tc of genesisCalls) {
        try { botSlugs.add(JSON.parse(tc.arguments).bot_slug); } catch { /* */ }
      }
      lines.push(`- **Genesis bots called:** ${genesisCalls.length} (${[...botSlugs].join(", ")})`);
    }
    if (imageGens.length > 0) {
      const completed = imageGens.filter((t: any) => t.status === "completed").length;
      lines.push(`- **Images generated:** ${completed}/${imageGens.length}`);
    }

    // Output-specific details
    if (output && typeof output === "object") {
      if (Array.isArray(output.ads)) {
        lines.push(`- **Ads produced:** ${output.ads.length}`);
        for (const ad of output.ads) {
          const pt = Array.isArray(ad.primaryTexts) ? ad.primaryTexts.length : 0;
          const hl = Array.isArray(ad.headlines) ? ad.headlines.length : 0;
          const briefLabel = ad.brief_id || ad.segment || "unknown";
          lines.push(`  - ${briefLabel}: ${pt} primary texts, ${hl} headlines`);
        }
      }
      if (Array.isArray(output.image_concepts)) {
        const byBrief: Record<string, number> = {};
        const botsUsed = new Set<string>();
        for (const c of output.image_concepts) {
          const bid = c.brief_id || "unknown";
          byBrief[bid] = (byBrief[bid] || 0) + 1;
          if (c.format_bot_used) botsUsed.add(c.format_bot_used);
          if (c.image_bot_used) botsUsed.add(c.image_bot_used);
        }
        lines.push(`- **Image concepts:** ${output.image_concepts.length}`);
        for (const [bid, count] of Object.entries(byBrief)) {
          lines.push(`  - ${bid}: ${count} concepts`);
        }
        if (botsUsed.size > 0) lines.push(`  - Formats: ${[...botsUsed].join(", ")}`);
      }
      if (Array.isArray(output.generated_images)) {
        const byBrief: Record<string, number> = {};
        for (const img of output.generated_images) {
          const bid = (img.brief_id || "unknown").replace(/-\d+$/, "");
          byBrief[bid] = (byBrief[bid] || 0) + 1;
        }
        lines.push(`- **Images generated:** ${output.generated_images.length}`);
        for (const [bid, count] of Object.entries(byBrief)) {
          lines.push(`  - ${bid}: ${count} images`);
        }
      }
    }
    lines.push("");
  }

  // List workspace files
  try {
    const files = await ctx.runQuery(internal.workspace.internals.listFiles, { threadId: run.threadId });
    const harnessFiles = files.filter((f: any) => f.source === "harness");
    const imageFiles = harnessFiles.filter((f: any) => f.contentType?.startsWith("image/"));
    const mdFiles = harnessFiles.filter((f: any) => f.filePath.endsWith(".md") && !f.filePath.startsWith("progress"));
    const jsonFiles = harnessFiles.filter((f: any) => f.filePath.endsWith(".json"));

    lines.push(`### Workspace Files\n`);
    lines.push(`- **${imageFiles.length}** images`);
    lines.push(`- **${mdFiles.length}** markdown documents`);
    lines.push(`- **${jsonFiles.length}** data files`);
    if (mdFiles.length > 0) {
      lines.push(`\n**Key files to review:**`);
      for (const f of mdFiles.slice(0, 10)) {
        lines.push(`- ${f.filePath}`);
      }
    }
  } catch { /* non-critical */ }

  lines.push(`\n---\n*Click any file in the workspace panel to view. Use ← → arrows to navigate between files.*`);

  return lines.join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function buildPhaseContext(
  ctx: any,
  run: any,
  phase: any,
  phaseIndex: number,
): Promise<PhaseContext> {
  // Get LLM settings
  const settings: any = await ctx.runQuery(internal.chat.internals.getSettings, { orgId: run.orgId });
  const apiKey = settings?.llmApiKey || "";
  const baseUrl = settings?.llmBaseUrl || "https://api.openai.com/v1";
  const model = phase.model || settings?.llmModel || "gpt-4o";
  const llmUrl = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  // Build prior results from completed phases
  const allPhases: any[] = await ctx.runQuery(internal.harness.internals.getPhases, { runId: run._id });
  const priorResults: Record<string, any> = {};
  for (const p of allPhases) {
    if (p.status === "completed" && p.output) {
      priorResults[String(p.phaseIndex)] = p.output;
    }
  }

  // Build system prompt
  const systemPrompt = substituteTemplate(phase.systemPromptTemplate, priorResults, phaseIndex);

  // Load user input (always included if present)
  const userInput = await ctx.runQuery(internal.workspace.internals.readFile, {
    threadId: run.threadId,
    filePath: "input.txt",
  });

  // Load workspace and foundation context
  let workspaceContext = "";
  const foundationDocsLoaded: Array<{ docType: string; contentLength: number }> = [];

  if (phase.workspaceInputs?.length) {
    for (const filePath of phase.workspaceInputs) {
      const content = await ctx.runQuery(internal.workspace.internals.readFile, {
        threadId: run.threadId,
        filePath,
      });
      if (content) workspaceContext += `\n\n### ${filePath}\n${content}`;
    }
  }
  if (phase.foundationInputs?.length && run.orgId) {
    const fSlug = run.offerSlug || "default";
    for (const docType of phase.foundationInputs) {
      // Try exact offerSlug match first
      let doc = await ctx.runQuery(internal.foundationDocs.internals.getByOrgOfferDoc, {
        orgId: run.orgId,
        offerSlug: fSlug,
        docType,
      });
      // Fallback: if no match and slug was "default", search all org docs for this type
      if (!doc && fSlug === "default") {
        const allOrgDocs: any[] = await ctx.runQuery(internal.foundationDocs.internals.listByOrg, {
          orgId: run.orgId,
        });
        doc = allOrgDocs.find((d: any) => d.docType === docType) ?? null;
      }
      if (doc) {
        workspaceContext += `\n\n### Foundation: ${docType}\n${doc.content}`;
        foundationDocsLoaded.push({ docType, contentLength: doc.content.length });
      }
    }
  }

  // Build user message with input instructions + workspace context
  let userMessage = "";
  if (userInput) {
    userMessage += `## User Instructions\n\nThe user provided the following direction for this workflow. Follow these instructions carefully and incorporate them into your approach:\n\n> ${userInput}\n\n`;
  }
  if (workspaceContext) {
    userMessage += `## Context from Prior Work\n${workspaceContext}`;
  }
  if (!userMessage) {
    userMessage = "Execute this phase based on the context provided in the system prompt.";
  }

  return {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    llmUrl,
    apiKey,
    model,
    foundationDocsLoaded,
  };
}

/**
 * Complete a phase: save output, workspace files, foundation docs, schedule next phase.
 */
async function completePhaseAndContinue(
  ctx: any,
  run: any,
  phase: any,
  phaseIndex: number,
  output: any,
): Promise<void> {
  // Save phase output
  await ctx.runMutation(internal.harness.internals.completePhase, {
    runId: run._id,
    phaseIndex,
    output,
  });

  // Write to workspace if configured
  if (phase.workspaceOutput && output) {
    const outputStr = typeof output === "string" ? output : JSON.stringify(output, null, 2);
    await ctx.runMutation(internal.workspace.internals.writeFile, {
      threadId: run.threadId,
      orgId: run.orgId,
      filePath: phase.workspaceOutput,
      content: outputStr,
      contentType: "application/json",
      source: "harness",
    });

    // Also save a rendered markdown version for easy reading
    if (phase.workspaceOutput.endsWith(".json")) {
      const mdPath = phase.workspaceOutput.replace(/\.json$/, ".md");
      let mdContent: string | null = null;

      if (output && typeof output === "object") {
        mdContent = renderOutputAsMarkdown(phase.name, output);
      }
      // Fallback: if output is a string (e.g., raw bot response), render it directly
      if (!mdContent && typeof output === "string" && output.length > 50) {
        mdContent = `# ${phase.name}\n\n${output}`;
      }
      // Last resort: pretty-print the JSON with a header
      if (!mdContent && output) {
        const jsonStr = typeof output === "string" ? output : JSON.stringify(output, null, 2);
        mdContent = `# ${phase.name}\n\n\`\`\`json\n${jsonStr}\n\`\`\``;
      }

      if (mdContent) {
        await ctx.runMutation(internal.workspace.internals.writeFile, {
          threadId: run.threadId,
          orgId: run.orgId,
          filePath: mdPath,
          content: mdContent,
          contentType: "text/markdown",
          source: "harness",
        });
      }

      // Save per-brief files when output contains brief-keyed items
      if (output && typeof output === "object") {
        await savePerBriefFiles(ctx, run, phase.name, output);
      }
    }
  }

  // Save foundation docs if configured
  const offerSlug = run.offerSlug || "default";
  const savedFoundationDocs: Array<{ docType: string; content: string }> = [];

  if (phase.foundationOutputs?.length && run.orgId) {
    // From structured output
    if (output && typeof output === "object") {
      for (const { key, docType } of phase.foundationOutputs) {
        const value = output[key];
        if (value) {
          const content = typeof value === "string" ? value : JSON.stringify(value, null, 2);
          await ctx.runMutation(internal.foundationDocs.internals.upsert, {
            orgId: run.orgId,
            offerSlug,
            docType,
            content,
            sourceBot: output[`${key}_source_bot`] ?? undefined,
          });
          savedFoundationDocs.push({ docType, content });
        }
      }
    }

    // Fallback: save from Genesis bot results cached on phase
    const phaseRecord: any = await ctx.runQuery(internal.harness.internals.getPhase, {
      runId: run._id,
      phaseIndex,
    });
    if (phaseRecord?.genesisBotResults) {
      for (const [slug, result] of Object.entries(phaseRecord.genesisBotResults)) {
        const docType = BOT_SLUG_TO_DOC_TYPE[slug];
        if (!docType || !result || (result as string).startsWith("Error:")) continue;
        const alreadySaved = output && typeof output === "object" &&
          phase.foundationOutputs?.some((fo: any) => fo.docType === docType && output[fo.key]);
        if (!alreadySaved) {
          await ctx.runMutation(internal.foundationDocs.internals.upsert, {
            orgId: run.orgId,
            offerSlug,
            docType,
            content: result as string,
            sourceBot: slug,
          });
          savedFoundationDocs.push({ docType, content: result as string });
        }
      }
    }
  }

  // Save each foundation doc as an individual .md workspace file for easy viewing
  for (const { docType, content } of savedFoundationDocs) {
    await ctx.runMutation(internal.workspace.internals.writeFile, {
      threadId: run.threadId,
      orgId: run.orgId,
      filePath: `docs/${docType}.md`,
      content,
      contentType: "text/markdown",
      source: "harness",
    });
  }

  // Schedule next phase
  await ctx.scheduler.runAfter(0, internal.harness.worker.runPhase, {
    runId: run._id,
    phaseIndex: phaseIndex + 1,
  });
}

/**
 * Save per-brief files when output contains items keyed by brief_id.
 * Creates briefs/{brief_id}/copy.md, briefs/{brief_id}/images.md, etc.
 */
async function savePerBriefFiles(
  ctx: any,
  run: any,
  phaseName: string,
  output: any,
): Promise<void> {
  // Determine which array to split and what type of content it is
  const briefItems: Array<{ briefId: string; item: any; type: string }> = [];

  if (Array.isArray(output.ads)) {
    for (const ad of output.ads) {
      const briefId = ad.brief_id || ad.briefId || `ad-${briefItems.length + 1}`;
      briefItems.push({ briefId, item: ad, type: "copy" });
    }
  }
  if (Array.isArray(output.image_concepts)) {
    for (const img of output.image_concepts) {
      const briefId = img.brief_id || img.briefId || `img-${briefItems.length + 1}`;
      briefItems.push({ briefId, item: img, type: "images" });
    }
  }
  if (Array.isArray(output.briefs)) {
    for (const brief of output.briefs) {
      const briefId = brief.id || brief.brief_id || `brief-${briefItems.length + 1}`;
      briefItems.push({ briefId, item: brief, type: "brief" });
    }
  }

  if (briefItems.length === 0) return;

  // Group by briefId
  const byBrief = new Map<string, Array<{ item: any; type: string }>>();
  for (const { briefId, item, type } of briefItems) {
    const slug = briefId.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    if (!byBrief.has(slug)) byBrief.set(slug, []);
    byBrief.get(slug)!.push({ item, type });
  }

  for (const [slug, items] of byBrief) {
    for (const { item, type } of items) {
      const filePath = `briefs/${slug}/${type}.md`;
      const md = renderBriefItemAsMarkdown(item, type);
      if (md) {
        await ctx.runMutation(internal.workspace.internals.writeFile, {
          threadId: run.threadId,
          orgId: run.orgId,
          filePath,
          content: md,
          contentType: "text/markdown",
          source: "harness",
        });
      }
    }
  }
}

/**
 * Render a single brief item (ad copy, image concept, or brief) as markdown.
 */
function renderBriefItemAsMarkdown(item: any, type: string): string | null {
  const lines: string[] = [];

  if (type === "copy") {
    const seg = item.segment || "";
    const awareness = item.awareness_level || "";
    lines.push(`# Ad Copy — ${seg}${awareness ? ` (${awareness})` : ""}\n`);
    if (item.concept) lines.push(`**Concept:** ${item.concept}`);
    if (item.angle) lines.push(`**Angle:** ${item.angle}`);
    if (item.genesis_bot_used) lines.push(`**Bot:** ${item.genesis_bot_used}`);
    lines.push("");

    if (Array.isArray(item.primaryTexts)) {
      lines.push(`## Primary Texts (${item.primaryTexts.length} variations)\n`);
      item.primaryTexts.forEach((text: string, i: number) => {
        lines.push(`### Variation ${i + 1}\n`);
        lines.push(text);
        lines.push("\n---\n");
      });
    }

    if (Array.isArray(item.headlines)) {
      lines.push(`## Headlines\n`);
      item.headlines.forEach((h: string, i: number) => {
        const len = h.length;
        const flag = len > 40 ? " ⚠️ OVER 40" : "";
        lines.push(`${i + 1}. **${h}** _(${len} chars${flag})_`);
      });
      lines.push("");
    }

    if (item.description) {
      lines.push(`## Description\n`);
      lines.push(`> ${item.description}\n`);
    }

    // Legacy format
    if (Array.isArray(item.copy?.hooks)) {
      lines.push(`## Hooks\n`);
      item.copy.hooks.forEach((h: string, i: number) => lines.push(`${i + 1}. ${h}`));
      lines.push("");
    }
    if (item.copy?.body) lines.push(`## Body\n\n${item.copy.body}\n`);
    if (item.copy?.full_text) lines.push(`## Full Text\n\n${item.copy.full_text}\n`);

  } else if (type === "images") {
    lines.push(`# Image Concept\n`);
    if (item.ad_hook) lines.push(`**Hook:** ${item.ad_hook}`);
    if (item.format_recommendation) lines.push(`**Format:** ${item.format_recommendation}`);
    if (item.image_bot_used) lines.push(`**Bot:** ${item.image_bot_used}`);
    lines.push("");

    if (item.concept) {
      if (item.concept.description) lines.push(`## Concept\n\n${item.concept.description}\n`);
      if (item.concept.text_overlay) lines.push(`**Text overlay:** ${item.concept.text_overlay}`);
      if (item.concept.style_notes) lines.push(`**Style:** ${item.concept.style_notes}`);
      if (item.concept.aspect_ratio) lines.push(`**Aspect ratio:** ${item.concept.aspect_ratio}`);
      lines.push("");
    }

    if (item.image_prompt) {
      lines.push(`## Image Prompt\n`);
      lines.push("```");
      lines.push(item.image_prompt);
      lines.push("```\n");
    }

  } else if (type === "brief") {
    const seg = item.gap?.segment || item.segment || "";
    lines.push(`# Creative Brief — ${seg}\n`);
    if (item.awareness_level) lines.push(`**Awareness:** ${item.awareness_level}`);
    if (item.concept_category) lines.push(`**Concept:** ${item.concept_category} — ${item.specific_concept || ""}`);
    if (item.angle) lines.push(`**Angle:** ${item.angle}`);
    if (item.style) lines.push(`**Style:** ${item.style}`);
    lines.push("");
    if (item.hook_direction) lines.push(`## Hook Direction\n\n${item.hook_direction}\n`);
    if (item.body_structure) lines.push(`## Body Structure\n\n${item.body_structure}\n`);
    if (item.visual_direction) lines.push(`## Visual Direction\n\n${item.visual_direction}\n`);
    if (item.cta_approach) lines.push(`## CTA\n\n${item.cta_approach}\n`);
    if (item.target_segment) {
      lines.push(`## Target Segment\n`);
      if (item.target_segment.name) lines.push(`**Name:** ${item.target_segment.name}`);
      if (item.target_segment.demographics) lines.push(`**Demographics:** ${item.target_segment.demographics}`);
      if (Array.isArray(item.target_segment.pains)) {
        lines.push(`**Pains:**`);
        item.target_segment.pains.forEach((p: string) => lines.push(`- ${p}`));
      }
      if (Array.isArray(item.target_segment.desires)) {
        lines.push(`**Desires:**`);
        item.target_segment.desires.forEach((d: string) => lines.push(`- ${d}`));
      }
      lines.push("");
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

/**
 * Render a phase's JSON output as readable markdown.
 * Handles known output shapes (ads, briefs, image concepts, etc.)
 * and falls back to a generic key-value rendering.
 */
function renderOutputAsMarkdown(phaseName: string, output: any): string | null {
  if (!output || typeof output !== "object") return null;

  const lines: string[] = [`# ${phaseName}\n`];

  // ── Ad Copy output (ad-copy.json) ──
  if (Array.isArray(output.ads)) {
    for (const ad of output.ads) {
      lines.push(`## ${ad.brief_id || "Ad"} — ${ad.segment || ""} (${ad.awareness_level || ""})\n`);
      if (ad.concept) lines.push(`**Concept:** ${ad.concept} | **Angle:** ${ad.angle || ""}\n`);
      if (ad.genesis_bot_used) lines.push(`**Bot:** ${ad.genesis_bot_used}\n`);

      // Primary texts
      if (Array.isArray(ad.primaryTexts)) {
        lines.push(`### Primary Texts (${ad.primaryTexts.length} variations)\n`);
        ad.primaryTexts.forEach((text: string, i: number) => {
          lines.push(`#### Variation ${i + 1}\n`);
          lines.push(text + "\n");
          lines.push("---\n");
        });
      }

      // Headlines
      if (Array.isArray(ad.headlines)) {
        lines.push(`### Headlines\n`);
        ad.headlines.forEach((h: string, i: number) => {
          const charCount = h.length;
          const flag = charCount > 40 ? " ⚠️ OVER 40 CHARS" : "";
          lines.push(`${i + 1}. ${h} _(${charCount} chars${flag})_`);
        });
        lines.push("");
      }

      // Description
      if (ad.description) {
        lines.push(`### Description\n`);
        lines.push(`> ${ad.description}\n`);
      }

      // Legacy format (hooks/body/full_text)
      if (Array.isArray(ad.copy?.hooks)) {
        lines.push(`### Hooks\n`);
        ad.copy.hooks.forEach((h: string, i: number) => lines.push(`${i + 1}. ${h}`));
        lines.push("");
      }
      if (ad.copy?.body) {
        lines.push(`### Body Copy\n`);
        lines.push(ad.copy.body + "\n");
      }
      if (ad.copy?.full_text) {
        lines.push(`### Full Ad Text\n`);
        lines.push(ad.copy.full_text + "\n");
      }

      lines.push("\n---\n");
    }

    if (output.summary) {
      lines.push(`## Summary\n`);
      if (output.summary.total_ads_produced) lines.push(`- **Ads produced:** ${output.summary.total_ads_produced}`);
      if (Array.isArray(output.summary.segments_covered)) lines.push(`- **Segments:** ${output.summary.segments_covered.join(", ")}`);
      if (output.summary.next_steps) lines.push(`- **Next steps:** ${output.summary.next_steps}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  // ── Image Concepts output (image-concepts.json) ──
  if (Array.isArray(output.image_concepts)) {
    for (const img of output.image_concepts) {
      lines.push(`## ${img.brief_id || "Image"}\n`);
      if (img.ad_hook) lines.push(`**Hook:** ${img.ad_hook}\n`);
      if (img.format_recommendation) lines.push(`**Format:** ${img.format_recommendation}`);
      if (img.image_bot_used) lines.push(`**Bot:** ${img.image_bot_used}\n`);

      if (img.concept) {
        if (img.concept.description) lines.push(`### Concept\n${img.concept.description}\n`);
        if (img.concept.text_overlay) lines.push(`**Text overlay:** ${img.concept.text_overlay}`);
        if (img.concept.style_notes) lines.push(`**Style:** ${img.concept.style_notes}`);
        if (img.concept.aspect_ratio) lines.push(`**Aspect ratio:** ${img.concept.aspect_ratio}`);
        lines.push("");
      }

      if (img.image_prompt) {
        lines.push(`### Image Generation Prompt\n`);
        lines.push("```");
        lines.push(img.image_prompt);
        lines.push("```\n");
      }

      lines.push("---\n");
    }

    if (output.summary) {
      lines.push(`## Summary\n`);
      if (output.summary.total_concepts) lines.push(`- **Concepts:** ${output.summary.total_concepts}`);
      if (Array.isArray(output.summary.formats_used)) lines.push(`- **Formats:** ${output.summary.formats_used.join(", ")}`);
      if (output.summary.next_steps) lines.push(`- **Next steps:** ${output.summary.next_steps}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  // ── Creative Briefs output (creative-briefs.json) ──
  if (Array.isArray(output.briefs)) {
    for (const brief of output.briefs) {
      lines.push(`## ${brief.id || "Brief"} — ${brief.gap?.segment || brief.segment || ""}\n`);
      if (brief.awareness_level) lines.push(`**Awareness:** ${brief.awareness_level}`);
      if (brief.concept_category) lines.push(`**Concept:** ${brief.concept_category} — ${brief.specific_concept || ""}`);
      if (brief.angle) lines.push(`**Angle:** ${brief.angle}`);
      if (brief.style) lines.push(`**Style:** ${brief.style}\n`);
      if (brief.hook_direction) lines.push(`### Hook Direction\n${brief.hook_direction}\n`);
      if (brief.body_structure) lines.push(`### Body Structure\n${brief.body_structure}\n`);
      if (brief.visual_direction) lines.push(`### Visual Direction\n${brief.visual_direction}\n`);
      if (brief.cta_approach) lines.push(`### CTA\n${brief.cta_approach}\n`);
      lines.push("---\n");
    }
    return lines.join("\n");
  }

  // ── Coverage Analysis output (coverage-analysis.json) ──
  if (Array.isArray(output.gaps)) {
    if (Array.isArray(output.segments)) {
      lines.push(`## Segments\n`);
      for (const seg of output.segments) {
        lines.push(`### ${seg.letter || ""}: ${seg.name || ""}`);
        if (seg.demographics) lines.push(`- **Demographics:** ${seg.demographics}`);
        if (seg.core_pain) lines.push(`- **Core pain:** ${seg.core_pain}`);
        if (seg.core_desire) lines.push(`- **Core desire:** ${seg.core_desire}`);
        if (seg.estimated_size) lines.push(`- **Size:** ${seg.estimated_size}`);
        lines.push("");
      }
    }

    if (output.grid) {
      lines.push(`## Grid Coverage\n`);
      lines.push(`- **Total cells:** ${output.grid.total_cells}`);
      lines.push(`- **Covered:** ${output.grid.covered_cells}`);
      lines.push(`- **Coverage:** ${output.grid.coverage_percentage}%\n`);
    }

    lines.push(`## Priority Gaps\n`);
    for (const gap of output.gaps) {
      lines.push(`### #${gap.rank}: ${gap.segment} × ${gap.awareness_level}`);
      lines.push(`- **Concept:** ${gap.recommended_concept}`);
      lines.push(`- **Angle:** ${gap.recommended_angle}`);
      lines.push(`- **Style:** ${gap.recommended_style}`);
      lines.push(`- **Priority:** ${gap.priority_score}`);
      if (gap.rationale) lines.push(`- **Rationale:** ${gap.rationale}`);
      lines.push("");
    }
    return lines.join("\n");
  }

  // ── Generic fallback: render all top-level keys ──
  for (const [key, value] of Object.entries(output)) {
    if (key.startsWith("_") || key.endsWith("_source_bot")) continue;
    const heading = key.replace(/_/g, " ").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    if (typeof value === "string") {
      lines.push(`## ${heading}\n`);
      lines.push(value + "\n");
    } else if (Array.isArray(value)) {
      lines.push(`## ${heading} (${value.length} items)\n`);
      for (const item of value.slice(0, 50)) {
        if (typeof item === "string") {
          lines.push(`- ${item}`);
        } else if (typeof item === "object" && item !== null) {
          // Render object items with their key fields
          const label = item.name || item.id || item.brief_id || item.title || "";
          if (label) lines.push(`### ${label}\n`);
          for (const [k, v] of Object.entries(item)) {
            if (k.startsWith("_") || k === "genesis_raw_output") continue;
            if (typeof v === "string" && v.length > 200) {
              lines.push(`**${k}:**\n${v}\n`);
            } else if (Array.isArray(v)) {
              lines.push(`**${k}:**`);
              for (const vi of v) lines.push(`- ${typeof vi === "string" ? vi : JSON.stringify(vi)}`);
              lines.push("");
            } else if (v !== null && v !== undefined) {
              lines.push(`**${k}:** ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
            }
          }
          lines.push("");
        }
      }
      lines.push("");
    } else if (typeof value === "object" && value !== null) {
      lines.push(`## ${heading}\n`);
      for (const [k, v] of Object.entries(value)) {
        if (v !== null && v !== undefined) {
          lines.push(`- **${k}:** ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
        }
      }
      lines.push("");
    } else if (value !== null && value !== undefined) {
      lines.push(`**${heading}:** ${String(value)}\n`);
    }
  }

  return lines.length > 1 ? lines.join("\n") : null;
}

/**
 * Run a batch phase inline (each item is a quick LLM call).
 */
async function runBatchPhase(
  ctx: any,
  run: any,
  phase: any,
  phaseIndex: number,
): Promise<any> {
  const settings: any = await ctx.runQuery(internal.chat.internals.getSettings, { orgId: run.orgId });
  const apiKey = settings?.llmApiKey || "";
  const baseUrl = settings?.llmBaseUrl || "https://api.openai.com/v1";
  const model = phase.model || settings?.llmModel || "gpt-4o";
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  // Get prior results
  const allPhases: any[] = await ctx.runQuery(internal.harness.internals.getPhases, { runId: run._id });
  const priorResults: Record<string, any> = {};
  for (const p of allPhases) {
    if (p.status === "completed" && p.output) {
      priorResults[String(p.phaseIndex)] = p.output;
    }
  }

  // Find items
  let items: any[] = [];
  if (phase.batchItemsKey) {
    for (const result of Object.values(priorResults)) {
      if (result && typeof result === "object" && phase.batchItemsKey in result) {
        items = result[phase.batchItemsKey];
        break;
      }
    }
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { items: [], message: "No items to process" };
  }

  // Apply filter
  if (phase.batchFilter === "yellow_red") {
    items = items.filter((item: any) =>
      ["YELLOW", "RED", "yellow", "red"].includes(item.risk_level));
  }

  const results: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemRef = item.clause_ref || item.section_ref || `item_${i + 1}`;

    // Update batch progress
    await ctx.runMutation(internal.harness.internals.updatePhaseStatus, {
      runId: run._id,
      phaseIndex,
      status: "running",
      batchProgress: { processed: i, total: items.length },
    });

    const systemPrompt = substituteTemplate(phase.systemPromptTemplate, priorResults, phaseIndex);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(item) },
        ],
      }),
    });

    if (!response.ok) {
      results.push({ ...item, _error: `LLM error: ${response.status}`, _ref: itemRef });
      continue;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseStructuredOutput(content);
    results.push({
      ...(typeof parsed === "object" && parsed !== null ? parsed : { result: parsed }),
      _ref: itemRef,
    });
  }

  return { assessments: results };
}
