/**
 * Ad Production Harness -- MVP (Phases 0-1)
 *
 * Produces ad copy and image concepts from creative briefs.
 * Reads foundation docs (org-scoped) + creative-briefs.json (workspace).
 *
 * Phase 0: Copy Production -- Genesis copy bots based on brief style
 * Phase 1: Image Concepts -- Genesis image prompt bots
 */
import type { HarnessDefinition } from "../types";

const genesisBotTool = {
  type: "function",
  function: {
    name: "call_genesis_bot",
    description: `Call a Genesis copywriting/research bot. Key bots for ad production:

COPY BOTS:
- 75-ads: Generate 75 ad variations (Opus-powered, use for static copy)
- ad-hook-bot-1: Generate ad hooks (Opus-powered)
- new-hook-bot: Alternative hook generator
- headline-bot-v2: Headlines
- microvsl: Micro VSL scripts (Opus-powered)
- direct-response-talking-head-script-bot-: 15-90 sec talking head scripts
- video-adscript-bot: 45-60 sec Meta/YouTube video scripts
- in-feed-vsl-bot: Cold traffic VSL concepts
- infinite-adcbwriter-bot: 120-sec teaser ads
- mario-bot-: Email copy in Mario style

IMAGE PROMPT BOTS:
- universal-static-bot: Recommends best image format, call FIRST
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

// ─── Harness Definition ─────────────────────────────────────────

export const adProductionHarness: HarnessDefinition = {
  type: "ad_production",
  name: "Ad Production",
  description: "Produce ad copy and image concepts from creative briefs using Genesis bots",

  phases: [
    // ── Phase 0: Copy Production ────────────────────────────────
    {
      name: "Copy Production",
      description: "Generate ad copy for each creative brief using Genesis copy bots",
      type: "llm_single",
      model: "anthropic/claude-opus-4.6",
      tools: [genesisBotTool],
      maxRounds: 12,
      workspaceInputs: ["creative-briefs.json"],
      foundationInputs: ["build-a-buyer", "copy-blocks", "offer-brief", "voice-profile"],
      systemPromptTemplate: `You are an ad copy production engine. Your job is to take creative briefs and produce finished ad copy using the right Genesis bots for each brief's style.

## Bot Selection Guide

Match the brief's style to the right bot:

| Style | Primary Bot | Notes |
|-------|------------|-------|
| Static (any) | 75-ads | Generates many variations. Best for static ad copy. |
| Video (talking head) | direct-response-talking-head-script-bot- | 15-90 sec scripts |
| Video (micro VSL) | microvsl | Short VSL scripts |
| Video (45-60 sec) | video-adscript-bot | Standard video ad scripts |
| Video (teaser/120 sec) | infinite-adcbwriter-bot | Longer teaser format |
| Hooks only | ad-hook-bot-1 or new-hook-bot | Just hooks, not full copy |
| Headlines only | headline-bot-v2 | Just headlines |

## Your Workflow

For EACH brief in the input:

1. Read the brief carefully -- segment, awareness level, concept, angle, style
2. Select the right Genesis bot based on style
3. Curate a detailed prompt (500-2000 words) that includes:
   - The specific brief details (segment, awareness, concept, angle)
   - Foundation context (Build-A-Buyer insights for this segment)
   - Voice profile (if available)
   - Copy blocks (if available) for proven persuasive elements
   - The offer details
   - Hook direction from the brief
   - Any compliance constraints
4. Call the Genesis bot
5. Compile the output

## Prompt Template for Genesis Bots

"Write [style] ad copy for [brand name].

TARGET: [segment name] -- [demographics]. They are [awareness level].
PAIN: [core pain from brief + Build-A-Buyer]
DESIRE: [core desire from brief + Build-A-Buyer]
CONCEPT: [concept category] -- [specific concept]
ANGLE: [angle type] -- [specific direction]
HOOK DIRECTION: [from brief]
BODY STRUCTURE: [from brief]

OFFER: [from offer brief foundation doc]
VOICE: [from voice profile if available]
PROVEN ELEMENTS: [from copy blocks if available]

COMPLIANCE: [any restrictions]

[Additional style-specific instructions]"

## Output Format

Respond with a JSON object:
{
  "ads": [
    {
      "brief_id": "string (matches brief id)",
      "segment": "string",
      "awareness_level": "string",
      "style": "string",
      "genesis_bot_used": "string (bot slug)",
      "copy": {
        "hooks": ["string (2-3 hook variations)"],
        "body": "string (the main ad body)",
        "cta": "string",
        "full_text": "string (complete ad as it would appear)"
      },
      "genesis_raw_output": "string (full bot response for reference)"
    }
  ],
  "summary": {
    "total_ads_produced": 0,
    "bots_used": ["string"],
    "styles_covered": ["string"],
    "next_steps": "string (what to do with these -- image concepts, compliance review, etc.)"
  }
}

IMPORTANT: Each ad must be COMPLETE and ready to use. Not outlines or frameworks -- finished copy that could be put in front of a customer.`,
      workspaceOutput: "ad-copy.json",
    },

    // ── Phase 1: Image Concepts ─────────────────────────────────
    {
      name: "Image Concepts",
      description: "Generate image concepts and prompts for each ad using Genesis image bots",
      type: "llm_single",
      model: "anthropic/claude-opus-4.6",
      tools: [genesisBotTool],
      maxRounds: 10,
      foundationInputs: ["build-a-buyer", "offer-brief"],
      systemPromptTemplate: `You are an image concept producer for Facebook ads. Your job is to create image concepts and prompts for each ad from the copy production phase.

## Ad Copy from Phase 0
$phase_0_output

## Your Workflow

For each ad:

1. First call universal-static-bot to get a format recommendation based on the ad's concept and angle
2. Then call the specific recommended image bot to generate the actual image concept/prompt
3. Compile the outputs

## Bot Selection After Universal Static

The universal-static-bot will recommend a format. Use its recommendation to pick the right bot:

| Format | Bot |
|--------|-----|
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

## Prompt Template for Image Bots

Include in your prompt:
- The ad's hook and key message
- Target segment demographics and psychographics
- The concept and angle being used
- Brand visual style (if known from foundation docs)
- The offer/product being promoted
- Platform (Facebook/Instagram) and placement (feed, stories, reels)

## Output Format

Respond with a JSON object:
{
  "image_concepts": [
    {
      "brief_id": "string (matches ad brief_id)",
      "ad_hook": "string (the hook this image supports)",
      "format_recommendation": "string (from universal-static-bot)",
      "image_bot_used": "string (specific bot slug)",
      "concept": {
        "description": "string (what the image shows)",
        "text_overlay": "string (any text on the image)",
        "style_notes": "string (visual style, colors, mood)",
        "aspect_ratio": "string (1:1, 4:5, 9:16)"
      },
      "image_prompt": "string (the full prompt for image generation)",
      "genesis_raw_output": "string (full bot response)"
    }
  ],
  "summary": {
    "total_concepts": 0,
    "formats_used": ["string"],
    "next_steps": "string (image generation with Gemini, review, etc.)"
  }
}`,
      workspaceOutput: "image-concepts.json",
    },
  ],
};
