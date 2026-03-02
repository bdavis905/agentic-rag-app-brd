/**
 * Shared auth helper for org-based multi-tenancy.
 * Every public query/mutation should call requireOrgMembership.
 */
interface AuthContext {
  auth: { getUserIdentity: () => Promise<any> };
  db: any;
}

interface OrgAuth {
  userId: string;
  orgId: string;
  role: "owner" | "admin" | "member";
}

/**
 * Verify the caller is authenticated and belongs to the specified org.
 * Platform admins (PLATFORM_ADMIN_EMAILS env var) bypass membership checks.
 */
export async function requireOrgMembership(
  ctx: AuthContext,
  args: { orgId: string },
): Promise<OrgAuth> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const userId = identity.subject;

  const membership = await ctx.db
    .query("orgMembers")
    .withIndex("by_user_org", (q: any) =>
      q.eq("userId", userId).eq("orgId", args.orgId),
    )
    .first();

  if (membership) {
    return { userId, orgId: args.orgId, role: membership.role };
  }

  // Platform admin bypass — check env var email list
  const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS || "")
    .split(",")
    .map((e: string) => e.trim())
    .filter(Boolean);
  const email = identity.email;

  if (email && adminEmails.includes(email)) {
    return { userId, orgId: args.orgId, role: "admin" };
  }

  throw new Error("Not a member of this organization");
}

/**
 * Get identity only — for functions that don't require org context
 * (e.g., listing user's orgs, user preferences).
 */
export async function requireAuth(
  ctx: AuthContext,
): Promise<{ userId: string; email?: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return { userId: identity.subject, email: identity.email };
}
