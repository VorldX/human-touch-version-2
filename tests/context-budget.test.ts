import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateTextTokens,
  selectContextBlocksByPriority
} from "../lib/agent/orchestration/context-budget.ts";

test("context budget selector enforces hard token cap and keeps priority order", () => {
  const heavy = "A".repeat(900);
  const result = selectContextBlocksByPriority({
    budgetTokens: 180,
    sectionMaxTokens: 90,
    candidates: [
      {
        id: "p1",
        name: "Priority 1",
        priority: 1,
        relevance: 1,
        amnesiaProtected: false,
        content: heavy
      },
      {
        id: "p2",
        name: "Priority 2",
        priority: 2,
        relevance: 0.8,
        amnesiaProtected: false,
        content: heavy
      },
      {
        id: "p3",
        name: "Priority 3",
        priority: 3,
        relevance: 0.7,
        amnesiaProtected: false,
        content: heavy
      }
    ]
  });

  assert.ok(result.trace.usedTokens <= result.trace.budgetTokens);
  assert.ok(result.blocks.length >= 1);
  assert.equal(result.blocks[0]?.id, "p1");
  assert.ok(result.trace.omittedSections.length >= 1);
});

test("token estimator is deterministic and non-zero", () => {
  assert.equal(estimateTextTokens("abcd"), 1);
  assert.equal(estimateTextTokens("a".repeat(400)), 100);
});
