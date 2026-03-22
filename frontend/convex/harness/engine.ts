/**
 * Harness execution engine.
 *
 * Runs inside the HTTP action (same V8 runtime as chat).
 * Executes phases sequentially, emitting SSE events for each phase.
 *
 * Phase types:
 * - llm_single: One LLM call with structured output (supports tool-calling loop)
 * - llm_batch_agents: Iterate over items, one LLM call per item
 */
import type { HarnessDefinition } from "./types";
import { internal } from "../_generated/api";

interface HarnessContext {
  ctx: any;
  threadId: any;
  orgId?: string;
  userId: string;
  apiKey: string;
  baseUrl: string | null;
  model: string;
  emit: (type: string, data?: Record<string, any>) => void;
}

/**
 * Execute a full harness workflow.
 */
export async function executeHarness(
  hctx: HarnessContext,
  definition: HarnessDefinition,
  inputFiles?: string[],
): Promise<void> {
  const { ctx, threadId, orgId, emit } = hctx;

  // Create harness run record
  const runId = await ctx.runMutation(internal.harness.internals.createRun, {
    threadId,
    orgId,
    harnessType: definition.type,
    inputFiles,
  });

  // Create todos from phase names
  const todos = definition.phases.map((phase, i) => ({
    content: `Phase ${i + 1}: ${phase.name}`,
    status: "pending" as const,
  }));
  await ctx.runMutation(internal.todos.internals.writeTodos, {
    threadId,
    orgId,
    todos,
  });
  emit("plan_update", {
    todos: todos.map((t, i) => ({ ...t, position: i })),
  });

  const phaseResults: Record<string, any> = {};

  try {
    for (let i = 0; i < definition.phases.length; i++) {
      const phase = definition.phases[i];

      // Update todo status
      const updatedTodos = todos.map((t, idx) => ({
        content: t.content,
        status: idx < i ? "completed" as const : idx === i ? "in_progress" as const : "pending" as const,
      }));
      await ctx.runMutation(internal.todos.internals.writeTodos, {
        threadId,
        orgId,
        todos: updatedTodos,
      });
      emit("plan_update", {
        todos: updatedTodos.map((t, idx) => ({ ...t, position: idx })),
      });

      emit("harness_phase_start", {
        phase_index: i,
        phase_name: phase.name,
        phase_description: phase.description,
      });

      let phaseOutput: any;

      try {
        if (phase.type === "llm_single") {
          phaseOutput = await runPhaseLlmSingle(hctx, phase, i, phaseResults);
        } else if (phase.type === "llm_batch_agents") {
          phaseOutput = await runPhaseBatchAgents(hctx, phase, i, phaseResults);
        } else {
          throw new Error(`Unknown phase type: ${phase.type}`);
        }

        phaseResults[String(i)] = phaseOutput;

        // Write phase output to workspace if configured
        if (phase.workspaceOutput && phaseOutput) {
          const outputStr =
            typeof phaseOutput === "string"
              ? phaseOutput
              : JSON.stringify(phaseOutput, null, 2);

          await ctx.runMutation(internal.workspace.internals.writeFile, {
            threadId,
            orgId,
            filePath: phase.workspaceOutput,
            content: outputStr,
            contentType: "application/json",
            source: "harness",
          });
          emit("workspace_file_written", {
            file_path: phase.workspaceOutput,
            content_type: "application/json",
            size_bytes: new TextEncoder().encode(outputStr).length,
            source: "harness",
          });
        }

        // Update harness run record
        await ctx.runMutation(internal.harness.internals.updatePhase, {
          runId,
          currentPhase: i + 1,
          phaseResults,
        });

        // Generate markdown summary
        const resultMarkdown = generatePhaseMarkdown(phase.name, phaseOutput);

        emit("harness_phase_complete", {
          phase_index: i,
          phase_name: phase.name,
          result_summary: `Phase ${i + 1} complete`,
          result_markdown: resultMarkdown,
        });
      } catch (phaseError: any) {
        emit("harness_phase_error", {
          phase_index: i,
          phase_name: phase.name,
          error: phaseError.message,
        });

        await ctx.runMutation(internal.harness.internals.failRun, {
          runId,
          error: phaseError.message,
          currentPhase: i,
        });

        // Update todos to show error
        const errorTodos = todos.map((t, idx) => ({
          content: idx === i ? `${t.content} (FAILED)` : t.content,
          status: idx < i ? "completed" as const : "pending" as const,
        }));
        await ctx.runMutation(internal.todos.internals.writeTodos, {
          threadId,
          orgId,
          todos: errorTodos,
        });
        emit("plan_update", {
          todos: errorTodos.map((t, idx) => ({ ...t, position: idx })),
        });

        throw phaseError;
      }
    }

    // All phases complete
    const finalTodos = todos.map((t) => ({
      content: t.content,
      status: "completed" as const,
    }));
    await ctx.runMutation(internal.todos.internals.writeTodos, {
      threadId,
      orgId,
      todos: finalTodos,
    });
    emit("plan_update", {
      todos: finalTodos.map((t, i) => ({ ...t, position: i })),
    });

    await ctx.runMutation(internal.harness.internals.completeRun, {
      runId,
      phaseResults,
    });

    emit("harness_complete", {
      harness_type: definition.type,
      overall_result: phaseResults,
    });
  } catch (e: any) {
    emit("error", { error: `Harness failed: ${e.message}` });
  }
}

// ─── Streaming LLM Call with Tool-Calling Loop ──────────────────

interface StreamResult {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finishReason: string;
}

/**
 * Make a streaming LLM call and return content + tool calls.
 */
async function streamLlmCall(
  url: string,
  apiKey: string,
  body: any,
  emit: (type: string, data?: Record<string, any>) => void,
  streamText: boolean = true,
): Promise<StreamResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error ${response.status}: ${errorText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finishReason = "stop";
  const toolCallsBuffer = new Map<number, { id: string; name: string; arguments: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;

      let chunk: any;
      try {
        chunk = JSON.parse(trimmed.slice(6));
      } catch {
        continue;
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      const delta = choice.delta;
      if (!delta) continue;

      // Text content
      if (delta.content) {
        content += delta.content;
        if (streamText) {
          emit("text_delta", { content: delta.content });
        }
      }

      // Tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallsBuffer.has(idx)) {
            toolCallsBuffer.set(idx, {
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              arguments: "",
            });
          }
          const existing = toolCallsBuffer.get(idx)!;
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name = tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
        }
      }
    }
  }

  return {
    content,
    toolCalls: [...toolCallsBuffer.values()],
    finishReason,
  };
}

// ─── Harness Tool Dispatcher ────────────────────────────────────

/**
 * Execute a harness tool call. Routes to the appropriate backend function.
 */
async function executeHarnessTool(
  hctx: HarnessContext,
  toolName: string,
  args: Record<string, any>,
): Promise<string> {
  const { ctx, orgId, userId } = hctx;
  const filterArgs = orgId ? { orgId } : { userId };

  // ── RAG Search ──
  if (toolName === "search_documents") {
    const query = args.query ?? "";
    const searchMode = args.search_mode ?? "hybrid";
    const results = await ctx.runAction(
      internal.search.actions.hybridSearch,
      { query, ...filterArgs, topK: 5, searchMode },
    );

    if (!results || results.length === 0) {
      return "No relevant documents found.";
    }

    return results
      .map((r: any) => {
        const meta = r.metadata ?? {};
        const source = meta.filename ?? "unknown";
        const docId = r.documentId ?? "";
        const scores: string[] = [];
        if (r.rerankScore != null) scores.push(`rerank: ${r.rerankScore.toFixed(3)}`);
        if (r.rrfScore != null) scores.push(`rrf: ${r.rrfScore.toFixed(4)}`);
        if (r._score != null) scores.push(`similarity: ${r._score.toFixed(2)}`);
        const scoreStr = scores.length > 0 ? scores.join(", ") : "n/a";
        return `[Source: ${source}]\n[document_id: ${docId}]\n(${scoreStr})\n${r.content}`;
      })
      .join("\n\n---\n\n");
  }

  // ── Navigation Tools ──
  if (toolName === "ls") {
    return await ctx.runQuery(internal.navigation.internals.ls, {
      path: args.path ?? "root",
      ...filterArgs,
    });
  }

  if (toolName === "tree") {
    return await ctx.runQuery(internal.navigation.internals.tree, {
      path: args.path ?? "root",
      depth: args.depth,
      limit: args.limit,
      ...filterArgs,
    });
  }

  if (toolName === "grep") {
    return await ctx.runQuery(internal.navigation.internals.grep, {
      pattern: args.pattern ?? "",
      path: args.path,
      caseSensitive: args.case_sensitive,
      ...filterArgs,
    });
  }

  if (toolName === "glob") {
    return await ctx.runQuery(internal.navigation.internals.glob, {
      pattern: args.pattern ?? "",
      ...filterArgs,
    });
  }

  if (toolName === "read") {
    return await ctx.runQuery(internal.navigation.internals.read, {
      documentId: args.document_id ?? "",
      startLine: args.start_line,
      endLine: args.end_line,
      ...filterArgs,
    });
  }

  // ── Genesis Bot ──
  if (toolName === "call_genesis_bot") {
    return await callGenesisBot(args);
  }

  return `Error: Unknown tool '${toolName}'. Available tools: search_documents, ls, tree, grep, glob, read, call_genesis_bot. Use 'read' with a document_id to read full document content.`;
}

/**
 * Call a Genesis copywriting/research bot via the OpenClaw API.
 */
async function callGenesisBot(args: {
  bot_slug: string;
  prompt: string;
  temperature?: number;
}): Promise<string> {
  const apiKey = process.env.GENESIS_API_KEY;
  const providerKey = process.env.GENESIS_ANTHROPIC_API_KEY;

  if (!apiKey || !providerKey) {
    return "Error: Genesis API keys not configured. Set GENESIS_API_KEY and GENESIS_ANTHROPIC_API_KEY in Convex environment.";
  }

  const response = await fetch("http://159.65.166.122/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "X-Provider-Key": providerKey,
    },
    body: JSON.stringify({
      model: args.bot_slug,
      messages: [{ role: "user", content: args.prompt }],
      stream: false,
      temperature: args.temperature ?? 0.7,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return `Error calling Genesis bot '${args.bot_slug}': ${response.status} ${errorText}`;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "Error: No response from Genesis bot.";
}

// ─── Phase Runners ──────────────────────────────────────────────

/**
 * Run a single LLM call phase with structured output.
 * Supports tool-calling loop when phase.tools is defined.
 */
async function runPhaseLlmSingle(
  hctx: HarnessContext,
  phase: any,
  phaseIndex: number,
  priorResults: Record<string, any>,
): Promise<any> {
  const { apiKey, baseUrl, emit } = hctx;
  const model = phase.model || hctx.model;

  // Build system prompt from template
  const systemPrompt = substituteTemplate(
    phase.systemPromptTemplate,
    priorResults,
    phaseIndex,
  );

  // Load workspace inputs if configured
  let workspaceContext = "";
  if (phase.workspaceInputs?.length) {
    for (const filePath of phase.workspaceInputs) {
      const content = await hctx.ctx.runQuery(
        internal.workspace.internals.readFile,
        { threadId: hctx.threadId, filePath },
      );
      if (content) {
        workspaceContext += `\n\n### ${filePath}\n${content}`;
      }
    }
  }

  const userMessage = workspaceContext
    ? `Execute this phase. Here is the context from prior work:\n${workspaceContext}`
    : "Execute this phase based on the context provided in the system prompt.";

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const url = `${(baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`;
  const maxRounds = phase.maxRounds ?? 10;
  const hasTools = phase.tools?.length > 0;

  // If no tools, do a simple single call (preserves original behavior)
  if (!hasTools) {
    const body: any = { model, messages, stream: true };
    const result = await streamLlmCall(url, apiKey, body, emit, true);
    return parseStructuredOutput(result.content);
  }

  // Tool-calling loop
  let fullContent = "";

  for (let round = 0; round < maxRounds; round++) {
    const body: any = {
      model,
      messages,
      tools: phase.tools,
      stream: true,
    };

    const result = await streamLlmCall(url, apiKey, body, emit, true);
    fullContent = result.content;

    // If the LLM finished with tool_calls, execute them and loop
    if (
      result.finishReason === "tool_calls" &&
      result.toolCalls.length > 0
    ) {
      // Add assistant message with tool_calls to conversation
      messages.push({
        role: "assistant",
        content: result.content || null,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      // Execute each tool call
      for (const tc of result.toolCalls) {
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = JSON.parse(tc.arguments || "{}");
        } catch {
          /* empty */
        }

        emit("tool_call_start", {
          tool_name: tc.name,
          arguments: tc.arguments,
        });

        const toolResult = await executeHarnessTool(hctx, tc.name, parsedArgs);

        // Add tool result to conversation
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult,
        });

        const resultSummary = toolResult.length > 200
          ? toolResult.slice(0, 200) + "..."
          : toolResult;

        emit("tool_call_complete", {
          tool_name: tc.name,
          result_summary: resultSummary,
        });
      }

      continue; // Next round
    }

    // LLM finished without tool calls -- we're done
    break;
  }

  return parseStructuredOutput(fullContent);
}

/**
 * Run a batch phase -- iterate over items and call LLM for each.
 */
async function runPhaseBatchAgents(
  hctx: HarnessContext,
  phase: any,
  phaseIndex: number,
  priorResults: Record<string, any>,
): Promise<any> {
  const { apiKey, baseUrl, emit } = hctx;
  const model = phase.model || hctx.model;

  // Get items from prior phase output
  if (!phase.batchItemsKey) {
    throw new Error("Batch phase requires batchItemsKey");
  }

  // Find the items in prior results
  let items: any[] = [];
  for (const key of Object.keys(priorResults)) {
    const result = priorResults[key];
    if (result && typeof result === "object" && phase.batchItemsKey in result) {
      items = result[phase.batchItemsKey];
      break;
    }
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { items: [], message: "No items to process" };
  }

  // Apply filter if configured
  if (phase.batchFilter === "yellow_red" && items.length > 0) {
    items = items.filter(
      (item: any) =>
        item.risk_level === "YELLOW" ||
        item.risk_level === "RED" ||
        item.risk_level === "yellow" ||
        item.risk_level === "red",
    );
  }

  const results: any[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemRef = item.clause_ref || item.section_ref || `item_${i + 1}`;

    emit("harness_batch_progress", {
      phase_index: phaseIndex,
      processed: i,
      total: items.length,
    });

    const systemPrompt = substituteTemplate(
      phase.systemPromptTemplate,
      priorResults,
      phaseIndex,
    );

    const itemJson = JSON.stringify(item, null, 2);
    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Analyze the following item (${i + 1}/${items.length}):\n\n${itemJson}`,
      },
    ];

    const url = `${(baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, stream: false }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        results.push({
          ...item,
          _error: `LLM error: ${errorText}`,
          _ref: itemRef,
        });
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content ?? "";
      const parsed = parseStructuredOutput(content);

      results.push({
        ...(typeof parsed === "object" && parsed !== null ? parsed : { result: parsed }),
        _ref: itemRef,
      });
    } catch (e: any) {
      results.push({
        ...item,
        _error: e.message,
        _ref: itemRef,
      });
    }
  }

  emit("harness_batch_progress", {
    phase_index: phaseIndex,
    processed: items.length,
    total: items.length,
  });

  return { assessments: results };
}

// ─── Utilities ──────────────────────────────────────────────────

/**
 * Substitute $variables in a template string.
 */
function substituteTemplate(
  template: string,
  priorResults: Record<string, any>,
  _phaseIndex: number,
): string {
  let result = template;

  // Substitute $prior_results with JSON of all prior outputs
  result = result.replace(
    /\$prior_results/g,
    JSON.stringify(priorResults, null, 2),
  );

  // Substitute individual phase outputs: $phase_0_output, $phase_1_output, etc.
  for (const [key, value] of Object.entries(priorResults)) {
    const placeholder = `$phase_${key}_output`;
    result = result.replace(
      new RegExp(placeholder.replace(/\$/g, "\\$"), "g"),
      typeof value === "string" ? value : JSON.stringify(value, null, 2),
    );
  }

  return result;
}

/**
 * Try to parse JSON from LLM output. Handles markdown code fences.
 */
function parseStructuredOutput(text: string): any {
  // Try direct JSON parse first
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // ignore
  }

  // Try extracting from markdown code fences
  const jsonMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {
      // ignore
    }
  }

  // Return as string if can't parse
  return trimmed;
}

/**
 * Generate a markdown summary of a phase result.
 */
function generatePhaseMarkdown(phaseName: string, output: any): string {
  if (typeof output === "string") {
    return `### ${phaseName}\n\n${output}`;
  }

  if (output && typeof output === "object") {
    // Try to create a readable summary
    const lines: string[] = [`### ${phaseName}\n`];

    for (const [key, value] of Object.entries(output)) {
      if (key.startsWith("_")) continue;
      if (Array.isArray(value)) {
        lines.push(`**${key}**: ${value.length} items`);
      } else if (typeof value === "object" && value !== null) {
        lines.push(`**${key}**: ${JSON.stringify(value).slice(0, 100)}...`);
      } else {
        lines.push(`**${key}**: ${String(value)}`);
      }
    }

    return lines.join("\n");
  }

  return `### ${phaseName}\n\nCompleted.`;
}
