"use node";

/**
 * Genesis bot caller as a Convex internal action.
 *
 * Runs in Node.js runtime. Reads API keys from the settings table
 * via ctx.runQuery (process.env is NOT available when called from
 * an HTTP action via ctx.runAction).
 */
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

export const callBot = internalAction({
  args: {
    botSlug: v.string(),
    prompt: v.string(),
    temperature: v.optional(v.number()),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Read org settings first, then fall back to any settings row
    // that already has Genesis keys configured.
    const settings: any = await ctx.runQuery(
      internal.settings.queries.getGenesisSettings,
      { orgId: args.orgId },
    );

    const apiKey = settings?.genesisApiKey;
    const providerKey = settings?.genesisProviderKey;

    if (!apiKey || !providerKey) {
      return "Error: Genesis API keys are not configured for this organization.";
    }

    const response = await fetch("https://gas.copycoders.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "X-Provider-Key": providerKey,
      },
      body: JSON.stringify({
        model: args.botSlug,
        messages: [{ role: "user", content: args.prompt }],
        stream: true,
        temperature: args.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (
        response.status === 429 &&
        errorText.includes("active session")
      ) {
        return "Error: Genesis API key is currently busy with an active streaming session. Revoke access in Genesis Server or wait for the active session to end, then retry.";
      }
      return `Error calling Genesis bot '${args.botSlug}': ${response.status} ${errorText}`;
    }

    // Collect streamed response
    // - 15 min max total runtime
    // - 2 min stall detection (no new data = stream is hung)
    const MAX_TOTAL_MS = 15 * 60 * 1000;
    const STALL_MS = 2 * 60 * 1000;
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const startTime = Date.now();
    let lastDataTime = Date.now();

    while (true) {
      const now = Date.now();
      if (now - startTime > MAX_TOTAL_MS) {
        reader.cancel();
        if (content) return content + `\n\n[Truncated: bot '${args.botSlug}' hit 15-minute limit]`;
        return `Error: Genesis bot '${args.botSlug}' timed out after 15 minutes with no output.`;
      }
      if (now - lastDataTime > STALL_MS) {
        reader.cancel();
        if (content) return content + `\n\n[Truncated: bot '${args.botSlug}' stream stalled for 2 minutes]`;
        return `Error: Genesis bot '${args.botSlug}' stream stalled (no data for 2 minutes).`;
      }

      const { done, value } = await reader.read();
      if (done) break;
      lastDataTime = Date.now();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const chunk = JSON.parse(trimmed.slice(6));
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) content += delta;
        } catch {
          continue;
        }
      }
    }

    return content || "Error: No response from Genesis bot.";
  },
});
