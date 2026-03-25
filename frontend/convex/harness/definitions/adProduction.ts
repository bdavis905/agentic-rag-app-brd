/**
 * Ad Production Harness -- Facebook Ad Copy + Image Concepts
 *
 * Produces publish-ready Facebook ad packages from creative briefs.
 * Output format matches Adzara's publishFromExternal API:
 *   - 5 primary text variations (hook + body)
 *   - 5 headlines (under 40 chars)
 *   - 1 description
 *
 * Phase 0: Copy Production -- write-like-luke-bot for Facebook ad copy
 * Phase 1: Image Concepts -- Genesis image prompt bots
 */
import type { HarnessDefinition } from "../types";

const genesisBotTool = {
  type: "function",
  function: {
    name: "call_genesis_bot",
    description: `Call a Genesis copywriting bot. Key bots for Facebook ad copy production:

COPY BOTS:
- write-like-luke-bot: Primary copy bot. Writes compelling direct-response Facebook ad copy in Luke's style. Use this for ALL primary text generation. Call once per brief.
- ad-hook-bot-1: Generate ad hooks specifically (Opus-powered). Use ONLY if you need additional hook variety beyond what write-like-luke-bot provides.
- headline-bot-v2: Generate punchy headlines under 40 characters. Use ONLY if you need additional headline variety.

IMPORTANT: Do NOT call write-like-luke-bot more than once per brief. If the first call returns good copy, use it. Do not retry or call alternative bots.

IMAGE PROMPT BOTS:
- universal-static-bot: Recommends best image format, call FIRST before specific image bots
- bold-typography-bot: Bold text overlay images
- hero-bot-: Hero/product images
- comparison-bot: Before/after comparison images
- testimonial-bot-: Testimonial-style images
- infographic-bot-: Infographic ads
- meme-style-ad-concept-generator-bot: Meme-format ads
- lo-fi-ad-concept-generator-bot: Lo-fi native-looking ads
- native-news-bot-: Native news-style ads
- holding-sign-bot: Person holding sign
- note-from-founder-bot-: Note from founder style
- screenshotchatnotification-transformer-bot: Chat/notification style
- unaware-static-image-ads-bot: Final 9:16 image prompts`,
    parameters: {
      type: "object",
      properties: {
        bot_slug: { type: "string", description: "The bot's slug identifier" },
        prompt: { type: "string", description: "Curated context and instructions (500-2000 words for best results)" },
        temperature: { type: "number", description: "Temperature. Use 0.7-0.9 for creative generation." },
      },
      required: ["bot_slug", "prompt"],
    },
  },
};

const imageGenTool = {
  type: "function",
  function: {
    name: "generate_image",
    description: "Generate an image using AI (Nano Banana Pro / Gemini 3 Pro Image). Pass the complete image generation prompt. Returns a storageId and filePath for the generated image.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The complete image generation prompt" },
        brief_id: { type: "string", description: "Brief ID for file naming (e.g., 'legacy-builders-problem-aware')" },
        aspect_ratio: { type: "string", enum: ["1:1", "4:5", "9:16", "16:9"], description: "Image aspect ratio (default: 1:1)" },
        resolution: { type: "string", enum: ["1K", "2K"], description: "Image resolution (default: 1K)" },
      },
      required: ["prompt", "brief_id"],
    },
  },
};

// ─── Harness Definition ─────────────────────────────────────────

export const adProductionHarness: HarnessDefinition = {
  type: "ad_production",
  name: "Ad Production",
  description: "Produce Facebook ad copy and image concepts from creative briefs",

  phases: [
    // ── Phase 0: Copy Production ────────────────────────────────
    {
      name: "Copy Production",
      description: "Generate Facebook ad copy for each creative brief using write-like-luke-bot",
      type: "llm_single",
      model: "anthropic/claude-opus-4.6",
      tools: [genesisBotTool],
      maxRounds: 12,
      workspaceInputs: ["creative-briefs.json"],
      foundationInputs: ["build-a-buyer", "pain-matrix", "copy-blocks", "offer-brief", "voice-profile"],
      systemPromptTemplate: `You are a Facebook ad copy production engine. Your job is to take creative briefs and produce COMPLETE, PUBLISH-READY Facebook ad copy using the write-like-luke-bot Genesis bot.

## CRITICAL: This is Facebook Ad Copy, NOT Video Scripts

You are producing Facebook/Instagram feed ad copy — the text that appears above the image in a Facebook ad. This is NOT a video script, NOT a talking head script, NOT a VSL. It is direct-response primary text copy.

## What You're Producing (Per Brief)

For EACH brief, you must produce a complete Facebook ad package:

### 1. Primary Texts (5 variations)
Each primary text is a COMPLETE, standalone Facebook ad. It includes:
- A scroll-stopping hook (first 1-2 lines visible before "See more")
- Body copy that builds desire and overcomes objections
- A clear call-to-action

The 5 variations should use DIFFERENT hooks and angles — not word swaps of the same hook. Each should be a genuinely different approach to the same brief's concept/angle.

Facebook users see only the first ~125 characters before "See more". The hook MUST create enough curiosity to get the click.

### 2. Headlines (5 variations)
Short, punchy headlines that appear below the image in the ad. These are the bold text the user sees.
- MUST be under 40 characters each (Facebook truncates longer headlines)
- Should complement the primary text, not repeat it
- Action-oriented or benefit-driven

### 3. Description (1)
A short secondary phrase (3-6 words) that appears below the headline.
Examples: "Free Training Available", "Limited Spots", "Watch Now", "Claim Your Spot"

## Why This Format Matters

This output feeds directly into the Adzara publishing system which creates Facebook ads using Meta's Advantage+ DEGREES_OF_FREEDOM optimization. Meta will test all 5 primary texts × 5 headlines × 1 description and find the best-performing combination automatically. That's why you need genuinely different variations — if they're too similar, Meta can't optimize.

## Your Workflow

For EACH brief in the input:

1. Read the brief carefully — segment, awareness level, concept, angle, style
2. Curate a detailed prompt (500-2000 words) for write-like-luke-bot that includes:
   - EXPLICITLY state you need Facebook ad primary text copy (NOT a video script)
   - Request 5 different primary text variations with different hooks
   - The specific brief details (segment, awareness, concept, angle)
   - Foundation context: Build-A-Buyer insights for this segment's psychology, pain points, desires
   - Pain Matrix: core wounds and emotional triggers
   - Voice Profile: brand voice and tone guidelines
   - Copy Blocks: proven persuasive elements to weave in
   - Offer details from the Offer Brief
   - Hook direction from the brief
   - Any compliance constraints
3. Call write-like-luke-bot with the curated prompt
4. From the bot's output, extract or assemble:
   - 5 primary text variations (complete ads with hook + body + CTA)
   - 5 headlines (under 40 chars each)
   - 1 description (3-6 words)

## Prompt Template for write-like-luke-bot

"Write 5 variations of Facebook ad primary text copy for [brand name].

FORMAT: Facebook/Instagram feed ad copy (the text above the image). NOT a video script. NOT a VSL. Just the text copy.

Each variation needs:
- A different hook (first 1-2 lines — this is what shows before 'See more')
- Body copy that builds desire and handles objections
- A clear CTA

TARGET: [segment name] — [demographics]. They are [awareness level].
CORE PAIN: [from brief + Build-A-Buyer + Pain Matrix]
CORE DESIRE: [from brief + Build-A-Buyer]
CONCEPT: [concept category] — [specific concept]
ANGLE: [angle type] — [specific direction]
HOOK DIRECTION: [from brief]

OFFER: [from offer brief]
VOICE: [from voice profile]
PROVEN ELEMENTS: [from copy blocks]
COMPLIANCE: [any restrictions]

CRITICAL RULES:
- Do NOT assume or fabricate specific durations (like '20-minute masterclass'). If you don't know how long something is, say 'free training' or 'free masterclass' without a time.
- Do NOT invent prices, statistics, or guarantees not in the offer brief.
- Only use facts explicitly stated in the source materials above.
- CTAs should match the actual offer — keep them simple and factual.

Also generate 5 headline variations (under 40 characters each) and 1 short description (3-6 words)."

## Output Format

Respond with a JSON object:
{
  "ads": [
    {
      "brief_id": "string (matches brief id from creative-briefs.json)",
      "segment": "string",
      "awareness_level": "string",
      "concept": "string",
      "angle": "string",
      "genesis_bot_used": "write-like-luke-bot",
      "primaryTexts": [
        "string (complete primary text 1 — hook + body + CTA)",
        "string (complete primary text 2 — different hook)",
        "string (complete primary text 3 — different hook)",
        "string (complete primary text 4 — different hook)",
        "string (complete primary text 5 — different hook)"
      ],
      "headlines": [
        "string (headline 1 — under 40 chars)",
        "string (headline 2 — under 40 chars)",
        "string (headline 3 — under 40 chars)",
        "string (headline 4 — under 40 chars)",
        "string (headline 5 — under 40 chars)"
      ],
      "description": "string (3-6 word description)",
      "genesis_raw_output": "string (full bot response for reference)"
    }
  ],
  "summary": {
    "total_ads_produced": 0,
    "segments_covered": ["string"],
    "next_steps": "string"
  }
}

IMPORTANT:
- Each primary text must be COMPLETE and ready to paste into Facebook Ads Manager. Not outlines or frameworks — finished copy.
- Headlines MUST be under 40 characters. Count them. If over 40, rewrite shorter.
- The 5 primary texts must have genuinely DIFFERENT hooks — not word swaps of the same hook.
- Do NOT produce video scripts, talking head scripts, or VSL scripts. Only Facebook ad primary text copy.
- Call write-like-luke-bot ONCE per brief. Do NOT retry or call it again for the same brief. Use whatever the bot returns on the first call.
- Extract the primaryTexts, headlines, and description from the bot's markdown output. The bot may format them differently — parse and restructure into the JSON schema above.
- You MUST produce one ad entry per brief. If there are 3 briefs, there must be 3 entries in the ads array.

## FACT-CHECK RULES (CRITICAL)

Do NOT fabricate or assume specific facts. Only use claims that are explicitly stated in the foundation docs or offer brief. Specifically:

- **Durations/lengths**: Do NOT assume how long a webinar, masterclass, training, or course is. If the offer brief does not state a specific duration, use vague language like "free training" or "free masterclass" — never "20-minute" or "60-minute" unless the offer brief explicitly says so.
- **Prices**: Only use prices explicitly stated in the offer brief. Never invent pricing.
- **Statistics**: Only use numbers and stats that appear in the foundation docs. Do not round, exaggerate, or fabricate statistics.
- **Guarantees**: Only reference guarantees explicitly described in the offer brief.
- **Testimonial claims**: Only use results/outcomes that appear in the foundation docs.
- **CTAs**: The CTA should match what the offer actually is. If the offer is a webinar registration, say "Register Now" or "Watch the Free Training" — do not add durations or details not in the offer brief.

When in doubt, keep it vague rather than specific. "Free training" is always safer than "Free 20-minute training" when you do not know the actual duration.`,
      workspaceOutput: "ad-copy.json",
    },

    // ── Phase 1: Image Concepts ─────────────────────────────────
    {
      name: "Image Concepts",
      description: "Generate 5-10 image concepts per brief using Genesis image bots",
      type: "llm_single",
      model: "anthropic/claude-opus-4.6",
      tools: [genesisBotTool],
      maxRounds: 20,
      foundationInputs: ["build-a-buyer", "offer-brief", "voice-profile"],
      systemPromptTemplate: `You are an image concept producer for Facebook ads. Your job is to create MULTIPLE image concepts per ad — at least 5-10 per brief — so we have plenty of options to choose from.

## Ad Copy from Phase 0
$phase_0_output

## Two-Step Process Per Brief

### Step 1: Call universal-static-bot (ROUTER)

For EACH ad in the ads array, call universal-static-bot with the FULL FINISHED AD COPY. This bot analyzes the copy and recommends which format bots to use.

Your prompt to universal-static-bot MUST include:

"Here is the finished Facebook ad copy. Recommend the best static image formats for this ad. Recommend at least 3-5 different format bots.

PRIMARY TEXT (the main ad copy that will appear above the image):
[Paste the FULL primaryTexts[0] here — every word of it]

HEADLINES:
1. [headline 1]
2. [headline 2]
3. [headline 3]
4. [headline 4]
5. [headline 5]

DESCRIPTION: [description]

TARGET AUDIENCE: [segment name] — [demographics]
OFFER: [product/offer from foundation docs]

Recommend 3-5 image format bots that would work best for this copy."

The universal-static-bot will recommend specific format bots. It is a ROUTER — its output tells you which bots to call next.

### Step 2: Call 2-3 Recommended Format Bots

For each ad, call 2-3 of the recommended format bots. Each bot produces 5 concepts, so 2-3 bots = 10-15 concepts per brief.

Format bots need EXTRACTED COPY BLOCKS, not the full ad copy. Structure your prompt like:

"Create 5 static ad image concepts for a Facebook ad.

CLIENT: [brand name]
PRODUCT: [offer name / mechanism]
TARGET: [segment name — demographics]
TONE: [from voice profile]

TEXT BLOCK 1 (main hook/headline, 3-8 words): [extracted from the ad's strongest hook]
TEXT BLOCK 2 (supporting statement): [extracted secondary claim or benefit]
KEY STAT: [any specific number or data point from the copy]
CTA: [call to action]

The ad copy above this image says: [first 2 lines of primaryTexts[0] — just the hook]

Create 5 image concepts with TEXT_BLOCK_1, TEXT_BLOCK_2, visual idea, CTA, color cues, and layout notes."

### Bot Slug Reference

| Format | Bot Slug |
|--------|----------|
| Bold typography | bold-typography-bot |
| Hero/product | hero-bot- |
| Before/after | side-by-sidebefore-and-after-bot- |
| Comparison | comparison-bot |
| Testimonial | testimonial-bot- |
| Infographic | infographic-bot- |
| Meme style | meme-style-ad-concept-generator-bot |
| Lo-fi/native | lo-fi-ad-concept-generator-bot |
| News style | native-news-bot- |
| Holding sign | holding-sign-bot |
| Founder note | note-from-founder-bot- |
| Chat/notification | screenshotchatnotification-transformer-bot |

## Target Numbers

- Per brief: 5-10 image concepts minimum
- Per format bot call: expect 5 concepts back
- Call 2-3 format bots per brief
- Total across all briefs: 15-30 image concepts

## Output Format

Respond with a JSON object:
{
  "image_concepts": [
    {
      "brief_id": "string (matches ad brief_id)",
      "ad_hook": "string (the hook line this image supports)",
      "format_bot_used": "string (e.g., bold-typography-bot)",
      "concept_index": 1,
      "text_block_1": "string (main headline text for the image, 3-8 words)",
      "text_block_2": "string (supporting text for the image)",
      "visual_description": "string (detailed visual concept)",
      "cta": "string",
      "color_cue": "string (hex colors and palette)",
      "layout_notes": "string (hierarchy, spacing, typography)",
      "image_prompt": "string (complete prompt for image generation — combine visual_description + text blocks + colors + layout into one prompt)",
      "aspect_ratio": "1:1"
    }
  ],
  "summary": {
    "total_concepts": 0,
    "concepts_per_brief": {},
    "formats_used": ["string"]
  }
}

IMPORTANT:
- You MUST produce at least 5 image concepts per brief. Aim for 10.
- Call universal-static-bot ONCE per brief with the FULL AD COPY.
- Call 2-3 format bots per brief with EXTRACTED COPY BLOCKS.
- Each format bot produces 5 concepts — include ALL of them in the output.
- The image_prompt field should be a complete, self-contained prompt ready for an image generator.`,
      workspaceOutput: "image-concepts.json",
    },

    // ── Phase 2: Image Generation (Code-Driven, No LLM) ────────
    {
      name: "Image Generation",
      description: "Generate images from prompts using Kie.ai Nano Banana Pro (5 at a time)",
      type: "executor" as any,
      systemPromptTemplate: "", // Not used — executor runs code directly
      workspaceOutput: "generated-images.json",
    },
  ],
};
