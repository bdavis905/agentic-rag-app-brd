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

            // Save each Genesis bot result as a workspace file immediately so it appears in the UI
            if (toolResult && !toolResult.startsWith("Error:")) {
              try {
                const parsedArgs = JSON.parse(tc.arguments || "{}");
                const botSlug = parsedArgs.bot_slug || "unknown";
                const botLabel = botSlug.replace(/-+$/g, "").replace(/-/g, " ");
                const fileIndex = String(round * 10 + i + 1).padStart(2, "0");
                const filePath = `results/${fileIndex}-${botSlug.replace(/-+$/g, "")}.md`;
                await ctx.runMutation(internal.workspace.internals.writeFile, {
                  threadId: run.threadId,
                  orgId: run.orgId,
                  filePath,
                  content: toolResult,
                  contentType: "text/markdown",
                  source: "harness",
                });
              } catch {
                // Non-critical — don't fail the phase if workspace write fails
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
interface PhaseContext {
  messages: any[];
  llmUrl: string;
  apiKey: string;
  model: string;
  foundationDocsLoaded: Array<{ docType: string; contentLength: number }>;
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
