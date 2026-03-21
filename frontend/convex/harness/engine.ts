/**
 * Harness execution engine.
 *
 * Runs inside the HTTP action (same V8 runtime as chat).
 * Executes phases sequentially, emitting SSE events for each phase.
 *
 * Phase types:
 * - llm_single: One LLM call with structured output
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

/**
 * Run a single LLM call phase with structured output.
 */
async function runPhaseLlmSingle(
  hctx: HarnessContext,
  phase: any,
  phaseIndex: number,
  priorResults: Record<string, any>,
): Promise<any> {
  const { apiKey, baseUrl, model, emit } = hctx;

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

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  // Make LLM call
  const url = `${(baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`;

  const body: any = {
    model,
    messages,
    stream: true,
  };

  if (phase.tools?.length) {
    body.tools = phase.tools;
  }

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

  // Stream response
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";

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

      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        fullContent += delta.content;
        emit("text_delta", { content: delta.content });
      }
    }
  }

  // Try to parse JSON from the response
  return parseStructuredOutput(fullContent);
}

/**
 * Run a batch phase — iterate over items and call LLM for each.
 */
async function runPhaseBatchAgents(
  hctx: HarnessContext,
  phase: any,
  phaseIndex: number,
  priorResults: Record<string, any>,
): Promise<any> {
  const { apiKey, baseUrl, model, emit } = hctx;

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
