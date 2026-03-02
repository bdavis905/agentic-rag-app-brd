/**
 * Internal queries for KB navigation tools (ls, tree, grep, glob, read).
 * Called from the HTTP Action chat handler via ctx.runQuery.
 *
 * Now uses orgId for data isolation. Falls back to userId for backward compat.
 */
import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

const MAX_READ_LINES = 500;

// ─── ls ──────────────────────────────────────────────────────────

export const ls = internalQuery({
  args: {
    path: v.string(),
    userId: v.optional(v.string()),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const isRoot = args.path.toLowerCase() === "root";
    let folderName = "root";

    if (!isRoot) {
      const folder = await ctx.db.get(args.path as any);
      if (!folder) return `Error: Folder not found (id: ${args.path})`;
      folderName = folder.name;
    }

    // Get subfolders
    const filterIdx = args.orgId ? "by_org" : "by_user";
    const filterVal = args.orgId ?? args.userId;

    const allFolders = await ctx.db
      .query("folders")
      .withIndex(filterIdx, (q: any) => q.eq(args.orgId ? "orgId" : "userId", filterVal))
      .collect();

    const subfolders = allFolders.filter((f) =>
      isRoot ? !f.parentId : String(f.parentId) === args.path,
    );

    // Get documents
    const docIdx = args.orgId ? "by_org" : "by_user";
    const allDocs = await ctx.db
      .query("documents")
      .withIndex(docIdx, (q: any) => q.eq(args.orgId ? "orgId" : "userId", filterVal))
      .collect();

    const docs = allDocs.filter(
      (d) =>
        d.status === "completed" &&
        (isRoot ? !d.folderId : String(d.folderId) === args.path),
    );

    const lines = [`Contents of '${folderName}':`, ""];

    if (subfolders.length > 0) {
      lines.push("Folders:");
      for (const f of subfolders.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        lines.push(`  ${f.name}/ (id: ${f._id})`);
      }
      lines.push("");
    }

    if (docs.length > 0) {
      lines.push("Documents:");
      for (const d of docs.sort((a, b) =>
        a.filename.localeCompare(b.filename),
      )) {
        const prefix = isRoot ? "[unfiled] " : "";
        lines.push(`  ${prefix}${d.filename} (id: ${d._id})`);
      }
      lines.push("");
    }

    if (subfolders.length === 0 && docs.length === 0) {
      lines.push("(empty)");
    }

    return lines.join("\n").trimEnd();
  },
});

// ─── tree ────────────────────────────────────────────────────────

export const tree = internalQuery({
  args: {
    path: v.string(),
    userId: v.optional(v.string()),
    orgId: v.optional(v.string()),
    depth: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxDepth = Math.min(Math.max(args.depth ?? 3, 1), 10);
    const maxItems = Math.min(Math.max(args.limit ?? 50, 10), 200);
    const isRoot = args.path.toLowerCase() === "root";

    let rootName = "root";
    if (!isRoot) {
      const folder = await ctx.db.get(args.path as any);
      if (!folder) return `Error: Folder not found (id: ${args.path})`;
      rootName = folder.name;
    }

    const filterIdx = args.orgId ? "by_org" : "by_user";
    const filterVal = args.orgId ?? args.userId;

    const allFolders = await ctx.db
      .query("folders")
      .withIndex(filterIdx, (q: any) => q.eq(args.orgId ? "orgId" : "userId", filterVal))
      .collect();

    const allDocs = await ctx.db
      .query("documents")
      .withIndex(args.orgId ? "by_org" : "by_user", (q: any) =>
        q.eq(args.orgId ? "orgId" : "userId", filterVal))
      .collect();

    const completedDocs = allDocs.filter((d) => d.status === "completed");

    const lines = [`${rootName}/`];
    let itemCount = 1;
    let truncated = false;

    function addFolder(
      folderId: string | null,
      indent: number,
      currentDepth: number,
    ) {
      if (currentDepth > maxDepth || truncated) return;

      const children = allFolders
        .filter((f) =>
          folderId === null
            ? !f.parentId
            : String(f.parentId) === folderId,
        )
        .sort((a, b) => a.name.localeCompare(b.name));

      if (folderId === null) {
        const unfiled = completedDocs
          .filter((d) => !d.folderId)
          .sort((a, b) => a.filename.localeCompare(b.filename));
        for (const doc of unfiled) {
          if (itemCount >= maxItems) {
            truncated = true;
            return;
          }
          lines.push(`${"  ".repeat(indent)}[unfiled] ${doc.filename}`);
          itemCount++;
        }
      }

      for (const folder of children) {
        if (itemCount >= maxItems) {
          truncated = true;
          return;
        }
        lines.push(`${"  ".repeat(indent)}${folder.name}/`);
        itemCount++;

        const folderDocs = completedDocs
          .filter((d) => String(d.folderId) === String(folder._id))
          .sort((a, b) => a.filename.localeCompare(b.filename));
        for (const doc of folderDocs) {
          if (itemCount >= maxItems) {
            truncated = true;
            return;
          }
          lines.push(`${"  ".repeat(indent + 1)}${doc.filename}`);
          itemCount++;
        }

        addFolder(String(folder._id), indent + 1, currentDepth + 1);
      }
    }

    const startId = isRoot ? null : args.path;
    addFolder(startId, 1, 1);

    if (truncated) {
      lines.push("");
      lines.push(`... (truncated at ${maxItems} items)`);
    }

    return lines.join("\n");
  },
});

// ─── grep ────────────────────────────────────────────────────────

export const grep = internalQuery({
  args: {
    pattern: v.string(),
    userId: v.optional(v.string()),
    orgId: v.optional(v.string()),
    path: v.optional(v.string()),
    caseSensitive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const caseSensitive = args.caseSensitive ?? false;

    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern, caseSensitive ? "" : "i");
    } catch (e: any) {
      return `Error: Invalid regex pattern '${args.pattern}': ${e.message}`;
    }

    const filterVal = args.orgId ?? args.userId;
    const filterIdx = args.orgId ? "by_org" : "by_user";

    const scopePath = args.path?.toLowerCase() === "root" ? null : args.path;
    let scopeFolderIds: Set<string> | null = null;

    if (scopePath) {
      const allFolders = await ctx.db
        .query("folders")
        .withIndex(filterIdx, (q: any) => q.eq(args.orgId ? "orgId" : "userId", filterVal))
        .collect();

      scopeFolderIds = new Set([scopePath]);
      let frontier = [scopePath];
      while (frontier.length > 0) {
        const nextFrontier: string[] = [];
        for (const fid of frontier) {
          for (const f of allFolders) {
            if (String(f.parentId) === fid) {
              scopeFolderIds.add(String(f._id));
              nextFrontier.push(String(f._id));
            }
          }
        }
        frontier = nextFrontier;
      }
    }

    const allDocs = await ctx.db
      .query("documents")
      .withIndex(filterIdx, (q: any) => q.eq(args.orgId ? "orgId" : "userId", filterVal))
      .collect();

    const docs = allDocs.filter((d) => {
      if (d.status !== "completed" || !d.fullText) return false;
      if (scopeFolderIds) {
        const fid = d.folderId ? String(d.folderId) : null;
        return fid !== null && scopeFolderIds.has(fid);
      }
      return true;
    });

    const matches: Array<{
      id: string;
      filename: string;
      lines: Array<[number, string]>;
    }> = [];

    for (const doc of docs) {
      const textLines = doc.fullText!.split("\n");
      const matchingLines: Array<[number, string]> = [];

      for (let i = 0; i < textLines.length; i++) {
        if (regex.test(textLines[i])) {
          const excerpt =
            textLines[i].length > 200
              ? textLines[i].slice(0, 200) + "..."
              : textLines[i];
          matchingLines.push([i + 1, excerpt.trim()]);
          if (matchingLines.length >= 5) break;
        }
      }

      if (matchingLines.length > 0) {
        matches.push({
          id: String(doc._id),
          filename: doc.filename,
          lines: matchingLines,
        });
        if (matches.length >= 20) break;
      }
    }

    if (matches.length === 0) {
      return `No documents found matching '${args.pattern}'.`;
    }

    const outputLines = [
      `Found ${matches.length} document(s) matching '${args.pattern}':`,
      "",
    ];
    for (const match of matches) {
      outputLines.push(`**${match.filename}** (id: ${match.id})`);
      for (const [lineNum, excerpt] of match.lines) {
        outputLines.push(`  Line ${lineNum}: ${excerpt}`);
      }
      outputLines.push("");
    }

    return outputLines.join("\n").trimEnd();
  },
});

// ─── glob ────────────────────────────────────────────────────────

export const glob = internalQuery({
  args: {
    pattern: v.string(),
    userId: v.optional(v.string()),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const filterVal = args.orgId ?? args.userId;
    const filterIdx = args.orgId ? "by_org" : "by_user";

    const allDocs = await ctx.db
      .query("documents")
      .withIndex(filterIdx, (q: any) => q.eq(args.orgId ? "orgId" : "userId", filterVal))
      .collect();

    const docs = allDocs.filter((d) => d.status === "completed");

    function matchGlob(filename: string, pattern: string): boolean {
      const regexStr = pattern
        .toLowerCase()
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "<<GLOBSTAR>>")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".")
        .replace(/<<GLOBSTAR>>/g, ".*");
      return new RegExp(`^${regexStr}$`).test(filename.toLowerCase());
    }

    const hasPath = args.pattern.includes("/") || args.pattern.includes("**");
    const allFolders = hasPath
      ? await ctx.db
          .query("folders")
          .withIndex(filterIdx, (q: any) => q.eq(args.orgId ? "orgId" : "userId", filterVal))
          .collect()
      : [];

    const folderMap = new Map(
      allFolders.map((f) => [String(f._id), f]),
    );

    function buildPath(folderId: string | undefined): string {
      if (!folderId) return "[knowledgebase]";
      const parts: string[] = [];
      let current: string | undefined = folderId;
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        visited.add(current);
        const folder = folderMap.get(current);
        if (!folder) break;
        parts.push(folder.name);
        current = folder.parentId ? String(folder.parentId) : undefined;
      }
      return parts.length > 0
        ? parts.reverse().join("/")
        : "[knowledgebase]";
    }

    const matches: Array<{
      id: string;
      filename: string;
      folderPath: string;
    }> = [];

    for (const doc of docs) {
      const folderPath = hasPath
        ? buildPath(doc.folderId ? String(doc.folderId) : undefined)
        : "";

      const matchTarget = hasPath
        ? `${folderPath}/${doc.filename}`
        : doc.filename;

      if (matchGlob(matchTarget, args.pattern)) {
        matches.push({
          id: String(doc._id),
          filename: doc.filename,
          folderPath: hasPath
            ? folderPath
            : buildPath(doc.folderId ? String(doc.folderId) : undefined),
        });
        if (matches.length >= 50) break;
      }
    }

    if (matches.length === 0) {
      return `No documents found matching '${args.pattern}'.`;
    }

    const byFolder = new Map<string, typeof matches>();
    for (const m of matches) {
      const existing = byFolder.get(m.folderPath) ?? [];
      existing.push(m);
      byFolder.set(m.folderPath, existing);
    }

    const outputLines = [
      `Found ${matches.length} document(s) matching '${args.pattern}':`,
      "",
    ];

    for (const [folder, folderMatches] of [...byFolder.entries()].sort()) {
      outputLines.push(`${folder}/`);
      for (const m of folderMatches) {
        outputLines.push(`  ${m.filename} (id: ${m.id})`);
      }
      outputLines.push("");
    }

    return outputLines.join("\n").trimEnd();
  },
});

// ─── read ────────────────────────────────────────────────────────

export const read = internalQuery({
  args: {
    documentId: v.string(),
    userId: v.optional(v.string()),
    orgId: v.optional(v.string()),
    startLine: v.optional(v.number()),
    endLine: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let doc;
    try {
      doc = await ctx.db.get(args.documentId as any);
    } catch {
      return `Error: Invalid document ID '${args.documentId}'.`;
    }

    // Check access via orgId or userId
    if (!doc) {
      return `Error: Document not found or access denied (id: ${args.documentId})`;
    }
    if (args.orgId && doc.orgId !== args.orgId) {
      return `Error: Document not found or access denied (id: ${args.documentId})`;
    }
    if (!args.orgId && doc.userId !== args.userId) {
      return `Error: Document not found or access denied (id: ${args.documentId})`;
    }

    if (!doc.fullText) {
      return `Error: Document content not available. Document '${doc.filename}' may need re-ingestion.`;
    }

    const lines = doc.fullText.split("\n");
    const totalLines = lines.length;

    let actualStart: number;
    let actualEnd: number;
    let truncated = false;

    if (args.startLine == null && args.endLine == null) {
      actualStart = 1;
      actualEnd = Math.min(totalLines, MAX_READ_LINES);
      truncated = totalLines > MAX_READ_LINES;
    } else {
      if (args.startLine != null && args.startLine < 1)
        return `Error: start_line must be >= 1 (got ${args.startLine})`;
      if (args.endLine != null && args.endLine < 1)
        return `Error: end_line must be >= 1 (got ${args.endLine})`;
      if (
        args.startLine != null &&
        args.endLine != null &&
        args.startLine > args.endLine
      )
        return `Error: start_line (${args.startLine}) cannot be greater than end_line (${args.endLine})`;

      actualStart = args.startLine ?? 1;
      actualEnd = args.endLine ?? totalLines;

      if (actualStart > totalLines)
        return `Error: start_line (${actualStart}) exceeds document length (${totalLines} lines)`;

      actualEnd = Math.min(actualEnd, totalLines);

      if (actualEnd - actualStart + 1 > MAX_READ_LINES) {
        actualEnd = actualStart + MAX_READ_LINES - 1;
        truncated = true;
      }
    }

    const selected = lines.slice(actualStart - 1, actualEnd);
    const width = String(actualEnd).length;

    const header =
      actualStart === 1 && actualEnd === totalLines && !truncated
        ? `**Document: ${doc.filename}** (${totalLines} lines)`
        : `**Document: ${doc.filename}** (lines ${actualStart}-${actualEnd} of ${totalLines})`;

    const outputLines = [header, ""];
    for (let i = 0; i < selected.length; i++) {
      const lineNum = String(actualStart + i).padStart(width, " ");
      outputLines.push(`${lineNum}: ${selected[i]}`);
    }

    if (truncated) {
      outputLines.push("");
      outputLines.push(
        `... (truncated at ${MAX_READ_LINES} lines, use line range to read more)`,
      );
    }

    return outputLines.join("\n");
  },
});

// ─── getFullDocument (for analyze_document sub-agent) ────────────

export const getFullDocument = internalQuery({
  args: {
    documentId: v.string(),
    userId: v.optional(v.string()),
    orgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let doc;
    try {
      doc = await ctx.db.get(args.documentId as any);
    } catch {
      return null;
    }

    if (!doc || doc.status !== "completed") return null;

    // Check access
    if (args.orgId && doc.orgId !== args.orgId) return null;
    if (!args.orgId && doc.userId !== args.userId) return null;

    return {
      id: String(doc._id),
      filename: doc.filename,
      content: doc.fullText ?? "",
      tokenEstimate: Math.ceil((doc.fullText?.length ?? 0) / 4),
    };
  },
});
