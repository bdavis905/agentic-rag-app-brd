"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

/**
 * Auto-join: called on first load when a user has no org memberships.
 *
 * This is an action (not a mutation) so it can call Clerk's API to look up
 * the user's email when `identity.email` is unavailable from the JWT.
 * The email is needed to match pending invites.
 */
export const ensureMembership = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    let email = identity.email;

    // If identity.email is missing (Clerk JWT may not include it),
    // look up the user's email from Clerk's API directly.
    if (!email) {
      const clerkSecretKey = process.env.CLERK_SECRET_KEY;
      if (clerkSecretKey) {
        try {
          const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
            headers: { Authorization: `Bearer ${clerkSecretKey}` },
          });
          if (res.ok) {
            const user = await res.json();
            const primary = user.email_addresses?.find(
              (e: any) => e.id === user.primary_email_address_id
            );
            email = primary?.email_address;
          }
        } catch {
          // Non-fatal — proceed without email, will fall back to default org
        }
      }
    }

    if (!email) {
      // Last resort — can't match invites without an email
      email = "";
    }

    return await ctx.runMutation(internal.organizations.mutations.processSignup, {
      userId,
      email: email.toLowerCase(),
    });
  },
});

/**
 * Invite a user by email. Always sends a Clerk email notification.
 *
 * - If they already have an account → add them immediately + send email.
 * - If they don't → send a Clerk signup invitation + store pending invite.
 *
 * Requires CLERK_SECRET_KEY env var.
 */
export const inviteByEmail = action({
  args: {
    orgId: v.id("organizations"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    // Auth check: caller must be authenticated and be owner/admin
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const callerUserId = identity.subject;

    // Check caller's membership via internal query
    const callerMembership = await ctx.runQuery(
      internal.organizations.queries.getMembershipInternal,
      { orgId: args.orgId, userId: callerUserId }
    );

    if (!callerMembership) {
      throw new Error("Not a member of this organization");
    }
    if (callerMembership.role !== "owner" && callerMembership.role !== "admin") {
      throw new Error("Only owners and admins can invite members");
    }

    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) {
      throw new Error(
        "CLERK_SECRET_KEY is not configured. Set it with: npx convex env set CLERK_SECRET_KEY sk_..."
      );
    }

    const appUrl = process.env.APP_URL || "https://agentic-rag-app-genesis.vercel.app";

    const email = args.email.trim().toLowerCase();

    // Get org name for the email
    const org = await ctx.runQuery(
      internal.organizations.queries.getInternal,
      { orgId: args.orgId }
    );
    const orgName = org?.name ?? "the organization";

    // Check if there's already a pending invite for this email + org
    const existingInvite = await ctx.runQuery(
      internal.organizations.queries.getPendingInvite,
      { orgId: args.orgId, email }
    );
    if (existingInvite) {
      return { status: "already_invited", email };
    }

    // Look up user by email in this Clerk app
    const lookupUrl = `https://api.clerk.com/v1/users?email_address[]=${encodeURIComponent(email)}`;
    const lookupRes = await fetch(lookupUrl, {
      headers: { Authorization: `Bearer ${clerkSecretKey}` },
    });

    if (!lookupRes.ok) {
      const body = await lookupRes.text();
      throw new Error(`Clerk API error (${lookupRes.status}): ${body}`);
    }

    const users = await lookupRes.json();

    // Verify the returned user actually owns this email address.
    // Clerk can return false positives — e.g. returning a completely unrelated
    // account. Only trust the result if the searched email is in their list.
    const existingUser = Array.isArray(users) && users.length > 0
      ? (() => {
          const candidate = users[0];
          const candidateEmails: string[] = (candidate.email_addresses ?? [])
            .map((e: any) => (e.email_address ?? "").toLowerCase());
          return candidateEmails.includes(email) ? candidate : null;
        })()
      : null;

    if (existingUser) {
      // User has an account — add them directly
      const result = await ctx.runMutation(internal.organizations.mutations.addMemberInternal, {
        orgId: args.orgId,
        userId: existingUser.id,
        role: args.role,
        email,
      });

      if (result?.alreadyMember) {
        return { status: "already_member", email };
      }

      // Send them a notification via Clerk invitation (ignore_existing lets it go through)
      try {
        await fetch("https://api.clerk.com/v1/invitations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${clerkSecretKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email_address: email,
            ignore_existing: true,
            redirect_url: appUrl,
            public_metadata: {
              invited_to_org: orgName,
            },
          }),
        });
      } catch {
        // Non-critical — they're already added, email is just a courtesy
      }

      return { status: "added", email };
    }

    // No account — send Clerk signup invitation + store pending invite
    const inviteRes = await fetch("https://api.clerk.com/v1/invitations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clerkSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: email,
        ignore_existing: true,
        expires_in_days: 30,
        redirect_url: appUrl,
        public_metadata: {
          invited_to_org: orgName,
        },
      }),
    });

    if (!inviteRes.ok) {
      const body = await inviteRes.text();
      throw new Error(`Failed to send invitation: ${body}`);
    }

    // Store pending invite so ensureMembership picks it up on signup
    await ctx.runMutation(internal.organizations.mutations.createPendingInvite, {
      orgId: args.orgId,
      email,
      role: args.role,
      invitedBy: callerUserId,
    });

    return { status: "invited", email };
  },
});
