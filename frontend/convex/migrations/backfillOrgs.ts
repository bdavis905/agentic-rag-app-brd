/**
 * One-time migration: Create "Genesis" org and backfill orgId on all records.
 *
 * Run in order:
 *   npx convex run migrations/backfillOrgs:setupOrg
 *   npx convex run migrations/backfillOrgs:backfillDocuments
 *   npx convex run migrations/backfillOrgs:backfillChunks      (run repeatedly until 0)
 *   npx convex run migrations/backfillOrgs:backfillFolders
 *   npx convex run migrations/backfillOrgs:backfillThreads
 *   npx convex run migrations/backfillOrgs:backfillApiKeys
 *   npx convex run migrations/backfillOrgs:backfillSettings
 *   npx convex run migrations/backfillOrgs:backfillDriveFiles
 */
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

/** Batch size for chunk backfill to stay under 16MB read limit */
const CHUNK_BATCH_SIZE = 200;

/**
 * Step 1: Create Genesis org + owner membership + user preferences.
 */
export const setupOrg = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Find existing user from documents
    const sampleDoc = await ctx.db.query("documents").first();
    const userId = sampleDoc?.userId ?? "placeholder";

    // Check if Genesis org already exists
    const existingOrgs = await ctx.db.query("organizations").collect();
    let genesisOrgId: any;

    const existing = existingOrgs.find((o: any) => o.name === "Genesis");
    if (existing) {
      console.log("Genesis org already exists:", existing._id);
      genesisOrgId = existing._id;
    } else {
      genesisOrgId = await ctx.db.insert("organizations", {
        name: "Genesis",
        createdBy: userId,
      });
      console.log("Created Genesis org:", genesisOrgId);
    }

    // Create orgMember if not exists
    const existingMember = await ctx.db
      .query("orgMembers")
      .withIndex("by_user_org", (q: any) =>
        q.eq("userId", userId).eq("orgId", genesisOrgId),
      )
      .first();

    if (!existingMember) {
      await ctx.db.insert("orgMembers", {
        orgId: genesisOrgId,
        userId,
        role: "owner",
      });
      console.log("Created owner membership for:", userId);
    }

    // Create userPreferences if not exists
    const existingPrefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .first();

    if (!existingPrefs) {
      await ctx.db.insert("userPreferences", {
        userId,
        activeOrgId: genesisOrgId,
      });
      console.log("Created user preferences");
    }

    // Create default settings row if not exists
    const existingSettings = await ctx.db
      .query("settings")
      .withIndex("by_org", (q: any) => q.eq("orgId", String(genesisOrgId)))
      .first();

    if (!existingSettings) {
      // Move any existing settings to this org
      const oldSettings = await ctx.db.query("settings").first();
      if (oldSettings && !oldSettings.orgId) {
        await ctx.db.patch(oldSettings._id, { orgId: String(genesisOrgId) });
        console.log("Updated existing settings with orgId");
      }
    }

    console.log("Setup complete. Org ID:", String(genesisOrgId));
    return { orgId: String(genesisOrgId), userId };
  },
});

/**
 * Step 2: Backfill documents.
 */
export const backfillDocuments = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = (await ctx.db.query("organizations").collect()).find(
      (o: any) => o.name === "Genesis",
    );
    if (!org) throw new Error("Run setupOrg first");
    const orgId = String(org._id);

    const docs = await ctx.db.query("documents").collect();
    let count = 0;
    for (const doc of docs) {
      if (!doc.orgId) {
        await ctx.db.patch(doc._id, { orgId });
        count++;
      }
    }
    console.log(`Backfilled ${count} documents`);
    return { count };
  },
});

/**
 * Step 3: Backfill chunks (paginated — run repeatedly until returns 0).
 */
export const backfillChunks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = (await ctx.db.query("organizations").collect()).find(
      (o: any) => o.name === "Genesis",
    );
    if (!org) throw new Error("Run setupOrg first");
    const orgId = String(org._id);

    // Find chunks without orgId using the by_org index (undefined = not yet set)
    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_org", (q: any) => q.eq("orgId", undefined))
      .take(CHUNK_BATCH_SIZE);

    let count = 0;
    for (const chunk of chunks) {
      await ctx.db.patch(chunk._id, { orgId });
      count++;
    }
    console.log(`Backfilled ${count} chunks (batch of ${CHUNK_BATCH_SIZE})`);
    if (count === CHUNK_BATCH_SIZE) {
      console.log("More chunks remain — run this function again");
    } else {
      console.log("All chunks backfilled!");
    }
    return { count, hasMore: count === CHUNK_BATCH_SIZE };
  },
});

/**
 * Step 4: Backfill folders.
 */
export const backfillFolders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = (await ctx.db.query("organizations").collect()).find(
      (o: any) => o.name === "Genesis",
    );
    if (!org) throw new Error("Run setupOrg first");
    const orgId = String(org._id);

    const folders = await ctx.db.query("folders").collect();
    let count = 0;
    for (const folder of folders) {
      if (!(folder as any).orgId) {
        await ctx.db.patch(folder._id, { orgId });
        count++;
      }
    }
    console.log(`Backfilled ${count} folders`);
    return { count };
  },
});

/**
 * Step 5: Backfill threads.
 */
export const backfillThreads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = (await ctx.db.query("organizations").collect()).find(
      (o: any) => o.name === "Genesis",
    );
    if (!org) throw new Error("Run setupOrg first");
    const orgId = String(org._id);

    const threads = await ctx.db.query("threads").collect();
    let count = 0;
    for (const thread of threads) {
      if (!(thread as any).orgId) {
        await ctx.db.patch(thread._id, { orgId });
        count++;
      }
    }
    console.log(`Backfilled ${count} threads`);
    return { count };
  },
});

/**
 * Step 6: Backfill API keys.
 */
export const backfillApiKeys = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = (await ctx.db.query("organizations").collect()).find(
      (o: any) => o.name === "Genesis",
    );
    if (!org) throw new Error("Run setupOrg first");
    const orgId = String(org._id);

    const keys = await ctx.db.query("apiKeys").collect();
    let count = 0;
    for (const key of keys) {
      if (!(key as any).orgId) {
        await ctx.db.patch(key._id, { orgId });
        count++;
      }
    }
    console.log(`Backfilled ${count} API keys`);
    return { count };
  },
});

/**
 * Step 7: Backfill settings.
 */
export const backfillSettings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = (await ctx.db.query("organizations").collect()).find(
      (o: any) => o.name === "Genesis",
    );
    if (!org) throw new Error("Run setupOrg first");
    const orgId = String(org._id);

    const allSettings = await ctx.db.query("settings").collect();
    let count = 0;
    for (const s of allSettings) {
      if (!(s as any).orgId) {
        await ctx.db.patch(s._id, { orgId });
        count++;
      }
    }
    console.log(`Backfilled ${count} settings records`);
    return { count };
  },
});

/**
 * Step 8: Backfill Google Drive files.
 */
export const backfillDriveFiles = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = (await ctx.db.query("organizations").collect()).find(
      (o: any) => o.name === "Genesis",
    );
    if (!org) throw new Error("Run setupOrg first");
    const orgId = String(org._id);

    const files = await ctx.db.query("googleDriveFiles").collect();
    let count = 0;
    for (const f of files) {
      if (!(f as any).orgId) {
        await ctx.db.patch(f._id, { orgId });
        count++;
      }
    }
    console.log(`Backfilled ${count} Drive files`);
    return { count };
  },
});

/**
 * Step 9: Backfill member emails using Clerk Backend API.
 *
 * Requires CLERK_SECRET_KEY env var. This is an internalMutation so it
 * cannot call external APIs directly. Instead, it patches any members
 * where the email is missing by looking up the identity from Clerk
 * claims stored in auth. Run the companion action instead:
 *
 *   npx convex run migrations/backfillOrgs:backfillMemberEmailsAction
 *
 * Or manually patch emails if you know them:
 *   Each orgMember record just needs { email: "user@example.com" }
 */
export const backfillMemberEmails = internalMutation({
  args: {
    updates: v.array(
      v.object({
        memberId: v.string(),
        email: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    let count = 0;
    for (const { memberId, email } of args.updates) {
      const member = await ctx.db.get(memberId as any);
      if (member && !(member as any).email) {
        await ctx.db.patch(member._id, { email });
        count++;
      }
    }
    console.log(`Backfilled ${count} member emails`);
    return { count };
  },
});
