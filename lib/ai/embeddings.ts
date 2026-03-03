import "server-only";

import { createHash } from "node:crypto";

const DEFAULT_DIMENSIONS = 1536;

export function createDeterministicEmbedding(
  text: string,
  dimensions = DEFAULT_DIMENSIONS
) {
  const source = text.trim() || "empty";
  const vector: number[] = [];

  for (let i = 0; i < dimensions; i += 1) {
    const digest = createHash("sha256")
      .update(`${i}:${source}`)
      .digest();
    const value = digest.readUInt16BE(0) / 65535;
    const normalized = value * 2 - 1;
    vector.push(Number(normalized.toFixed(6)));
  }

  return vector;
}

export function toPgVectorLiteral(vector: number[]) {
  return `[${vector.join(",")}]`;
}

