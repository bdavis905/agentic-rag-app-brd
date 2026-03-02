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
