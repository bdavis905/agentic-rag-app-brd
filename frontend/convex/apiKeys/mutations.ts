"use node";
/**
 * API key mutations — create and remove keys.
 * Uses "use node" for crypto.randomBytes access.
 */
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { createHash, randomBytes } from "crypto";

export const create = action({
  args: { orgId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Generate raw key: rag_ + 32 random hex chars
    const rawKey = `rag_${randomBytes(16).toString("hex")}`;

    // Hash for storage
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    const keyId = await ctx.runMutation(internal.apiKeys.internals.createKey, {
      ownerUserId: identity.subject,
      orgId: args.orgId,
      name: args.name,
      keyHash,
    });

    return { keyId, rawKey };
  },
});

export const remove = action({
  args: { orgId: v.string(), keyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Verify the key belongs to this org
    const key = await ctx.runQuery(internal.apiKeys.internals.getByOrgAndId, {
      orgId: args.orgId,
      keyId: args.keyId,
    });
    if (!key) throw new Error("API key not found");

    await ctx.runMutation(internal.apiKeys.internals.deleteKey, {
      keyId: args.keyId,
    });
  },
});
