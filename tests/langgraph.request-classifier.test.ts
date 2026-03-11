import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRequestType,
  inferTeamIntent,
  isTeamOrchestrationRequest
} from "../lib/langgraph/utils/request-classifier.ts";

test("classifies team creation intent", () => {
  const requestType = classifyRequestType("Start my marketing team");
  assert.equal(requestType, "TEAM_CREATION_REQUEST");
  assert.equal(isTeamOrchestrationRequest(requestType), true);
});

test("classifies team update intent", () => {
  const requestType = classifyRequestType("Update my sales team structure");
  assert.equal(requestType, "TEAM_UPDATE_REQUEST");
});

test("classifies team activation intent", () => {
  const requestType = classifyRequestType("Activate the research squad");
  assert.equal(requestType, "TEAM_ACTIVATION_REQUEST");
});

test("keeps normal requests out of team flow", () => {
  const requestType = classifyRequestType("Summarize this report");
  assert.equal(requestType, "NORMAL_SWARM_REQUEST");
  assert.equal(isTeamOrchestrationRequest(requestType), false);
});

test("infers team type and operation", () => {
  const intent = inferTeamIntent("Create a product team for launch planning");
  assert.equal(intent.requested, true);
  assert.equal(intent.operation, "CREATE");
  assert.equal(intent.teamType, "product");
});
