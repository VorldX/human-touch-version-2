import "server-only";

import { featureFlags } from "@/lib/config/feature-flags";
import { legacyMemoryService } from "@/lib/memory/legacy-memory-service";
import type { MemoryService } from "@/lib/memory/memory-service";

// Migration adapter:
// - false => legacy memory remains source-of-truth.
// - true  => same adapter now, can be swapped to the new unified backend implementation later.
export const memoryService: MemoryService = featureFlags.useNewMemoryService
  ? legacyMemoryService
  : legacyMemoryService;

export * from "@/lib/memory/memory-service";
