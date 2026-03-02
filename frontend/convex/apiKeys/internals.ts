/**
 * Internal API key functions — called from HTTP Action handlers.
 * No auth checks needed (caller is trusted server-side code).
 */
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const getByHash = internalQuery({
  args: { keyHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("apiKeys")
      .withIndex("by_hash", (q: any) => q.eq("keyHash", args.keyHash))
      .first();
  },
});

export const touchLastUsed = internalMutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.keyId, { lastUsedAt: Date.now() });
  },
});

export const createKey = internalMutation({
  args: {
    ownerUserId: v.string(),
    orgId: v.string(),
    name: v.string(),
    keyHash: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("apiKeys", {
      ownerUserId: args.ownerUserId,
      orgId: args.orgId,
      name: args.name,
      keyHash: args.keyHash,
      createdAt: Date.now(),
    });
  },
});

export const getByOwnerAndId = internalQuery({
  args: { ownerUserId: v.string(), keyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key || key.ownerUserId !== args.ownerUserId) return null;
    return key;
  },
});

export const getByOrgAndId = internalQuery({
  args: { orgId: v.string(), keyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key || key.orgId !== args.orgId) return null;
    return key;
  },
});

export const deleteKey = internalMutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.keyId);
  },
});
