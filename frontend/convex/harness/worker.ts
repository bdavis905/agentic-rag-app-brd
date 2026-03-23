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
      const todos = allPhases.map((p: any) => ({
        content: p.phaseName,
        status: "completed" as const,
        position: p.phaseIndex,
      }));
      await ctx.runMutation(internal.todos.internals.writeTodos, {
        threadId: run.threadId,
        orgId: run.orgId,
        todos,
      });
      // Add completion message to chat
      await ctx.runMutation(internal.chat.internals.addMessage, {
        threadId: run.threadId,
        role: "assistant",
        content: `Harness workflow "${definition.name}" completed. Check the workspace panel for detailed results.`,
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
    const todos = allPhases.map((p: any) => ({
      content: p.phaseName,
      status: p.phaseIndex === phaseIndex ? "in_progress" : p.status === "completed" ? "completed" : "pending",
      position: p.phaseIndex,
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
          const { messages, llmUrl, apiKey, model } = await buildPhaseContext(ctx, run, phase, phaseIndex);

          await ctx.runMutation(internal.harness.internals.updatePhaseStatus, {
            runId,
            phaseIndex,
            status: "running",
            messages,
            currentRound: 0,
          });

          // Schedule the first tool round
          await ctx.scheduler.runAfter(0, internal.harness.worker.runToolRound, {
            runId,
            phaseIndex,
            round: 0,
          });
        } else {
          // Phase without tools -- single LLM call
          const { messages, llmUrl, apiKey, model } = await buildPhaseContext(ctx, run, phase, phaseIndex);

          const noopEmit = () => {};
          const result = await streamLlmCall(
            llmUrl, apiKey,
            { model, messages, stream: true },
            noopEmit, false,
          );

          const output = parseStructuredOutput(result.content);
          await completePhaseAndContinue(ctx, run, phase, phaseIndex, output);
        }
      } else if (phase.type === "llm_batch_agents") {
        // Batch phase -- run inline since each item is a quick LLM call
        const output = await runBatchPhase(ctx, run, phase, phaseIndex);
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

        // Separate Genesis calls from others
        const genesisCalls = result.toolCalls.filter((tc) => {
          try {
            const a = JSON.parse(tc.arguments || "{}");
            return tc.name === "call_genesis_bot" && a.bot_slug;
          } catch { return false; }
        });
        const otherCalls = result.toolCalls.filter((tc) => !genesisCalls.includes(tc));

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
          }

          // If ALL tool calls were Genesis, complete phase with bot results
          if (otherCalls.length === 0 && genesisCalls.length > 0) {
            // Save foundation docs directly from Genesis results
            if (run.offerSlug && run.orgId && hctx.genesisBotResults) {
              for (const [slug, result] of Object.entries(hctx.genesisBotResults)) {
                const docType = BOT_SLUG_TO_DOC_TYPE[slug];
                if (!docType || !result || (result as string).startsWith("Error:")) continue;
                await ctx.runMutation(internal.foundationDocs.internals.upsert, {
                  orgId: run.orgId,
                  offerSlug: run.offerSlug,
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

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Build the initial messages array for a phase.
 * Reads prior phase outputs from DB, loads workspace/foundation context.
 */
async function buildPhaseContext(
  ctx: any,
  run: any,
  phase: any,
  phaseIndex: number,
): Promise<{ messages: any[]; llmUrl: string; apiKey: string; model: string }> {
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

  // Load workspace and foundation context
  let workspaceContext = "";
  if (phase.workspaceInputs?.length) {
    for (const filePath of phase.workspaceInputs) {
      const content = await ctx.runQuery(internal.workspace.internals.readFile, {
        threadId: run.threadId,
        filePath,
      });
      if (content) workspaceContext += `\n\n### ${filePath}\n${content}`;
    }
  }
  if (phase.foundationInputs?.length && run.orgId && run.offerSlug) {
    for (const docType of phase.foundationInputs) {
      const doc = await ctx.runQuery(internal.foundationDocs.internals.getByOrgOfferDoc, {
        orgId: run.orgId,
        offerSlug: run.offerSlug,
        docType,
      });
      if (doc) workspaceContext += `\n\n### Foundation: ${docType}\n${doc.content}`;
    }
  }

  const userMessage = workspaceContext
    ? `Execute this phase. Here is the context from prior work:\n${workspaceContext}`
    : "Execute this phase based on the context provided in the system prompt.";

  return {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    llmUrl,
    apiKey,
    model,
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
  }

  // Save foundation docs if configured
  if (phase.foundationOutputs?.length && run.orgId && run.offerSlug) {
    // From structured output
    if (output && typeof output === "object") {
      for (const { key, docType } of phase.foundationOutputs) {
        const value = output[key];
        if (value) {
          const content = typeof value === "string" ? value : JSON.stringify(value, null, 2);
          await ctx.runMutation(internal.foundationDocs.internals.upsert, {
            orgId: run.orgId,
            offerSlug: run.offerSlug,
            docType,
            content,
            sourceBot: output[`${key}_source_bot`] ?? undefined,
          });
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
            offerSlug: run.offerSlug,
            docType,
            content: result as string,
            sourceBot: slug,
          });
        }
      }
    }
  }

  // Schedule next phase
  await ctx.scheduler.runAfter(0, internal.harness.worker.runPhase, {
    runId: run._id,
    phaseIndex: phaseIndex + 1,
  });
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
