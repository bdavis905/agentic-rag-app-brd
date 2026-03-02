/**
 * Text extraction from various file formats.
 * Imported by the processDocument action (runs in Node.js runtime).
 *
 * Uses dynamic imports to avoid loading Node-only modules during
 * Convex's V8 module analysis phase.
 */

export async function extractText(
  fileBuffer: ArrayBuffer,
  fileType: string,
): Promise<string> {
  // Plain text and markdown — simple UTF-8 decode
  if (fileType === "text/plain" || fileType === "text/markdown") {
    return new TextDecoder("utf-8").decode(fileBuffer);
  }

  // PDF
  if (fileType === "application/pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  // DOCX
  if (
    fileType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammothModule = await import("mammoth");
    const mammoth = mammothModule.default ?? mammothModule;
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(fileBuffer),
    });
    return result.value;
  }

  throw new Error(`Unsupported file type: ${fileType}`);
}
