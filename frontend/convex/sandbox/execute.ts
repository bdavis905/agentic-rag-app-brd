"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { Sandbox } from "@e2b/code-interpreter";

/** Infer MIME type from filename extension for Convex storage. */
function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    csv: "text/csv",
    json: "application/json",
    txt: "text/plain",
    html: "text/html",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ppt: "application/vnd.ms-powerpoint",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    zip: "application/zip",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
  };
  return mimeMap[ext] ?? "application/octet-stream";
}

/**
 * Execute Python code in an E2B sandbox.
 * Returns stdout, stderr, error info, and any generated files uploaded to Convex storage.
 */
export const execute = internalAction({
  args: {
    code: v.string(),
    libraries: v.optional(v.array(v.string())),
    outputFilenames: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{
    stdout: string;
    stderr: string;
    error: string | null;
    files: Array<{ name: string; storageId: string; size: number }>;
    png: string | null;
  }> => {
    const apiKey = process.env.E2B_API_KEY;
    if (!apiKey) {
      return {
        stdout: "",
        stderr: "",
        error: "E2B_API_KEY not configured.",
        files: [],
        png: null,
      };
    }

    const templateId = process.env.E2B_TEMPLATE_ID;

    let sbx: Sandbox | null = null;
    try {
      // Create a fresh sandbox (stateless per execution for MVP)
      // Use custom template if configured (pre-installed packages = faster cold starts)
      sbx = await Sandbox.create(templateId || undefined, { apiKey, timeoutMs: 60_000 });

      // Build the code to execute, prepending pip installs if needed
      // Skip pip preamble if using a custom template (packages are pre-installed)
      let codeToRun = args.code;
      if (!templateId && args.libraries && args.libraries.length > 0) {
        // Prepend pip install as subprocess call so packages are available to the same runtime
        const libList = args.libraries.map((l) => JSON.stringify(l)).join(", ");
        const pipPreamble = `import subprocess as _sp; _sp.run(["pip", "install", "-q", ${libList}], check=True)\n`;
        codeToRun = pipPreamble + codeToRun;
      }

      // Execute the user's code
      const execution = await sbx.runCode(codeToRun);

      const stdout = execution.logs.stdout.join("\n");
      const stderr = execution.logs.stderr.join("\n");
      const error = execution.error
        ? `${execution.error.name}: ${execution.error.value}\n${execution.error.traceback}`
        : null;

      // Check for inline PNG results (matplotlib plots, etc.)
      let png: string | null = null;
      for (const result of execution.results) {
        if (result.png) {
          png = result.png; // base64-encoded PNG
          break;
        }
      }

      // Read and upload any specified output files
      const files: Array<{ name: string; storageId: string; size: number }> = [];
      if (args.outputFilenames && args.outputFilenames.length > 0) {
        for (const filename of args.outputFilenames) {
          try {
            const filePath = filename.startsWith("/")
              ? filename
              : `/home/user/${filename}`;
            const fileBytes = await sbx.files.read(filePath, {
              format: "bytes",
            });

            // Upload to Convex storage with proper MIME type
            const mimeType = getMimeType(filename);
            const blob = new Blob([fileBytes], { type: mimeType });
            const storageId = await ctx.storage.store(blob);

            files.push({
              name: filename,
              storageId,
              size: fileBytes.byteLength,
            });
          } catch (fileErr: any) {
            // File might not exist if code errored — skip silently
            console.warn(
              `Could not read output file ${filename}: ${fileErr.message}`
            );
          }
        }
      }

      return { stdout, stderr, error, files, png };
    } catch (e: any) {
      return {
        stdout: "",
        stderr: "",
        error: `Sandbox error: ${e.message}`,
        files: [],
        png: null,
      };
    } finally {
      if (sbx) {
        try {
          await sbx.kill();
        } catch {
          // Best-effort cleanup
        }
      }
    }
  },
});
