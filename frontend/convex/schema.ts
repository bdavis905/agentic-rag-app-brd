import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ─── Organization Tables ──────────────────────────────────────

  organizations: defineTable({
    name: v.string(),
    createdBy: v.string(), // userId who created it
  }),

  orgMembers: defineTable({
    orgId: v.id("organizations"),
    userId: v.string(),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
    email: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["orgId"])
    .index("by_user_org", ["userId", "orgId"]),

  pendingInvites: defineTable({
    orgId: v.id("organizations"),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    invitedBy: v.string(), // userId of inviter
    createdAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired")),
  })
    .index("by_email", ["email"])
    .index("by_org", ["orgId"])
    .index("by_status", ["status"]),

  userPreferences: defineTable({
    userId: v.string(),
    activeOrgId: v.optional(v.id("organizations")),
  }).index("by_user", ["userId"]),

  // ─── Data Tables ──────────────────────────────────────────────

  documents: defineTable({
    userId: v.string(),
    orgId: v.optional(v.string()),
    folderId: v.optional(v.id("folders")),
    filename: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
    storageId: v.id("_storage"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
    processingStep: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    chunkCount: v.number(),
    contentHash: v.optional(v.string()),
    metadata: v.optional(v.any()),
    fullText: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_user_folder", ["userId", "folderId"])
    .index("by_user_filename", ["userId", "filename"])
    .index("by_org", ["orgId"])
    .index("by_org_folder", ["orgId", "folderId"])
    .index("by_org_filename", ["orgId", "filename"]),

  chunks: defineTable({
    documentId: v.id("documents"),
    userId: v.string(),
    orgId: v.optional(v.string()),
    content: v.string(),
    chunkIndex: v.number(),
    embedding: v.array(v.float64()),
    metadata: v.optional(v.any()),
  })
    .index("by_document", ["documentId"])
    .index("by_user", ["userId"])
    .index("by_org", ["orgId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId", "orgId"],
    })
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["userId", "orgId"],
    }),

  folders: defineTable({
    userId: v.optional(v.string()),
    orgId: v.optional(v.string()),
    parentId: v.optional(v.id("folders")),
    name: v.string(),
    order: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_parent", ["parentId"])
    .index("by_user_parent", ["userId", "parentId"])
    .index("by_org", ["orgId"])
    .index("by_org_parent", ["orgId", "parentId"]),

  threads: defineTable({
    userId: v.string(),
    orgId: v.optional(v.string()),
    title: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["orgId"]),

  messages: defineTable({
    threadId: v.id("threads"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    toolCalls: v.optional(v.any()),
  }).index("by_thread", ["threadId"]),

  apiKeys: defineTable({
    ownerUserId: v.string(),
    orgId: v.optional(v.string()),
    name: v.string(),
    keyHash: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_hash", ["keyHash"])
    .index("by_org", ["orgId"]),

  settings: defineTable({
    orgId: v.optional(v.string()),
    llmModel: v.optional(v.string()),
    llmBaseUrl: v.optional(v.string()),
    llmApiKey: v.optional(v.string()),
    embeddingModel: v.optional(v.string()),
    embeddingBaseUrl: v.optional(v.string()),
    embeddingApiKey: v.optional(v.string()),
    embeddingDimensions: v.optional(v.number()),
    metadataSchema: v.optional(v.any()),
    rerankModel: v.optional(v.string()),
    rerankBaseUrl: v.optional(v.string()),
    rerankApiKey: v.optional(v.string()),
    rerankTopN: v.optional(v.number()),
    webSearchEnabled: v.optional(v.boolean()),
    webSearchProvider: v.optional(v.string()),
    webSearchApiKey: v.optional(v.string()),
    chatSystemPrompt: v.optional(v.string()),
    genesisApiKey: v.optional(v.string()),
    genesisProviderKey: v.optional(v.string()),
  }).index("by_org", ["orgId"]),

  skills: defineTable({
    orgId: v.string(),
    name: v.string(),
    description: v.string(),
    instructions: v.string(),
    enabled: v.boolean(),
    isGlobal: v.optional(v.boolean()),
    sharedBy: v.optional(v.string()),
    createdBy: v.string(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_enabled", ["orgId", "enabled"])
    .index("by_org_name", ["orgId", "name"]),

  // ─── Todos (Deep Mode Planning) ───────────────────────────────

  todos: defineTable({
    threadId: v.id("threads"),
    orgId: v.optional(v.string()),
    content: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed")
    ),
    position: v.number(),
  }).index("by_thread", ["threadId"]),

  // ─── Workspace Files (Per-Thread Agent Artifacts) ────────────

  workspaceFiles: defineTable({
    threadId: v.id("threads"),
    orgId: v.optional(v.string()),
    filePath: v.string(),
    content: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    contentType: v.string(),
    source: v.string(), // "agent", "user", "harness"
    sizeBytes: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_thread_path", ["threadId", "filePath"]),

  // ─── Harness Runs (Multi-Phase Workflows) ────────────────────

  harnessRuns: defineTable({
    threadId: v.id("threads"),
    orgId: v.optional(v.string()),
    harnessType: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("paused")
    ),
    currentPhase: v.number(),
    phaseResults: v.optional(v.any()),
    inputFiles: v.optional(v.array(v.string())),
    config: v.optional(v.any()),
    error: v.optional(v.string()),
  }).index("by_thread", ["threadId"]),

  // ─── Foundation Docs (Per-Org, Per-Offer Persistent Knowledge) ──

  foundationDocs: defineTable({
    orgId: v.string(),
    offerSlug: v.optional(v.string()),
    docType: v.string(),
    content: v.string(),
    sourceBot: v.optional(v.string()),
    version: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_offer", ["orgId", "offerSlug"])
    .index("by_org_offer_doc", ["orgId", "offerSlug", "docType"]),

  // ─── Google Drive (connection is per-user, files get orgId) ───

  googleDriveConnections: defineTable({
    userId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    email: v.optional(v.string()),
    connectedAt: v.number(),
  }).index("by_user", ["userId"]),

  googleDriveFiles: defineTable({
    userId: v.string(),
    orgId: v.optional(v.string()),
    documentId: v.id("documents"),
    driveFileId: v.string(),
    driveName: v.string(),
    driveMimeType: v.string(),
    driveModifiedTime: v.string(),
    lastSyncedAt: v.number(),
    syncStatus: v.union(
      v.literal("synced"),
      v.literal("pending"),
      v.literal("error")
    ),
    errorMessage: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["orgId"])
    .index("by_document", ["documentId"])
    .index("by_drive_file", ["userId", "driveFileId"]),
});
