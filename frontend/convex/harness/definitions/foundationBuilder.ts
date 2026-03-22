/**
 * Foundation Builder Harness -- Build persistent per-org knowledge docs
 *
 * Run once per client/org to create foundational documents that power
 * all downstream harnesses (Creative Strategist, Ad Production, etc.)
 *
 * Phase 0: Raw Context Collection -- RAG search for brand materials
 * Phase 1: Core Foundation Docs -- Genesis research bots (Build-A-Buyer, Pain Matrix, Mechanism, Offer Brief)
 * Phase 2: Extended Foundation Docs -- Genesis bots (Copy Blocks, Voice Profile)
 */
import type { HarnessDefinition } from "../types";

// ─── Shared Tool Definitions ────────────────────────────────────

const ragTools = [
  {
    type: "function",
    function: {
      name: "search_documents",
      description: "Search uploaded documents for relevant information. Use multiple searches with different queries for thorough retrieval.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          search_mode: {
            type: "string",
            enum: ["hybrid", "vector", "keyword"],
            description: "Search strategy: 'hybrid' (default), 'keyword' (exact terms), 'vector' (conceptual similarity)",
          },
        },
        required: ["query"],
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
          path: { type: "string", description: "'root' for top-level, or a folder ID" },
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
          path: { type: "string", description: "'root' or folder ID" },
          depth: { type: "integer", description: "Max depth (default 3)" },
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
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: { type: "string", description: "Scope to folder (optional)" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob",
      description: "Find documents by filename pattern (wildcards: *, ?, **).",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Filename pattern with wildcards" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description: "Read document content by ID. Returns full text or specific line range.",
      parameters: {
        type: "object",
        properties: {
          document_id: { type: "string", description: "Document ID from search/ls/glob results" },
          start_line: { type: "integer" },
          end_line: { type: "integer" },
        },
        required: ["document_id"],
      },
    },
  },
];

const genesisBotTool = {
  type: "function",
  function: {
    name: "call_genesis_bot",
    description: `Call a Genesis copywriting/research bot. Key bots for foundation building:

RESEARCH: build-a-buyer-elite- (deep buyer psychology profile), pain-matrix-core-wound-bot-copy (pain mapping and core wound identification), universal-mechanism-bot (unique mechanism/solution identification), copy-blocks-extract (extract persuasive elements from existing copy), deep-dive-voice-analyzer (voice and tone analysis from writing samples)

STRATEGY: belief-analyst-bot (map beliefs needed for conversion), outcome-engineer- (core transformation promise), master-concept-bot (complete marketing intelligence)`,
    parameters: {
      type: "object",
      properties: {
        bot_slug: { type: "string", description: "The bot's slug identifier (e.g., 'build-a-buyer-elite-')" },
        prompt: { type: "string", description: "Curated context and instructions for the bot (500-2000 words for best results)" },
        temperature: { type: "number", description: "Temperature (default 0.7). Use 0.3-0.5 for research/analysis." },
      },
      required: ["bot_slug", "prompt"],
    },
  },
};

// ─── Harness Definition ─────────────────────────────────────────

export const foundationBuilderHarness: HarnessDefinition = {
  type: "foundation_builder",
  name: "Foundation Builder",
  description: "Build persistent foundation documents for this client/org: buyer profile, pain matrix, mechanism, offer brief, copy blocks, voice profile",

  phases: [
    // ── Phase 0: Raw Context Collection ─────────────────────────
    {
      name: "Raw Context Collection",
      description: "Search the document library for brand materials, existing copy, product info, and writing samples",
      type: "llm_single",
      model: "openai/gpt-4o-mini",
      tools: ragTools,
      maxRounds: 10,
      systemPromptTemplate: `You are a research assistant collecting raw context from a document library to build foundational marketing documents. Your job is to search aggressively and compile everything relevant.

CRITICAL RULES:
- You are ONLY retrieving raw context. Do NOT analyze, strategize, or write copy.
- Make MANY searches with different queries. Do not stop after 2-3 searches.
- Use different search modes (hybrid, keyword, vector) for better coverage.
- Read full documents when you find relevant ones, not just snippets.
- You MUST respond with ONLY the JSON object at the end.

## Search Strategy

Execute ALL of these search categories. Use 2-3 different query phrasings per category:

### 1. Brand Voice & Writing Samples
- Search: brand voice, tone, style guide, brand DNA, writing samples, blog posts, newsletters
- Look for: how the brand communicates, signature phrases, personality traits, do/don't lists

### 2. Product & Offer Details
- Search: product, offer, pricing, features, benefits, mechanism, how it works, guarantee, bonuses
- Look for: what they sell, the unique mechanism, pricing tiers, guarantees, proof points

### 3. Customer/Audience Data
- Search: customer, avatar, ICP, ideal client, audience, demographics, testimonials, reviews, case studies
- Look for: who they serve, customer language, pain points, desires, outcomes, testimonials

### 4. Existing Ad Copy & Marketing
- Search: ad copy, ads, campaigns, headlines, hooks, emails, sales page, landing page, funnel
- Look for: proven copy that works, winning hooks, high-performing ads, email sequences

### 5. Competitor & Market Context
- Search: competitor, market, industry, alternatives, competitive advantage
- Look for: market positioning, differentiation, competitive landscape

### 6. Results & Proof
- Search: results, case study, testimonial, proof, ROI, outcomes, before after, success story
- Look for: concrete results, customer stories, social proof, data points

## Output Format

Respond with a JSON object:
{
  "brand_voice": {
    "samples": ["string (actual text excerpts showing voice/tone)"],
    "observations": "string (what you noticed about the voice)",
    "signature_phrases": ["string"]
  },
  "product_offer": {
    "product_name": "string",
    "description": "string",
    "mechanism": "string (the unique approach/method/system)",
    "pricing": "string",
    "guarantee": "string",
    "bonuses": ["string"],
    "key_benefits": ["string"],
    "proof_points": ["string"]
  },
  "audience": {
    "primary_segments": [
      {
        "name": "string",
        "demographics": "string",
        "pain_points": ["string (in their language)"],
        "desires": ["string (in their language)"],
        "objections": ["string"],
        "awareness_level": "string"
      }
    ],
    "customer_language": ["string (actual phrases from testimonials/reviews)"],
    "testimonials": ["string (key testimonial excerpts)"]
  },
  "existing_copy": {
    "winning_hooks": ["string"],
    "ad_copy_samples": ["string (full ad copy text)"],
    "email_samples": ["string"],
    "landing_page_copy": ["string (key sections)"]
  },
  "market_context": {
    "competitors": ["string"],
    "positioning": "string",
    "differentiation": "string"
  },
  "sources_used": ["string (document names)"],
  "data_gaps": ["string (what you couldn't find)"]
}

Populate EVERY field with real data from documents. If you can't find data for a section, note "NOT FOUND" and list what you searched for in data_gaps.`,
      workspaceOutput: "raw-context.json",
    },

    // ── Phase 1: Core Foundation Docs ───────────────────────────
    {
      name: "Core Foundation Docs",
      description: "Generate Build-A-Buyer, Pain Matrix, Mechanism, and Offer Brief using Genesis research bots",
      type: "llm_single",
      model: "anthropic/claude-opus-4.6",
      tools: [genesisBotTool],
      maxRounds: 12,
      systemPromptTemplate: `You are a foundation document builder. Your job is to take raw context and use Genesis research bots to create 4 core foundational documents.

## Raw Context
$phase_0_output

## Your Workflow

You MUST create all 4 documents by calling the appropriate Genesis bots. For each bot call, curate a detailed prompt (500-2000 words) from the raw context.

### Document 1: Build-A-Buyer Profile
Bot: build-a-buyer-elite-
Temperature: 0.5
Include in prompt: audience segments, demographics, pain points, desires, objections, customer language, testimonials, awareness levels. The more specific context you give, the better the output.

### Document 2: Pain Matrix & Core Wound
Bot: pain-matrix-core-wound-bot-copy
Temperature: 0.5
Include in prompt: customer pain points, fears, frustrations, what they've tried before, emotional language from testimonials, the deeper "core wound" underneath surface complaints.

### Document 3: Unique Mechanism
Bot: universal-mechanism-bot
Temperature: 0.5
Include in prompt: product mechanism, how it works differently, why alternatives fail, the unique approach/method/system, proof that it works, before/after outcomes.

### Document 4: Offer Brief
This one you assemble yourself (no bot needed) from the raw context. Structure it as:
- Product name and description
- Core promise / transformation
- Pricing and tiers
- Guarantee
- Bonuses
- Key proof points
- Primary CTA
- Compliance notes (if any)

## Output Format

After calling all bots, respond with a JSON object:
{
  "build_a_buyer": "string (the full Build-A-Buyer document from Genesis)",
  "build_a_buyer_source_bot": "build-a-buyer-elite-",
  "pain_matrix": "string (the full Pain Matrix document from Genesis)",
  "pain_matrix_source_bot": "pain-matrix-core-wound-bot-copy",
  "mechanism": "string (the full Mechanism document from Genesis)",
  "mechanism_source_bot": "universal-mechanism-bot",
  "offer_brief": "string (the assembled Offer Brief)",
  "summary": {
    "buyer_segments_identified": 0,
    "core_wound": "string (one-line core wound)",
    "mechanism_name": "string",
    "offer_price": "string"
  }
}

IMPORTANT: Pass RICH, DETAILED context to each bot. Don't just pass a sentence -- give them 500-2000 words of curated context from the raw research. The quality of foundation docs depends entirely on the quality of your bot prompts.`,
      workspaceOutput: "core-foundation.json",
      foundationOutputs: [
        { key: "build_a_buyer", docType: "build-a-buyer" },
        { key: "pain_matrix", docType: "pain-matrix" },
        { key: "mechanism", docType: "mechanism" },
        { key: "offer_brief", docType: "offer-brief" },
      ],
    },

    // ── Phase 2: Extended Foundation Docs ────────────────────────
    {
      name: "Extended Foundation Docs",
      description: "Generate Copy Blocks and Voice Profile using Genesis bots (if sufficient source material exists)",
      type: "llm_single",
      model: "anthropic/claude-opus-4.6",
      tools: [genesisBotTool],
      maxRounds: 8,
      systemPromptTemplate: `You are building extended foundation documents using Genesis bots. These are optional but powerful additions to the core foundation.

## Raw Context
$phase_0_output

## Core Foundation (already built)
$phase_1_output

## Your Workflow

### Document 5: Copy Blocks
Bot: copy-blocks-extract
Temperature: 0.5
Only call this if the raw context contains existing ad copy, emails, or sales page copy to extract from.
Include in prompt: all existing copy samples (ads, emails, landing page sections, headlines, hooks). The bot will extract the persuasive building blocks.

If NO existing copy samples were found in raw context, skip this and set copy_blocks to "SKIPPED - No existing copy found to extract from. Run again after uploading winning ad copy."

### Document 6: Voice Profile
Bot: deep-dive-voice-analyzer
Temperature: 0.5
Only call this if the raw context contains writing samples, blog posts, newsletters, or other brand voice examples.
Include in prompt: writing samples, brand voice observations, signature phrases, tone notes.

If NO writing samples were found, skip this and set voice_profile to "SKIPPED - No writing samples found. Run again after uploading brand content (blogs, emails, newsletters)."

## Output Format

Respond with a JSON object:
{
  "copy_blocks": "string (the full Copy Blocks document from Genesis, or SKIPPED message)",
  "copy_blocks_source_bot": "copy-blocks-extract",
  "voice_profile": "string (the full Voice Profile document from Genesis, or SKIPPED message)",
  "voice_profile_source_bot": "deep-dive-voice-analyzer",
  "summary": {
    "copy_blocks_status": "string (completed/skipped)",
    "voice_profile_status": "string (completed/skipped)",
    "recommendation": "string (what to upload to improve these docs)"
  }
}`,
      workspaceOutput: "extended-foundation.json",
      foundationOutputs: [
        { key: "copy_blocks", docType: "copy-blocks" },
        { key: "voice_profile", docType: "voice-profile" },
      ],
    },
  ],
};
