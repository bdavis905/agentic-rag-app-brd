import type { Doc, Id } from "../../convex/_generated/dataModel";

// Convex document types — the canonical shape from the database
export type ConvexDocument = Doc<"documents"> & {
  action?: "created" | "skipped" | "updated";
};
export type ConvexFolder = Doc<"folders">;

// Re-export ID type for convenience
export type { Id };

// Legacy type aliases for api.ts stubs (will be removed when api.ts is fully replaced)
export type Document = ConvexDocument;
export type Folder = ConvexFolder;

// Legacy types used by chat components (Phase 5 will replace these)
export interface Thread {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  tool_calls?: ToolCallInfo[] | null;
}

export interface MetadataFieldDefinition {
  name: string;
  type: "string" | "list" | "enum" | "number" | "boolean";
  required: boolean;
  description: string;
  enum_values?: string[];
}

export interface ToolCallInfo {
  tool_name: string;
  arguments: string;
  status: "running" | "completed" | "error";
  result_summary?: string;
}

export interface ExplorerToolCall {
  tool_name: string;
  arguments: Record<string, any>;
  round: number;
  result_summary?: string;
  status: "running" | "completed";
}

export interface SubAgentState {
  active: boolean;
  mode: "analyze" | "explore";
  documentId?: string;
  filename?: string;
  researchQuery?: string;
  explorerToolCalls?: ExplorerToolCall[];
  reasoning: string;
  status: "running" | "completed" | "error";
}

// ─── Deep Mode Types ──────────────────────────────────────────

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  position: number;
}

export interface WorkspaceFile {
  id: string;
  filePath: string;
  contentType: string;
  source: "agent" | "user" | "harness";
  sizeBytes: number;
  storageId: string | null;
}

// ─── Harness Types ────────────────────────────────────────────

export interface HarnessToolCall {
  toolCallId?: string;
  toolName: string;
  arguments: string;
  result?: string;
  status: "running" | "completed";
}

export interface HarnessSubAgent {
  subAgentId: string;
  clauseRef: string;
  description: string;
  status: "running" | "completed" | "error";
  toolCalls: HarnessToolCall[];
  result?: string;
}

export interface HarnessBatchProgress {
  current: number;
  total: number;
  processed: number;
}

export interface HarnessPhaseState {
  phaseIndex: number;
  phaseName: string;
  phaseDescription: string;
  status: "pending" | "running" | "completed" | "error" | "cancelled";
  resultMarkdown: string;
  toolCalls: HarnessToolCall[];
  error?: string;
  streamingText?: string;
  agentRound?: number;
  agentMaxRounds?: number;
  subAgents?: HarnessSubAgent[];
  batchProgress?: HarnessBatchProgress;
  isHumanInput?: boolean;
}

export interface HarnessRun {
  id: string;
  threadId: string;
  harnessType: string;
  status: "running" | "completed" | "failed" | "paused";
  currentPhase: number;
  phaseResults?: Record<string, any>;
}
