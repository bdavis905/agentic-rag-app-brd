/**
 * API layer — chat streaming connects to Convex HTTP Action.
 * All other CRUD uses Convex hooks directly in components.
 */

// ─── Chat Streaming ─────────────────────────────────────────────

export interface SendMessageOptions {
  threadId: string;
  content: string;
  orgId?: string;
  token?: string | null;
  onTextDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  onToolCallStart?: (toolName: string, args: string) => void;
  onToolCallComplete?: (toolName: string, resultSummary?: string) => void;
  onSubAgentStart?: (documentId: string, filename: string) => void;
  onSubAgentReasoning?: (content: string) => void;
  onSubAgentComplete?: (result: string) => void;
  onSubAgentError?: (error: string) => void;
  onExplorerStart?: (researchQuery: string, startingPath: string) => void;
  onExplorerToolCall?: (
    toolName: string,
    args: Record<string, any>,
    round: number
  ) => void;
  onExplorerToolResult?: (toolName: string, resultSummary: string) => void;
  onExplorerReasoning?: (content: string) => void;
  onExplorerComplete?: (findings: string) => void;
  onExplorerError?: (error: string) => void;
  onSkillActivated?: (skillId: string, skillName: string) => void;
  onThreadTitle?: (title: string) => void;
  signal?: AbortSignal;
}

/** Derive the Convex HTTP Action URL from the deployment URL */
function getHttpUrl(): string {
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
  return convexUrl.replace(".convex.cloud", ".convex.site");
}

export async function sendMessage(options: SendMessageOptions): Promise<void> {
  const {
    threadId,
    content,
    orgId,
    token,
    onTextDelta,
    onDone,
    onError,
    onToolCallStart,
    onToolCallComplete,
    onSubAgentStart,
    onSubAgentReasoning,
    onSubAgentComplete,
    onSubAgentError,
    onExplorerStart,
    onExplorerToolCall,
    onExplorerToolResult,
    onExplorerReasoning,
    onExplorerComplete,
    onExplorerError,
    onSkillActivated,
    onThreadTitle,
    signal,
  } = options;

  const httpUrl = getHttpUrl();

  let response: Response;
  try {
    response = await fetch(`${httpUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ threadId, content, orgId }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    onError("Network error: Could not connect to server.");
    onDone();
    return;
  }

  if (!response.ok) {
    const errorData = await response
      .json()
      .catch(() => ({ error: `HTTP ${response.status}` }));
    onError(errorData.error || `HTTP ${response.status}`);
    onDone();
    return;
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        let event: any;
        try {
          event = JSON.parse(trimmed.slice(6));
        } catch {
          continue;
        }

        switch (event.type) {
          case "text_delta":
            onTextDelta(event.content ?? "");
            break;
          case "tool_call_start":
            onToolCallStart?.(event.tool_name, event.arguments ?? "");
            break;
          case "tool_call_complete":
            onToolCallComplete?.(event.tool_name, event.result_summary);
            break;
          case "sub_agent_start":
            onSubAgentStart?.(event.document_id, event.filename);
            break;
          case "sub_agent_reasoning":
            onSubAgentReasoning?.(event.content ?? "");
            break;
          case "sub_agent_complete":
            onSubAgentComplete?.(event.result ?? "");
            break;
          case "sub_agent_error":
            onSubAgentError?.(event.error ?? "");
            break;
          case "explorer_start":
            onExplorerStart?.(event.research_query, event.starting_path);
            break;
          case "explorer_tool_call":
            onExplorerToolCall?.(
              event.tool_name,
              event.arguments ?? {},
              event.round ?? 0
            );
            break;
          case "explorer_tool_result":
            onExplorerToolResult?.(event.tool_name, event.result_summary ?? "");
            break;
          case "explorer_reasoning":
            onExplorerReasoning?.(event.content ?? "");
            break;
          case "explorer_complete":
            onExplorerComplete?.(event.findings ?? "");
            break;
          case "explorer_error":
            onExplorerError?.(event.error ?? "");
            break;
          case "skill_activated":
            onSkillActivated?.(event.skill_id ?? "", event.skill_name ?? "");
            break;
          case "thread_title":
            onThreadTitle?.(event.title ?? "");
            break;
          case "done":
            onDone();
            return;
          case "error":
            onError(event.error ?? "Unknown error");
            onDone();
            return;
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    onError((err as Error).message || "Stream error");
  }

  // Stream ended without explicit done event
  onDone();
}
