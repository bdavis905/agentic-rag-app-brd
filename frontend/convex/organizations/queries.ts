import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";

/**
 * List all organizations the current user belongs to.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const memberships = await ctx.db
      .query("orgMembers")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect();

    const orgs = await Promise.all(
      memberships.map(async (m: any) => {
        const org = await ctx.db.get(m.orgId);
        if (!org) return null;
        return { ...org, role: m.role };
      }),
    );

    return orgs.filter(Boolean);
  },
});

/**
 * Get the user's active org preference.
 */
export const getActiveOrg = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);

    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .first();

    return prefs?.activeOrgId ?? null;
  },
});

/**
 * Get org details by ID.
 */
export const get = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const org = await ctx.db.get(args.orgId);
    return org;
  },
});

/**
 * Get members of an organization.
 */
export const getMembers = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const members = await ctx.db
      .query("orgMembers")
      .withIndex("by_org", (q: any) => q.eq("orgId", args.orgId))
      .collect();

    // Enrich each member with all their org memberships
    const enriched = await Promise.all(
      members.map(async (m: any) => {
        const allMemberships = await ctx.db
          .query("orgMembers")
          .withIndex("by_user", (q: any) => q.eq("userId", m.userId))
          .collect();

        const orgEntries = await Promise.all(
          allMemberships.map(async (mem: any) => {
            const org = await ctx.db.get(mem.orgId);
            return org ? { orgId: String(mem.orgId), name: org.name, role: mem.role } : null;
          })
        );

        return {
          ...m,
          orgs: orgEntries.filter(Boolean),
        };
      })
    );

    return enriched;
  },
});

/**
 * Check if the current user is a platform admin.
 */
export const isPlatformAdmin = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;

    const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS || "")
      .split(",")
      .map((e: string) => e.trim())
      .filter(Boolean);

    return identity.email ? adminEmails.includes(identity.email) : false;
  },
});

/**
 * Internal: get org by ID (no auth check).
 */
export const getInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.orgId);
  },
});

/**
 * Internal: get a user's membership in an org (no auth check).
 * Used by actions that can't access ctx.db directly.
 */
export const getMembershipInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("orgMembers")
      .withIndex("by_user_org", (q: any) =>
        q.eq("userId", args.userId).eq("orgId", args.orgId),
      )
      .first();
  },
});

/**
 * Get pending invites for an org. Used in the Members UI.
 */
export const getPendingInvites = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const invites = await ctx.db
      .query("pendingInvites")
      .withIndex("by_org", (q: any) => q.eq("orgId", args.orgId))
      .collect();

    return invites.filter((i: any) => i.status === "pending");
  },
});

/**
 * Internal: check if a pending invite already exists for an email + org.
 */
export const getPendingInvite = internalQuery({
  args: {
    orgId: v.id("organizations"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const invites = await ctx.db
      .query("pendingInvites")
      .withIndex("by_email", (q: any) => q.eq("email", args.email))
      .collect();

    return invites.find(
      (i: any) => String(i.orgId) === String(args.orgId) && i.status === "pending"
    ) ?? null;
  },
});
