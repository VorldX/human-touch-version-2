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
  shouldDirectWorkflowLaunch,
  shouldForceDirectionPlanRoute,
  sleep,
  splitDraftLines,
  summarizeHumanInputReason,
  toLocalDateKey,
  workflowAgentLabelFromTaskTrace
} from "@/components/vorldx-shell/shared";

export function SteerDetailsEditorSurface({
  stringItem,
  calendarDate,
  permissionRequests,
  approvalCheckpoints,
  draftsByString,
  onDraftChange,
  scoreByString = {},
  steerLane = "CENTER",
  onSteerLaneChange,
  steerDecisions = {},
  onSteerDecision,
  initialDetailsTab,
  readOnly = false
}: {
  stringItem: ControlThreadHistoryItem | null;
  calendarDate?: string | null;
  permissionRequests: PermissionRequestItem[];
  approvalCheckpoints: ApprovalCheckpointItem[];
  draftsByString?: Record<string, EditableStringDraft>;
  onDraftChange?: (stringId: string, nextDraft: EditableStringDraft) => void;
  scoreByString?: Record<string, StringScoreRecord[]>;
  steerLane?: SteerLaneTab;
  onSteerLaneChange?: (value: SteerLaneTab) => void;
  steerDecisions?: Record<string, SteerLaneTab>;
  onSteerDecision?: (cardId: string, lane: SteerLaneTab) => void;
  initialDetailsTab?: FlowStringDetailsSubtab;
  readOnly?: boolean;
}) {
  const [detailsTab, setDetailsTab] = useState<FlowStringDetailsSubtab>(
    initialDetailsTab ?? "OVERVIEW"
  );
  const [internalDraftsByString, setInternalDraftsByString] = useState<
    Record<string, EditableStringDraft>
  >({});
  const activeStringItem = stringItem;
  const isExternalDraftMode = typeof onDraftChange === "function";
  const resolvedDraftsByString = useMemo(() => {
    if (isExternalDraftMode) {
      return {
        ...internalDraftsByString,
        ...(draftsByString ?? {})
      };
    }
    if (draftsByString && Object.keys(draftsByString).length > 0) {
      return {
        ...internalDraftsByString,
        ...draftsByString
      };
    }
    return internalDraftsByString;
  }, [draftsByString, internalDraftsByString, isExternalDraftMode]);

  useEffect(() => {
    if (!initialDetailsTab) {
      return;
    }
    setDetailsTab(initialDetailsTab);
  }, [initialDetailsTab]);

  const writeDraft = useCallback(
    (stringId: string, nextDraft: EditableStringDraft) => {
      if (isExternalDraftMode) {
        onDraftChange?.(stringId, nextDraft);
        return;
      }
      setInternalDraftsByString((previous) => ({
        ...previous,
        [stringId]: nextDraft
      }));
    },
    [isExternalDraftMode, onDraftChange]
  );

  useEffect(() => {
    if (!activeStringItem) {
      return;
    }
    if (resolvedDraftsByString[activeStringItem.id]) {
      return;
    }
    writeDraft(
      activeStringItem.id,
      buildEditableStringDraft({
        stringItem: activeStringItem,
        permissionRequests,
        approvalCheckpoints
      })
    );
  }, [
    activeStringItem,
    approvalCheckpoints,
    permissionRequests,
    resolvedDraftsByString,
    writeDraft
  ]);

  const activeDraft = activeStringItem ? resolvedDraftsByString[activeStringItem.id] ?? null : null;
  const activePlan = activeStringItem?.planningResult?.primaryPlan ?? null;
  const activeRequiredToolkits = activeStringItem?.planningResult?.requiredToolkits ?? [];
  const activeScoreRecords = useMemo(
    () =>
      activeStringItem
        ? [...(scoreByString[activeStringItem.id] ?? [])].sort(
            (left, right) => right.createdAt - left.createdAt
          )
        : [],
    [activeStringItem, scoreByString]
  );
  const steerCards = useMemo(
    () =>
      activeStringItem && activeDraft
        ? buildDraftDeliverableCards({
            stringItem: activeStringItem,
            draft: activeDraft
          }).map((card) => ({
            ...card,
            lane: steerDecisions[card.id] ?? "CENTER"
          }))
        : [],
    [activeDraft, activeStringItem, steerDecisions]
  );
  const steerLaneCounts = useMemo(
    () => ({
      CENTER: steerCards.filter((card) => card.lane === "CENTER").length,
      APPROVED: steerCards.filter((card) => card.lane === "APPROVED").length,
      RETHINK: steerCards.filter((card) => card.lane === "RETHINK").length
    }),
    [steerCards]
  );
  const visibleSteerCards = useMemo(
    () => steerCards.filter((card) => card.lane === steerLane),
    [steerCards, steerLane]
  );
  const draftPlanDeliverablesText = activeDraft?.plan.deliverablesText ?? "";
  const draftPlanDeliverables = useMemo(
    () => splitDraftLines(draftPlanDeliverablesText),
    [draftPlanDeliverablesText]
  );
  const draftWorkflowDeliverableCount =
    activeDraft?.workflows.reduce(
      (total, workflow) => total + splitDraftLines(workflow.deliverablesText).length,
      0
    ) ?? 0;
  const collaborationParticipants = useMemo(() => {
    const entries = new Map<
      string,
      { id: string; actorType: ActorType; actorLabel: string; turnCount: number }
    >();
    activeDraft?.discussion.forEach((entry, index) => {
      const actorLabel =
        entry.actorLabel.trim() || (entry.actorType === "HUMAN" ? "Owner" : "Participant");
      const key = `${entry.actorType}:${actorLabel.toLowerCase()}`;
      const existing = entries.get(key);
      if (existing) {
        existing.turnCount += 1;
        return;
      }
      entries.set(key, {
        id: `participant-${index}`,
        actorType: entry.actorType,
        actorLabel,
        turnCount: 1
      });
    });
    return [...entries.values()];
  }, [activeDraft]);
  const collaborationWorkforce = useMemo(
    () => activePlan?.resourcePlan ?? [],
    [activePlan?.resourcePlan]
  );
  const collaborationAutoSquad = activeStringItem?.planningResult?.autoSquad ?? null;
  const collaborationCount =
    collaborationParticipants.length +
    collaborationWorkforce.length +
    (collaborationAutoSquad?.created?.length ?? 0) +
    (collaborationAutoSquad?.requestedRoles?.length ?? 0);
  const overviewCards = useMemo(
    () =>
      activeDraft
        ? [
            {
              label: "Discussion",
              value: `${activeDraft.discussion.length}`,
              helper:
                activeDraft.discussion[activeDraft.discussion.length - 1]?.content ||
                "No discussion entries yet."
            },
            {
              label: "Direction",
              value: activeDraft.direction.trim() ? "Ready" : "Empty",
              helper: compactTaskTitle(activeDraft.direction, "No direction captured yet.")
            },
            {
              label: "Plan",
              value: activeDraft.plan.summary.trim() ? "Ready" : "Empty",
              helper: compactTaskTitle(activeDraft.plan.summary, "No plan summary yet.")
            },
            {
              label: "Workflow",
              value: `${activeDraft.workflows.length}`,
              helper: activeDraft.workflows[0]?.title || "No workflows yet."
            },
            {
              label: "Pathway",
              value: `${activeDraft.pathway.length}`,
              helper: activeDraft.pathway[0]
                ? `${activeDraft.pathway[0].workflowTitle} -> ${activeDraft.pathway[0].taskTitle}`
                : "No pathway steps yet."
            },
            {
              label: "Approvals",
              value: `${activeDraft.approvals.length}`,
              helper:
                activeDraft.approvals[0]?.title ||
                "No approval requests or checkpoints yet."
            },
            {
              label: "Milestones",
              value: `${activeDraft.milestones.length}`,
              helper: activeDraft.milestones[0]?.title || "No milestones yet."
            },
            {
              label: "Deliverables",
              value: `${steerCards.length}`,
              helper:
                draftPlanDeliverables[0] ||
                activeDraft.workflows.find((workflow) => splitDraftLines(workflow.deliverablesText).length > 0)
                  ?.title ||
                "No deliverables captured yet."
            },
            {
              label: "Scoring",
              value: activeDraft.scoring.detailScore.trim()
                ? `${activeDraft.scoring.detailScore}/100`
                : "N/A",
              helper: `${steerLaneCounts.APPROVED} approved, ${steerLaneCounts.RETHINK} rethink`
            },
            {
              label: "Collaboration",
              value: `${collaborationCount}`,
              helper:
                collaborationWorkforce[0]?.role ||
                collaborationParticipants[0]?.actorLabel ||
                collaborationAutoSquad?.created?.[0]?.name ||
                "No collaboration context yet."
            }
          ]
        : [],
    [
      activeDraft,
      collaborationAutoSquad?.created,
      collaborationCount,
      collaborationParticipants,
      collaborationWorkforce,
      draftPlanDeliverables,
      steerCards.length,
      steerLaneCounts.APPROVED,
      steerLaneCounts.RETHINK
    ]
  );

  const updateDraft = useCallback(
    (updater: (draft: EditableStringDraft) => EditableStringDraft) => {
      if (!activeStringItem) {
        return;
      }
      const current =
        resolvedDraftsByString[activeStringItem.id] ??
        buildEditableStringDraft({
          stringItem: activeStringItem,
          permissionRequests,
          approvalCheckpoints
        });
      writeDraft(activeStringItem.id, updater(current));
    },
    [activeStringItem, approvalCheckpoints, permissionRequests, resolvedDraftsByString, writeDraft]
  );

  const resetDraft = useCallback(() => {
    if (!activeStringItem) {
      return;
    }
    writeDraft(
      activeStringItem.id,
      buildEditableStringDraft({
        stringItem: activeStringItem,
        permissionRequests,
        approvalCheckpoints
      })
    );
  }, [activeStringItem, approvalCheckpoints, permissionRequests, writeDraft]);

  if (!activeStringItem) {
    return (
      <div className="rounded-[24px] border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-slate-500">
        {readOnly
          ? "Select a string from the signal chain to view its blueprint."
          : "Select a string from the signal chain to edit Steer details for this calendar scope."}
      </div>
    );
  }

  if (!activeDraft) {
    return (
      <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-slate-500">
        {readOnly ? "Preparing string blueprint..." : "Preparing steer details draft..."}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {readOnly ? "String Blueprint" : "Editable Steer Details"}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-100">
              {controlThreadDisplayTitle(activeStringItem)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {readOnly
                ? "Read the same blueprint canvas used by Steer, aligned to this string across discussion, direction, plan, workflow, pathway, approvals, milestones, deliverables, scoring, and collaboration."
                : "Edit plan details here, and use the scoring tab to review deliverables with approve and rethink decisions in the same place."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                {calendarDate
                  ? `Calendar scope: ${new Date(`${calendarDate}T00:00:00`).toLocaleDateString()}`
                  : "Calendar scope: All dates"}
              </span>
            </div>
          </div>
          {!readOnly ? (
            <button
              type="button"
              onClick={resetDraft}
              className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
            >
              Reset Draft
            </button>
          ) : null}
        </div>
      </div>

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
              {readOnly ? "Blueprint aligned to string" : "Synced across string and steer"}
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {overviewCards.map((card) => (
              <div key={card.label} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    {card.label}
                  </p>
                  <span className="text-sm font-semibold text-slate-100">{card.value}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-400">{card.helper}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {readOnly ? "Deliverable Review" : "Steer Sync"}
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                  {steerCards.length} deliverable(s)
                </span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Center</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{steerLaneCounts.CENTER}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Approved</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{steerLaneCounts.APPROVED}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Rethink</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{steerLaneCounts.RETHINK}</p>
                </div>
              </div>
              {steerCards.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">No steer deliverables are available yet.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {steerCards.slice(0, 6).map((card) => (
                    <div
                      key={`overview-${card.id}`}
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
                          card.lane === "APPROVED"
                            ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                            : card.lane === "RETHINK"
                              ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                              : "border-white/10 bg-white/5 text-slate-300"
                        }`}
                      >
                        {card.lane}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/25 p-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {readOnly ? "Scoring" : "Scoring Sync"}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  {readOnly
                    ? "Current score and review activity for this string."
                    : "The editable score note here also drives the visible string dashboard."}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Current Review</p>
                <p className="mt-2 text-sm font-semibold text-slate-100">
                  {activeDraft.scoring.detailScore.trim()
                    ? `${activeDraft.scoring.detailScore}/100`
                    : "No review score yet"}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  {activeDraft.scoring.note.trim() || "No scoring note captured yet."}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    Recent Activity
                  </p>
                  <span className="text-[11px] text-slate-500">{activeScoreRecords.length} record(s)</span>
                </div>
                {activeScoreRecords.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">No scoring or steer activity logged yet.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {activeScoreRecords.slice(0, 5).map((record) => (
                      <div
                        key={record.id}
                        className="rounded-2xl border border-white/10 bg-black/15 px-3 py-2"
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
        </div>
      ) : null}

      {detailsTab === "DISCUSSION" ? (
        <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Discussion</p>
            {!readOnly ? (
              <button
                type="button"
                onClick={() =>
                  updateDraft((draft) => ({
                    ...draft,
                    discussion: [
                      ...draft.discussion,
                      {
                        id: makeLocalDraftId("discussion"),
                        actorType: "HUMAN",
                        actorLabel: "Owner",
                        content: ""
                      }
                    ]
                  }))
                }
                className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-200"
              >
                Add
              </button>
            ) : null}
          </div>
          {activeDraft.discussion.map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div
                className={`grid gap-2 ${
                  readOnly ? "md:grid-cols-[150px_1fr]" : "md:grid-cols-[150px_1fr_auto]"
                }`}
              >
                <input
                  value={entry.actorLabel}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateDraft((draft) => ({
                      ...draft,
                      discussion: draft.discussion.map((item) =>
                        item.id === entry.id ? { ...item, actorLabel: event.target.value } : item
                      )
                    }))
                  }
                  placeholder="Actor"
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                />
                <textarea
                  value={entry.content}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateDraft((draft) => ({
                      ...draft,
                      discussion: draft.discussion.map((item) =>
                        item.id === entry.id ? { ...item, content: event.target.value } : item
                      )
                    }))
                  }
                  placeholder="Discussion content"
                  className="h-20 resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                />
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() =>
                      updateDraft((draft) => ({
                        ...draft,
                        discussion: draft.discussion.filter((item) => item.id !== entry.id)
                      }))
                    }
                    className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {activeDraft.discussion.length === 0 ? <p className="text-xs text-slate-500">No discussion entries yet.</p> : null}
        </div>
      ) : null}

      {detailsTab === "DIRECTION" ? (
        <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Direction</p>
          <textarea
            value={activeDraft.direction}
            readOnly={readOnly}
            onChange={(event) => updateDraft((draft) => ({ ...draft, direction: event.target.value }))}
            placeholder="Direction"
            className="mt-3 h-44 w-full resize-none rounded-2xl border border-white/10 bg-black/40 px-3 py-3 text-sm text-slate-100 outline-none"
          />
        </div>
      ) : null}

      {detailsTab === "PLAN" ? (
        <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Workflows</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {activePlan?.workflows.length ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Deliverables</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {draftPlanDeliverables.length}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Score</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {activeDraft.scoring.detailScore || "N/A"}
              </p>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Plan Summary
            </p>
            <textarea
              value={activeDraft.plan.summary}
              readOnly={readOnly}
              onChange={(event) =>
                updateDraft((draft) => ({
                  ...draft,
                  plan: { ...draft.plan, summary: event.target.value }
                }))
              }
              placeholder="Plan summary"
              className="mt-3 h-44 w-full resize-none rounded-2xl border border-white/10 bg-black/40 px-3 py-3 text-sm text-slate-100 outline-none"
            />
          </div>
          {activeRequiredToolkits.length > 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Required Toolkits
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {activeRequiredToolkits.map((toolkit) => (
                  <span
                    key={toolkit}
                    className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-100"
                  >
                    {toolkit}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {detailsTab === "WORKFLOW" ? (
        <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Workflow</p>
            {!readOnly ? (
              <button
                type="button"
                onClick={() =>
                  updateDraft((draft) => ({
                    ...draft,
                    workflows: [
                      ...draft.workflows,
                      {
                        id: makeLocalDraftId("workflow"),
                        title: "",
                        ownerRole: "",
                        goal: "",
                        deliverablesText: "",
                        taskSummary: ""
                      }
                    ]
                  }))
                }
                className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-200"
              >
                Add
              </button>
            ) : null}
          </div>
          {activeDraft.workflows.map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div
                className={`grid gap-2 ${
                  readOnly ? "md:grid-cols-[1fr_220px]" : "md:grid-cols-[1fr_220px_auto]"
                }`}
              >
                <input
                  value={entry.title}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateDraft((draft) => ({
                      ...draft,
                      workflows: draft.workflows.map((item) =>
                        item.id === entry.id ? { ...item, title: event.target.value } : item
                      )
                    }))
                  }
                  placeholder="Workflow title"
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                />
                <input
                  value={entry.ownerRole}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateDraft((draft) => ({
                      ...draft,
                      workflows: draft.workflows.map((item) =>
                        item.id === entry.id ? { ...item, ownerRole: event.target.value } : item
                      )
                    }))
                  }
                  placeholder="Owner role"
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                />
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() =>
                      updateDraft((draft) => ({
                        ...draft,
                        workflows: draft.workflows.filter((item) => item.id !== entry.id)
                      }))
                    }
                    className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <textarea
                value={entry.goal}
                readOnly={readOnly}
                onChange={(event) =>
                  updateDraft((draft) => ({
                    ...draft,
                    workflows: draft.workflows.map((item) =>
                      item.id === entry.id ? { ...item, goal: event.target.value } : item
                    )
                  }))
                }
                placeholder="Workflow notes"
                className="mt-2 h-24 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </div>
          ))}
          {activeDraft.workflows.length === 0 ? <p className="text-xs text-slate-500">No workflow entries yet.</p> : null}
        </div>
      ) : null}

      {detailsTab === "PATHWAY" ? (
        <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Pathway</p>
            {!readOnly ? (
              <button
                type="button"
                onClick={() =>
                  updateDraft((draft) => ({
                    ...draft,
                    pathway: [
                      ...draft.pathway,
                      {
                        id: makeLocalDraftId("pathway"),
                        workflowTitle: "",
                        taskTitle: "",
                        ownerRole: "",
                        executionMode: "HYBRID",
                        trigger: "",
                        dueWindow: ""
                      }
                    ]
                  }))
                }
                className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-200"
              >
                Add
              </button>
            ) : null}
          </div>
          {activeDraft.pathway.map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div
                className={`grid gap-2 ${
                  readOnly ? "md:grid-cols-[1fr_1fr]" : "md:grid-cols-[1fr_1fr_auto]"
                }`}
              >
                <input
                  value={entry.workflowTitle}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateDraft((draft) => ({
                      ...draft,
                      pathway: draft.pathway.map((item) =>
                        item.id === entry.id ? { ...item, workflowTitle: event.target.value } : item
                      )
                    }))
                  }
                  placeholder="Workflow"
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                />
                <input
                  value={entry.taskTitle}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateDraft((draft) => ({
                      ...draft,
                      pathway: draft.pathway.map((item) =>
                        item.id === entry.id ? { ...item, taskTitle: event.target.value } : item
                      )
                    }))
                  }
                  placeholder="Task"
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                />
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() =>
                      updateDraft((draft) => ({
                        ...draft,
                        pathway: draft.pathway.filter((item) => item.id !== entry.id)
                      }))
                    }
                    className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <textarea
                value={`${entry.ownerRole}${entry.trigger ? `\n${entry.trigger}` : ""}`}
                readOnly={readOnly}
                onChange={(event) =>
                  updateDraft((draft) => ({
                    ...draft,
                    pathway: draft.pathway.map((item) =>
                      item.id === entry.id
                        ? {
                            ...item,
                            ownerRole: event.target.value.split("\n")[0] ?? "",
                            trigger: event.target.value.split("\n").slice(1).join("\n")
                          }
                        : item
                    )
                  }))
                }
                placeholder="Owner role on first line, notes below"
                className="mt-2 h-24 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </div>
          ))}
          {activeDraft.pathway.length === 0 ? <p className="text-xs text-slate-500">No pathway entries yet.</p> : null}
        </div>
      ) : null}

      {detailsTab === "APPROVALS" ? (
        <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Approvals</p>
            {!readOnly ? (
              <button
                type="button"
                onClick={() =>
                  updateDraft((draft) => ({
                    ...draft,
                    approvals: [
                      ...draft.approvals,
                      {
                        id: makeLocalDraftId("approval"),
                        title: "",
                        owner: "",
                        reason: "",
                        status: "PENDING"
                      }
                    ]
                  }))
                }
                className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-200"
              >
                Add
              </button>
            ) : null}
          </div>
          {activeDraft.approvals.map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div
                className={`grid gap-2 ${
                  readOnly ? "md:grid-cols-[1fr_160px]" : "md:grid-cols-[1fr_160px_auto]"
                }`}
              >
                <input
                  value={entry.title}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateDraft((draft) => ({
                      ...draft,
                      approvals: draft.approvals.map((item) =>
                        item.id === entry.id ? { ...item, title: event.target.value } : item
                      )
                    }))
                  }
                  placeholder="Approval"
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                />
                <input
                  value={entry.status}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateDraft((draft) => ({
                      ...draft,
                      approvals: draft.approvals.map((item) =>
                        item.id === entry.id ? { ...item, status: event.target.value } : item
                      )
                    }))
                  }
                  placeholder="Status"
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                />
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() =>
                      updateDraft((draft) => ({
                        ...draft,
                        approvals: draft.approvals.filter((item) => item.id !== entry.id)
                      }))
                    }
                    className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <textarea
                value={`${entry.owner}${entry.reason ? `\n${entry.reason}` : ""}`}
                readOnly={readOnly}
                onChange={(event) =>
                  updateDraft((draft) => ({
                    ...draft,
                    approvals: draft.approvals.map((item) =>
                      item.id === entry.id
                        ? {
                            ...item,
                            owner: event.target.value.split("\n")[0] ?? "",
                            reason: event.target.value.split("\n").slice(1).join("\n")
                          }
                        : item
                    )
                  }))
                }
                placeholder="Owner on first line, reason below"
                className="mt-2 h-20 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </div>
          ))}
          {activeDraft.approvals.length === 0 ? <p className="text-xs text-slate-500">No approval entries yet.</p> : null}
        </div>
      ) : null}

      {detailsTab === "MILESTONES" ? (
        <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Milestones</p>
            {!readOnly ? (
              <button
                type="button"
                onClick={() =>
                  updateDraft((draft) => ({
                    ...draft,
                    milestones: [
                      ...draft.milestones,
                      {
                        id: makeLocalDraftId("milestone"),
                        title: "",
                        ownerRole: "",
                        dueWindow: "",
                        deliverable: "",
                        successSignal: ""
                      }
                    ]
                  }))
                }
                className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-200"
              >
                Add
              </button>
            ) : null}
          </div>
          {activeDraft.milestones.map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div
                className={`grid gap-2 ${
                  readOnly ? "md:grid-cols-[1fr_220px]" : "md:grid-cols-[1fr_220px_auto]"
                }`}
              >
                <input
                  value={entry.title}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateDraft((draft) => ({
                      ...draft,
                      milestones: draft.milestones.map((item) =>
                        item.id === entry.id ? { ...item, title: event.target.value } : item
                      )
                    }))
                  }
                  placeholder="Milestone title"
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                />
                <input
                  value={entry.ownerRole}
                  readOnly={readOnly}
                  onChange={(event) =>
                    updateDraft((draft) => ({
                      ...draft,
                      milestones: draft.milestones.map((item) =>
                        item.id === entry.id ? { ...item, ownerRole: event.target.value } : item
                      )
                    }))
                  }
                  placeholder="Owner role"
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                />
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() =>
                      updateDraft((draft) => ({
                        ...draft,
                        milestones: draft.milestones.filter((item) => item.id !== entry.id)
                      }))
                    }
                    className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-200"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <textarea
                value={`${entry.deliverable}${entry.successSignal ? `\n${entry.successSignal}` : ""}`}
                readOnly={readOnly}
                onChange={(event) =>
                  updateDraft((draft) => ({
                    ...draft,
                    milestones: draft.milestones.map((item) =>
                      item.id === entry.id
                        ? {
                            ...item,
                            deliverable: event.target.value.split("\n")[0] ?? "",
                            successSignal: event.target.value.split("\n").slice(1).join("\n")
                          }
                        : item
                    )
                  }))
                }
                placeholder="Deliverable on first line, success signal below"
                className="mt-2 h-20 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              />
            </div>
          ))}
          {activeDraft.milestones.length === 0 ? <p className="text-xs text-slate-500">No milestone entries yet.</p> : null}
        </div>
      ) : null}

      {detailsTab === "DELIVERABLES" ? (
        <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Plan Deliverables
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {draftPlanDeliverables.length}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Workflow Deliverables
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {draftWorkflowDeliverableCount}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Plan Deliverables
              </p>
              <span className="text-[11px] text-slate-500">One deliverable per line</span>
            </div>
            <textarea
              value={activeDraft.plan.deliverablesText}
              readOnly={readOnly}
              onChange={(event) =>
                updateDraft((draft) => ({
                  ...draft,
                  plan: { ...draft.plan, deliverablesText: event.target.value }
                }))
              }
              placeholder="List plan deliverables"
              className="mt-3 h-28 w-full resize-none rounded-2xl border border-white/10 bg-black/40 px-3 py-3 text-sm text-slate-100 outline-none"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Workflow Deliverables
              </p>
              <span className="text-[11px] text-slate-500">One deliverable per line</span>
            </div>
            {activeDraft.workflows.length === 0 ? (
              <p className="text-xs text-slate-500">No workflow entries yet.</p>
            ) : (
              activeDraft.workflows.map((entry) => (
                <div key={`${entry.id}-deliverables`} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-xs font-semibold text-slate-100">
                    {entry.title || "Untitled workflow"}
                  </p>
                  <textarea
                    value={entry.deliverablesText}
                    readOnly={readOnly}
                    onChange={(event) =>
                      updateDraft((draft) => ({
                        ...draft,
                        workflows: draft.workflows.map((item) =>
                          item.id === entry.id
                            ? { ...item, deliverablesText: event.target.value }
                            : item
                        )
                      }))
                    }
                    placeholder="List workflow deliverables"
                    className="mt-2 h-24 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {detailsTab === "SCORING" ? (
        <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Scoring
            </p>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
              Review deliverables and score in one pass
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Detail Score
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {activeDraft.scoring.detailScore || "N/A"}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Center</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {steerLaneCounts.CENTER}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Approved</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {steerLaneCounts.APPROVED}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Rethink</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {steerLaneCounts.RETHINK}
              </p>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.85fr)]">
            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/25 p-3">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {readOnly ? "Deliverable Review" : "Steer Review"}
                  </p>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                    {steerCards.length} deliverable(s)
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  {readOnly
                    ? "Review the current deliverable decisions for this string."
                    : "Approve, rethink, or reset deliverables while you capture the score for this string."}
                </p>
              </div>

              {steerCards.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-3 text-xs text-slate-500">
                  No plan deliverables are available to review yet.
                </div>
              ) : (
                <>
                  <div className="inline-flex flex-wrap rounded-full border border-white/15 bg-black/40 p-1">
                    {([
                      { id: "CENTER", label: "Center" },
                      { id: "APPROVED", label: "Approved" },
                      { id: "RETHINK", label: "Rethink" }
                    ] as Array<{ id: SteerLaneTab; label: string }>).map((lane) => (
                      <button
                        key={lane.id}
                        type="button"
                        onClick={() => onSteerLaneChange?.(lane.id)}
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                          steerLane === lane.id
                            ? "bg-gradient-to-r from-cyan-200 to-white text-slate-950"
                            : "text-slate-300 hover:bg-white/10"
                        }`}
                      >
                        {lane.label} ({steerLaneCounts[lane.id]})
                      </button>
                    ))}
                  </div>

                  {visibleSteerCards.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-3 text-xs text-slate-500">
                      {steerLane === "CENTER"
                        ? "No deliverables waiting in Center."
                        : steerLane === "APPROVED"
                          ? "No deliverables approved yet."
                          : "No deliverables are in Rethink."}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {visibleSteerCards.map((card) => (
                        <article
                          key={card.id}
                          className="rounded-2xl border border-white/10 bg-black/20 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100">
                                  {card.source}
                                </span>
                                {card.workflowTitle ? (
                                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                                    {card.workflowTitle}
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-2 text-sm font-semibold leading-6 text-slate-100">
                                {card.text}
                              </p>
                            </div>
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                                card.lane === "APPROVED"
                                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                                  : card.lane === "RETHINK"
                                    ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                                    : "border-white/10 bg-white/5 text-slate-300"
                              }`}
                            >
                              {card.lane}
                            </span>
                          </div>

                          {!readOnly ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => onSteerDecision?.(card.id, "CENTER")}
                                className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                              >
                                Back To Center
                              </button>
                              <button
                                type="button"
                                onClick={() => onSteerDecision?.(card.id, "APPROVED")}
                                className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => onSteerDecision?.(card.id, "RETHINK")}
                                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-200 transition hover:bg-amber-500/20"
                              >
                                Move To Rethink
                              </button>
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/25 p-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {readOnly ? "Score Snapshot" : "Score Capture"}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  {readOnly
                    ? "Current score and note for this blueprint."
                    : "Keep the plan score and review note beside the approve or rethink decisions."}
                </p>
              </div>
              <input
                value={activeDraft.scoring.detailScore}
                readOnly={readOnly}
                onChange={(event) =>
                  updateDraft((draft) => ({
                    ...draft,
                    scoring: { ...draft.scoring, detailScore: event.target.value }
                  }))
                }
                placeholder="Detail score"
                className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
              />
              <textarea
                value={activeDraft.scoring.note}
                readOnly={readOnly}
                onChange={(event) =>
                  updateDraft((draft) => ({
                    ...draft,
                    scoring: { ...draft.scoring, note: event.target.value }
                  }))
                }
                placeholder="Scoring note"
                className="h-32 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              />
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    Recent Activity
                  </p>
                  <span className="text-[11px] text-slate-500">{activeScoreRecords.length}</span>
                </div>
                {activeScoreRecords.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">No steer or score activity logged yet.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {activeScoreRecords.slice(0, 4).map((record) => (
                      <div
                        key={`score-${record.id}`}
                        className="rounded-2xl border border-white/10 bg-black/15 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-100">{record.metric}</p>
                          <span className="text-[11px] text-slate-500">
                            {new Date(record.createdAt).toLocaleTimeString()}
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
        </div>
      ) : null}

      {detailsTab === "COLLABORATION" ? (
        <div className="space-y-3 rounded-[24px] border border-white/10 bg-black/20 p-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Participants</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">{collaborationParticipants.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Workforce</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">{collaborationWorkforce.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Requested Roles</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {collaborationAutoSquad?.requestedRoles?.length ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Created Team</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {collaborationAutoSquad?.created?.length ?? 0}
              </p>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.1fr)]">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Participants
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                  From discussion turns
                </span>
              </div>
              {collaborationParticipants.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">No participants captured for this string yet.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {collaborationParticipants.map((participant) => (
                    <div
                      key={participant.id}
                      className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                              participant.actorType === "HUMAN"
                                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                                : participant.actorType === "AI"
                                  ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-200"
                                  : "border-white/10 bg-white/5 text-slate-300"
                            }`}
                          >
                            {participant.actorType}
                          </span>
                          <p className="text-xs font-semibold text-slate-100">{participant.actorLabel}</p>
                        </div>
                        <span className="text-[11px] text-slate-500">{participant.turnCount} turn(s)</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Workforce Context
                  </p>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                    {collaborationWorkforce.length} allocation(s)
                  </span>
                </div>
                {collaborationWorkforce.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-500">No workforce plan linked yet.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {collaborationWorkforce.map((resource, index) => (
                      <div
                        key={`${resource.role}-${index}`}
                        className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-100">{resource.role}</p>
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                            {resource.workforceType} | {resource.capacityPct}%
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">{resource.responsibility}</p>
                        {resource.tools.length > 0 ? (
                          <p className="mt-1 text-[11px] text-slate-500">Tools: {resource.tools.join(" | ")}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Auto-WorkForce
                  </p>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${
                      collaborationAutoSquad?.triggered
                        ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-200"
                        : "border-white/10 bg-white/5 text-slate-300"
                    }`}
                  >
                    {collaborationAutoSquad?.triggered ? "Triggered" : "Not triggered"}
                  </span>
                </div>
                {collaborationAutoSquad?.domain ? (
                  <p className="mt-2 text-[11px] text-slate-500">Domain: {collaborationAutoSquad.domain}</p>
                ) : null}
                {(collaborationAutoSquad?.requestedRoles?.length ?? 0) > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(collaborationAutoSquad?.requestedRoles ?? []).map((role) => (
                      <span
                        key={role}
                        className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100"
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">No requested roles captured yet.</p>
                )}
                {(collaborationAutoSquad?.created?.length ?? 0) > 0 ? (
                  <div className="mt-3 space-y-2">
                    {(collaborationAutoSquad?.created ?? []).map((member) => (
                      <div
                        key={member.id}
                        className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-100">{member.name}</p>
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                            {member.role}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">Agent ID: {member.id}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
