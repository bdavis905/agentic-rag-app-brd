/**
 * OpenAI-compatible embedding API calls with batching.
 */
import OpenAI from "openai";

const BATCH_SIZE = 250;

export interface EmbeddingOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  dimensions: number;
}

export async function getEmbeddings(
  texts: string[],
  opts: EmbeddingOptions,
): Promise<number[][]> {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    ...(opts.baseUrl && { baseURL: opts.baseUrl }),
  });

  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await client.embeddings.create({
      model: opts.model,
      input: batch,
      dimensions: opts.dimensions,
    });
    allEmbeddings.push(...response.data.map((item) => item.embedding));
  }

  return allEmbeddings;
}
