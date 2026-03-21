import {
  type ChangeEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Activity,
  ArrowUpRight,
  Bell,
  Bot,
  Building2,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Command,
  Compass,
  Database,
  FileText,
  FolderOpen,
  Ghost,
  LayoutDashboard,
  LayoutGrid,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  PlusCircle,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Shield,
  Target,
  UserCheck,
  Users,
  Workflow,
  X
} from "lucide-react";
import {
  ActorType,
  AgentRunResponse,
  AgentRunStatus,
  ApprovalCheckpointItem,
  ComposerAttachmentPayload,
  ControlConversationDetail,
  ControlMessage,
  ControlMode,
  ControlSurfaceTab,
  ControlThreadHistoryItem,
  DEFAULT_PRIMARY_TAB_SUBTAB,
  DIRECTION_MODELS,
  DirectionExecutionPlan,
  DirectionIntentRouting,
  DirectionPlanPathwayStep,
  DirectionPlanTask,
  DirectionPlanWorkflow,
  DirectionPlanningResult,
  DirectionTurn,
  EditableApprovalDraft,
  EditableDiscussionDraft,
  EditableMilestoneDraft,
  EditablePathwayDraft,
  EditablePlanDraft,
  EditableScoringDraft,
  EditableStringDraft,
  EditableWorkflowDraft,
  FLOW_STRING_DETAILS_SUBTABS,
  FlowExecutionSurfaceTab,
  FlowGovernanceSurfaceTab,
  FlowStringDetailsSubtab,
  FlowStringsSurfaceTab,
  HumanInputRequest,
  NAV_ITEMS,
  NAV_ITEM_MAP,
  NavItemId,
  OPERATION_TAB_IDS,
  OPERATION_TAB_SET,
  OperationTabId,
  OrchestrationPipelineEffectivePolicy,
  OrchestrationPipelineMode,
  OrgListResponse,
  PIPELINE_POLICY_POLL_INTERVAL_MS,
  PRESENCE_POOL,
  PRIMARY_WORKSPACE_TABS,
  PendingChatPlanRoute,
  PendingEmailApproval,
  PendingPlanLaunchApproval,
  PendingToolkitApproval,
  PermissionRequestItem,
  PrimaryWorkspaceTabId,
  REQUESTS_POLL_INTERVAL_MS,
  ScanActivityRow,
  SetupPanel,
  SteerDeliverableCard,
  SteerLane,
  SteerLaneTab,
  SteerSurfaceTab,
  StringDeliverableCard,
  StringDetailsTab,
  StringScanRow,
  StringScoreRecord,
  StringSteerDecisionRecord,
  StringWorkspaceTab,
  THEME_STYLES,
  UserJoinRequest,
  WorkspaceMode,
  buildDraftDeliverableCards,
  buildEditableStringDraft,
  buildLocalMonthGrid,
  buildPlanCardMeta,
  buildStringDiscussionTurns,
  buildThreadDeliverableCards,
  buildThreadScanRows,
  buildToolkitApprovalRequestId,
  collectPlanToolkits,
  compactTaskTitle,
  controlThreadDefaultTitle,
  controlThreadDisplayTitle,
  controlThreadKindLabel,
  controlThreadPreview,
  controlThreadRailScope,
  controlThreadScopeBadgeClass,
  formatDraftForChat,
  formatRelativeTimeShort,
  formatToolkitList,
  getPrimaryWorkspaceTabForNavItem,
  inferToolkitsFromDirectionPrompt,
  inferTurnTimestamp,
  initials,
  isApprovalReply,
  isGmailDirectionPrompt,
  isRecurringTaskPrompt,
  isRejectReply,
  makeDirectionTurnId,
  makeLocalDraftId,
  normalizeDeliverableId,
  normalizeHumanInputReason,
  normalizePlanAnalysisText,
  normalizeToolkitAlias,
  normalizeWorkflowTaskStatus,
  openCenteredPopup,
  primaryWorkspaceScopeLabel,
  randomPresence,
  getScopedApprovalCheckpointsForString,
  getScopedPermissionRequestsForString,
  shouldDirectWorkflowLaunch,
  shouldForceDirectionPlanRoute,
  sleep,
  splitDraftLines,
  summarizeHumanInputReason,
  toLocalDateKey,
  workflowAgentLabelFromTaskTrace
} from "@/components/vorldx-shell/shared";
import { SteerDetailsEditorSurface } from "@/components/vorldx-shell/surfaces/steer-details-editor-surface";
import { SteerConsoleSurface } from "@/components/vorldx-shell/surfaces/steer-console-surface";

export function FlowStringsSurface({
  calendarDate,
  stringItem,
  allStringItems,
  permissionRequests,
  approvalCheckpoints,
  draftsByString = {},
  onDraftChange,
  scoreByString = {},
  steerDecisions,
  onSteerDecision,
  surfaceTab
}: {
  calendarDate?: string | null;
  stringItem: ControlThreadHistoryItem | null;
  allStringItems: ControlThreadHistoryItem[];
  permissionRequests: PermissionRequestItem[];
  approvalCheckpoints: ApprovalCheckpointItem[];
  draftsByString?: Record<string, EditableStringDraft>;
  onDraftChange?: (stringId: string, nextDraft: EditableStringDraft) => void;
  scoreByString?: Record<string, StringScoreRecord[]>;
  steerDecisions: Record<string, SteerLaneTab>;
  onSteerDecision: (cardId: string, lane: SteerLaneTab) => void;
  surfaceTab: FlowStringsSurfaceTab;
}) {
  const [detailsTab, setDetailsTab] = useState<FlowStringDetailsSubtab>("OVERVIEW");
  const [blueprintLane, setBlueprintLane] = useState<SteerSurfaceTab>("CENTER");
  const parseDetailScore = (value: string | null | undefined) => {
    const parsed = Number.parseInt((value ?? "").trim(), 10);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Math.max(0, Math.min(100, parsed));
  };
  const buildLaneCounts = useCallback(
    (cards: SteerDeliverableCard[]) =>
      cards.reduce(
        (totals, card) => {
          const lane = steerDecisions[card.id] ?? "CENTER";
          totals[lane] += 1;
          return totals;
        },
        { CENTER: 0, APPROVED: 0, RETHINK: 0 } as Record<SteerLaneTab, number>
      ),
    [steerDecisions]
  );
  const plan = stringItem?.planningResult?.primaryPlan ?? null;
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
  const draftRows = useMemo(
    () =>
      allStringItems.map((item) => ({
        item,
        stringTitle: controlThreadDisplayTitle(item),
        draft:
          draftsByString[item.id] ??
          buildEditableStringDraft({
            stringItem: item,
            permissionRequests: permissionRequestsByString.get(item.id) ?? [],
            approvalCheckpoints: approvalCheckpointsByString.get(item.id) ?? []
          })
      })),
    [allStringItems, approvalCheckpointsByString, draftsByString, permissionRequestsByString]
  );
  const activeDraftRow = useMemo(
    () => (stringItem ? draftRows.find((row) => row.item.id === stringItem.id) ?? null : null),
    [draftRows, stringItem]
  );
  const activeDraft = activeDraftRow?.draft ?? null;
  const activePermissionRequests = stringItem
    ? permissionRequestsByString.get(stringItem.id) ?? []
    : permissionRequests;
  const activeApprovalCheckpoints = stringItem
    ? approvalCheckpointsByString.get(stringItem.id) ?? []
    : approvalCheckpoints;
  const discussionTurnMeta = useMemo(
    () => new Map(buildStringDiscussionTurns(stringItem).map((turn) => [turn.id, turn.timestamp])),
    [stringItem]
  );
  const discussionTurns = useMemo(
    () =>
      activeDraft
        ? activeDraft.discussion
            .map((entry, index) => ({
              ...entry,
              timestamp:
                discussionTurnMeta.get(entry.id) ??
                (stringItem?.updatedAt ?? Date.now()) + index
            }))
            .sort((left, right) => left.timestamp - right.timestamp)
        : [],
    [activeDraft, discussionTurnMeta, stringItem?.updatedAt]
  );
  const latestDiscussionTurns = useMemo(
    () => discussionTurns.slice(Math.max(0, discussionTurns.length - 3)).reverse(),
    [discussionTurns]
  );
  const directionText = activeDraft?.direction.trim() ?? "";
  const planSummary = activeDraft?.plan.summary.trim() ?? "";
  const deliverables = activeDraft ? splitDraftLines(activeDraft.plan.deliverablesText) : [];
  const deliverableCards = useMemo(
    () =>
      stringItem && activeDraft
        ? buildDraftDeliverableCards({
            stringItem,
            draft: activeDraft
          })
        : [],
    [activeDraft, stringItem]
  );
  const requiredToolkits = stringItem?.planningResult?.requiredToolkits ?? [];
  const workflows = useMemo(
    () =>
      activeDraft?.workflows.map((workflow) => ({
        title: workflow.title,
        ownerRole: workflow.ownerRole,
        goal: workflow.goal,
        tasks: splitDraftLines(workflow.taskSummary)
      })) ?? [],
    [activeDraft?.workflows]
  );
  const milestones = useMemo(() => activeDraft?.milestones ?? [], [activeDraft?.milestones]);
  const pathway = useMemo(
    () =>
      activeDraft?.pathway.map((step, index) => ({
        stepId: step.id,
        line: index + 1,
        ...step
      })) ?? [],
    [activeDraft?.pathway]
  );
  const planApprovals =
    activeDraft?.approvals.map((approval, index) => ({
      name: approval.title || `Approval ${index + 1}`,
      requiredRole: approval.owner || "Owner",
      trigger: approval.status || "PENDING",
      reason: approval.reason
    })) ?? [];
  const detailScore = (() => {
    const draftScore = parseDetailScore(activeDraft?.scoring.detailScore);
    if (draftScore !== null) {
      return draftScore;
    }
    return typeof plan?.detailScore === "number" && Number.isFinite(plan.detailScore)
      ? Math.max(0, Math.min(100, Math.floor(plan.detailScore)))
      : null;
  })();
  const activeScoreRecords = useMemo(
    () =>
      stringItem
        ? [...(scoreByString[stringItem.id] ?? [])].sort(
            (left, right) => right.createdAt - left.createdAt
          )
        : [],
    [scoreByString, stringItem]
  );
  const pendingPermissionRequests = activePermissionRequests.filter((request) => request.status === "PENDING");
  const pendingApprovalCheckpoints = activeApprovalCheckpoints.filter(
    (checkpoint) => checkpoint.status === "PENDING"
  );
  const totalDirectionStrings = allStringItems.filter((item) => item.mode === "DIRECTION").length;
  const totalDiscussionStrings = allStringItems.length - totalDirectionStrings;
  const allDiscussionTurns = useMemo(
    () =>
      draftRows
        .flatMap(({ item, stringTitle, draft }) => {
          const turnMetaById = new Map(
            buildStringDiscussionTurns(item).map((turn) => [turn.id, turn.timestamp])
          );
          return draft.discussion.map((entry, index) => ({
            id: `${item.id}-${entry.id}`,
            actorLabel: entry.actorLabel,
            content: entry.content,
            stringTitle,
            timestamp: turnMetaById.get(entry.id) ?? item.updatedAt + index
          }));
        })
        .sort((left, right) => right.timestamp - left.timestamp),
    [draftRows]
  );
  const allDirections = useMemo(
    () =>
      draftRows
        .map(({ item, stringTitle, draft }) => ({
          id: item.id,
          stringTitle,
          text: draft.direction.trim()
        }))
        .filter((item) => item.text),
    [draftRows]
  );
  const allPlans = useMemo(
    () =>
      draftRows.flatMap(({ item, stringTitle, draft }) => {
        const summary = draft.plan.summary.trim();
        const itemDetailScore =
          parseDetailScore(draft.scoring.detailScore) ??
          (typeof item.planningResult?.primaryPlan?.detailScore === "number" &&
          Number.isFinite(item.planningResult.primaryPlan.detailScore)
            ? Math.max(0, Math.min(100, Math.floor(item.planningResult.primaryPlan.detailScore)))
            : null);
        const workflowCount = draft.workflows.length;
        const deliverableCount = buildDraftDeliverableCards({ stringItem: item, draft }).length;
        const milestoneCount = draft.milestones.length;

        if (
          !summary &&
          workflowCount === 0 &&
          deliverableCount === 0 &&
          milestoneCount === 0 &&
          itemDetailScore === null
        ) {
          return [];
        }

        return [
          {
            id: item.id,
            stringTitle,
            summary,
            workflowCount,
            deliverableCount,
            milestoneCount,
            detailScore: itemDetailScore
          }
        ];
      }),
    [draftRows]
  );
  const allWorkflows = useMemo(
    () =>
      draftRows.flatMap(({ item, stringTitle, draft }) =>
        draft.workflows.map((workflow, index) => ({
          id: `${item.id}-workflow-${index}`,
          stringTitle,
          workflow: {
            title: workflow.title,
            ownerRole: workflow.ownerRole,
            goal: workflow.goal,
            tasks: splitDraftLines(workflow.taskSummary)
          }
        }))
      ),
    [draftRows]
  );
  const allDeliverableCards = useMemo(
    () =>
      draftRows.flatMap(({ item, draft }) =>
        buildDraftDeliverableCards({
          stringItem: item,
          draft
        })
      ),
    [draftRows]
  );
  const allPathway = useMemo(
    () =>
      draftRows.flatMap(({ item, stringTitle, draft }) =>
        draft.pathway.map((step, index) => ({
          id: `${item.id}-pathway-${step.id || index}`,
          stringTitle,
          step: {
            line: index + 1,
            ...step
          }
        }))
      ),
    [draftRows]
  );
  const allPlanApprovals = useMemo(
    () =>
      draftRows.flatMap(({ item, stringTitle, draft }) =>
        draft.approvals.map((approval, index) => ({
          id: `${item.id}-approval-${index}`,
          stringTitle,
          approval: {
            name: approval.title || `Approval ${index + 1}`,
            requiredRole: approval.owner || "Owner",
            trigger: approval.status || "PENDING",
            reason: approval.reason
          }
        }))
      ),
    [draftRows]
  );
  const allMilestones = useMemo(
    () =>
      draftRows.flatMap(({ item, stringTitle, draft }) =>
        draft.milestones.map((milestone, index) => ({
          id: `${item.id}-milestone-${index}`,
          stringTitle,
          milestone
        }))
      ),
    [draftRows]
  );
  const allScores = useMemo(
    () =>
      draftRows.flatMap(({ item, stringTitle, draft }) => {
        const score =
          parseDetailScore(draft.scoring.detailScore) ??
          (typeof item.planningResult?.primaryPlan?.detailScore === "number" &&
          Number.isFinite(item.planningResult.primaryPlan.detailScore)
            ? Math.max(0, Math.min(100, Math.floor(item.planningResult.primaryPlan.detailScore)))
            : null);
        const summary = draft.scoring.note.trim() || draft.plan.summary.trim();
        if (score === null && !summary) {
          return [];
        }
        return [
          {
            id: item.id,
            stringTitle,
            score,
            summary
          }
        ];
      }),
    [draftRows]
  );
  const allScoreActivity = useMemo(
    () =>
      draftRows
        .flatMap(({ item, stringTitle }) =>
          (scoreByString[item.id] ?? []).map((record) => ({
            ...record,
            stringTitle
          }))
        )
        .sort((left, right) => right.createdAt - left.createdAt),
    [draftRows, scoreByString]
  );
  const activeLaneCounts = useMemo(
    () => buildLaneCounts(deliverableCards),
    [buildLaneCounts, deliverableCards]
  );
  const allLaneCounts = useMemo(
    () => buildLaneCounts(allDeliverableCards),
    [allDeliverableCards, buildLaneCounts]
  );
  const activeOverviewCards = useMemo(
    () =>
      activeDraft
        ? [
            {
              label: "Discussion",
              value: `${discussionTurns.length}`,
              helper:
                activeDraft.discussion[activeDraft.discussion.length - 1]?.content ||
                "No discussion captured yet."
            },
            {
              label: "Direction",
              value: directionText ? "Ready" : "Empty",
              helper: compactTaskTitle(directionText, "No direction context captured yet.")
            },
            {
              label: "Plan",
              value: planSummary ? "Ready" : "Empty",
              helper: compactTaskTitle(planSummary, "No plan summary is available yet.")
            },
            {
              label: "Workflow",
              value: `${workflows.length}`,
              helper: workflows[0]?.title || "No workflows planned yet."
            },
            {
              label: "Pathway",
              value: `${pathway.length}`,
              helper:
                pathway[0] ? `${pathway[0].workflowTitle} -> ${pathway[0].taskTitle}` : "No pathway steps yet."
            },
            {
              label: "Approvals",
              value: `${planApprovals.length + activePermissionRequests.length + activeApprovalCheckpoints.length}`,
              helper: `${pendingPermissionRequests.length + pendingApprovalCheckpoints.length} pending`
            },
            {
              label: "Milestones",
              value: `${milestones.length}`,
              helper: milestones[0]?.title || "No milestones defined yet."
            },
            {
              label: "Deliverables",
              value: `${deliverableCards.length}`,
              helper: deliverableCards[0]?.text || "No deliverables attached yet."
            },
            {
              label: "Scoring",
              value: detailScore === null ? "N/A" : `${detailScore}/100`,
              helper: `${activeLaneCounts.APPROVED} approved | ${activeScoreRecords.length} activity records`
            }
          ]
        : [],
    [
      activeApprovalCheckpoints.length,
      activeDraft,
      activeLaneCounts.APPROVED,
      activePermissionRequests.length,
      activeScoreRecords.length,
      deliverableCards,
      detailScore,
      directionText,
      discussionTurns.length,
      milestones,
      pathway,
      pendingApprovalCheckpoints.length,
      pendingPermissionRequests.length,
      planApprovals.length,
      planSummary,
      workflows
    ]
  );
  const allOverviewCards = useMemo(
    () => [
      {
        label: "Discussion",
        value: `${allDiscussionTurns.length}`,
        helper: `${totalDiscussionStrings} discussion string(s)`
      },
      {
        label: "Direction",
        value: `${allDirections.length}`,
        helper: `${totalDirectionStrings} direction string(s)`
      },
      {
        label: "Plan",
        value: `${allPlans.length}`,
        helper: `${allPlans.filter((item) => item.summary).length} summarized plan(s)`
      },
      {
        label: "Workflow",
        value: `${allWorkflows.length}`,
        helper: `${allStringItems.length} visible string(s)`
      },
      {
        label: "Pathway",
        value: `${allPathway.length}`,
        helper:
          allPathway[0] ? `${allPathway[0].stringTitle} | ${allPathway[0].step.workflowTitle}` : "No pathway steps yet."
      },
      {
        label: "Approvals",
        value: `${allPlanApprovals.length + permissionRequests.length + approvalCheckpoints.length}`,
        helper: `${pendingPermissionRequests.length + pendingApprovalCheckpoints.length} pending in current scope`
      },
      {
        label: "Milestones",
        value: `${allMilestones.length}`,
        helper: allMilestones[0]?.milestone.title || "No milestones captured yet."
      },
      {
        label: "Deliverables",
        value: `${allDeliverableCards.length}`,
        helper: `${allLaneCounts.APPROVED} approved | ${allLaneCounts.RETHINK} rethink`
      },
      {
        label: "Scoring",
        value: `${allScores.filter((item) => item.score !== null).length}`,
        helper: `${allScoreActivity.length} score and steer activity record(s)`
      }
    ],
    [
      allDeliverableCards.length,
      allDirections.length,
      allDiscussionTurns.length,
      allLaneCounts.APPROVED,
      allLaneCounts.RETHINK,
      allMilestones,
      allPathway,
      allPlanApprovals.length,
      allPlans,
      allScoreActivity.length,
      allScores,
      allStringItems.length,
      allWorkflows.length,
      approvalCheckpoints.length,
      pendingApprovalCheckpoints.length,
      pendingPermissionRequests.length,
      permissionRequests.length,
      totalDirectionStrings,
      totalDiscussionStrings
    ]
  );

  const statusPillClass = (status: string) => {
    if (status === "APPROVED") {
      return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
    }
    if (status === "REJECTED") {
      return "border-red-500/35 bg-red-500/10 text-red-200";
    }
    return "border-amber-500/35 bg-amber-500/10 text-amber-200";
  };
  const blueprintSurface = stringItem ? (
    <SteerDetailsEditorSurface
      stringItem={stringItem}
      calendarDate={calendarDate}
      permissionRequests={activePermissionRequests}
      approvalCheckpoints={activeApprovalCheckpoints}
      draftsByString={draftsByString}
      scoreByString={scoreByString}
      steerLane={blueprintLane === "DETAILS" ? "CENTER" : blueprintLane}
      onSteerLaneChange={setBlueprintLane}
      steerDecisions={steerDecisions}
      readOnly
    />
  ) : (
    <SteerConsoleSurface
      stringItem={stringItem}
      allStringItems={allStringItems}
      calendarDate={calendarDate}
      activeLane={blueprintLane}
      onActiveLaneChange={setBlueprintLane}
      draftsByString={draftsByString}
      onDraftChange={onDraftChange}
      scoreByString={scoreByString}
      decisions={steerDecisions}
      onDecision={onSteerDecision}
      permissionRequests={permissionRequests}
      approvalCheckpoints={approvalCheckpoints}
    />
  );

  if (!stringItem) {
    return (
      <div className="space-y-3">
        <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,15,24,0.94),rgba(8,9,16,0.88))] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.28)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Flow Strings
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-100">No string selected, showing all strings</p>
          <p className="mt-1 text-xs text-slate-400">
            Details now aggregate discussion, direction, plan, workflow, pathway, approvals,
            milestones, and scoring across every visible string.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Total Strings</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{allStringItems.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Discussion</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{totalDiscussionStrings}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Direction</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{totalDirectionStrings}</p>
            </div>
          </div>
        </div>

        {surfaceTab === "DETAILS" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-[24px] border border-white/10 bg-black/20 p-2">
              {FLOW_STRING_DETAILS_SUBTABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setDetailsTab(tab.id)}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                    detailsTab === tab.id
                      ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                      : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {detailsTab === "OVERVIEW" ? (
              <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Overview
                  </p>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                    All visible strings
                  </span>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {allOverviewCards.map((card) => (
                    <div key={card.label} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{card.label}</p>
                        <span className="text-sm font-semibold text-slate-100">{card.value}</span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-400">{card.helper}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        String Dashboards
                      </p>
                      <span className="text-[11px] text-slate-500">{draftRows.length} string(s)</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {draftRows.length === 0 ? (
                        <p className="text-xs text-slate-500">No strings are visible in this scope.</p>
                      ) : (
                        draftRows.slice(0, 6).map(({ item, stringTitle, draft }) => {
                          const cards = buildDraftDeliverableCards({ stringItem: item, draft });
                          const laneCounts = buildLaneCounts(cards);
                          const score =
                            parseDetailScore(draft.scoring.detailScore) ??
                            (typeof item.planningResult?.primaryPlan?.detailScore === "number" &&
                            Number.isFinite(item.planningResult.primaryPlan.detailScore)
                              ? Math.max(0, Math.min(100, Math.floor(item.planningResult.primaryPlan.detailScore)))
                              : null);
                          return (
                            <div
                              key={`overview-${item.id}`}
                              className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-slate-100">{stringTitle}</p>
                                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                                  {score === null ? "N/A" : `${score}/100`}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-slate-400">
                                {cards.length} deliverable(s) | {laneCounts.APPROVED} approved | {laneCounts.RETHINK} rethink
                              </p>
                              <p className="mt-2 text-[11px] text-slate-500">
                                {draft.scoring.note.trim() ||
                                  draft.plan.summary.trim() ||
                                  "No review note or plan summary yet."}
                              </p>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Score And Steer Activity
                      </p>
                      <span className="text-[11px] text-slate-500">{allScoreActivity.length} record(s)</span>
                    </div>
                    {allScoreActivity.length === 0 ? (
                      <p className="mt-3 text-xs text-slate-500">No scoring or steer activity logged yet.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {allScoreActivity.slice(0, 6).map((record) => (
                          <div
                            key={`all-score-${record.id}`}
                            className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-slate-100">{record.metric}</p>
                              <span className="text-[11px] text-slate-500">
                                {new Date(record.createdAt).toLocaleString()}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-slate-400">{record.stringTitle}</p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              {record.score}/{record.maxScore}
                              {record.note ? ` | ${record.note}` : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {detailsTab === "DISCUSSION" ? (
              <div className="space-y-2 rounded-[24px] border border-white/10 bg-black/20 p-4">
                {allDiscussionTurns.length === 0 ? (
                  <p className="text-xs text-slate-500">No discussion captured across strings yet.</p>
                ) : (
                  allDiscussionTurns.slice(0, 12).map((turn) => (
                    <article key={turn.id} className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                            {turn.stringTitle}
                          </span>
                          <span className="text-xs font-semibold text-slate-200">{turn.actorLabel}</span>
                        </div>
                        <span className="text-[11px] text-slate-500">{new Date(turn.timestamp).toLocaleString()}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200 [overflow-wrap:anywhere]">{turn.content}</p>
                    </article>
                  ))
                )}
              </div>
            ) : null}

            {detailsTab === "DIRECTION" ? (
              <div className="space-y-2 rounded-[24px] border border-white/10 bg-black/20 p-4">
                {allDirections.length === 0 ? (
                  <p className="text-xs text-slate-500">No direction context captured across strings yet.</p>
                ) : (
                  allDirections.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                        {item.stringTitle}
                      </span>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200 [overflow-wrap:anywhere]">{item.text}</p>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            {detailsTab === "PLAN" ? (
              <div className="space-y-2 rounded-[24px] border border-white/10 bg-black/20 p-4">
                {allPlans.length === 0 ? (
                  <p className="text-xs text-slate-500">No plans captured across strings yet.</p>
                ) : (
                  allPlans.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                          {item.stringTitle}
                        </span>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                          <span>{item.workflowCount} workflow(s)</span>
                          <span>{item.deliverableCount} deliverable(s)</span>
                          {item.detailScore !== null ? <span>{item.detailScore}/100</span> : null}
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        {item.milestoneCount} milestone(s)
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200 [overflow-wrap:anywhere]">
                        {item.summary || "No plan summary available yet."}
                      </p>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            {detailsTab === "WORKFLOW" ? (
              <div className="space-y-2 rounded-[24px] border border-white/10 bg-black/20 p-4">
                {allWorkflows.length === 0 ? (
                  <p className="text-xs text-slate-500">No workflows found across strings yet.</p>
                ) : (
                  allWorkflows.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                          {item.stringTitle}
                        </span>
                        <p className="text-xs font-semibold text-slate-100">{item.workflow.title}</p>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">{item.workflow.ownerRole || "Owner"} | {item.workflow.tasks.length} task(s)</p>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            {detailsTab === "PATHWAY" ? (
              <div className="space-y-2 rounded-[24px] border border-white/10 bg-black/20 p-4">
                {allPathway.length === 0 ? (
                  <p className="text-xs text-slate-500">No pathway steps found across strings yet.</p>
                ) : (
                  allPathway.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                          {item.stringTitle}
                        </span>
                        <p className="text-xs font-semibold text-slate-100">{item.step.line}. {item.step.workflowTitle} {"->"} {item.step.taskTitle}</p>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">{item.step.ownerRole} | {item.step.executionMode}</p>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            {detailsTab === "APPROVALS" ? (
              <div className="space-y-2 rounded-[24px] border border-white/10 bg-black/20 p-4">
                {allPlanApprovals.length === 0 && permissionRequests.length === 0 && approvalCheckpoints.length === 0 ? (
                  <p className="text-xs text-slate-500">No approvals found across strings yet.</p>
                ) : (
                  <>
                    {allPlanApprovals.map((item) => (
                      <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                            {item.stringTitle}
                          </span>
                          <p className="text-xs font-semibold text-slate-100">{item.approval.name}</p>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">{item.approval.requiredRole} | {item.approval.trigger}</p>
                      </div>
                    ))}
                    {permissionRequests.map((request) => (
                      <div key={request.id} className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                        <p className="text-xs font-semibold text-slate-100">{request.area} | {request.workflowTitle || "Workflow"} {"->"} {request.taskTitle || "Task"}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{request.status} | {request.requestedByEmail || "Owner"}</p>
                      </div>
                    ))}
                    {approvalCheckpoints.map((checkpoint) => (
                      <div key={checkpoint.id} className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-100">
                            Flow {checkpoint.flowId?.slice(0, 8) ?? "N/A"} | Task {checkpoint.taskId?.slice(0, 8) ?? "N/A"}
                          </p>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusPillClass(checkpoint.status)}`}>
                            {checkpoint.status}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">{checkpoint.reason}</p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : null}

            {detailsTab === "MILESTONES" ? (
              <div className="space-y-2 rounded-[24px] border border-white/10 bg-black/20 p-4">
                {allMilestones.length === 0 ? (
                  <p className="text-xs text-slate-500">No milestones found across strings yet.</p>
                ) : (
                  allMilestones.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                          {item.stringTitle}
                        </span>
                        <p className="text-xs font-semibold text-slate-100">{item.milestone.title}</p>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">{item.milestone.ownerRole} | {item.milestone.dueWindow}</p>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            {detailsTab === "DELIVERABLES" ? (
              <div className="space-y-2 rounded-[24px] border border-white/10 bg-black/20 p-4">
                {allDeliverableCards.length === 0 ? (
                  <p className="text-xs text-slate-500">No deliverables found across strings yet.</p>
                ) : (
                  allDeliverableCards.map((card) => (
                    <div key={card.id} className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                          {card.stringTitle}
                        </span>
                        <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100">
                          {card.source}
                        </span>
                        {card.workflowTitle ? (
                          <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] text-slate-400">
                            {card.workflowTitle}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-slate-100">{card.text}</p>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            {detailsTab === "SCORING" ? (
              <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
                <div className="grid gap-2 sm:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Scored Strings</p>
                    <p className="mt-1 text-lg font-semibold text-slate-100">
                      {allScores.filter((item) => item.score !== null).length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Center</p>
                    <p className="mt-1 text-lg font-semibold text-slate-100">{allLaneCounts.CENTER}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Approved</p>
                    <p className="mt-1 text-lg font-semibold text-slate-100">{allLaneCounts.APPROVED}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Rethink</p>
                    <p className="mt-1 text-lg font-semibold text-slate-100">{allLaneCounts.RETHINK}</p>
                  </div>
                </div>

                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        String Scores
                      </p>
                      <span className="text-[11px] text-slate-500">{allScores.length} string(s)</span>
                    </div>
                    {allScores.length === 0 ? (
                      <p className="mt-3 text-xs text-slate-500">No detail scores found across strings yet.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {allScores.map((item) => (
                          <div key={item.id} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                                {item.stringTitle}
                              </span>
                              <span className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200">
                                {item.score === null ? "N/A" : `${item.score}/100`}
                              </span>
                            </div>
                            {item.summary ? <p className="mt-2 text-[11px] text-slate-400">{item.summary}</p> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Recent Activity
                      </p>
                      <span className="text-[11px] text-slate-500">{allScoreActivity.length} record(s)</span>
                    </div>
                    {allScoreActivity.length === 0 ? (
                      <p className="mt-3 text-xs text-slate-500">No scoring or steer activity logged yet.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {allScoreActivity.slice(0, 6).map((record) => (
                          <div
                            key={`all-scoring-${record.id}`}
                            className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-slate-100">{record.metric}</p>
                              <span className="text-[11px] text-slate-500">
                                {new Date(record.createdAt).toLocaleString()}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-slate-400">{record.stringTitle}</p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              {record.score}/{record.maxScore}
                              {record.note ? ` | ${record.note}` : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          blueprintSurface
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,15,24,0.94),rgba(8,9,16,0.88))] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.28)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Flow Strings
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-100">
              {controlThreadDisplayTitle(stringItem)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {controlThreadKindLabel(stringItem.mode)} | {new Date(stringItem.updatedAt).toLocaleString()}
            </p>
          </div>
          <div className="grid gap-2 text-right sm:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Discussion</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">{discussionTurns.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Workflow</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">{workflows.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Approvals</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {planApprovals.length + activePermissionRequests.length + activeApprovalCheckpoints.length}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Score</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {detailScore === null ? "N/A" : `${detailScore}/100`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {surfaceTab === "DETAILS" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-[24px] border border-white/10 bg-black/20 p-2">
            {FLOW_STRING_DETAILS_SUBTABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDetailsTab(tab.id)}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                  detailsTab === tab.id
                    ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                    : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {detailsTab === "OVERVIEW" ? (
            <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Overview
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                  Visible and steer stay synced
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {activeOverviewCards.map((card) => (
                  <div key={card.label} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{card.label}</p>
                      <span className="text-sm font-semibold text-slate-100">{card.value}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-400">{card.helper}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Steer Snapshot
                    </p>
                    <span className="text-[11px] text-slate-500">{deliverableCards.length} deliverable(s)</span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Center</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">{activeLaneCounts.CENTER}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Approved</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">{activeLaneCounts.APPROVED}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Rethink</p>
                      <p className="mt-1 text-sm font-semibold text-slate-100">{activeLaneCounts.RETHINK}</p>
                    </div>
                  </div>
                  {deliverableCards.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-500">No deliverables are linked to this string yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {deliverableCards.slice(0, 6).map((card) => {
                        const lane = steerDecisions[card.id] ?? "CENTER";
                        return (
                          <div
                            key={`single-overview-${card.id}`}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-slate-100">{card.text}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {card.source}
                                {card.workflowTitle ? ` | ${card.workflowTitle}` : ""}
                              </p>
                            </div>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                lane === "APPROVED"
                                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                                  : lane === "RETHINK"
                                    ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                                    : "border-white/10 bg-white/5 text-slate-300"
                              }`}
                            >
                              {lane}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Scoring Activity
                    </p>
                    <span className="text-[11px] text-slate-500">{activeScoreRecords.length} record(s)</span>
                  </div>
                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Current Review</p>
                    <p className="mt-2 text-sm font-semibold text-slate-100">
                      {detailScore === null ? "No review score yet" : `${detailScore}/100`}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-slate-400">
                      {activeDraft?.scoring.note.trim() || "No scoring note captured yet."}
                    </p>
                  </div>
                  {activeScoreRecords.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-500">No steer or score activity logged yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {activeScoreRecords.slice(0, 5).map((record) => (
                        <div
                          key={`single-score-${record.id}`}
                          className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-100">{record.metric}</p>
                            <span className="text-[11px] text-slate-500">
                              {new Date(record.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-400">
                            {record.score}/{record.maxScore} by {record.scoredBy}
                          </p>
                          {record.note ? <p className="mt-1 text-[11px] text-slate-500">{record.note}</p> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {detailsTab === "DISCUSSION" ? (
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Discussion
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                  {discussionTurns.length} turn(s)
                </span>
              </div>
              {latestDiscussionTurns.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">No discussion captured for this string yet.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {latestDiscussionTurns.map((turn) => (
                    <article
                      key={turn.id}
                      className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                              turn.actorType === "HUMAN"
                                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                                : "border-cyan-500/35 bg-cyan-500/10 text-cyan-200"
                            }`}
                          >
                            {turn.actorType}
                          </span>
                          <span className="text-xs font-semibold text-slate-200">{turn.actorLabel}</span>
                        </div>
                        <span className="text-[11px] text-slate-500">
                          {new Date(turn.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200 [overflow-wrap:anywhere]">
                        {turn.content}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {detailsTab === "DIRECTION" ? (
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Direction
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200 [overflow-wrap:anywhere]">
                {directionText || "No direction context captured for this string yet."}
              </p>
            </div>
          ) : null}

          {detailsTab === "PLAN" ? (
            <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Plan
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                  {workflows.length} workflow(s)
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Deliverables</p>
                  <p className="mt-1 text-lg font-semibold text-slate-100">{deliverables.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Milestones</p>
                  <p className="mt-1 text-lg font-semibold text-slate-100">{milestones.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Toolkits</p>
                  <p className="mt-1 text-lg font-semibold text-slate-100">{requiredToolkits.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Detail Score</p>
                  <p className="mt-1 text-lg font-semibold text-slate-100">
                    {detailScore === null ? "N/A" : `${detailScore}/100`}
                  </p>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Plan Summary
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200 [overflow-wrap:anywhere]">
                  {planSummary || "No plan summary is available for this string yet."}
                </p>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Deliverables ({deliverables.length})
                  </p>
                  {deliverables.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">No deliverables captured yet.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {deliverables.map((deliverable, index) => (
                        <span
                          key={`${deliverable}-${index}`}
                          className="rounded-full border border-white/15 bg-black/30 px-2.5 py-1 text-[11px] text-slate-200"
                        >
                          {deliverable}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Required Toolkits
                  </p>
                  {requiredToolkits.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">No toolkits were attached to this plan.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {requiredToolkits.map((toolkit) => (
                        <span
                          key={toolkit}
                          className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-100"
                        >
                          {toolkit}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {detailsTab === "WORKFLOW" ? (
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Workflow
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                  {workflows.length} workflow(s)
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-200">
                {planSummary || "No workflow summary is available for this string yet."}
              </p>
              <div className="mt-3 space-y-2">
                {workflows.length === 0 ? (
                  <p className="text-xs text-slate-500">No workflows have been planned yet.</p>
                ) : (
                  workflows.map((workflow, index) => (
                    <div
                      key={`${workflow.title}-${index}`}
                      className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-100">{workflow.title}</p>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                          {workflow.tasks.length} task(s)
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {workflow.ownerRole || "Owner"}
                        {workflow.goal ? ` | ${compactTaskTitle(workflow.goal, workflow.title)}` : ""}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          {detailsTab === "PATHWAY" ? (
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Pathway
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                  {pathway.length} step(s)
                </span>
              </div>
              {pathway.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">No pathway has been mapped yet.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {pathway.map((step) => (
                    <div
                      key={step.stepId}
                      className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
                    >
                      <p className="text-xs font-semibold text-slate-100">
                        {step.line}. {step.workflowTitle} {"->"} {step.taskTitle}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {step.ownerRole} | {step.executionMode} | {step.dueWindow}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">{step.trigger}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {detailsTab === "APPROVALS" ? (
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Approvals
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                  {pendingPermissionRequests.length + pendingApprovalCheckpoints.length} pending
                </span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Plan Gates</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{planApprovals.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Requests</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{activePermissionRequests.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Runtime Checks</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{activeApprovalCheckpoints.length}</p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {planApprovals.map((approval, index) => (
                  <div
                    key={`${approval.name}-${index}`}
                    className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
                  >
                    <p className="text-xs font-semibold text-slate-100">{approval.name}</p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {approval.requiredRole} | {approval.trigger}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">{approval.reason}</p>
                  </div>
                ))}
                {activePermissionRequests.map((request) => (
                  <div
                    key={request.id}
                    className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-100">
                        {request.area} | {request.workflowTitle || "Workflow"} {"->"} {request.taskTitle || "Task"}
                      </p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusPillClass(request.status)}`}>
                        {request.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">{request.requestedByEmail || "Owner"}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{request.reason}</p>
                  </div>
                ))}
                {activeApprovalCheckpoints.map((checkpoint) => (
                  <div
                    key={checkpoint.id}
                    className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-100">
                        Flow {checkpoint.flowId?.slice(0, 8) ?? "N/A"} | Task {checkpoint.taskId?.slice(0, 8) ?? "N/A"}
                      </p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusPillClass(checkpoint.status)}`}>
                        {checkpoint.status}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{checkpoint.reason}</p>
                  </div>
                ))}
                {planApprovals.length === 0 &&
                activePermissionRequests.length === 0 &&
                activeApprovalCheckpoints.length === 0 ? (
                  <p className="text-xs text-slate-500">No approval items are attached to this string yet.</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {detailsTab === "MILESTONES" ? (
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Milestones
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                  {milestones.length} milestone(s)
                </span>
              </div>
              {milestones.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">No milestones have been defined yet.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {milestones.map((milestone, index) => (
                    <div
                      key={`${milestone.title}-${index}`}
                      className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
                    >
                      <p className="text-xs font-semibold text-slate-100">{milestone.title}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {milestone.ownerRole} | {milestone.dueWindow}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-300">{milestone.deliverable}</p>
                      <p className="mt-1 text-[11px] text-slate-500">{milestone.successSignal}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {detailsTab === "DELIVERABLES" ? (
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Deliverables
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                  {deliverableCards.length} deliverable(s)
                </span>
              </div>
              {deliverableCards.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">No deliverables have been defined yet.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {deliverableCards.map((card) => (
                    <div
                      key={card.id}
                      className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100">
                          {card.source}
                        </span>
                        {card.workflowTitle ? (
                          <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] text-slate-400">
                            {card.workflowTitle}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-slate-100">{card.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {detailsTab === "SCORING" ? (
            <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Scoring
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                  {detailScore === null ? "Detail score unavailable" : `Detail score ${detailScore}/100`}
                </span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Detail Score</p>
                  <p className="mt-1 text-lg font-semibold text-slate-100">
                    {detailScore === null ? "N/A" : `${detailScore}/100`}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Linked Flows</p>
                  <p className="mt-1 text-lg font-semibold text-slate-100">
                    {(stringItem.launchScope?.flowIds ?? []).length}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Approved</p>
                  <p className="mt-1 text-lg font-semibold text-slate-100">{activeLaneCounts.APPROVED}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Rethink</p>
                  <p className="mt-1 text-lg font-semibold text-slate-100">
                    {activeLaneCounts.RETHINK}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Steer Linked Review
                    </p>
                    <span className="text-[11px] text-slate-500">{deliverableCards.length} deliverable(s)</span>
                  </div>
                  {deliverableCards.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-500">No deliverables are linked to scoring yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {deliverableCards.map((card) => {
                        const lane = steerDecisions[card.id] ?? "CENTER";
                        return (
                          <div
                            key={`scoring-${card.id}`}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-slate-100">{card.text}</p>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {card.source}
                                {card.workflowTitle ? ` | ${card.workflowTitle}` : ""}
                              </p>
                            </div>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                lane === "APPROVED"
                                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                                  : lane === "RETHINK"
                                    ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                                    : "border-white/10 bg-white/5 text-slate-300"
                              }`}
                            >
                              {lane}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Current Review
                    </p>
                    <span className="text-[11px] text-slate-500">{activeScoreRecords.length} activity record(s)</span>
                  </div>
                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Scoring Note</p>
                    <p className="mt-2 text-xs leading-5 text-slate-400">
                      {activeDraft?.scoring.note.trim() || "No scoring note captured yet."}
                    </p>
                  </div>
                  {activeScoreRecords.length === 0 ? (
                    <p className="mt-3 text-xs text-slate-500">No steer or score activity logged yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {activeScoreRecords.slice(0, 5).map((record) => (
                        <div
                          key={`scoring-activity-${record.id}`}
                          className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-100">{record.metric}</p>
                            <span className="text-[11px] text-slate-500">
                              {new Date(record.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-400">
                            {record.score}/{record.maxScore} by {record.scoredBy}
                          </p>
                          {record.note ? <p className="mt-1 text-[11px] text-slate-500">{record.note}</p> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        blueprintSurface
      )}
    </div>
  );
}
