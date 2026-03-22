/**
 * Creative Strategist Harness -- Phase 1 (Phases 0-3)
 *
 * Automates the media buying creative strategy workflow:
 * 0. Context Retrieval -- RAG search for brand, offer, ICP, compliance, winners
 * 1. Performance Intel -- Synthesize winners, fatigue signals, phase analytics
 * 2. Coverage Gap Analysis -- Map creative grid, identify untested segments/angles
 * 3. Creative Brief -- Generate briefs for priority gaps via Genesis autobrief-bot
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
    description: `Call a Genesis copywriting/research bot. Available bots include:
- build-a-buyer-elite- (buyer persona generation)
- pain-matrix-core-wound-bot-copy (pain mapping and core wound analysis)
- universal-mechanism-bot (unique mechanism identification)
- autobrief-bot- (structured creative brief from research inputs)
- reverse-brief (reverse-engineer a brief from a winning ad)
- ad-lottery (random creative angle generator)
- 75-ads (ad copy generation -- 75 variations)
- ad-hook-generator (hook generation)
- headline-bot-v2 (headline generation)
- microvsl (micro VSL script)
And 20+ image prompt bots.`,
    parameters: {
      type: "object",
      properties: {
        bot_slug: { type: "string", description: "The bot's slug identifier (e.g., 'autobrief-bot-')" },
        prompt: { type: "string", description: "Curated context and instructions for the bot (500-2000 words for best results)" },
        temperature: { type: "number", description: "Temperature (default 0.7). Use 0.3-0.5 for research/analysis, 0.8-0.9 for creative generation." },
      },
      required: ["bot_slug", "prompt"],
    },
  },
};

// ─── Harness Definition ─────────────────────────────────────────

export const creativeStrategistHarness: HarnessDefinition = {
  type: "creative_strategist",
  name: "Creative Strategist",
  description: "Multi-phase creative strategy workflow: context retrieval, performance intel, coverage analysis, and brief generation",

  phases: [
    // ── Phase 0: Context Retrieval ──────────────────────────────
    {
      name: "Context Retrieval",
      description: "Search the document library for brand voice, offer details, ICP, compliance rules, and existing winners",
      type: "llm_single",
      model: "openai/gpt-4o-mini",
      tools: ragTools,
      maxRounds: 10,
      systemPromptTemplate: `You are a creative strategy context retriever. Your job is to search the document library thoroughly and compile a comprehensive client context package.

You MUST make multiple search queries to cover all areas. Do not stop after one search. Be aggressive with retrieval -- the downstream phases depend entirely on the quality of context you pull.

CRITICAL RULES:
- You are ONLY retrieving context. Do NOT write ads, copy, or briefs. That happens in later phases.
- Your ONLY job is to search documents and compile findings into the JSON schema below.
- Only use the tools provided: search_documents, ls, tree, grep, glob, read. Do NOT call any other tools.
- You MUST respond with ONLY the JSON object at the end. No other text, no analysis, no recommendations.

## Retrieval Strategy

Execute these searches in order. Use different query phrasings for each area:

### 1. Brand Voice & DNA
- Search for: brand voice, brand guidelines, tone, messaging, brand DNA, style guide
- Look for: signature phrases, do/don't lists, brand personality traits

### 2. Offer Details
- Search for: offer, product, pricing, mechanism, guarantee, bonuses, value proposition
- Look for: what they sell, how it works, pricing structure, unique mechanism, proof points, CTAs

### 3. ICP / Audience Segments
- Search for: ICP, ideal customer, avatar, audience, segments, demographics, psychographics
- Look for: who they serve, pain points, desires, objections, awareness levels, language they use

### 4. Compliance & Creative Guidelines
- Search for: compliance, legal, disclaimers, prohibited, creative rules, ad guidelines
- Look for: what you can't say, required disclaimers, platform-specific rules

### 5. Existing Winners & Performance
- Search for: winners, top performing, best ads, winning creative, results
- Look for: what's working, creative patterns, which segments respond, common hooks

### 6. Competitors & Market
- Search for: competitors, market, competitive, landscape, alternatives
- Look for: who else is advertising, their messaging, differentiation points

After all searches, compile your findings into the structured JSON output below.

## Output Format

Respond with a JSON object:
{
  "brand": {
    "name": "string",
    "voice": "string (2-3 sentences describing the brand voice)",
    "tone": "string",
    "signature_phrases": ["string"],
    "visual_style": "string"
  },
  "offer": {
    "product": "string",
    "mechanism": "string (the unique mechanism or approach)",
    "price": "string",
    "guarantee": "string",
    "proof_points": ["string"],
    "cta": "string"
  },
  "segments": [
    {
      "name": "string",
      "demographics": "string",
      "core_pain": "string",
      "core_desire": "string",
      "awareness_level": "string",
      "language_patterns": ["string (actual phrases/words they use)"],
      "objections": ["string"]
    }
  ],
  "compliance": {
    "prohibited_claims": ["string"],
    "required_disclaimers": ["string"],
    "platform_rules": ["string"]
  },
  "creative_guidelines": {
    "visual_style": "string",
    "do": ["string"],
    "dont": ["string"]
  },
  "winners_summary": {
    "top_performers": [
      {
        "name": "string",
        "concept": "string",
        "angle": "string",
        "segment": "string",
        "why_it_works": "string"
      }
    ],
    "common_patterns": ["string"]
  },
  "sources_used": ["string (document names you pulled from)"]
}

IMPORTANT: Every field must be populated with REAL data from the documents, not placeholders. If you can't find information for a section, note "NOT FOUND IN DOCUMENTS" so downstream phases know to work around the gap.`,
      workspaceOutput: "client-context.json",
    },

    // ── Phase 1: Performance Intel ──────────────────────────────
    {
      name: "Performance Intel",
      description: "Synthesize ad performance data into a structured intel report",
      type: "llm_single",
      model: "openai/gpt-4o-mini",
      tools: ragTools,
      maxRounds: 6,
      systemPromptTemplate: `You are a performance intel synthesizer for Facebook ads. Your job is to search for and analyze all available performance data in the document library.

Search for performance data documents -- these may be titled things like "winners", "performance", "phase analytics", "ad metrics", "campaign data", "Adzara", "results".

CRITICAL RULES:
- You are ONLY synthesizing performance data. Do NOT write ads or copy.
- Only use the tools provided: search_documents, ls, tree, grep, glob, read. Do NOT call any other tools.
- You MUST respond with ONLY the JSON object. No other text.

Also reference the client context from the prior phase:
$phase_0_output

## What to Extract

For each ad you find performance data on:
- Ad name and copy snippet
- CPR (cost per result), CTR, spend, days running
- Which segment and concept it maps to
- Current phase status (P1 testing, P3 scaling, etc.)
- Any fatigue signals (rising CPR, dropping CTR)

## Output Format

Respond with a JSON object:
{
  "winners": [
    {
      "name": "string",
      "copy_snippet": "string (first 50 words)",
      "cpr": 0,
      "ctr": 0,
      "spend": 0,
      "days_running": 0,
      "segment": "string",
      "concept": "string",
      "angle": "string",
      "style": "string",
      "status": "string (winner/scaling/testing)"
    }
  ],
  "testing": [
    {
      "name": "string",
      "early_signal": "string (promising/neutral/poor)",
      "cpr": 0,
      "days_in_test": 0,
      "recommendation": "string"
    }
  ],
  "fatigue_alerts": [
    {
      "name": "string",
      "signal": "string (describe the fatigue pattern)",
      "severity": "string (low/medium/high)",
      "days_since_peak": 0
    }
  ],
  "overall": {
    "total_spend_period": "string",
    "avg_cpr": 0,
    "best_cpr": 0,
    "trend": "string (improving/stable/declining)",
    "active_ad_count": 0,
    "winner_count": 0
  },
  "data_quality": "string (describe what data was available and any gaps)"
}

If no performance data is found in the document library, return the structure with empty arrays and note "No performance data found" in data_quality. The coverage analysis can still proceed using client context alone.`,
      workspaceOutput: "intel-report.json",
    },

    // ── Phase 2: Coverage Gap Analysis ──────────────────────────
    {
      name: "Coverage Gap Analysis",
      description: "Map the creative grid and identify untested segments, awareness levels, concepts, and angles",
      type: "llm_single",
      model: "anthropic/claude-opus-4",
      systemPromptTemplate: `You are a creative coverage strategist. You analyze the full creative landscape and identify gaps in ad coverage using the Creative Strategist Flywheel framework.

## Input Data

Client context:
$phase_0_output

Performance intel:
$phase_1_output

## The Creative Coverage Grid

Every ad lives at the intersection of: Segments x Awareness Levels x Concepts x Angles x Styles

### Awareness Levels (5)
| Level | Their State | Your Job |
|-------|------------|----------|
| Unaware | Doesn't know they have a problem | Interrupt, make them realize something is off |
| Problem-Aware | Knows something is wrong | Name the real enemy, validate, teach the mechanism |
| Solution-Aware | Knows solutions exist, comparing | Explain why your mechanism is different |
| Product-Aware | Knows your product, hasn't bought | Address every objection, prove it works |
| Most-Aware | Ready to buy, needs reason NOW | Urgency, scarcity, risk removal |

### Concept Meta-Categories (5 - C.A.S.H.E.)
| Category | What It Contains |
|----------|-----------------|
| Attention | Things in the cultural zeitgeist that grab focus |
| Belief | Shifting what someone currently believes |
| Constraint | What's actually stopping them from acting |
| Desire | Deep emotional desire underneath the surface want |
| Excuse | Stories they tell themselves about why they can't/won't act |

### Angle Types (25)
Paradox, Forgotten Answer, Conspiracy, Warning Sign, Everyday Threat, Story, Big Win, Deep Fear, Simple Call-Out, Sacred Cow, Credentialed Expert, Hidden Truth, Myth Buster, Outsider Expert, Head-to-Head, Experiment, Confession, Permission, Personalization, Dare, Countdown, Movement, Underdog, Reluctant Endorsement, Vindication

### Style Types
Static: Ugly Ad, Bold Statement, Fake Post, Phone Screenshot, Product Hero, Carousel
Video: Real Person, Expert on Camera, Founder on Camera, Show-and-Tell, Text Video, Raw Clip, Conversation, Reaction

## Your Task

1. **Define the segments** based on the client context (3-5 segments)
2. **Build the grid** -- map Segments x Awareness Levels (this creates your cells)
3. **Map existing coverage** -- place each winning/active ad into its grid cell
4. **Identify gaps** -- find untested cells and score them by priority
5. **Run S.T.O.R.M.I.N.G. audit** -- check if creative ideas are coming from diverse sources

### Gap Priority Scoring
Priority = (market size of segment) x (awareness level opportunity) x (novelty of angle)
- High priority: Large segment + underserved awareness level + untested concept category
- Low priority: Niche segment + already well-covered awareness level

### S.T.O.R.M.I.N.G. Sources Check
S = Swipes (competitor ads), T = Templates (proven structures), O = Organic (creator hooks), R = Research (comments, reviews), M = Matrix (this grid), I = Internal (mining own winners), N = New formats, G = Gambits (wild cards)

## Output Format

Respond with a JSON object:
{
  "segments": [
    {
      "letter": "A",
      "name": "string",
      "demographics": "string",
      "core_pain": "string",
      "core_desire": "string",
      "estimated_size": "string (large/medium/small)"
    }
  ],
  "grid": {
    "total_cells": 0,
    "covered_cells": 0,
    "coverage_percentage": 0
  },
  "existing_coverage": [
    {
      "ad_name": "string",
      "segment": "string",
      "awareness": "string",
      "concept_category": "string",
      "angle": "string",
      "style": "string"
    }
  ],
  "gaps": [
    {
      "rank": 1,
      "segment": "string",
      "awareness_level": "string",
      "recommended_concept": "string",
      "recommended_angle": "string",
      "recommended_style": "string",
      "priority_score": "string (high/medium/low)",
      "rationale": "string (why this gap matters)"
    }
  ],
  "storming_audit": {
    "sources_used": ["string"],
    "sources_missing": ["string"],
    "recommendation": "string"
  },
  "tier_1_plan": {
    "description": "One thin coat: test one ad per untested cell with best-guess concept",
    "total_ads_needed": 0,
    "priority_order": ["string (gap descriptions in order)"]
  }
}

Focus on the TOP 10 gaps. Don't try to fill every cell -- prioritize the highest-impact untested combinations.`,
      workspaceOutput: "coverage-analysis.json",
    },

    // ── Phase 3: Brief Orchestrator ─────────────────────────────
    {
      name: "Creative Brief Generation",
      description: "Generate creative briefs for priority gaps using Genesis autobrief-bot",
      type: "llm_single",
      model: "anthropic/claude-opus-4",
      tools: [genesisBotTool],
      maxRounds: 8,
      systemPromptTemplate: `You are a creative brief orchestrator. Your job is to take the top priority gaps from the coverage analysis and generate detailed creative briefs using the Genesis autobrief-bot.

## Input Data

Client context:
$phase_0_output

Coverage analysis with gaps:
$phase_2_output

## Your Workflow

For the TOP 3-5 priority gaps:

1. **Curate a focused prompt** (500-2000 words) for the Genesis autobrief-bot that includes:
   - Brand name, voice, and tone
   - The specific segment being targeted (demographics, pains, desires, language)
   - The awareness level and what that means for the ad approach
   - The recommended concept and angle from the coverage analysis
   - The offer details (product, mechanism, price, proof)
   - Any compliance constraints
   - Examples of what's already working (winners) for context

2. **Call the Genesis bot** using call_genesis_bot with bot_slug "autobrief-bot-"
   - Temperature: 0.7 for balanced briefs
   - The prompt should be rich with context -- the bot performs better with more specific inputs

3. **Structure the output** into the brief schema below

## Brief Prompt Template

When calling autobrief-bot-, structure your prompt like this:

"You are writing a creative brief for a Facebook ad.

BRAND: [name, voice, tone]
PRODUCT: [what it is, mechanism, price]
TARGET SEGMENT: [name] -- [demographics, core pain, core desire]
AWARENESS LEVEL: [level] -- [what this means for the ad]
CONCEPT: [recommended concept] -- [why this concept for this segment+awareness]
ANGLE: [recommended angle] -- [how to deliver the concept]
STYLE: [recommended style]

WINNERS FOR REFERENCE: [brief descriptions of what's already working]

COMPLIANCE: [any restrictions]

Write a complete creative brief that a copywriter could use to write this ad."

## Output Format

Respond with a JSON object:
{
  "briefs": [
    {
      "id": "brief-1",
      "gap": {
        "segment": "string",
        "awareness_level": "string",
        "concept": "string",
        "angle": "string",
        "style": "string"
      },
      "target_segment": {
        "name": "string",
        "demographics": "string",
        "pains": ["string"],
        "desires": ["string"],
        "language": ["string (words/phrases this segment uses)"]
      },
      "awareness_level": "string",
      "concept_category": "string",
      "specific_concept": "string",
      "angle": "string",
      "style": "string",
      "hook_direction": "string (the opening hook approach)",
      "body_structure": "string (how the ad body should flow)",
      "visual_direction": "string (what the image/video should show)",
      "cta_approach": "string",
      "genesis_bot_used": "string (bot slug)",
      "genesis_raw_output": "string (the full bot response)"
    }
  ],
  "summary": {
    "total_briefs": 0,
    "segments_covered": ["string"],
    "awareness_levels_covered": ["string"],
    "next_steps": "string (what Phase 2 build will do with these briefs)"
  }
}

IMPORTANT: Each brief must be specific enough that a copywriter could write the full ad from it. Vague briefs are useless. Include concrete hook directions, body structure, and visual concepts.`,
      workspaceOutput: "creative-briefs.json",
    },
  ],
};
