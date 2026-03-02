import { query } from "../_generated/server";

export const getConnectionStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    // Check if Google Drive is configured (env vars set by deployer)
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    const configured = !!(clientId && redirectUri);

    const conn = await ctx.db
      .query("googleDriveConnections")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .first();

    return {
      configured,
      clientId: clientId ?? null,
      redirectUri: redirectUri ?? null,
      connected: !!conn,
      email: conn?.email ?? null,
      connectedAt: conn?.connectedAt ?? null,
    };
  },
});
