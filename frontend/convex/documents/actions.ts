"use node";

/**
 * Document processing action — the ingestion pipeline orchestrator.
 * Runs in Node.js runtime for access to pdf-parse, mammoth, OpenAI SDK.
 */
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

import { extractText } from "../ingestion/parsing";
import { chunkText } from "../ingestion/chunking";
import { getEmbeddings } from "../ingestion/embedding";
import { extractMetadata } from "../ingestion/metadata";

/** Chunks per mutation call — keeps argument size under Convex 1MB limit */
const MUTATION_BATCH_SIZE = 50;
/** Max chars for fullText field (Convex 1MB doc limit) */
const MAX_FULL_TEXT_CHARS = 800_000;

export const processDocument = internalAction({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const { documentId } = args;

    const updateStep = async (step: string) => {
      await ctx.runMutation(internal.documents.internals.updateDocumentStatus, {
        documentId,
        status: "processing" as const,
        processingStep: step,
      });
    };

    try {
      // 1. Update status to processing
      await updateStep("Parsing document...");

      // 2. Get document record
      const doc = await ctx.runQuery(
        internal.documents.internals.getDocument,
        { documentId },
      );
      if (!doc) throw new Error(`Document ${documentId} not found`);

      // 3. Download file from Convex storage
      const blob = await ctx.storage.get(doc.storageId);
      if (!blob) throw new Error("File not found in storage");
      const fileBuffer = await blob.arrayBuffer();

      // 4. Extract text
      const text = await extractText(fileBuffer, doc.fileType);
      if (!text.trim()) {
        throw new Error("No text content extracted from document");
      }

      // 5. Chunk text
      await updateStep("Chunking text...");
      const chunks = chunkText(text);
      if (chunks.length === 0) {
        throw new Error("No chunks generated from document");
      }

      // 6. Get settings (use orgId if available)
      const settings = await ctx.runQuery(
        internal.documents.internals.getSettings,
        { orgId: doc.orgId },
      );

      const embeddingApiKey = settings?.embeddingApiKey || process.env.EMBEDDING_API_KEY;
      const embeddingBaseUrl = settings?.embeddingBaseUrl || process.env.EMBEDDING_BASE_URL;
      if (!embeddingApiKey) {
        throw new Error(
          "Embedding API key not configured. Set it in Settings or as EMBEDDING_API_KEY env var.",
        );
      }

      const embeddingModel =
        settings?.embeddingModel ?? "text-embedding-3-small";
      const embeddingDimensions = settings?.embeddingDimensions ?? 1536;

      // 7. Generate embeddings (batched internally at 250 per API call)
      await updateStep("Generating embeddings...");
      const embeddings = await getEmbeddings(chunks, {
        apiKey: embeddingApiKey,
        baseUrl: embeddingBaseUrl,
        model: embeddingModel,
        dimensions: embeddingDimensions,
      });

      // 8. Extract metadata via LLM
      await updateStep("Extracting metadata...");
      const llmApiKey = settings?.llmApiKey || process.env.OPENAI_API_KEY;
      const llmModel = settings?.llmModel ?? "gpt-4o";
      let docMetadata: Record<string, any> = {};

      if (llmApiKey) {
        try {
          docMetadata = await extractMetadata(text, {
            apiKey: llmApiKey,
            model: llmModel,
            baseUrl: settings?.llmBaseUrl || process.env.LLM_BASE_URL,
            schema: settings?.metadataSchema ?? undefined,
          });
        } catch (metadataError) {
          console.error("Metadata extraction failed:", metadataError);
          docMetadata = {
            _extractionError: metadataError instanceof Error
              ? metadataError.message
              : String(metadataError),
          };
        }
      }

      // 9. Store chunks with embeddings in batches — stamp with orgId
      await updateStep("Saving chunks...");
      let totalChunks = 0;
      for (let i = 0; i < chunks.length; i += MUTATION_BATCH_SIZE) {
        const batchChunks = chunks.slice(i, i + MUTATION_BATCH_SIZE);
        const batchEmbeddings = embeddings.slice(i, i + MUTATION_BATCH_SIZE);

        const chunkRecords = batchChunks.map((content, j) => ({
          documentId,
          userId: doc.userId,
          orgId: doc.orgId,
          content,
          chunkIndex: i + j,
          embedding: batchEmbeddings[j],
          metadata: {
            filename: doc.filename,
            chunk_index: i + j,
            ...docMetadata,
          },
        }));

        await ctx.runMutation(internal.documents.internals.insertChunks, {
          chunks: chunkRecords,
        });
        totalChunks += batchChunks.length;
      }

      // 10. Prepare fullText for navigation tools (truncate if needed)
      const fullText =
        text.length > MAX_FULL_TEXT_CHARS
          ? text.slice(0, MAX_FULL_TEXT_CHARS) +
            `\n\n... (truncated at ${MAX_FULL_TEXT_CHARS.toLocaleString()} characters)`
          : text;

      // 11. Update document status to completed
      await ctx.runMutation(internal.documents.internals.updateDocumentStatus, {
        documentId,
        status: "completed" as const,
        chunkCount: totalChunks,
        metadata: docMetadata,
        fullText,
        processingStep: "",
      });

      console.log(
        `Document ${documentId} processed: ${totalChunks} chunks created`,
      );
    } catch (error) {
      console.error(`Error processing document ${documentId}:`, error);
      await ctx.runMutation(internal.documents.internals.updateDocumentStatus, {
        documentId,
        status: "failed" as const,
        errorMessage:
          error instanceof Error ? error.message : String(error),
        processingStep: "",
      });
    }
  },
});
