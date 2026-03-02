import { internalQuery } from "../_generated/server";

/**
 * Helper query for the backfill action — returns members missing email.
 */
export const getMembersWithoutEmail = internalQuery({
  args: {},
  handler: async (ctx) => {
    const members = await ctx.db.query("orgMembers").collect();
    return members.filter((m: any) => !m.email);
  },
});
