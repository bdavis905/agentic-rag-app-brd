"use node";

/**
 * Hybrid search action — orchestrates vector search, text search, RRF fusion, and reranking.
 */
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

import { getEmbeddings } from "../ingestion/embedding";

export const hybridSearch = internalAction({
  args: {
    query: v.string(),
    userId: v.optional(v.string()),
    orgId: v.optional(v.string()),
    topK: v.optional(v.number()),
    searchMode: v.optional(
      v.union(v.literal("hybrid"), v.literal("vector"), v.literal("keyword")),
    ),
  },
  handler: async (ctx, args) => {
    const topK = args.topK ?? 5;
    const searchMode = args.searchMode ?? "hybrid";
    const candidateCount = 4 * topK;

    // Get settings (scoped to org if available)
    const settings = args.orgId
      ? await ctx.runQuery(internal.settings.queries.getFullSettings, { orgId: args.orgId })
      : await ctx.runQuery(internal.documents.internals.getSettings, {});

    const embeddingApiKey = settings?.embeddingApiKey || process.env.EMBEDDING_API_KEY;
    const embeddingBaseUrl = settings?.embeddingBaseUrl || process.env.EMBEDDING_BASE_URL;
    if (!embeddingApiKey) {
      throw new Error("Embedding API key not configured. Set it in Settings or as EMBEDDING_API_KEY env var.");
    }

    const embeddingModel =
      settings?.embeddingModel ?? "text-embedding-3-small";
    const embeddingDimensions = settings?.embeddingDimensions ?? 1536;

    // Build filter args for search internals
    const filterArgs = args.orgId
      ? { orgId: args.orgId }
      : { userId: args.userId };

    // Keyword-only search (no embedding needed)
    if (searchMode === "keyword") {
      const textResults = await ctx.runQuery(
        internal.search.internals.textSearchQuery,
        { query: args.query, ...filterArgs, limit: candidateCount },
      );
      const reranked = await rerankDocuments(
        args.query,
        textResults,
        topK,
        settings,
      );
      return reranked.slice(0, topK);
    }

    // Embed the query
    const [queryEmbedding] = await getEmbeddings([args.query], {
      apiKey: embeddingApiKey,
      baseUrl: embeddingBaseUrl,
      model: embeddingModel,
      dimensions: embeddingDimensions,
    });

    // Vector-only search
    if (searchMode === "vector") {
      const vectorResults = await ctx.runAction(
        internal.search.internals.vectorSearchAction,
        {
          embedding: queryEmbedding,
          ...filterArgs,
          limit: candidateCount,
        },
      );
      const reranked = await rerankDocuments(
        args.query,
        vectorResults,
        topK,
        settings,
      );
      return reranked.slice(0, topK);
    }

    // Hybrid: run vector and text search in parallel, fuse with RRF
    const [vectorResults, textResults] = await Promise.all([
      ctx.runAction(internal.search.internals.vectorSearchAction, {
        embedding: queryEmbedding,
        ...filterArgs,
        limit: candidateCount,
      }),
      ctx.runQuery(internal.search.internals.textSearchQuery, {
        query: args.query,
        ...filterArgs,
        limit: candidateCount,
      }),
    ]);

    if (!vectorResults.length && !textResults.length) {
      return [];
    }

    const fused = reciprocalRankFusion([vectorResults, textResults]);
    const reranked = await rerankDocuments(
      args.query,
      fused.slice(0, candidateCount),
      topK,
      settings?.rerankTopN,
    );
    return reranked.slice(0, topK);
  },
});

function reciprocalRankFusion(resultLists: any[][], k: number = 60): any[] {
  const scores = new Map<string, number>();
  const docs = new Map<string, any>();

  for (const resultList of resultLists) {
    for (let rank = 0; rank < resultList.length; rank++) {
      const doc = resultList[rank];
      const docId = doc._id;
      scores.set(docId, (scores.get(docId) ?? 0) + 1.0 / (k + rank + 1));
      if (!docs.has(docId)) {
        docs.set(docId, { ...doc });
      }
    }
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([docId, score]) => ({
      ...docs.get(docId)!,
      rrfScore: score,
    }));
}

async function rerankDocuments(
  query: string,
  documents: any[],
  topN: number,
  settings?: any | null,
): Promise<any[]> {
  const rerankApiKey = settings?.rerankApiKey || process.env.RERANK_API_KEY;
  const rerankBaseUrl = settings?.rerankBaseUrl || process.env.RERANK_BASE_URL;

  if (!rerankApiKey || !rerankBaseUrl || documents.length === 0) {
    return documents;
  }

  const effectiveTopN = settings?.rerankTopN ?? topN;
  const rerankModel = settings?.rerankModel ?? "rerank-v3.5";

  try {
    const texts = documents.map((d) => d.content ?? "");
    const response = await fetch(
      `${rerankBaseUrl.replace(/\/+$/, "")}/rerank`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${rerankApiKey}`,
        },
        body: JSON.stringify({
          model: rerankModel,
          query,
          documents: texts,
          top_n: effectiveTopN,
        }),
      },
    );

    if (!response.ok) {
      console.warn(`Reranking failed: ${response.status}`);
      return documents;
    }

    const data = await response.json();
    const results = data.results ?? [];

    return results
      .filter((item: any) => item.index < documents.length)
      .map((item: any) => ({
        ...documents[item.index],
        rerankScore: item.relevance_score ?? 0,
      }));
  } catch (error) {
    console.warn("Reranking failed, returning original results:", error);
    return documents;
  }
}
