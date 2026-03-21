/**
 * Type definitions for the domain harness engine.
 *
 * A harness is a multi-phase workflow that processes data through sequential
 * LLM calls, with each phase building on the output of previous phases.
 */

export type PhaseType = "llm_single" | "llm_batch_agents";

export interface PhaseDefinition {
  /** Display name for the phase */
  name: string;
  /** Description shown in the UI */
  description: string;
  /** Execution strategy */
  type: PhaseType;
  /**
   * System prompt template. Uses $variable syntax for substitution.
   * Available variables: $contract_text, $prior_results, $phase_name,
   * and $workspace_{filename} for loaded workspace files.
   */
  systemPromptTemplate: string;
  /** Tool definitions available during this phase (OpenAI format) */
  tools?: any[];
  /** Expected output JSON structure (for documentation/validation) */
  outputSchema?: Record<string, any>;
  /** For llm_batch_agents: key in prior phase output containing items to iterate */
  batchItemsKey?: string;
  /** For llm_batch_agents: max concurrent items (sequential in MVP) */
  batchSize?: number;
  /** For llm_batch_agents: filter function name to apply to items */
  batchFilter?: string;
  /** Workspace file paths to load as context */
  workspaceInputs?: string[];
  /** Workspace file path where phase result is written */
  workspaceOutput?: string;
  /** Max LLM rounds for agent phases */
  maxRounds?: number;
}

export interface HarnessDefinition {
  /** Unique type identifier (e.g., "contract_review") */
  type: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Ordered list of phases */
  phases: PhaseDefinition[];
}

export interface PhaseResult {
  phaseIndex: number;
  phaseName: string;
  output: any;
  markdown?: string;
}
