import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { requireOrgMembership } from "../lib/auth";

/** Create a new skill (public — requires membership). */
export const create = mutation({
  args: {
    orgId: v.string(),
    name: v.string(),
    description: v.string(),
    instructions: v.string(),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgMembership(ctx, args);

    // Check for duplicate name within org
    const existing = await ctx.db
      .query("skills")
      .withIndex("by_org_name", (q) =>
        q.eq("orgId", args.orgId).eq("name", args.name),
      )
      .first();
    if (existing) throw new Error(`Skill "${args.name}" already exists`);

    return ctx.db.insert("skills", {
      orgId: args.orgId,
      name: args.name,
      description: args.description,
      instructions: args.instructions,
      enabled: args.enabled ?? true,
      createdBy: userId,
      updatedAt: Date.now(),
    });
  },
});

/** Update a skill (public — requires membership). */
export const update = mutation({
  args: {
    orgId: v.string(),
    skillId: v.id("skills"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    instructions: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);

    const skill = await ctx.db.get(args.skillId);
    if (!skill || skill.orgId !== args.orgId) {
      throw new Error("Skill not found");
    }

    // Check for duplicate name on rename
    if (args.name && args.name !== skill.name) {
      const existing = await ctx.db
        .query("skills")
        .withIndex("by_org_name", (q) =>
          q.eq("orgId", args.orgId).eq("name", args.name!),
        )
        .first();
      if (existing) throw new Error(`Skill "${args.name}" already exists`);
    }

    const updates: Record<string, any> = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.instructions !== undefined) updates.instructions = args.instructions;
    if (args.enabled !== undefined) updates.enabled = args.enabled;

    await ctx.db.patch(args.skillId, updates);
  },
});

/** Delete a skill (public — requires membership). */
export const remove = mutation({
  args: { orgId: v.string(), skillId: v.id("skills") },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);

    const skill = await ctx.db.get(args.skillId);
    if (!skill || skill.orgId !== args.orgId) {
      throw new Error("Skill not found");
    }

    await ctx.db.delete(args.skillId);
  },
});

/** Toggle a skill's enabled state (public — requires membership). */
export const toggleEnabled = mutation({
  args: { orgId: v.string(), skillId: v.id("skills") },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args);

    const skill = await ctx.db.get(args.skillId);
    if (!skill || skill.orgId !== args.orgId) {
      throw new Error("Skill not found");
    }

    await ctx.db.patch(args.skillId, {
      enabled: !skill.enabled,
      updatedAt: Date.now(),
    });
  },
});

/** Create a skill from the LLM save_skill tool (internal — no auth check). */
export const createFromTool = internalMutation({
  args: {
    orgId: v.string(),
    name: v.string(),
    description: v.string(),
    instructions: v.string(),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    // Check for duplicate name
    const existing = await ctx.db
      .query("skills")
      .withIndex("by_org_name", (q) =>
        q.eq("orgId", args.orgId).eq("name", args.name),
      )
      .first();
    if (existing) throw new Error(`Skill "${args.name}" already exists`);

    return ctx.db.insert("skills", {
      orgId: args.orgId,
      name: args.name,
      description: args.description,
      instructions: args.instructions,
      enabled: true,
      createdBy: args.createdBy,
      updatedAt: Date.now(),
    });
  },
});
