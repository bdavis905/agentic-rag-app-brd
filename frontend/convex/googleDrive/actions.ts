"use node";

import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
// ─── Constants ──────────────────────────────────────────────────

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3";

/** MIME types we can import */
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);

/** Google Workspace types we can export */
const GOOGLE_EXPORT_MAP: Record<string, { mimeType: string; extension: string }> = {
  "application/vnd.google-apps.document": {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: ".docx",
  },
  "application/vnd.google-apps.presentation": {
    mimeType: "application/pdf",
    extension: ".pdf",
  },
};

const FOLDER_MIME = "application/vnd.google-apps.folder";

// ─── Token Helpers ──────────────────────────────────────────────

function getGoogleCredentials(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret) {
    throw new Error("Google Drive not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.");
  }
  if (!redirectUri) {
    throw new Error("Google Redirect URI not configured. Set GOOGLE_REDIRECT_URI env var.");
  }
  return { clientId, clientSecret, redirectUri };
}

async function getValidAccessToken(
  ctx: any,
  userId: string
): Promise<string> {
  const conn = await ctx.runQuery(internal.googleDrive.internals.getConnection, { userId });
  if (!conn) throw new Error("Google Drive not connected. Connect in Settings.");

  if (conn.expiresAt > Date.now() + 5 * 60 * 1000) {
    return conn.accessToken;
  }

  const { clientId, clientSecret } = getGoogleCredentials();

  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: conn.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Token refresh failed: ${errText}`);
  }

  const data = await resp.json();
  const newAccessToken = data.access_token as string;
  const expiresIn = (data.expires_in as number) || 3600;
  const expiresAt = Date.now() + expiresIn * 1000;

  await ctx.runMutation(internal.googleDrive.internals.updateTokens, {
    userId,
    accessToken: newAccessToken,
    expiresAt,
  });

  return newAccessToken;
}

// ─── OAuth Actions ──────────────────────────────────────────────

export const exchangeCode = action({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const { clientId, clientSecret, redirectUri } = getGoogleCredentials();

    const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: args.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      throw new Error(`Token exchange failed: ${errText}`);
    }

    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token as string;
    const refreshToken = tokenData.refresh_token as string;
    const expiresIn = (tokenData.expires_in as number) || 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    if (!refreshToken) {
      throw new Error("No refresh token received. You may need to revoke access and reconnect.");
    }

    let email: string | undefined;
    try {
      const userResp = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userResp.ok) {
        const userData = await userResp.json();
        email = userData.email;
      }
    } catch {
      // Non-critical
    }

    await ctx.runMutation(internal.googleDrive.internals.upsertConnection, {
      userId,
      accessToken,
      refreshToken,
      expiresAt,
      email,
    });

    return { success: true, email };
  },
});

export const disconnect = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    await ctx.runMutation(internal.googleDrive.internals.deleteConnection, {
      userId: identity.subject,
    });

    return { success: true };
  },
});

// ─── Drive Browsing ─────────────────────────────────────────────

export const listDriveFolder = action({
  args: {
    folderId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const accessToken = await getValidAccessToken(ctx, identity.subject);
    const parentId = args.folderId || "root";

    const query = `'${parentId}' in parents and trashed = false`;
    const fields = "files(id,name,mimeType,size,modifiedTime),nextPageToken";
    const orderBy = "folder,name";

    const url = `${GOOGLE_DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&orderBy=${encodeURIComponent(orderBy)}&pageSize=100`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Drive API error: ${errText}`);
    }

    const data = await resp.json();
    const files = (data.files || []) as Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      modifiedTime?: string;
    }>;

    return files
      .filter((f) => {
        if (f.mimeType === FOLDER_MIME) return true;
        if (f.mimeType in GOOGLE_EXPORT_MAP) return true;
        if (SUPPORTED_MIME_TYPES.has(f.mimeType)) return true;
        return false;
      })
      .map((f) => {
        const isFolder = f.mimeType === FOLDER_MIME;
        const isGoogleDoc = f.mimeType in GOOGLE_EXPORT_MAP;

        let exportInfo: { exportAs: string; extension: string } | null = null;
        if (isGoogleDoc) {
          const mapping = GOOGLE_EXPORT_MAP[f.mimeType];
          exportInfo = { exportAs: mapping.mimeType, extension: mapping.extension };
        }

        return {
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size ? parseInt(f.size) : null,
          modifiedTime: f.modifiedTime || null,
          isFolder,
          importable: true,
          exportInfo,
        };
      });
  },
});

// ─── File Import ────────────────────────────────────────────────

export const importFiles = action({
  args: {
    orgId: v.string(),
    files: v.array(
      v.object({
        driveFileId: v.string(),
        driveName: v.string(),
        driveMimeType: v.string(),
        driveModifiedTime: v.optional(v.string()),
      })
    ),
    targetFolderId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    for (const file of args.files) {
      await ctx.scheduler.runAfter(0, internal.googleDrive.actions.importFile, {
        userId: identity.subject,
        orgId: args.orgId,
        driveFileId: file.driveFileId,
        driveName: file.driveName,
        driveMimeType: file.driveMimeType,
        driveModifiedTime: file.driveModifiedTime || "",
        targetFolderId: args.targetFolderId,
      });
    }

    return { scheduled: args.files.length };
  },
});

export const importFolder = action({
  args: {
    orgId: v.string(),
    driveFolderId: v.string(),
    driveFolderName: v.string(),
    targetParentFolderId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;

    const localFolderId = await ctx.runMutation(
      internal.googleDrive.internals.createImportedFolder,
      {
        userId,
        orgId: args.orgId,
        name: args.driveFolderName,
        parentId: args.targetParentFolderId,
      }
    );

    await ctx.scheduler.runAfter(
      0,
      internal.googleDrive.actions.importFolderContents,
      {
        userId,
        orgId: args.orgId,
        driveFolderId: args.driveFolderId,
        localFolderId,
      }
    );

    return { scheduled: true, folderId: localFolderId };
  },
});

// ─── Internal Actions (run in background) ───────────────────────

export const importFile = internalAction({
  args: {
    userId: v.string(),
    orgId: v.optional(v.string()),
    driveFileId: v.string(),
    driveName: v.string(),
    driveMimeType: v.string(),
    driveModifiedTime: v.string(),
    targetFolderId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    try {
      const accessToken = await getValidAccessToken(ctx, args.userId);

      const isGoogleDoc = args.driveMimeType in GOOGLE_EXPORT_MAP;
      let downloadUrl: string;
      let filename = args.driveName;
      let fileType: string;

      if (isGoogleDoc) {
        const mapping = GOOGLE_EXPORT_MAP[args.driveMimeType];
        downloadUrl = `${GOOGLE_DRIVE_API}/files/${args.driveFileId}/export?mimeType=${encodeURIComponent(mapping.mimeType)}`;
        fileType = mapping.mimeType;
        if (!filename.endsWith(mapping.extension)) {
          filename += mapping.extension;
        }
      } else {
        downloadUrl = `${GOOGLE_DRIVE_API}/files/${args.driveFileId}?alt=media`;
        fileType = args.driveMimeType;
      }

      const resp = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!resp.ok) {
        throw new Error(`Download failed (${resp.status}): ${await resp.text()}`);
      }

      const blob = await resp.blob();

      const arrayBuffer = await blob.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const contentHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      const storageId = await ctx.storage.store(blob);

      const result = await ctx.runMutation(
        internal.googleDrive.internals.createImportedDocument,
        {
          userId: args.userId,
          orgId: args.orgId,
          filename,
          fileType,
          fileSize: blob.size,
          storageId,
          folderId: args.targetFolderId,
          contentHash,
        }
      );

      if (result.action === "skipped") {
        console.log(`Drive import skipped (duplicate): ${filename}`);
        return;
      }

      await ctx.runMutation(
        internal.googleDrive.internals.createDriveFileMapping,
        {
          userId: args.userId,
          orgId: args.orgId,
          documentId: result.documentId,
          driveFileId: args.driveFileId,
          driveName: args.driveName,
          driveMimeType: args.driveMimeType,
          driveModifiedTime: args.driveModifiedTime || new Date().toISOString(),
        }
      );

      await ctx.scheduler.runAfter(
        0,
        internal.documents.actions.processDocument,
        { documentId: result.documentId }
      );

      console.log(`Drive import started: ${filename} → ${result.documentId}`);
    } catch (error) {
      console.error(`Drive import failed for ${args.driveName}:`, error);
      throw error;
    }
  },
});

export const importFolderContents = internalAction({
  args: {
    userId: v.string(),
    orgId: v.optional(v.string()),
    driveFolderId: v.string(),
    localFolderId: v.id("folders"),
  },
  handler: async (ctx, args) => {
    try {
      const accessToken = await getValidAccessToken(ctx, args.userId);
      const query = `'${args.driveFolderId}' in parents and trashed = false`;
      const fields = "files(id,name,mimeType,size,modifiedTime)";
      const orderBy = "folder,name";

      const url = `${GOOGLE_DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&orderBy=${encodeURIComponent(orderBy)}&pageSize=100`;

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!resp.ok) {
        throw new Error(`Drive API error: ${await resp.text()}`);
      }

      const data = await resp.json();
      const files = (data.files || []) as Array<{
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        modifiedTime?: string;
      }>;

      for (const file of files) {
        if (file.mimeType === FOLDER_MIME) {
          await ctx.scheduler.runAfter(
            0,
            internal.googleDrive.actions.importFolderRecursive,
            {
              userId: args.userId,
              orgId: args.orgId,
              driveFolderId: file.id,
              driveFolderName: file.name,
              targetParentFolderId: args.localFolderId,
            }
          );
        } else {
          const isGoogleDoc = file.mimeType in GOOGLE_EXPORT_MAP;
          const isDirectlySupported = SUPPORTED_MIME_TYPES.has(file.mimeType);

          if (isGoogleDoc || isDirectlySupported) {
            await ctx.scheduler.runAfter(
              0,
              internal.googleDrive.actions.importFile,
              {
                userId: args.userId,
                orgId: args.orgId,
                driveFileId: file.id,
                driveName: file.name,
                driveMimeType: file.mimeType,
                driveModifiedTime: file.modifiedTime || "",
                targetFolderId: args.localFolderId,
              }
            );
          }
        }
      }

      console.log(
        `Drive folder contents import: ${args.localFolderId} (${files.length} items)`
      );
    } catch (error) {
      console.error(`Drive folder contents import failed:`, error);
      throw error;
    }
  },
});

export const importFolderRecursive = internalAction({
  args: {
    userId: v.string(),
    orgId: v.optional(v.string()),
    driveFolderId: v.string(),
    driveFolderName: v.string(),
    targetParentFolderId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    try {
      const localFolderId = await ctx.runMutation(
        internal.googleDrive.internals.createImportedFolder,
        {
          userId: args.userId,
          orgId: args.orgId,
          name: args.driveFolderName,
          parentId: args.targetParentFolderId,
        }
      );

      const accessToken = await getValidAccessToken(ctx, args.userId);
      const query = `'${args.driveFolderId}' in parents and trashed = false`;
      const fields = "files(id,name,mimeType,size,modifiedTime)";
      const orderBy = "folder,name";

      const url = `${GOOGLE_DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&orderBy=${encodeURIComponent(orderBy)}&pageSize=100`;

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!resp.ok) {
        throw new Error(`Drive API error: ${await resp.text()}`);
      }

      const data = await resp.json();
      const files = (data.files || []) as Array<{
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        modifiedTime?: string;
      }>;

      for (const file of files) {
        if (file.mimeType === FOLDER_MIME) {
          await ctx.scheduler.runAfter(
            0,
            internal.googleDrive.actions.importFolderRecursive,
            {
              userId: args.userId,
              orgId: args.orgId,
              driveFolderId: file.id,
              driveFolderName: file.name,
              targetParentFolderId: localFolderId,
            }
          );
        } else {
          const isGoogleDoc = file.mimeType in GOOGLE_EXPORT_MAP;
          const isDirectlySupported = SUPPORTED_MIME_TYPES.has(file.mimeType);

          if (isGoogleDoc || isDirectlySupported) {
            await ctx.scheduler.runAfter(
              0,
              internal.googleDrive.actions.importFile,
              {
                userId: args.userId,
                orgId: args.orgId,
                driveFileId: file.id,
                driveName: file.name,
                driveMimeType: file.mimeType,
                driveModifiedTime: file.modifiedTime || "",
                targetFolderId: localFolderId,
              }
            );
          }
        }
      }

      console.log(
        `Drive folder import started: ${args.driveFolderName} → ${localFolderId} (${files.length} items)`
      );
    } catch (error) {
      console.error(
        `Drive folder import failed for ${args.driveFolderName}:`,
        error
      );
      throw error;
    }
  },
});
