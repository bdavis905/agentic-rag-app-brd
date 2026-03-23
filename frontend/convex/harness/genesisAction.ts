"use node";

/**
 * Genesis bot caller as a Convex internal action.
 *
 * Runs in Node.js runtime where process.env is guaranteed to work.
 * Reads API keys directly from process.env -- no key passing needed.
 */
import { internalAction } from "../_generated/server";
import { v } from "convex/values";

export const callBot = internalAction({
  args: {
    botSlug: v.string(),
    prompt: v.string(),
    temperature: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.GENESIS_API_KEY;
    const providerKey = process.env.GENESIS_ANTHROPIC_API_KEY;

    if (!apiKey || !providerKey) {
      return `Error: Genesis API keys not in env (apiKey: ${apiKey ? "set" : "MISSING"}, providerKey: ${providerKey ? "set" : "MISSING"}). Set GENESIS_API_KEY and GENESIS_ANTHROPIC_API_KEY via npx convex env set.`;
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
      return `Error calling Genesis bot '${args.botSlug}': ${response.status} ${errorText}`;
    }

    // Collect streamed response
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

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
