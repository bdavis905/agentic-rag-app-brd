"use node";

/**
 * Backfill email addresses on orgMembers records using Clerk Backend API.
 *
 * Run: npx convex run migrations/backfillMemberEmails:run
 *
 * Requires CLERK_SECRET_KEY env var.
 */
import { action } from "../_generated/server";
import { internal } from "../_generated/api";

export const run = action({
  args: {},
  handler: async (ctx) => {
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) {
      throw new Error("CLERK_SECRET_KEY is not set");
    }

    // Get all members without email
    const allMembers = await ctx.runQuery(
      internal.migrations.backfillMemberEmailsHelper.getMembersWithoutEmail,
      {}
    );

    if (allMembers.length === 0) {
      console.log("All members already have emails");
      return { count: 0 };
    }

    // Collect unique userIds
    const userIdSet = new Set<string>();
    for (const m of allMembers as any[]) {
      userIdSet.add(m.userId);
    }
    const userIds: string[] = [...userIdSet];
    const emailMap: Record<string, string> = {};

    // Look up each user via Clerk
    for (const userId of userIds) {
      try {
        const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
          headers: {
            Authorization: `Bearer ${clerkSecretKey}`,
          },
        });
        if (res.ok) {
          const user = await res.json();
          const email =
            user.email_addresses?.find(
              (e: any) => e.id === user.primary_email_address_id
            )?.email_address ?? user.email_addresses?.[0]?.email_address;
          if (email) {
            emailMap[userId] = email;
          }
        }
      } catch (err) {
        console.error(`Failed to look up user ${userId}:`, err);
      }
    }

    // Build updates
    const updates = allMembers
      .filter((m: any) => emailMap[m.userId])
      .map((m: any) => ({
        memberId: String(m._id),
        email: emailMap[m.userId],
      }));

    if (updates.length === 0) {
      console.log("No emails resolved from Clerk");
      return { count: 0 };
    }

    // Apply via internal mutation
    await ctx.runMutation(
      internal.migrations.backfillOrgs.backfillMemberEmails,
      { updates }
    );

    console.log(`Backfilled ${updates.length} member emails`);
    return { count: updates.length };
  },
});
