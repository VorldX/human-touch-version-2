import assert from "node:assert/strict";
import test from "node:test";

import { buildOrganizationMainAgentPrompt } from "../lib/agent/prompts/organizationMain.ts";

test("organization main prompt includes critical identity and hard rules", () => {
  const prompt = buildOrganizationMainAgentPrompt({
    orgName: "Acme",
    mode: "chat",
    contextAvailable: true,
    includeDirectionSection: false
  });

  assert.match(prompt, /You are the Organization\./);
  assert.match(prompt, /Do not bypass approvals\./);
  assert.match(prompt, /Do not bypass Composio-integrated tool paths\./);
  assert.match(prompt, /Use tools through the existing platform execution system\./);
});

test("chat mode toggles Direction section guidance", () => {
  const withDirection = buildOrganizationMainAgentPrompt({
    orgName: "Acme",
    mode: "chat",
    contextAvailable: true,
    includeDirectionSection: true
  });
  const withoutDirection = buildOrganizationMainAgentPrompt({
    orgName: "Acme",
    mode: "chat",
    contextAvailable: true,
    includeDirectionSection: false
  });

  assert.match(withDirection, /Include a final `Direction:` section/);
  assert.match(withoutDirection, /Do not append `Direction:` unless execution\/planning intent is explicit\./);
});

test("planning mode enforces machine-parseable output behavior", () => {
  const prompt = buildOrganizationMainAgentPrompt({
    orgName: "Acme",
    mode: "planning",
    contextAvailable: false
  });

  assert.match(prompt, /operate in planning mode/i);
  assert.match(prompt, /Return machine-parseable output exactly in the schema requested/);
  assert.match(prompt, /If company context is missing, request only the minimum clarification needed\./);
});
