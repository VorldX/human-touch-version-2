import assert from "node:assert/strict";
import test from "node:test";

import { mapLegacyEventToQueueJob } from "../lib/queue/event-mapper.ts";

test("maps flow launch to RUN_CREATED", () => {
  const mapped = mapLegacyEventToQueueJob({
    name: "vorldx/flow.launched",
    data: {
      orgId: "org-1",
      flowId: "flow-1",
      prompt: "Ship migration",
      executionMode: "BALANCED"
    }
  });

  assert.ok(mapped);
  assert.equal(mapped?.name, "RUN_CREATED");
  assert.equal(mapped?.orgId, "org-1");
  assert.equal(mapped?.runId, "flow-1");
  if (!mapped) return;
  assert.equal(mapped.payload.prompt, "Ship migration");
});

test("maps task completion to TASK_COMPLETED", () => {
  const mapped = mapLegacyEventToQueueJob({
    name: "vorldx/task.completed",
    data: {
      orgId: "org-1",
      flowId: "flow-1",
      taskId: "task-1",
      outputHash: "abc"
    }
  });

  assert.ok(mapped);
  assert.equal(mapped?.name, "TASK_COMPLETED");
  if (!mapped || mapped.name !== "TASK_COMPLETED") return;
  assert.equal(mapped.payload.taskId, "task-1");
  assert.equal(mapped.payload.outputHash, "abc");
});

test("returns null when mapping identity is missing", () => {
  const mapped = mapLegacyEventToQueueJob({
    name: "vorldx/task.completed",
    data: {
      flowId: "flow-1",
      taskId: "task-1"
    }
  });

  assert.equal(mapped, null);
});
