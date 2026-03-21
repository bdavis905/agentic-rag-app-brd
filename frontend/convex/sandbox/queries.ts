import { query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Generate a download URL for a sandbox-generated file stored in Convex storage.
 */
export const getFileUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});
