import assert from "node:assert/strict";
import test from "node:test";

import { isOrganizationGraphEnabledForActor } from "../lib/langgraph/utils/feature-gating.ts";

test("feature gate returns false when disabled globally", () => {
  const enabled = isOrganizationGraphEnabledForActor({
    featureEnabled: false,
    orgAllowlist: [],
    userAllowlist: [],
    orgId: "org-1",
    userId: "user-1"
  });

  assert.equal(enabled, false);
});

test("feature gate supports org-level allowlist", () => {
  const allowed = isOrganizationGraphEnabledForActor({
    featureEnabled: true,
    orgAllowlist: ["org-1", "org-2"],
    userAllowlist: [],
    orgId: "org-1",
    userId: "user-1"
  });
  const blocked = isOrganizationGraphEnabledForActor({
    featureEnabled: true,
    orgAllowlist: ["org-2"],
    userAllowlist: [],
    orgId: "org-1",
    userId: "user-1"
  });

  assert.equal(allowed, true);
  assert.equal(blocked, false);
});

test("feature gate supports user-level allowlist", () => {
  const allowed = isOrganizationGraphEnabledForActor({
    featureEnabled: true,
    orgAllowlist: [],
    userAllowlist: ["user-1"],
    orgId: "org-1",
    userId: "user-1"
  });
  const blocked = isOrganizationGraphEnabledForActor({
    featureEnabled: true,
    orgAllowlist: [],
    userAllowlist: ["user-2"],
    orgId: "org-1",
    userId: "user-1"
  });

  assert.equal(allowed, true);
  assert.equal(blocked, false);
});
