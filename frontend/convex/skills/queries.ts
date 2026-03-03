import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { requireOrgMembership } from "../lib/auth";

/** List all skills for an org (public — requires membership). */
export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);
    return ctx.db
      .query("skills")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
  },
});

/** Get a single skill by ID (public — requires membership). */
export const get = query({
  args: { orgId: v.string(), skillId: v.id("skills") },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);
    const skill = await ctx.db.get(args.skillId);
    if (!skill || skill.orgId !== args.orgId) return null;
    return skill;
  },
});

/** List enabled skills for system prompt catalog (internal — called from http.ts). */
export const listEnabled = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("skills")
      .withIndex("by_org_enabled", (q) =>
        q.eq("orgId", args.orgId).eq("enabled", true),
      )
      .collect();
  },
});

/** Get a single skill by ID (internal — called from http.ts load_skill handler). */
export const getById = internalQuery({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.skillId);
  },
});
