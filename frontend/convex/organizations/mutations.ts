import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth, requireOrgMembership } from "../lib/auth";

/**
 * Internal mutation: process a new user signup by checking pending invites
 * and creating org memberships + preferences. Called by the ensureMembership action.
 */
export const processSignup = internalMutation({
  args: {
    userId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, email } = args;

    // Already has memberships? Nothing to do.
    const existing = await ctx.db
      .query("orgMembers")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .first();
    if (existing) return { joined: false };

    // Check for pending invites by email
    let firstOrgId: any = null;
    let firstOrgName: string | null = null;

    const pendingInvites = await ctx.db
      .query("pendingInvites")
      .withIndex("by_email", (q: any) => q.eq("email", email.toLowerCase()))
      .collect();

    const active = pendingInvites.filter((i: any) => i.status === "pending");

    for (const invite of active) {
      // Add to invited org
      await ctx.db.insert("orgMembers", {
        orgId: invite.orgId,
        userId,
        role: invite.role,
        email,
      });

      // Mark invite as accepted
      await ctx.db.patch(invite._id, { status: "accepted" as const });

      // Track first org for setting active
      if (!firstOrgId) {
        firstOrgId = invite.orgId;
        const org = await ctx.db.get(invite.orgId);
        firstOrgName = org?.name ?? null;
      }
    }

    // If no pending invites, fall back to default org (Genesis)
    if (!firstOrgId) {
      const allOrgs = await ctx.db.query("organizations").collect();
      const defaultOrg = allOrgs.find((o: any) => o.name === "Genesis") ?? allOrgs[0];
      if (!defaultOrg) return { joined: false };

      await ctx.db.insert("orgMembers", {
        orgId: defaultOrg._id,
        userId,
        role: "member",
        email,
      });

      firstOrgId = defaultOrg._id;
      firstOrgName = defaultOrg.name;
    }

    // Set active org
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .first();

    if (prefs) {
      await ctx.db.patch(prefs._id, { activeOrgId: firstOrgId });
    } else {
      await ctx.db.insert("userPreferences", {
        userId,
        activeOrgId: firstOrgId,
      });
    }

    return { joined: true, orgId: String(firstOrgId), orgName: firstOrgName };
  },
});

/**
 * Create a new organization. The creator becomes the owner.
 */
export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const { userId, email } = await requireAuth(ctx);

    const orgId = await ctx.db.insert("organizations", {
      name: args.name,
      createdBy: userId,
    });

    // Add creator as owner
    await ctx.db.insert("orgMembers", {
      orgId,
      userId,
      role: "owner",
      email,
    });

    // Set as active org
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .first();

    if (prefs) {
      await ctx.db.patch(prefs._id, { activeOrgId: orgId });
    } else {
      await ctx.db.insert("userPreferences", {
        userId,
        activeOrgId: orgId,
      });
    }

    // Create default settings row for this org
    await ctx.db.insert("settings", { orgId: String(orgId) });

    return orgId;
  },
});

/**
 * Switch the user's active organization.
 */
export const switchOrg = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    // Verify membership
    const membership = await ctx.db
      .query("orgMembers")
      .withIndex("by_user_org", (q: any) =>
        q.eq("userId", userId).eq("orgId", args.orgId),
      )
      .first();

    if (!membership) {
      // Check platform admin
      const identity = await ctx.auth.getUserIdentity();
      const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS || "")
        .split(",")
        .map((e: string) => e.trim())
        .filter(Boolean);
      if (!identity?.email || !adminEmails.includes(identity.email)) {
        throw new Error("Not a member of this organization");
      }
    }

    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .first();

    if (prefs) {
      await ctx.db.patch(prefs._id, { activeOrgId: args.orgId });
    } else {
      await ctx.db.insert("userPreferences", {
        userId,
        activeOrgId: args.orgId,
      });
    }
  },
});

/**
 * Rename an organization. Requires owner or admin role.
 */
export const rename = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, { orgId: String(args.orgId) });
    await ctx.db.patch(args.orgId, { name: args.name });
  },
});

/**
 * Add a member to an organization. Requires owner or admin role.
 */
export const addMember = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireOrgMembership(ctx, { orgId: String(args.orgId) });
    if (auth.role !== "owner" && auth.role !== "admin") {
      throw new Error("Only owners and admins can add members");
    }

    // Check if already a member
    const existing = await ctx.db
      .query("orgMembers")
      .withIndex("by_user_org", (q: any) =>
        q.eq("userId", args.userId).eq("orgId", args.orgId),
      )
      .first();

    if (existing) throw new Error("User is already a member");

    await ctx.db.insert("orgMembers", {
      orgId: args.orgId,
      userId: args.userId,
      role: args.role,
      email: args.email,
    });
  },
});

/**
 * Internal mutation to add a member — called by the inviteByEmail action.
 */
export const addMemberInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    // Skip if already a member
    const existing = await ctx.db
      .query("orgMembers")
      .withIndex("by_user_org", (q: any) =>
        q.eq("userId", args.userId).eq("orgId", args.orgId),
      )
      .first();

    if (existing) return { alreadyMember: true };

    await ctx.db.insert("orgMembers", {
      orgId: args.orgId,
      userId: args.userId,
      role: args.role,
      email: args.email,
    });

    return { alreadyMember: false };
  },
});

/**
 * Internal: create a pending invite record.
 */
export const createPendingInvite = internalMutation({
  args: {
    orgId: v.id("organizations"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    invitedBy: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("pendingInvites", {
      orgId: args.orgId,
      email: args.email,
      role: args.role,
      invitedBy: args.invitedBy,
      createdAt: Date.now(),
      status: "pending",
    });
  },
});

/**
 * Cancel a pending invite. Requires owner or admin role.
 */
export const cancelPendingInvite = mutation({
  args: {
    inviteId: v.id("pendingInvites"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) throw new Error("Invite not found");

    const auth = await requireOrgMembership(ctx, { orgId: String(invite.orgId) });
    if (auth.role !== "owner" && auth.role !== "admin") {
      throw new Error("Only owners and admins can cancel invites");
    }

    await ctx.db.delete(args.inviteId);
  },
});

/**
 * Update a member's role. Owners and admins can change roles.
 * Cannot change the owner's role.
 */
export const updateMemberRole = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const auth = await requireOrgMembership(ctx, { orgId: String(args.orgId) });
    if (auth.role !== "owner" && auth.role !== "admin") {
      throw new Error("Only owners and admins can change roles");
    }

    const membership = await ctx.db
      .query("orgMembers")
      .withIndex("by_user_org", (q: any) =>
        q.eq("userId", args.userId).eq("orgId", args.orgId),
      )
      .first();

    if (!membership) throw new Error("User is not a member");
    if (membership.role === "owner") throw new Error("Cannot change the owner's role");

    await ctx.db.patch(membership._id, { role: args.role });
  },
});

/**
 * Remove a member from an organization. Owners can remove anyone.
 * Admins can remove members (but not other admins or owners).
 */
export const removeMember = mutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireOrgMembership(ctx, { orgId: String(args.orgId) });

    if (args.userId === auth.userId) {
      throw new Error("Cannot remove yourself");
    }

    const membership = await ctx.db
      .query("orgMembers")
      .withIndex("by_user_org", (q: any) =>
        q.eq("userId", args.userId).eq("orgId", args.orgId),
      )
      .first();

    if (!membership) return;

    // Owners can remove anyone; admins can only remove members
    if (auth.role === "owner") {
      await ctx.db.delete(membership._id);
    } else if (auth.role === "admin" && membership.role === "member") {
      await ctx.db.delete(membership._id);
    } else {
      throw new Error("Insufficient permissions to remove this member");
    }
  },
});
