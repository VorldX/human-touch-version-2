import assert from "node:assert/strict";
import test from "node:test";

import { checkAgentCapability } from "../lib/agents/capability-guard.ts";

test("capability guard passes when capabilities and tools are allowed", () => {
  const result = checkAgentCapability({
    agent: {
      id: "agent-1",
      orgId: "org-1",
      role: "MANAGER",
      capabilities: ["tool.execute", "task.delegate"],
      allowedTools: ["gmail", "calendar"],
      policyVersion: "v1",
      status: "ACTIVE"
    },
    requiredCapabilities: ["tool.execute"],
    requiredTools: ["gmail"]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.missingCapabilities, []);
  assert.deepEqual(result.missingTools, []);
});

test("capability guard returns missing capability and tool", () => {
  const result = checkAgentCapability({
    agent: {
      id: "agent-1",
      orgId: "org-1",
      role: "WORKER",
      capabilities: ["task.execute"],
      allowedTools: ["notion"],
      policyVersion: "v1",
      status: "ACTIVE"
    },
    requiredCapabilities: ["tool.execute"],
    requiredTools: ["gmail"]
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missingCapabilities, ["tool.execute"]);
  assert.deepEqual(result.missingTools, ["gmail"]);
});
