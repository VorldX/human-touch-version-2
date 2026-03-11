import assert from "node:assert/strict";
import test from "node:test";

import {
  extractSemanticFacts,
  scoreMemoryCandidate,
  summarizeMemoryContent
} from "../lib/agent/memory/scoring.ts";

test("scoreMemoryCandidate persists high-signal final outputs", () => {
  const scored = scoreMemoryCandidate({
    content:
      "Agent completed onboarding workflow, created summary, and identified next follow-up actions for the team.",
    summary: "Workflow completed with actionable outcomes.",
    memoryType: "EPISODIC",
    source: "final_output",
    tags: ["final_output", "outcome"],
    importanceHint: 0.9
  });

  assert.equal(scored.persist, true);
  assert.ok(scored.score >= 0.52);
});

test("scoreMemoryCandidate rejects low-information chatter", () => {
  const scored = scoreMemoryCandidate({
    content: "ok",
    memoryType: "WORKING",
    source: "chat_message",
    tags: [],
    importanceHint: 0.1
  });

  assert.equal(scored.persist, false);
  assert.ok(scored.score < 0.52);
});

test("extractSemanticFacts captures preferences and constraints", () => {
  const facts = extractSemanticFacts(
    "My name is Riya. I prefer concise status updates. Timezone is Asia/Kolkata. Never schedule meetings after 7 pm."
  );

  assert.ok(facts.some((fact) => fact.includes("name:")));
  assert.ok(facts.some((fact) => fact.includes("preference:")));
  assert.ok(facts.some((fact) => fact.includes("timezone:")));
  assert.ok(facts.some((fact) => fact.includes("constraint:")));
});

test("summarizeMemoryContent trims long text", () => {
  const longText = "A".repeat(500);
  const summary = summarizeMemoryContent(longText, 80);

  assert.ok(summary.length <= 80);
  assert.ok(summary.endsWith("..."));
});
