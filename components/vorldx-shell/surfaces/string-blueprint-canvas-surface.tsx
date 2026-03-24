"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MarkerType, type Edge, type Node } from "reactflow";
import ReactFlow, { Background, Controls, MiniMap } from "reactflow";
import "reactflow/dist/style.css";

import {
  type ApprovalCheckpointItem,
  type ControlThreadHistoryItem,
  type EditableStringDraft,
  type PermissionRequestItem,
  type SteerLaneTab,
  type StringScoreRecord,
  buildDraftDeliverableCards,
  buildStringCollaborationSnapshot,
  compactTaskTitle,
  controlThreadDisplayTitle,
  getScopedApprovalCheckpointsForString,
  getScopedPermissionRequestsForString,
  resolveEditableStringDraft,
  splitDraftLines
} from "@/components/vorldx-shell/shared";

interface StringBlueprintCanvasSurfaceProps {
  themeStyle: {
    accent?: string;
    accentSoft?: string;
    border: string;
  };
  calendarDate?: string | null;
  stringItem: ControlThreadHistoryItem | null;
  allStringItems: ControlThreadHistoryItem[];
  permissionRequests: PermissionRequestItem[];
  approvalCheckpoints: ApprovalCheckpointItem[];
  draftsByString?: Record<string, EditableStringDraft>;
  scoreByString?: Record<string, StringScoreRecord[]>;
  steerDecisions: Record<string, SteerLaneTab>;
  selectedStringId?: string | null;
  onSelectedStringChange?: (value: string | null) => void;
}

type CanvasSection =
  | "STRING"
  | "DISCUSSION"
  | "DIRECTION"
  | "PLAN"
  | "WORKFLOW"
  | "PATHWAY"
  | "WORKING"
  | "SCORING"
  | "COLLABORATION";

interface CanvasNodeMeta {
  id: string;
  stringId: string;
  stringTitle: string;
  section: CanvasSection;
  heading: string;
  summary: string;
  items: string[];
}

interface BlueprintRow {
  item: ControlThreadHistoryItem;
  stringTitle: string;
  draft: EditableStringDraft;
  detailScore: number | null;
  deliverableCount: number;
  workflowCount: number;
  pathwayCount: number;
  milestoneCount: number;
  approvalCount: number;
  pendingApprovalCount: number;
  scoreActivityCount: number;
  approvedDeliverables: number;
  rethinkDeliverables: number;
  collaboration: ReturnType<typeof buildStringCollaborationSnapshot>;
}

const SECTION_THEME: Record<CanvasSection, { border: string; background: string; badge: string }> = {
  STRING: {
    border: "rgba(34,211,238,0.52)",
    background: "rgba(8,47,73,0.28)",
    badge: "text-cyan-200"
  },
  DISCUSSION: {
    border: "rgba(45,212,191,0.45)",
    background: "rgba(17,94,89,0.24)",
    badge: "text-teal-200"
  },
  DIRECTION: {
    border: "rgba(56,189,248,0.46)",
    background: "rgba(7,89,133,0.24)",
    badge: "text-sky-200"
  },
  PLAN: {
    border: "rgba(59,130,246,0.44)",
    background: "rgba(30,64,175,0.22)",
    badge: "text-blue-200"
  },
  WORKFLOW: {
    border: "rgba(96,165,250,0.44)",
    background: "rgba(30,41,59,0.82)",
    badge: "text-blue-100"
  },
  PATHWAY: {
    border: "rgba(14,165,233,0.46)",
    background: "rgba(8,145,178,0.2)",
    badge: "text-cyan-100"
  },
  WORKING: {
    border: "rgba(245,158,11,0.46)",
    background: "rgba(120,53,15,0.22)",
    badge: "text-amber-100"
  },
  SCORING: {
    border: "rgba(16,185,129,0.44)",
    background: "rgba(6,78,59,0.24)",
    badge: "text-emerald-100"
  },
  COLLABORATION: {
    border: "rgba(34,197,94,0.44)",
    background: "rgba(20,83,45,0.24)",
    badge: "text-emerald-100"
  }
};

function parseDetailScore(value: string | null | undefined, fallback?: number | null) {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  if (Number.isFinite(parsed)) {
    return Math.max(0, Math.min(100, parsed));
  }
  if (typeof fallback === "number" && Number.isFinite(fallback)) {
    return Math.max(0, Math.min(100, Math.floor(fallback)));
  }
  return null;
}

function buildCanvasNode(input: {
  id: string;
  x: number;
  y: number;
  section: CanvasSection;
  heading: string;
  summary: string;
  badge: string;
}) {
  const theme = SECTION_THEME[input.section];

  return {
    id: input.id,
    position: { x: input.x, y: input.y },
    data: {
      label: (
        <div className="space-y-2 text-left">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              {input.section}
            </p>
            <span className={`text-[10px] font-semibold ${theme.badge}`}>{input.badge}</span>
          </div>
          <p className="line-clamp-2 text-xs font-semibold leading-5 text-slate-100">
            {input.heading}
          </p>
          <p className="line-clamp-3 text-[11px] leading-5 text-slate-400">{input.summary}</p>
        </div>
      )
    },
    draggable: false,
    selectable: true,
    style: {
      width: 210,
      minHeight: 118,
      borderRadius: 18,
      border: `1px solid ${theme.border}`,
      background: theme.background,
      color: "#e2e8f0",
      boxShadow: "0 12px 28px rgba(2,6,23,0.34)",
      padding: 12
    }
  } satisfies Node;
}

function buildCanvasGraph(input: {
  rows: BlueprintRow[];
  calendarDate: string | null | undefined;
}): {
  nodes: Node[];
  edges: Edge[];
  nodeMeta: Map<string, CanvasNodeMeta>;
} {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodeMeta = new Map<string, CanvasNodeMeta>();

  input.rows.forEach((row, rowIndex) => {
    const baseY = 48 + rowIndex * 240;
    const lastDiscussion = row.draft.discussion[row.draft.discussion.length - 1];
    const directionText = row.draft.direction.trim();
    const planSummary = row.draft.plan.summary.trim();
    const workflows = row.draft.workflows;
    const pathway = row.draft.pathway;
    const deliverables = buildDraftDeliverableCards({
      stringItem: row.item,
      draft: row.draft
    });

    const sectionNodes: Array<{
      section: CanvasSection;
      heading: string;
      summary: string;
      badge: string;
      items: string[];
    }> = [
      {
        section: "STRING",
        heading: row.stringTitle,
        summary: input.calendarDate
          ? `Canvas scope ${new Date(`${input.calendarDate}T00:00:00`).toLocaleDateString()}`
          : "Canvas scope all visible dates",
        badge: row.item.mode,
        items: [
          `Updated ${new Date(row.item.updatedAt).toLocaleString()}`,
          `Mode ${row.item.mode}`,
          row.item.directionGiven.trim() || "No string objective captured yet."
        ]
      },
      {
        section: "DISCUSSION",
        heading: `${row.draft.discussion.length} discussion turn(s)`,
        summary: lastDiscussion?.content?.trim() || "No discussion captured yet.",
        badge: `${row.draft.discussion.length}`,
        items:
          row.draft.discussion.length > 0
            ? row.draft.discussion
                .slice(Math.max(0, row.draft.discussion.length - 4))
                .map((entry) => `${entry.actorLabel || entry.actorType}: ${entry.content.trim() || "Empty turn"}`)
            : ["No discussion captured yet."]
      },
      {
        section: "DIRECTION",
        heading: directionText || "Direction not captured yet.",
        summary: directionText ? compactTaskTitle(directionText, directionText) : "No direction captured yet.",
        badge: directionText ? "Ready" : "Empty",
        items: [directionText || "No direction captured yet."]
      },
      {
        section: "PLAN",
        heading: planSummary || "Plan summary unavailable.",
        summary: `${row.workflowCount} workflow(s) | ${row.deliverableCount} deliverable(s)`,
        badge: row.detailScore === null ? "N/A" : `${row.detailScore}/100`,
        items: [
          planSummary || "No plan summary captured yet.",
          ...splitDraftLines(row.draft.plan.deliverablesText).slice(0, 4).map(
            (entry) => `Deliverable: ${entry}`
          )
        ]
      },
      {
        section: "WORKFLOW",
        heading:
          workflows[0]?.title || (row.workflowCount > 0 ? `${row.workflowCount} workflows` : "No workflow yet."),
        summary:
          row.workflowCount > 0
            ? `${row.workflowCount} workflow(s) | ${workflows.reduce((sum, workflow) => sum + splitDraftLines(workflow.taskSummary).length, 0)} task(s)`
            : "No workflow planned yet.",
        badge: `${row.workflowCount}`,
        items:
          workflows.length > 0
            ? workflows.map((workflow) => {
                const taskCount = splitDraftLines(workflow.taskSummary).length;
                return `${workflow.title || "Untitled workflow"} | ${workflow.ownerRole || "Owner"} | ${taskCount} task(s)`;
              })
            : ["No workflows captured yet."]
      },
      {
        section: "PATHWAY",
        heading:
          pathway[0]
            ? `${pathway[0].workflowTitle} -> ${pathway[0].taskTitle}`
            : "No pathway mapped yet.",
        summary:
          row.pathwayCount > 0
            ? `${row.pathwayCount} pathway step(s)`
            : "No pathway mapped yet.",
        badge: `${row.pathwayCount}`,
        items:
          pathway.length > 0
            ? pathway.map(
                (step, index) =>
                  `${index + 1}. ${step.workflowTitle} -> ${step.taskTitle} | ${step.ownerRole || "Owner"} | ${step.dueWindow || "No due window"}`
              )
            : ["No pathway captured yet."]
      },
      {
        section: "WORKING",
        heading:
          deliverables[0]?.text || row.draft.milestones[0]?.title || "No working outputs yet.",
        summary: `${row.deliverableCount} deliverable(s) | ${row.milestoneCount} milestone(s) | ${row.approvalCount} approval item(s)`,
        badge: `${row.pendingApprovalCount} pending`,
        items: [
          ...deliverables.slice(0, 4).map((card) => `Deliverable: ${card.text}`),
          ...row.draft.milestones.slice(0, 2).map((milestone) => `Milestone: ${milestone.title}`),
          ...row.draft.approvals.slice(0, 2).map((approval) => `Approval: ${approval.title || approval.reason || approval.status}`)
        ].slice(0, 6)
      },
      {
        section: "SCORING",
        heading:
          row.detailScore === null ? "Score unavailable." : `Detail score ${row.detailScore}/100`,
        summary: `${row.approvedDeliverables} approved | ${row.rethinkDeliverables} rethink | ${row.scoreActivityCount} score record(s)`,
        badge: row.detailScore === null ? "N/A" : `${row.detailScore}`,
        items: [
          row.draft.scoring.note.trim() || "No scoring note captured yet.",
          `Approved deliverables ${row.approvedDeliverables}`,
          `Rethink deliverables ${row.rethinkDeliverables}`
        ]
      },
      {
        section: "COLLABORATION",
        heading: row.collaboration.summary,
        summary: `${row.collaboration.totalCount} collaboration signal(s)`,
        badge: `${row.collaboration.totalCount}`,
        items: [
          ...row.collaboration.participants.map(
            (participant) => `Participant: ${participant.actorLabel} | ${participant.turnCount} turn(s)`
          ),
          ...row.collaboration.workforce.map(
            (resource) => `Workforce: ${resource.role} | ${resource.capacityPct}%`
          ),
          ...((row.collaboration.autoSquad?.requestedRoles ?? []).map(
            (role) => `Requested role: ${role}`
          ) as string[])
        ].slice(0, 6)
      }
    ];

    sectionNodes.forEach((sectionNode, sectionIndex) => {
      const nodeId = `${row.item.id}:${sectionNode.section.toLowerCase()}`;
      nodes.push(
        buildCanvasNode({
          id: nodeId,
          x: 36 + sectionIndex * 244,
          y: baseY,
          section: sectionNode.section,
          heading: sectionNode.heading,
          summary: sectionNode.summary,
          badge: sectionNode.badge
        })
      );
      nodeMeta.set(nodeId, {
        id: nodeId,
        stringId: row.item.id,
        stringTitle: row.stringTitle,
        section: sectionNode.section,
        heading: sectionNode.heading,
        summary: sectionNode.summary,
        items: sectionNode.items.length > 0 ? sectionNode.items : ["No details captured yet."]
      });

      if (sectionIndex > 0) {
        const priorNodeId = `${row.item.id}:${sectionNodes[sectionIndex - 1]!.section.toLowerCase()}`;
        edges.push({
          id: `edge:${priorNodeId}:${nodeId}`,
          source: priorNodeId,
          target: nodeId,
          animated: sectionNode.section === "PATHWAY" || sectionNode.section === "WORKING",
          style: {
            stroke: "rgba(56,189,248,0.68)",
            strokeWidth: 1.5
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "rgba(56,189,248,0.68)"
          }
        });
      }
    });
  });

  return { nodes, edges, nodeMeta };
}

export function StringBlueprintCanvasSurface({
  themeStyle,
  calendarDate,
  stringItem,
  allStringItems,
  permissionRequests,
  approvalCheckpoints,
  draftsByString = {},
  scoreByString = {},
  steerDecisions,
  selectedStringId,
  onSelectedStringChange
}: StringBlueprintCanvasSurfaceProps) {
  const [internalSelectedStringId, setInternalSelectedStringId] = useState<string | null>(
    stringItem?.id ?? null
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedStringId !== undefined) {
      return;
    }
    setInternalSelectedStringId(stringItem?.id ?? null);
  }, [selectedStringId, stringItem?.id]);

  const activeSelectedStringId =
    selectedStringId !== undefined ? selectedStringId : internalSelectedStringId;

  const handleStringScopeChange = useCallback(
    (value: string | null) => {
      if (onSelectedStringChange) {
        onSelectedStringChange(value);
        return;
      }
      setInternalSelectedStringId(value);
    },
    [onSelectedStringChange]
  );

  const permissionRequestsByString = useMemo(
    () =>
      new Map(
        allStringItems.map((item) => [
          item.id,
          getScopedPermissionRequestsForString(item, permissionRequests)
        ])
      ),
    [allStringItems, permissionRequests]
  );

  const approvalCheckpointsByString = useMemo(
    () =>
      new Map(
        allStringItems.map((item) => [
          item.id,
          getScopedApprovalCheckpointsForString(item, approvalCheckpoints)
        ])
      ),
    [allStringItems, approvalCheckpoints]
  );

  const rows = useMemo<BlueprintRow[]>(
    () =>
      allStringItems
        .map((item) => {
          const draft = resolveEditableStringDraft({
            draft: draftsByString[item.id],
            stringItem: item,
            permissionRequests: permissionRequestsByString.get(item.id) ?? [],
            approvalCheckpoints: approvalCheckpointsByString.get(item.id) ?? []
          });
          const deliverables = buildDraftDeliverableCards({
            stringItem: item,
            draft
          });
          const detailScore = parseDetailScore(
            draft.scoring.detailScore,
            item.planningResult?.primaryPlan?.detailScore ?? null
          );
          const scoreRecords = scoreByString[item.id] ?? [];
          const approvedDeliverables = deliverables.filter(
            (card) => steerDecisions[card.id] === "APPROVED"
          ).length;
          const rethinkDeliverables = deliverables.filter(
            (card) => steerDecisions[card.id] === "RETHINK"
          ).length;

          return {
            item,
            stringTitle: controlThreadDisplayTitle(item),
            draft,
            detailScore,
            deliverableCount: deliverables.length,
            workflowCount: draft.workflows.length,
            pathwayCount: draft.pathway.length,
            milestoneCount: draft.milestones.length,
            approvalCount: draft.approvals.length,
            pendingApprovalCount: draft.approvals.filter(
              (approval) => approval.status === "PENDING" || approval.status === "PLAN"
            ).length,
            scoreActivityCount: scoreRecords.length,
            approvedDeliverables,
            rethinkDeliverables,
            collaboration: buildStringCollaborationSnapshot({
              draft,
              stringItem: item
            })
          };
        })
        .sort((left, right) => right.item.updatedAt - left.item.updatedAt),
    [
      allStringItems,
      approvalCheckpointsByString,
      draftsByString,
      permissionRequestsByString,
      scoreByString,
      steerDecisions
    ]
  );

  const visibleRows = useMemo(
    () =>
      activeSelectedStringId
        ? rows.filter((row) => row.item.id === activeSelectedStringId)
        : rows,
    [activeSelectedStringId, rows]
  );

  useEffect(() => {
    setSelectedNodeId(null);
  }, [activeSelectedStringId, visibleRows.length]);

  const graph = useMemo(
    () =>
      buildCanvasGraph({
        rows: visibleRows,
        calendarDate
      }),
    [calendarDate, visibleRows]
  );

  const selectedMeta = selectedNodeId ? graph.nodeMeta.get(selectedNodeId) ?? null : null;
  const totalWorkflows = visibleRows.reduce((sum, row) => sum + row.workflowCount, 0);
  const totalPathway = visibleRows.reduce((sum, row) => sum + row.pathwayCount, 0);
  const totalDeliverables = visibleRows.reduce((sum, row) => sum + row.deliverableCount, 0);
  const totalPendingApprovals = visibleRows.reduce((sum, row) => sum + row.pendingApprovalCount, 0);

  return (
    <div className="space-y-4">
      <header className={`rounded-3xl border border-white/10 bg-black/35 p-4 ${themeStyle.border}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">String Blueprint</p>
            <h2 className="text-lg font-semibold text-slate-100">Canvas For String Path And Working</h2>
            <p className="text-xs text-slate-400">
              The canvas stays fixed. Only the content changes for all strings or the selected string.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-300">
              {calendarDate
                ? `Date ${new Date(`${calendarDate}T00:00:00`).toLocaleDateString()}`
                : "All visible dates"}
            </span>
            <select
              value={activeSelectedStringId ?? "ALL"}
              onChange={(event) =>
                handleStringScopeChange(event.target.value === "ALL" ? null : event.target.value)
              }
              className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs text-slate-200"
            >
              <option value="ALL">All Strings</option>
              {rows.map((row) => (
                <option key={row.item.id} value={row.item.id}>
                  {row.stringTitle}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Visible Strings</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{visibleRows.length}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Workflows</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{totalWorkflows}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Pathway Steps</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{totalPathway}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Working Items</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{totalDeliverables}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Pending Gates</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{totalPendingApprovals}</p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <section className={`rounded-3xl border border-white/10 bg-black/35 p-3 ${themeStyle.border}`}>
          {graph.nodes.length === 0 ? (
            <div className="flex h-[62vh] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#02060d] px-6 text-center text-sm text-slate-500">
              No string blueprint is available in this scope yet.
            </div>
          ) : (
            <div className="h-[62vh] rounded-2xl border border-white/10 bg-[#02060d]">
              <ReactFlow
                nodes={graph.nodes}
                edges={graph.edges}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                defaultEdgeOptions={{
                  markerEnd: {
                    type: MarkerType.ArrowClosed
                  }
                }}
              >
                <Background color="rgba(148,163,184,0.2)" gap={22} size={0.8} />
                <MiniMap
                  nodeColor={() => "rgba(56,189,248,0.35)"}
                  maskColor="rgba(2,6,23,0.5)"
                  style={{ backgroundColor: "rgba(2,6,23,0.6)" }}
                />
                <Controls />
              </ReactFlow>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className={`rounded-3xl border border-white/10 bg-black/35 p-4 ${themeStyle.border}`}>
            <h3 className="text-sm font-semibold text-slate-100">Selected Canvas Node</h3>
            {!selectedMeta ? (
              <p className="mt-2 text-xs text-slate-400">
                Select a canvas node to inspect the path and working details for that string section.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    {selectedMeta.section}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">
                    {selectedMeta.stringTitle}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{selectedMeta.heading}</p>
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">{selectedMeta.summary}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Details</p>
                  <div className="mt-3 max-h-[40vh] space-y-2 overflow-y-auto pr-1">
                    {selectedMeta.items.map((item, index) => (
                      <div
                        key={`${selectedMeta.id}-${index}`}
                        className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
                      >
                        <p className="text-xs leading-5 text-slate-200">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className={`rounded-3xl border border-white/10 bg-black/35 p-4 ${themeStyle.border}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-100">String Scope</h3>
              <button
                type="button"
                onClick={() => handleStringScopeChange(null)}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:bg-white/10"
              >
                All Strings
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {rows.length === 0 ? (
                <p className="text-xs text-slate-500">No strings are visible in this scope.</p>
              ) : (
                rows.map((row) => {
                  const isActive = row.item.id === activeSelectedStringId;
                  return (
                    <button
                      key={row.item.id}
                      type="button"
                      onClick={() => handleStringScopeChange(isActive ? null : row.item.id)}
                      className={`block w-full rounded-2xl border px-3 py-3 text-left transition ${
                        isActive
                          ? "border-cyan-400/40 bg-cyan-500/10"
                          : "border-white/10 bg-black/20 hover:bg-white/5"
                      }`}
                    >
                      <p className="text-xs font-semibold text-slate-100">{row.stringTitle}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {row.workflowCount} workflow(s) | {row.pathwayCount} pathway step(s) | {row.deliverableCount} deliverable(s)
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
