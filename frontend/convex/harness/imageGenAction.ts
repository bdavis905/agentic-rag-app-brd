"use node";

/**
 * Image generation via Kie.ai API (Nano Banana Pro / Gemini 3 Pro Image).
 *
 * Flow: createTask → poll recordInfo → download image → store in Convex storage.
 */
import { internalAction } from "../_generated/server";
import { v } from "convex/values";

const KIE_API_BASE = "https://api.kie.ai/api/v1/jobs";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_TIME_MS = 5 * 60 * 1000; // 5 minutes

export const generateImage = internalAction({
  args: {
    prompt: v.string(),
    aspectRatio: v.optional(v.string()),
    resolution: v.optional(v.string()),
    model: v.optional(v.string()),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    storageId: string;
    imageUrl: string;
    costTime: number;
    taskId: string;
  }> => {
    const apiKey = process.env.KIE_API_KEY;
    if (!apiKey) {
      throw new Error("KIE_API_KEY environment variable is not set. Set it via: npx convex env set KIE_API_KEY <key>");
    }

    const model = args.model || "nano-banana-pro";
    const aspectRatio = args.aspectRatio || "1:1";
    const resolution = args.resolution || "1K";

    // ── Step 1: Create task ──
    const createResponse = await fetch(`${KIE_API_BASE}/createTask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: {
          prompt: args.prompt.slice(0, 10000), // API max
          aspect_ratio: aspectRatio,
          resolution,
          output_format: "png",
        },
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Kie.ai createTask failed (${createResponse.status}): ${errorText}`);
    }

    const createData = await createResponse.json();
    if (createData.code !== 200 || !createData.data?.taskId) {
      throw new Error(`Kie.ai createTask error: ${JSON.stringify(createData)}`);
    }

    const taskId = createData.data.taskId;

    // ── Step 2: Poll for completion ──
    const startTime = Date.now();
    let imageUrl: string | null = null;
    let costTime = 0;

    while (Date.now() - startTime < MAX_POLL_TIME_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const pollResponse = await fetch(
        `${KIE_API_BASE}/recordInfo?taskId=${encodeURIComponent(taskId)}`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      );

      if (!pollResponse.ok) {
        const errorText = await pollResponse.text();
        throw new Error(`Kie.ai recordInfo failed (${pollResponse.status}): ${errorText}`);
      }

      const pollData = await pollResponse.json();
      const task = pollData.data;

      if (!task) continue;

      if (task.state === "success") {
        costTime = task.costTime || 0;
        try {
          const resultJson = typeof task.resultJson === "string"
            ? JSON.parse(task.resultJson)
            : task.resultJson;
          const urls = resultJson?.resultUrls;
          if (Array.isArray(urls) && urls.length > 0) {
            imageUrl = urls[0];
          }
        } catch {
          throw new Error(`Failed to parse resultJson: ${task.resultJson}`);
        }
        break;
      }

      if (task.state === "fail") {
        throw new Error(`Image generation failed: ${task.failMsg || task.failCode || "unknown error"}`);
      }

      // Still processing (waiting, queuing, generating) — continue polling
    }

    if (!imageUrl) {
      throw new Error(`Image generation timed out after ${MAX_POLL_TIME_MS / 1000}s (taskId: ${taskId})`);
    }

    // ── Step 3: Download image and store in Convex ──
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image from ${imageUrl}: ${imageResponse.status}`);
    }

    const imageBlob = await imageResponse.blob();
    const storageId = await ctx.storage.store(imageBlob);

    return {
      storageId: storageId as unknown as string,
      imageUrl,
      costTime,
      taskId,
    };
  },
});
