import assert from "node:assert/strict";
import test from "node:test";

import { resolveEditableStringDraft } from "../components/vorldx-shell/shared.ts";
import type { ControlThreadHistoryItem, EditableStringDraft } from "../components/vorldx-shell/shared.ts";

function buildStringItem(): ControlThreadHistoryItem {
  const plan = {
    summary: "Launch summary",
    deliverables: ["Launch brief"],
    milestones: [
      {
        title: "Checklist ready",
        ownerRole: "Ops",
        dueWindow: "Today",
        deliverable: "Checklist",
        successSignal: "Shared with the team"
      }
    ],
    approvalCheckpoints: [
      {
        name: "Founder sign-off",
        trigger: "Before send",
        requiredRole: "Founder",
        reason: "Brand risk"
      }
    ],
    pathway: [
      {
        stepId: "pathway-0",
        line: 1,
        workflowTitle: "Plan launch",
        taskTitle: "Create checklist",
        ownerRole: "Ops",
        executionMode: "HUMAN" as const,
        trigger: "Direction approved",
        dueWindow: "Today",
        dependsOn: []
      }
    ],
    workflows: [
      {
        title: "Plan launch",
        goal: "Prepare launch assets",
        ownerRole: "Ops",
        tasks: [
          {
            title: "Create checklist",
            ownerRole: "Ops",
            subtasks: [],
            tools: [],
            requiresApproval: false,
            approvalRole: "",
            approvalReason: ""
          }
        ],
        deliverables: ["Launch brief"]
      }
    ],
    risks: [],
    successMetrics: []
  };

  return {
    id: "string-1",
    title: "Launch",
    mode: "DIRECTION",
    updatedAt: Date.now(),
    turns: [],
    directionGiven: "Ship the launch",
    planningResult: {
      analysis: "Launch analysis",
      directionGiven: "Ship the launch",
      primaryPlan: plan,
      fallbackPlan: plan
    }
  };
}

test("resolveEditableStringDraft refreshes generated sections while keeping custom entries", () => {
  const stringItem = buildStringItem();
  const existingDraft: EditableStringDraft = {
    discussion: [],
    direction: "Ship the launch",
    plan: {
      summary: "Older summary",
      deliverablesText: "Older deliverable"
    },
    workflows: [
      {
        id: "workflow-0",
        title: "Old workflow title",
        ownerRole: "Old owner",
        goal: "Old goal",
        deliverablesText: "Old workflow deliverable",
        taskSummary: "Old workflow task"
      },
      {
        id: "workflow-custom",
        title: "Custom workflow",
        ownerRole: "Founder",
        goal: "",
        deliverablesText: "",
        taskSummary: ""
      }
    ],
    pathway: [
      {
        id: "pathway-0",
        workflowTitle: "Old pathway workflow",
        taskTitle: "Old pathway task",
        ownerRole: "Old owner",
        executionMode: "AGENT",
        trigger: "Old trigger",
        dueWindow: "Tomorrow"
      },
      {
        id: "pathway-custom",
        workflowTitle: "Custom path",
        taskTitle: "",
        ownerRole: "",
        executionMode: "HUMAN",
        trigger: "",
        dueWindow: ""
      }
    ],
    approvals: [
      {
        id: "plan-approval-0",
        title: "Old approval title",
        owner: "Old owner",
        reason: "Old reason",
        status: "OLD"
      },
      {
        id: "approval-custom",
        title: "Custom approval",
        owner: "Founder",
        reason: "Manual gate",
        status: "CUSTOM"
      }
    ],
    milestones: [
      {
        id: "milestone-0",
        title: "Old milestone title",
        ownerRole: "Old owner",
        dueWindow: "Tomorrow",
        deliverable: "Old milestone deliverable",
        successSignal: "Old signal"
      },
      {
        id: "milestone-custom",
        title: "Custom milestone",
        ownerRole: "",
        dueWindow: "",
        deliverable: "",
        successSignal: ""
      }
    ],
    scoring: {
      detailScore: "",
      note: ""
    }
  };

  const resolved = resolveEditableStringDraft({
    draft: existingDraft,
    stringItem,
    permissionRequests: [],
    approvalCheckpoints: []
  });

  assert.equal(resolved.workflows[0]?.title, "Plan launch");
  assert.equal(resolved.workflows[0]?.taskSummary, "Create checklist");
  assert.equal(resolved.workflows.some((entry) => entry.id === "workflow-custom"), true);

  assert.equal(resolved.pathway[0]?.workflowTitle, "Plan launch");
  assert.equal(resolved.pathway[0]?.taskTitle, "Create checklist");
  assert.equal(resolved.pathway.some((entry) => entry.id === "pathway-custom"), true);

  assert.equal(resolved.approvals[0]?.title, "Founder sign-off");
  assert.equal(resolved.approvals[0]?.reason, "Brand risk");
  assert.equal(resolved.approvals.some((entry) => entry.id === "approval-custom"), true);

  assert.equal(resolved.milestones[0]?.title, "Checklist ready");
  assert.equal(resolved.milestones[0]?.deliverable, "Checklist");
  assert.equal(resolved.milestones.some((entry) => entry.id === "milestone-custom"), true);
});
