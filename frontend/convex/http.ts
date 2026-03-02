/**
 * HTTP Action router — serves chat endpoints (admin + external API).
 * Uses raw fetch to OpenAI (V8 runtime compatible, no "use node" needed).
 */
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// ─── Constants ───────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 10;
const MAX_EXPLORER_ROUNDS = 8;
const TAVILY_API_URL = "https://api.tavily.com/search";
const MAX_CONTEXT_TOKENS = 100_000;

// ─── CORS Headers ────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  ...CORS_HEADERS,
} as const;

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ─── API Key Auth Helper ─────────────────────────────────────────

async function authenticateApiKey(
  ctx: any,
  request: Request,
): Promise<{ ownerUserId: string; orgId: string | undefined; keyId: any } | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const rawKey = authHeader.slice(7);
  if (!rawKey.startsWith("rag_")) return null;

  // SHA-256 hash the key using Web Crypto (available in Convex V8 runtime)
  const encoded = new TextEncoder().encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  const keyRecord = await ctx.runQuery(
    internal.apiKeys.internals.getByHash,
    { keyHash },
  );
  if (!keyRecord) return null;

  // Fire-and-forget: update lastUsedAt
  ctx.runMutation(internal.apiKeys.internals.touchLastUsed, {
    keyId: keyRecord._id,
  });

  return { ownerUserId: keyRecord.ownerUserId, orgId: keyRecord.orgId, keyId: keyRecord._id };
}

// ─── System Prompt ───────────────────────────────────────────────

const DEFAULT_PERSONA = `You are a helpful assistant powered by Genesis.
You have access to multiple tools to help answer questions.`;

const TOOL_INSTRUCTIONS = `## CRITICAL: Response Requirement
You have a maximum of ${MAX_TOOL_ROUNDS} tool call rounds available. You MUST:
- Plan your tool usage efficiently to gather information within this limit
- Begin synthesizing your answer after gathering sufficient information
- ALWAYS provide a final text response to the user - never end with just a tool call
- Aim to complete your research and respond well before reaching round ${MAX_TOOL_ROUNDS}

## Your Approach: Strategic Retrieval

Before answering any question, you MUST first develop a retrieval strategy:

1. **Analyze the Query**: What is the user actually asking?
2. **Plan Your Retrieval**: Which tools and queries will gather the necessary information?
3. **Execute Strategically**: Make multiple tool calls if needed.
4. **Synthesize**: Combine all retrieved information into a comprehensive, well-cited answer.

## Available Tools

1. **search_documents** - Search uploaded documents for relevant information.
   - Search modes: 'hybrid' (default), 'keyword' (exact terms), 'vector' (conceptual)
   - Pro tip: Make MULTIPLE searches with different phrasings for complex questions.

2. **analyze_document** - Analyze a specific document in depth.
   - Spawns a sub-agent that reads the FULL document content
   - Use for: "Summarize my report", "What are the key points?"
   - The document_id must come from search_documents or ls/glob results.

3. **web_search** - Search the web for current information.
   - Use when documents don't have the answer
   - Always cite source URLs

4. **ls** - List folder contents. Shows subfolders and documents.

5. **tree** - Get hierarchical folder view. Understand KB organization.

6. **grep** - Search document content for regex patterns.

7. **glob** - Find documents by filename pattern (wildcards: *, ?, **).

8. **read** - Read document content. Returns full text or specific line range.

9. **explore_knowledge_base** - Delegate complex research to an exploration sub-agent.
   - The explorer has access to all KB tools (ls, tree, grep, glob, read, analyze_document)
   - Great for multi-document research tasks.

## Important Guidelines
- Be thorough: One search is rarely enough for complex questions.
- Vary your queries: Use synonyms and different phrasings.
- Always cite: Reference specific documents or web sources.
- Explain gaps: If you couldn't find information, say so.`;

function getSystemPrompt(customInstructions?: string): string {
  const persona = customInstructions || DEFAULT_PERSONA;
  return `${persona}\n\n${TOOL_INSTRUCTIONS}`;
}

// ─── Tool Definitions ────────────────────────────────────────────

function getToolDefinitions(includeWebSearch: boolean): any[] {
  const tools: any[] = [
    {
      type: "function",
      function: {
        name: "search_documents",
        description:
          "Search the user's uploaded documents for relevant information.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query",
            },
            search_mode: {
              type: "string",
              enum: ["hybrid", "vector", "keyword"],
              description:
                "Search strategy: 'hybrid' (default), 'keyword', or 'vector'",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "analyze_document",
        description:
          "Analyze a specific document in depth. Spawns a sub-agent that reads the full content.",
        parameters: {
          type: "object",
          properties: {
            document_id: {
              type: "string",
              description: "The document ID from search/ls/glob results",
            },
            query: {
              type: "string",
              description: "What to analyze or extract",
            },
          },
          required: ["document_id", "query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "ls",
        description: "List files and subfolders in a folder.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "'root' for top-level, or a folder ID",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "tree",
        description: "Get hierarchical view of folder structure.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "'root' or folder ID",
            },
            depth: { type: "integer", description: "Max depth (default 3)" },
            limit: {
              type: "integer",
              description: "Max items (default 50)",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "grep",
        description: "Search document content for a regex pattern.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Regex pattern" },
            path: {
              type: "string",
              description: "Scope to folder (optional)",
            },
            case_sensitive: { type: "boolean" },
          },
          required: ["pattern"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "glob",
        description: "Find documents by filename pattern.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "Filename pattern with wildcards",
            },
          },
          required: ["pattern"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read",
        description: "Read document content by ID.",
        parameters: {
          type: "object",
          properties: {
            document_id: {
              type: "string",
              description: "Document ID",
            },
            start_line: { type: "integer" },
            end_line: { type: "integer" },
          },
          required: ["document_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "explore_knowledge_base",
        description:
          "Delegate a knowledge base exploration task to a specialized sub-agent.",
        parameters: {
          type: "object",
          properties: {
            research_query: {
              type: "string",
              description: "What to research in the knowledge base",
            },
            starting_path: {
              type: "string",
              description: "'root' or folder ID",
            },
          },
          required: ["research_query"],
        },
      },
    },
  ];

  if (includeWebSearch) {
    tools.push({
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web for current information.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            max_results: {
              type: "integer",
              description: "Max results (default 5)",
            },
          },
          required: ["query"],
        },
      },
    });
  }

  return tools;
}

// ─── OpenAI SSE Stream Parser ────────────────────────────────────

interface ToolCallBuffer {
  id: string;
  name: string;
  arguments: string;
}

interface StreamResult {
  content: string;
  toolCalls: ToolCallBuffer[];
  finishReason: string | null;
}

async function callOpenAIStreaming(
  messages: any[],
  tools: any[],
  apiKey: string,
  baseUrl: string | null,
  model: string,
  emit: (type: string, data?: Record<string, any>) => void,
  streamText: boolean = true,
): Promise<StreamResult> {
  const url = `${(baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`;

  const body: any = { model, messages, stream: true };
  if (tools.length > 0) body.tools = tools;

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
  const toolCallsBuffer: Map<number, ToolCallBuffer> = new Map();
  let finishReason: string | null = null;

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
      if (delta.content && streamText) {
        content += delta.content;
        emit("text_delta", { content: delta.content });
      } else if (delta.content) {
        content += delta.content;
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
          if (tc.function?.arguments)
            existing.arguments += tc.function.arguments;
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

// ─── Tool Execution ──────────────────────────────────────────────

async function executeTool(
  ctx: any,
  toolName: string,
  args: Record<string, any>,
  userId: string,
  emit: (type: string, data?: Record<string, any>) => void,
  llmConfig: { apiKey: string; baseUrl: string | null; model: string },
  orgId?: string,
): Promise<string> {
  // Build filter args — prefer orgId, fall back to userId
  const filterArgs = orgId ? { orgId } : { userId };

  if (toolName === "search_documents") {
    const query = args.query ?? "";
    const searchMode = args.search_mode ?? "hybrid";
    const results = await ctx.runAction(
      internal.search.actions.hybridSearch,
      {
        query,
        ...filterArgs,
        topK: 5,
        searchMode,
      },
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
        if (r.rerankScore != null)
          scores.push(`rerank: ${r.rerankScore.toFixed(3)}`);
        if (r.rrfScore != null)
          scores.push(`rrf: ${r.rrfScore.toFixed(4)}`);
        if (r._score != null)
          scores.push(`similarity: ${r._score.toFixed(2)}`);
        const scoreStr = scores.length > 0 ? scores.join(", ") : "n/a";
        return `[Source: ${source}]\n[document_id: ${docId}]\n(${scoreStr})\n${r.content}`;
      })
      .join("\n\n---\n\n");
  }

  if (toolName === "web_search") {
    const query = args.query ?? "";
    if (!query) return "Error: No search query provided.";

    // Read web search API key from settings first, then env var
    const settingsForSearch = await ctx.runQuery(
      internal.chat.internals.getSettings,
      { orgId },
    );
    const tavilyApiKey = settingsForSearch?.webSearchApiKey || process.env.TAVILY_API_KEY;
    if (!tavilyApiKey) {
      return "Web search is not enabled. Configure the API key in Settings or as TAVILY_API_KEY env var.";
    }

    try {
      const response = await fetch(TAVILY_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query,
          max_results: args.max_results ?? 5,
          search_depth: "basic",
          include_answer: false,
          include_raw_content: false,
        }),
      });

      if (!response.ok)
        return `Web search failed: ${response.status}`;

      const data = await response.json();
      const results = data.results ?? [];

      if (results.length === 0)
        return `No web search results found for: ${query}`;

      return results
        .map(
          (r: any, i: number) =>
            `[${i + 1}] ${r.title ?? "Untitled"}\n    URL: ${r.url ?? ""}\n    ${r.content ?? ""}`,
        )
        .join("\n\n");
    } catch (e: any) {
      return `Web search failed: ${e.message}`;
    }
  }

  if (toolName === "ls") {
    return await ctx.runQuery(internal.navigation.internals.ls, {
      path: args.path ?? "root",
      ...filterArgs,
    });
  }

  if (toolName === "tree") {
    return await ctx.runQuery(internal.navigation.internals.tree, {
      path: args.path ?? "root",
      ...filterArgs,
      depth: Math.min(Math.max(args.depth ?? 3, 1), 10),
      limit: Math.min(Math.max(args.limit ?? 50, 10), 200),
    });
  }

  if (toolName === "grep") {
    if (!args.pattern) return "Error: No search pattern provided.";
    return await ctx.runQuery(internal.navigation.internals.grep, {
      pattern: args.pattern,
      ...filterArgs,
      path: args.path,
      caseSensitive: args.case_sensitive,
    });
  }

  if (toolName === "glob") {
    if (!args.pattern) return "Error: No filename pattern provided.";
    return await ctx.runQuery(internal.navigation.internals.glob, {
      pattern: args.pattern,
      ...filterArgs,
    });
  }

  if (toolName === "read") {
    if (!args.document_id) return "Error: No document_id provided.";
    return await ctx.runQuery(internal.navigation.internals.read, {
      documentId: args.document_id,
      ...filterArgs,
      startLine: args.start_line,
      endLine: args.end_line,
    });
  }

  if (toolName === "analyze_document") {
    return await runAnalyzeDocument(ctx, args, userId, emit, llmConfig, orgId);
  }

  if (toolName === "explore_knowledge_base") {
    return await runExplorerAgent(ctx, args, userId, emit, llmConfig, orgId);
  }

  return `Error: Unknown tool '${toolName}'`;
}

// ─── Sub-Agent: Analyze Document ─────────────────────────────────

async function runAnalyzeDocument(
  ctx: any,
  args: Record<string, any>,
  userId: string,
  emit: (type: string, data?: Record<string, any>) => void,
  llmConfig: { apiKey: string; baseUrl: string | null; model: string },
  orgId?: string,
): Promise<string> {
  const documentId = args.document_id ?? "";
  const query = args.query ?? "";

  if (!documentId || !query) {
    return "Error: document_id and query are required.";
  }

  const filterArgs = orgId ? { orgId } : { userId };
  const docData = await ctx.runQuery(
    internal.navigation.internals.getFullDocument,
    { documentId, ...filterArgs },
  );

  if (!docData) {
    emit("sub_agent_error", {
      error: `Document not found or not accessible: ${documentId}`,
    });
    return `Error: Document not found: ${documentId}`;
  }

  if (docData.tokenEstimate > MAX_CONTEXT_TOKENS) {
    emit("sub_agent_error", {
      error: `Document too large (${docData.tokenEstimate.toLocaleString()} est. tokens)`,
    });
    return `Error: Document too large for analysis.`;
  }

  emit("sub_agent_start", {
    document_id: docData.id,
    filename: docData.filename,
    token_count: docData.tokenEstimate,
  });

  const subMessages = [
    {
      role: "system",
      content:
        "You are a document analysis specialist. Analyze the provided document and answer the user's question. Be specific and cite relevant sections.",
    },
    {
      role: "user",
      content: `## Document: ${docData.filename}\n\n${docData.content}\n\n---\n\n## Analysis Request\n\n${query}`,
    },
  ];

  try {
    const result = await callOpenAIStreaming(
      subMessages,
      [],
      llmConfig.apiKey,
      llmConfig.baseUrl,
      llmConfig.model,
      (type, data) => {
        if (type === "text_delta") {
          emit("sub_agent_reasoning", { content: data?.content ?? "" });
        }
      },
      true,
    );

    emit("sub_agent_complete", { result: result.content });
    return result.content;
  } catch (e: any) {
    emit("sub_agent_error", { error: e.message });
    return `Error analyzing document: ${e.message}`;
  }
}

// ─── Sub-Agent: Explorer ─────────────────────────────────────────

const EXPLORER_SYSTEM_PROMPT = `You are a knowledge base exploration specialist. Research a specific topic by navigating and searching the user's document collection.

## Your Tools
1. **ls(path)** - List folder contents
2. **tree(path, depth, limit)** - Get hierarchical view
3. **grep(pattern, path, case_sensitive)** - Search content for patterns
4. **glob(pattern)** - Find files by name pattern
5. **read(document_id, start_line, end_line)** - Read document content

## Your Approach
1. Explore structure (tree/ls)
2. Search for relevance (grep/glob)
3. Deep dive (read)
4. Synthesize findings

## Critical Rules
- Maximum 8 tool call rounds. Plan efficiently.
- Start broad, then narrow, then deep.
- Synthesize findings into: Summary, Key Documents, Key Findings, Gaps.`;

const EXPLORER_TOOLS = [
  {
    type: "function",
    function: {
      name: "ls",
      description: "List folder contents.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "'root' or folder ID" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tree",
      description: "Get hierarchical folder view.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          depth: { type: "integer" },
          limit: { type: "integer" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "Search content for regex pattern.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
          case_sensitive: { type: "boolean" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob",
      description: "Find documents by filename pattern.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description: "Read document content by ID.",
      parameters: {
        type: "object",
        properties: {
          document_id: { type: "string" },
          start_line: { type: "integer" },
          end_line: { type: "integer" },
        },
        required: ["document_id"],
      },
    },
  },
];

function getExplorerToolResultSummary(
  toolName: string,
  result: string,
): string {
  if (toolName === "ls") {
    const lines = result.split("\n");
    const folders = lines.filter((l) => l.trim().endsWith("/")).length;
    const docs = lines.filter(
      (l) => l.includes("(id:") && !l.trim().endsWith("/"),
    ).length;
    return `Listed ${folders} folders and ${docs} documents`;
  }
  if (toolName === "tree") {
    const lines = result.split("\n").filter((l) => l.trim());
    return `Displayed tree with ${lines.length} items`;
  }
  if (toolName === "grep" || toolName === "glob") {
    if (result.includes("No documents found")) return "No matches";
    const match = result.match(/Found (\d+)/);
    return match ? `Found ${match[1]} documents` : "Search complete";
  }
  if (toolName === "read") {
    if (result.includes("Error:")) return "Read failed";
    const lines = result.split("\n").filter((l) => l.trim()).length;
    return `Read ${lines} lines`;
  }
  return "Complete";
}

async function executeExplorerTool(
  ctx: any,
  toolName: string,
  args: Record<string, any>,
  userId: string,
  orgId?: string,
): Promise<string> {
  const filterArgs = orgId ? { orgId } : { userId };

  if (toolName === "ls") {
    return await ctx.runQuery(internal.navigation.internals.ls, {
      path: args.path ?? "root",
      ...filterArgs,
    });
  }
  if (toolName === "tree") {
    return await ctx.runQuery(internal.navigation.internals.tree, {
      path: args.path ?? "root",
      ...filterArgs,
      depth: args.depth,
      limit: args.limit,
    });
  }
  if (toolName === "grep") {
    return await ctx.runQuery(internal.navigation.internals.grep, {
      pattern: args.pattern ?? "",
      ...filterArgs,
      path: args.path,
      caseSensitive: args.case_sensitive,
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
      ...filterArgs,
      startLine: args.start_line,
      endLine: args.end_line,
    });
  }
  return `Error: Unknown explorer tool '${toolName}'`;
}

async function runExplorerAgent(
  ctx: any,
  args: Record<string, any>,
  userId: string,
  emit: (type: string, data?: Record<string, any>) => void,
  llmConfig: { apiKey: string; baseUrl: string | null; model: string },
  orgId?: string,
): Promise<string> {
  const researchQuery = args.research_query ?? "";
  const startingPath = args.starting_path ?? "root";

  if (!researchQuery)
    return "Error: No research query provided.";

  emit("explorer_start", {
    research_query: researchQuery,
    starting_path: startingPath,
  });

  const explorerMessages: any[] = [
    { role: "system", content: EXPLORER_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Research this topic in the knowledge base:\n\n${researchQuery}\n\nStart exploring from: ${startingPath}`,
    },
  ];

  try {
    for (let round = 1; round <= MAX_EXPLORER_ROUNDS; round++) {
      if (round > 5) {
        explorerMessages.push({
          role: "system",
          content: `Round ${round} of ${MAX_EXPLORER_ROUNDS}. Please begin synthesizing your findings.`,
        });
      }

      const result = await callOpenAIStreaming(
        explorerMessages,
        EXPLORER_TOOLS,
        llmConfig.apiKey,
        llmConfig.baseUrl,
        llmConfig.model,
        (type, data) => {
          if (type === "text_delta") {
            emit("explorer_reasoning", { content: data?.content ?? "" });
          }
        },
        true,
      );

      if (
        result.finishReason === "stop" ||
        result.toolCalls.length === 0
      ) {
        emit("explorer_complete", { findings: result.content });
        return result.content;
      }

      // Build assistant message with tool_calls
      explorerMessages.push({
        role: "assistant",
        content: null,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      // Execute each tool
      for (const tc of result.toolCalls) {
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = JSON.parse(tc.arguments || "{}");
        } catch {
          /* empty */
        }

        emit("explorer_tool_call", {
          tool_name: tc.name,
          arguments: parsedArgs,
          round,
        });

        const toolResult = await executeExplorerTool(
          ctx,
          tc.name,
          parsedArgs,
          userId,
          orgId,
        );

        explorerMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult,
        });

        emit("explorer_tool_result", {
          tool_name: tc.name,
          result_summary: getExplorerToolResultSummary(tc.name, toolResult),
        });
      }
    }

    // Max rounds reached — force synthesis
    explorerMessages.push({
      role: "system",
      content:
        "Maximum exploration rounds reached. Synthesize your findings now.",
    });

    const finalResult = await callOpenAIStreaming(
      explorerMessages,
      [],
      llmConfig.apiKey,
      llmConfig.baseUrl,
      llmConfig.model,
      (type, data) => {
        if (type === "text_delta") {
          emit("explorer_reasoning", { content: data?.content ?? "" });
        }
      },
      true,
    );

    emit("explorer_complete", { findings: finalResult.content });
    return finalResult.content;
  } catch (e: any) {
    emit("explorer_error", { error: e.message });
    return `Error exploring knowledge base: ${e.message}`;
  }
}

// ─── Title Generation ────────────────────────────────────────────

async function generateTitle(
  userMessage: string,
  assistantResponse: string,
  apiKey: string,
  baseUrl: string | null,
  model: string,
): Promise<string | null> {
  try {
    const assistantContext = assistantResponse.slice(0, 500);
    const url = `${(baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Generate a short, descriptive title (2-6 words) for a chat conversation. Reply with ONLY the title.",
          },
          {
            role: "user",
            content: `User message: ${userMessage}\n\nAssistant response: ${assistantContext}`,
          },
        ],
        stream: false,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const title = data.choices?.[0]?.message?.content?.trim();
    return title ? title.slice(0, 60) : null;
  } catch {
    return null;
  }
}

// ─── Result Summary ──────────────────────────────────────────────

function getResultSummary(toolName: string, result: string): string {
  if (toolName === "search_documents") {
    if (result.includes("No relevant documents")) return "No results";
    const count = (result.match(/\[Source:/g) || []).length;
    return count > 0 ? `${count} result${count !== 1 ? "s" : ""}` : "Results found";
  }
  if (toolName === "web_search") {
    const count = (result.match(/^\[\d+\]/gm) || []).length;
    return count > 0 ? `${count} result${count !== 1 ? "s" : ""}` : "No results";
  }
  if (toolName === "analyze_document") return "Analysis complete";
  if (toolName === "explore_knowledge_base") return "Exploration complete";
  return "Complete";
}

// ─── Reusable Chat Loop ─────────────────────────────────────────

/**
 * Core chat loop — shared between admin (Clerk) and external (API key) endpoints.
 *
 * @param ctx        Convex httpAction context
 * @param userId     The userId for document search scoping (admin's Clerk userId)
 * @param threadId   Thread ID (already validated/created by caller)
 * @param content    User message text
 * @param emit       SSE emit function
 */
async function runChatLoop(params: {
  ctx: any;
  userId: string;
  orgId?: string;
  threadId: any;
  content: string;
  emit: (type: string, data?: Record<string, any>) => void;
}): Promise<void> {
  const { ctx, userId, orgId, threadId, content, emit } = params;

  // Store user message
  await ctx.runMutation(internal.chat.internals.addMessage, {
    threadId,
    role: "user",
    content,
  });

  // Get message history
  const messages = await ctx.runQuery(
    internal.chat.internals.getThreadMessages,
    { threadId },
  );

  // Get LLM settings (scoped to org)
  const settings = await ctx.runQuery(
    internal.chat.internals.getSettings,
    { orgId },
  );

  const apiKey = settings?.llmApiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    emit("error", { error: "LLM API key not configured." });
    return;
  }

  const llmModel = settings?.llmModel ?? "gpt-4o";
  const llmBaseUrl = settings?.llmBaseUrl || process.env.LLM_BASE_URL || null;
  const llmConfig = { apiKey, baseUrl: llmBaseUrl, model: llmModel };

  const webSearchEnabled =
    (settings?.webSearchEnabled ?? false) &&
    !!(settings?.webSearchApiKey || process.env.TAVILY_API_KEY);

  const tools = getToolDefinitions(webSearchEnabled);

  // Check if this is the first exchange (for title generation)
  const messageCount = await ctx.runQuery(
    internal.chat.internals.getMessageCount,
    { threadId },
  );
  const isFirstExchange = messageCount <= 1;

  let fullResponse = "";
  const currentMessages = [
    { role: "system", content: getSystemPrompt(settings?.chatSystemPrompt || undefined) },
    ...messages,
  ];
  const allToolCalls: any[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await callOpenAIStreaming(
      currentMessages,
      tools,
      apiKey,
      llmBaseUrl,
      llmModel,
      emit,
      true,
    );

    fullResponse += result.content;

    if (
      result.finishReason === "tool_calls" &&
      result.toolCalls.length > 0
    ) {
      currentMessages.push({
        role: "assistant",
        content: null,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      for (const tc of result.toolCalls) {
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = JSON.parse(tc.arguments || "{}");
        } catch {
          /* empty */
        }

        const toolCallRecord = {
          tool_name: tc.name,
          arguments: tc.arguments,
          status: "running" as string,
          result_summary: null as string | null,
        };
        allToolCalls.push(toolCallRecord);

        emit("tool_call_start", {
          tool_name: tc.name,
          arguments: tc.arguments,
        });

        const toolResult = await executeTool(
          ctx,
          tc.name,
          parsedArgs,
          userId,
          emit,
          llmConfig,
          orgId,
        );

        currentMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult,
        });

        const resultSummary = getResultSummary(tc.name, toolResult);
        toolCallRecord.status = "completed";
        toolCallRecord.result_summary = resultSummary;

        emit("tool_call_complete", {
          tool_name: tc.name,
          result_summary: resultSummary,
        });
      }

      continue;
    }

    break;
  }

  // Store assistant message
  if (fullResponse) {
    await ctx.runMutation(internal.chat.internals.addMessage, {
      threadId,
      role: "assistant",
      content: fullResponse,
      toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
    });
  }

  // Generate title for new threads
  if (isFirstExchange && fullResponse) {
    try {
      const title = await generateTitle(
        content,
        fullResponse,
        apiKey,
        llmBaseUrl,
        llmModel,
      );
      if (title) {
        await ctx.runMutation(
          internal.chat.internals.updateThreadTitle,
          { threadId, title },
        );
        emit("thread_title", { title });
      }
    } catch {
      // Title generation failure must never break chat
    }
  }

  emit("done");
}

/**
 * Build an SSE streaming Response from an async chat function.
 */
function buildStreamingResponse(
  chatFn: (emit: (type: string, data?: Record<string, any>) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function emit(type: string, data: Record<string, any> = {}) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`),
        );
      }

      try {
        await chatFn(emit);
      } catch (e: any) {
        emit("error", { error: e.message ?? "Unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

// ─── Admin Chat HTTP Action (Clerk auth) ─────────────────────────

const chat = httpAction(async (ctx, request) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }
  const userId = identity.subject;

  let body: { threadId: string; content: string; orgId?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const { threadId, content, orgId } = body;
  if (!threadId || !content) {
    return jsonResponse({ error: "threadId and content are required" }, 400);
  }

  // Verify thread access (by orgId if provided, else userId)
  const thread = await ctx.runQuery(internal.chat.internals.getThread, {
    threadId: threadId as any,
  });
  if (!thread) {
    return jsonResponse({ error: "Thread not found" }, 404);
  }
  if (orgId) {
    if (thread.orgId !== orgId) {
      return jsonResponse({ error: "Thread not found" }, 404);
    }
  } else if (thread.userId !== userId) {
    return jsonResponse({ error: "Thread not found" }, 404);
  }

  return buildStreamingResponse((emit) =>
    runChatLoop({
      ctx,
      userId,
      orgId,
      threadId: threadId as any,
      content,
      emit,
    }),
  );
});

// ─── External Chat API (API key auth) ────────────────────────────

const externalChat = httpAction(async (ctx, request) => {
  const auth = await authenticateApiKey(ctx, request);
  if (!auth) {
    return jsonResponse({ error: "Invalid or missing API key" }, 401);
  }

  let body: { externalUserId: string; content: string; threadId?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const { externalUserId, content, threadId } = body;
  if (!externalUserId || !content) {
    return jsonResponse(
      { error: "externalUserId and content are required" },
      400,
    );
  }

  // Prefix the external user ID to keep threads separate from admin
  const threadUserId = `ext_${externalUserId}`;
  // Use org-scoped search (orgId from API key record)
  const searchOrgId = auth.orgId;
  const searchUserId = auth.ownerUserId;

  let resolvedThreadId: any;

  if (threadId) {
    // Verify thread ownership
    const thread = await ctx.runQuery(internal.chat.internals.getThread, {
      threadId: threadId as any,
    });
    if (!thread || thread.userId !== threadUserId) {
      return jsonResponse({ error: "Thread not found" }, 404);
    }
    resolvedThreadId = threadId as any;
  } else {
    // Create new thread (stamp with orgId)
    resolvedThreadId = await ctx.runMutation(
      internal.chat.internals.createThread,
      { userId: threadUserId, orgId: searchOrgId },
    );
  }

  return buildStreamingResponse((emit) => {
    if (!threadId) {
      emit("thread_created", { threadId: resolvedThreadId });
    }

    return runChatLoop({
      ctx,
      userId: searchUserId,
      orgId: searchOrgId,
      threadId: resolvedThreadId,
      content,
      emit,
    });
  });
});

// ─── External: List Threads ──────────────────────────────────────

const externalListThreads = httpAction(async (ctx, request) => {
  const auth = await authenticateApiKey(ctx, request);
  if (!auth) {
    return jsonResponse({ error: "Invalid or missing API key" }, 401);
  }

  const url = new URL(request.url);
  const externalUserId = url.searchParams.get("externalUserId");
  if (!externalUserId) {
    return jsonResponse({ error: "externalUserId query param required" }, 400);
  }

  const threadUserId = `ext_${externalUserId}`;
  const threads = await ctx.runQuery(
    internal.chat.internals.listThreadsByUser,
    { userId: threadUserId },
  );

  return jsonResponse({
    threads: threads.map((t: any) => ({
      threadId: t._id,
      title: t.title,
      createdAt: t._creationTime,
    })),
  });
});

// ─── External: Get Thread Messages ───────────────────────────────

const externalGetMessages = httpAction(async (ctx, request) => {
  const auth = await authenticateApiKey(ctx, request);
  if (!auth) {
    return jsonResponse({ error: "Invalid or missing API key" }, 401);
  }

  const url = new URL(request.url);
  const threadId = url.searchParams.get("threadId");
  const externalUserId = url.searchParams.get("externalUserId");

  if (!threadId || !externalUserId) {
    return jsonResponse(
      { error: "threadId and externalUserId query params required" },
      400,
    );
  }

  const threadUserId = `ext_${externalUserId}`;

  // Verify thread ownership
  const thread = await ctx.runQuery(internal.chat.internals.getThread, {
    threadId: threadId as any,
  });
  if (!thread || thread.userId !== threadUserId) {
    return jsonResponse({ error: "Thread not found" }, 404);
  }

  const messages = await ctx.runQuery(
    internal.chat.internals.getThreadMessages,
    { threadId: threadId as any },
  );

  return jsonResponse({ messages });
});

// ─── CORS Preflight Handlers ─────────────────────────────────────

const corsOptions = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
});

const corsOptionsV1 = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
});

// ─── Router ──────────────────────────────────────────────────────

const http = httpRouter();

// Admin chat (Clerk auth)
http.route({ path: "/api/chat", method: "POST", handler: chat });
http.route({ path: "/api/chat", method: "OPTIONS", handler: corsOptions });

// External API (API key auth)
http.route({ path: "/api/v1/chat", method: "POST", handler: externalChat });
http.route({ path: "/api/v1/chat", method: "OPTIONS", handler: corsOptionsV1 });
http.route({ path: "/api/v1/threads", method: "GET", handler: externalListThreads });
http.route({ path: "/api/v1/threads", method: "OPTIONS", handler: corsOptionsV1 });
http.route({ path: "/api/v1/thread-messages", method: "GET", handler: externalGetMessages });
http.route({ path: "/api/v1/thread-messages", method: "OPTIONS", handler: corsOptionsV1 });

export default http;
