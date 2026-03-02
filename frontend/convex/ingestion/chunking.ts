/**
 * Recursive character text splitter — no external dependencies.
 * Ported from backend/app/services/chunking_service.py.
 */

export function chunkText(
  text: string,
  chunkSize: number = 1000,
  chunkOverlap: number = 200,
  separators: string[] = ["\n\n", "\n", ". ", " "],
): string[] {
  if (text.length <= chunkSize) {
    const trimmed = text.trim();
    return trimmed ? [trimmed] : [];
  }

  // Find the best separator (largest that exists in the text)
  let separator = separators[separators.length - 1];
  for (const sep of separators) {
    if (text.includes(sep)) {
      separator = sep;
      break;
    }
  }

  // Split by the chosen separator
  const splits = text.split(separator);

  // Merge splits into chunks
  const chunks: string[] = [];
  let currentChunk = "";

  for (const split of splits) {
    const piece = currentChunk ? separator + split : split;

    if (currentChunk.length + piece.length <= chunkSize) {
      currentChunk += piece;
    } else {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      // Start new chunk with overlap from previous
      if (chunkOverlap > 0 && currentChunk) {
        const overlapText = currentChunk.slice(-chunkOverlap);
        currentChunk = overlapText + separator + split;
      } else {
        currentChunk = split;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // Recursively split any chunks that are still too large
  const separatorIndex = separators.indexOf(separator);
  const remainingSeparators =
    separatorIndex >= 0 ? separators.slice(separatorIndex + 1) : [];

  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length > chunkSize && remainingSeparators.length > 0) {
      finalChunks.push(
        ...chunkText(chunk, chunkSize, chunkOverlap, remainingSeparators),
      );
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks;
}
