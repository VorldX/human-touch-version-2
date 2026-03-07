import assert from "node:assert/strict";
import test from "node:test";

import { selectCompanyContext } from "../lib/ai/context-selector.ts";

test("selector-brain curates company JSON context within budget", () => {
  const companyData = JSON.stringify(
    {
      company: {
        orgId: "org-1",
        name: "Acme Labs",
        description: "AI ops studio for B2B founders",
        executionMode: "BALANCED"
      },
      financials: {
        monthlyBudgetUsd: "1200",
        currentSpendUsd: "132.42"
      },
      founder: {
        username: "acmefounder",
        email: "founder@acme.test"
      },
      orchestration: {
        primaryProvider: "gemini",
        primaryModel: "gemini-2.5-flash"
      },
      oauthProviders: ["gmail", "googlecalendar", "slack"],
      operations: {
        process: "Draft message, create meeting invite, send confirmation email to attendee."
      }
    },
    null,
    2
  );

  const result = selectCompanyContext({
    mode: "direction-chat",
    companyDataText: companyData,
    primaryText: "Set up a meeting and send invite email using calendar",
    history: [{ role: "owner", content: "Need a calendar invite + email workflow." }],
    maxSelectedChars: 700,
    maxChunkChars: 240
  });

  assert.equal(result.trace.strategy, "json");
  assert.ok(result.trace.totalChunks >= result.trace.selectedChunks);
  assert.ok(result.trace.discardedChunks >= 0);
  assert.ok(result.trace.selectedChars <= 700);
  assert.match(result.contextText, /calendar|gmail|invite/i);
});

test("selector-brain falls back to text chunking for plain text company data", () => {
  const result = selectCompanyContext({
    mode: "direction-plan",
    companyDataText: [
      "Team Playbook",
      "",
      "Meeting operations: Use calendar blocks, agenda templates, and follow-up summaries.",
      "",
      "Finance policy: approvals required above 500 USD."
    ].join("\n"),
    primaryText: "Create a plan for recurring meeting workflows",
    history: [{ role: "owner", content: "Weekly meeting automation with approvals." }],
    maxSelectedChars: 420
  });

  assert.equal(result.trace.strategy, "text");
  assert.ok(result.trace.selectedChunks >= 1);
  assert.ok(result.trace.selectedChars <= 420);
  assert.match(result.contextText, /meeting|workflow|approval/i);
});
