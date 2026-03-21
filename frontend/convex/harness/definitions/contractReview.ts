/**
 * Contract Review Harness — 7-phase contract analysis workflow.
 *
 * Phases:
 * 1. Classify Contract — identify type, parties, dates
 * 2. Extract Clauses — extract key clauses with categories
 * 3. Assess Risk — per-clause risk assessment (batch)
 * 4. Generate Redlines — proposed language for YELLOW/RED clauses (batch)
 * 5. Validate — cross-check consistency
 * 6. Executive Summary — final risk report
 */
import type { HarnessDefinition } from "../types";

export const contractReviewHarness: HarnessDefinition = {
  type: "contract_review",
  name: "Contract Review",
  description: "Multi-phase contract analysis with clause extraction, risk assessment, and redline generation",

  phases: [
    // Phase 0: Classify Contract
    {
      name: "Classify Contract",
      description: "Identify contract type, parties, key dates, and governing law",
      type: "llm_single",
      systemPromptTemplate: `You are a contract classification specialist. Analyze the provided contract and extract structured information.

You MUST respond with a JSON object containing:
{
  "contract_type": "string (e.g., 'Employment Agreement', 'NDA', 'SaaS Agreement', 'Lease')",
  "parties": [{"name": "string", "role": "string (e.g., 'Employer', 'Employee', 'Licensor')"}],
  "effective_date": "string or null",
  "expiration_date": "string or null",
  "governing_law": "string or null",
  "key_characteristics": ["string"],
  "confidence": "HIGH | MEDIUM | LOW"
}

Respond ONLY with the JSON object, no other text.`,
      workspaceOutput: "classification.json",
    },

    // Phase 1: Extract Clauses
    {
      name: "Extract Clauses",
      description: "Extract all key clauses with categories and section references",
      type: "llm_single",
      systemPromptTemplate: `You are a contract clause extraction specialist.

Previous classification: $phase_0_output

Extract all key clauses from the contract. For each clause, identify:
- The category (e.g., "Termination", "Indemnification", "Limitation of Liability", "Confidentiality", "IP Assignment", "Non-Compete", "Payment Terms")
- The section reference (e.g., "Section 5.2", "Article III")
- The verbatim clause text

Respond with JSON:
{
  "clauses": [
    {
      "category": "string",
      "title": "string",
      "text": "string (verbatim clause text)",
      "section_ref": "string",
      "clause_ref": "string (unique reference like 'clause_1')"
    }
  ]
}

Respond ONLY with the JSON object.`,
      workspaceOutput: "clauses.json",
    },

    // Phase 2: Assess Risk (Batch — one call per clause)
    {
      name: "Assess Risk",
      description: "Evaluate each clause for risk level and concerns",
      type: "llm_batch_agents",
      batchItemsKey: "clauses",
      systemPromptTemplate: `You are a contract risk assessment specialist.

Assess the risk of the following clause. Consider:
- Standard market terms vs. unusual provisions
- One-sided language favoring one party
- Missing protections or limitations
- Ambiguous language that could be exploited

Respond with JSON:
{
  "clause_ref": "string",
  "category": "string",
  "risk_level": "GREEN | YELLOW | RED",
  "rationale": "string (1-2 sentences explaining the risk assessment)",
  "concerns": ["string"],
  "suggested_language": "string or null (proposed improvement for YELLOW/RED items)"
}

Respond ONLY with the JSON object.`,
      workspaceOutput: "risk-assessment.json",
    },

    // Phase 3: Generate Redlines (Batch — YELLOW/RED only)
    {
      name: "Generate Redlines",
      description: "Propose alternative language for high-risk clauses",
      type: "llm_batch_agents",
      batchItemsKey: "assessments",
      batchFilter: "yellow_red",
      systemPromptTemplate: `You are a contract redlining specialist.

For the following clause that has been flagged as risky, generate a proposed redline (alternative language) that:
- Addresses the identified concerns
- Maintains the commercial intent
- Uses market-standard language
- Protects both parties more equitably

Respond with JSON:
{
  "clause_ref": "string",
  "original_text": "string",
  "proposed_text": "string",
  "risk_level": "YELLOW | RED",
  "rationale": "string (why this change improves the contract)"
}

Respond ONLY with the JSON object.`,
      workspaceOutput: "redlines.json",
    },

    // Phase 4: Validate
    {
      name: "Validate Consistency",
      description: "Cross-check all redlines for conflicts and consistency",
      type: "llm_single",
      systemPromptTemplate: `You are a contract consistency reviewer.

Review the following risk assessments and proposed redlines for:
1. Internal consistency — do any proposed changes conflict with each other?
2. Completeness — are there any high-risk areas that were missed?
3. Practicality — are the proposed changes commercially reasonable?

Prior results:
$prior_results

Respond with JSON:
{
  "is_consistent": true/false,
  "conflicts": [{"clause_refs": ["string"], "description": "string"}],
  "missing_areas": ["string"],
  "recommendations": ["string"]
}

Respond ONLY with the JSON object.`,
      workspaceOutput: "validation.json",
    },

    // Phase 5: Executive Summary
    {
      name: "Executive Summary",
      description: "Generate final risk assessment report with key findings and recommendations",
      type: "llm_single",
      systemPromptTemplate: `You are a senior contract review partner preparing an executive summary.

Based on the complete contract review, generate a comprehensive executive summary.

Prior results:
$prior_results

Respond with JSON:
{
  "overall_risk": "LOW | MODERATE | HIGH | CRITICAL",
  "recommendation": "string (1-2 sentence recommendation — e.g., 'Proceed with modifications' or 'Reject and renegotiate')",
  "key_findings": [
    {
      "finding": "string",
      "severity": "LOW | MEDIUM | HIGH",
      "action_required": "string"
    }
  ],
  "risk_breakdown": {
    "green_count": number,
    "yellow_count": number,
    "red_count": number
  },
  "detailed_report": "string (markdown-formatted detailed report with sections for each major finding)"
}

Respond ONLY with the JSON object.`,
      workspaceOutput: "executive-summary.json",
    },
  ],
};
