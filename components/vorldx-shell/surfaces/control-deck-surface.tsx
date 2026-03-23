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
  summarizeHumanInputReason,
  toLocalDateKey,
  workflowAgentLabelFromTaskTrace
} from "@/components/vorldx-shell/shared";
import { classifyEmailDraftReply } from "@/lib/agent/run/email-request-parser";
import { SteerDetailsEditorSurface } from "@/components/vorldx-shell/surfaces/steer-details-editor-surface";
import { StringCollaborationPanel } from "@/components/vorldx-shell/surfaces/string-collaboration-panel";

export function ControlDeckSurface({
  orgId,
  orgName,
  orgRoleLabel,
  themeStyle,
  mode,
  conversationDetail,
  engaged,
  directionGiven,
  turns,
  directionModelId,
  directionModels,
  directionChatInFlight,
  directionPlanningInFlight,
  planningResult,
  message,
  onDismissMessage,
  agentRunResult,
  agentRunInputValues,
  pendingPlanLaunchApproval,
  pendingEmailApproval,
  pendingToolkitApproval,
  agentInputSourceUrl,
  agentInputFile,
  agentInputSubmitting,
  agentActionBusy,
  permissionRequests,
  approvalCheckpoints,
  permissionRequestActionId,
  approvalCheckpointActionId,
  historyItems,
  activeHistoryId,
  onCreateThread,
  onSelectThread,
  onModeChange,
  onConversationDetailChange,
  onDirectionGivenChange,
  onAgentInputValueChange,
  onAgentInputSourceUrlChange,
  onAgentInputFileChange,
  onSubmitAgentInputs,
  onRejectAgentInput,
  onApprovePlanLaunch,
  onRejectPlanLaunch,
  onApproveEmailDraft,
  onRejectEmailDraft,
  onApproveToolkitAccess,
  onRejectToolkitAccess,
  onPermissionRequestDecision,
  onApprovalCheckpointDecision,
  onOpenTools,
  onOpenStringInFlow,
  onDirectionModelChange,
  onEngageWithMode,
  onSendMessage,
  onVoiceIntent,
  isRecordingIntent
}: {
  orgId: string | null;
  orgName: string;
  orgRoleLabel: string;
  themeStyle: { accent: string; accentSoft: string; border: string };
  mode: ControlMode;
  conversationDetail: ControlConversationDetail;
  engaged: boolean;
  directionGiven: string;
  turns: DirectionTurn[];
  directionModelId: (typeof DIRECTION_MODELS)[number]["id"];
  directionModels: readonly { id: string; label: string }[];
  directionChatInFlight: boolean;
  directionPlanningInFlight: boolean;
  planningResult: DirectionPlanningResult | null;
  message: ControlMessage | null;
  onDismissMessage?: () => void;
  agentRunResult: AgentRunResponse | null;
  agentRunInputValues: Record<string, string>;
  pendingPlanLaunchApproval: PendingPlanLaunchApproval | null;
  pendingEmailApproval: PendingEmailApproval | null;
  pendingToolkitApproval: PendingToolkitApproval | null;
  agentInputSourceUrl: string;
  agentInputFile: File | null;
  agentInputSubmitting: boolean;
  agentActionBusy: boolean;
  permissionRequests: PermissionRequestItem[];
  approvalCheckpoints: ApprovalCheckpointItem[];
  permissionRequestActionId: string | null;
  approvalCheckpointActionId: string | null;
  historyItems: ControlThreadHistoryItem[];
  activeHistoryId: string | null;
  onCreateThread: (mode?: ControlMode) => void;
  onSelectThread: (threadId: string) => void;
  onModeChange: (value: ControlMode) => void;
  onConversationDetailChange: (value: ControlConversationDetail) => void;
  onDirectionGivenChange: (value: string) => void;
  onAgentInputValueChange: (key: string, value: string) => void;
  onAgentInputSourceUrlChange: (value: string) => void;
  onAgentInputFileChange: (file: File | null) => void;
  onSubmitAgentInputs: () => void;
  onRejectAgentInput: () => void;
  onApprovePlanLaunch: () => void;
  onRejectPlanLaunch: () => void;
  onApproveEmailDraft: () => void;
  onRejectEmailDraft: () => void;
  onApproveToolkitAccess: () => void;
  onRejectToolkitAccess: () => void;
  onPermissionRequestDecision: (requestId: string, decision: "APPROVE" | "REJECT") => void;
  onApprovalCheckpointDecision: (
    checkpointId: string,
    decision: "APPROVE" | "REJECT"
  ) => void;
  onOpenTools: () => void;
  onOpenStringInFlow: (threadId: string) => void;
  onDirectionModelChange: (value: (typeof DIRECTION_MODELS)[number]["id"]) => void;
  onEngageWithMode: (value: ControlMode) => void;
  onSendMessage: (
    message: string,
    mode: ControlMode,
    attachments?: ComposerAttachmentPayload
  ) => Promise<void>;
  onVoiceIntent: () => void;
  isRecordingIntent: boolean;
}) {
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [surfaceTab, setSurfaceTab] = useState<ControlSurfaceTab>(mode);
  const [stringsWorkspaceTab, setStringsWorkspaceTab] = useState<StringWorkspaceTab>("DETAILS");
  const [stringDetailsTab, setStringDetailsTab] = useState<StringDetailsTab>("DISCUSSION");
  const [steerLane, setSteerLane] = useState<SteerLane>("CENTER");
  const [steerByString, setSteerByString] = useState<
    Record<string, Record<string, StringSteerDecisionRecord>>
  >({});
  const [steerDrag, setSteerDrag] = useState<{ id: string; startX: number; deltaX: number } | null>(
    null
  );
  const [scoreByString, setScoreByString] = useState<Record<string, StringScoreRecord[]>>({});
  const [scoreMetricDraft, setScoreMetricDraft] = useState("String quality");
  const [scoreValueDraft, setScoreValueDraft] = useState("80");
  const [scoreMaxDraft, setScoreMaxDraft] = useState("100");
  const [scoreByTypeDraft, setScoreByTypeDraft] = useState<ActorType>("HUMAN");
  const [scoreByNameDraft, setScoreByNameDraft] = useState("Owner");
  const [scoreNoteDraft, setScoreNoteDraft] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasConversation = turns.length > 0;
  const hasDirectionDraft = directionGiven.trim().length > 0;
  const isBusy =
    directionChatInFlight ||
    directionPlanningInFlight ||
    sending ||
    agentActionBusy ||
    agentInputSubmitting;
  const isApprovalBusy = sending || agentActionBusy || agentInputSubmitting;
  const requiredInputs = agentRunResult?.status === "needs_input" ? agentRunResult.required_inputs ?? [] : [];
  const hasActionCards =
    Boolean(pendingPlanLaunchApproval) ||
    Boolean(pendingToolkitApproval) ||
    Boolean(pendingEmailApproval) ||
    agentRunResult?.status === "needs_input";
  const showLanding =
    !hasConversation &&
    !hasDirectionDraft &&
    !hasActionCards &&
    !planningResult?.analysis;
  const hideControlDeckScreenshotElements = true;
  const actionQueueCount = Number(Boolean(pendingPlanLaunchApproval)) +
    Number(Boolean(pendingToolkitApproval)) +
    Number(Boolean(pendingEmailApproval)) +
    Number(agentRunResult?.status === "needs_input");
  const showCommandDraftPanel = false;
  const stringItems = useMemo(() => historyItems, [historyItems]);
  const isStringsView = surfaceTab === "STRINGS";
  const activeStringItem = useMemo(() => {
    if (historyItems.length === 0) {
      return null;
    }
    if (!activeHistoryId) {
      return historyItems[0] ?? null;
    }
    return historyItems.find((item) => item.id === activeHistoryId) ?? historyItems[0] ?? null;
  }, [activeHistoryId, historyItems]);
  const isActiveStringThread = Boolean(
    activeStringItem && activeHistoryId && activeStringItem.id === activeHistoryId
  );
  const activeStringPlan = activeStringItem?.planningResult?.primaryPlan ?? null;
  const stringDetailsRows = useMemo(() => {
    const workflowCount = activeStringPlan?.workflows?.length ?? 0;
    const pathwayCount = activeStringPlan?.pathway?.length ?? 0;
    const milestoneCount = activeStringPlan?.milestones?.length ?? 0;
    const approvalCount =
      (activeStringPlan?.approvalCheckpoints?.length ?? 0) +
      (activeStringItem?.planningResult?.permissionRequests?.length ?? 0) +
      Number(Boolean(activeStringItem?.pendingPlanLaunchApproval)) +
      Number(Boolean(activeStringItem?.pendingToolkitApproval)) +
      Number(Boolean(activeStringItem?.pendingEmailApproval));

    const planText =
      activeStringPlan?.summary?.trim() ||
      activeStringItem?.planningResult?.analysis?.trim() ||
      "No plan details yet.";
    const detailScore =
      typeof activeStringPlan?.detailScore === "number" && Number.isFinite(activeStringPlan.detailScore)
        ? `${Math.max(0, Math.min(100, Math.floor(activeStringPlan.detailScore)))}/100`
        : "N/A";

    return [
      { label: "Plan", value: compactTaskTitle(planText, "No plan details yet.") },
      { label: "Workflow", value: `${workflowCount} workflow(s)` },
      { label: "Pathway", value: `${pathwayCount} pathway step(s)` },
      { label: "Approval", value: `${approvalCount} approval item(s)` },
      { label: "Milestone", value: `${milestoneCount} milestone(s)` },
      { label: "Details Score", value: detailScore }
    ] as const;
  }, [activeStringItem, activeStringPlan]);
  const activeStringDetailScore = useMemo(() => {
    const value = activeStringPlan?.detailScore;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.floor(value)));
  }, [activeStringPlan?.detailScore]);
  const activeStringDeliverables = useMemo(() => {
    const items: StringDeliverableCard[] = [];
    const seen = new Set<string>();
    const pushItem = (
      label: string,
      source: StringDeliverableCard["source"],
      index: number
    ) => {
      const normalizedLabel = label.trim();
      if (!normalizedLabel) {
        return;
      }
      const key = normalizedLabel.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      items.push({
        id: normalizeDeliverableId(normalizedLabel, source, index),
        label: normalizedLabel,
        source
      });
    };
    (activeStringPlan?.deliverables ?? []).forEach((item, index) => pushItem(item, "PLAN", index));
    for (const workflow of activeStringPlan?.workflows ?? []) {
      for (const deliverable of workflow.deliverables ?? []) {
        pushItem(deliverable, "WORKFLOW", items.length);
      }
    }
    for (const milestone of activeStringPlan?.milestones ?? []) {
      if (milestone?.deliverable) {
        pushItem(milestone.deliverable, "MILESTONE", items.length);
      }
    }
    return items;
  }, [activeStringPlan]);
  const activeSteerRecords = useMemo(() => {
    if (!activeStringItem) {
      return [] as StringSteerDecisionRecord[];
    }
    return Object.values(steerByString[activeStringItem.id] ?? {}).sort(
      (left, right) => left.label.localeCompare(right.label)
    );
  }, [activeStringItem, steerByString]);
  const activeSteerLaneRecords = useMemo(
    () => activeSteerRecords.filter((item) => item.lane === steerLane),
    [activeSteerRecords, steerLane]
  );
  const activeSteerDecisions = useMemo(
    () =>
      Object.fromEntries(
        activeSteerRecords.map((item) => [item.id, item.lane])
      ) as Record<string, SteerLaneTab>,
    [activeSteerRecords]
  );
  const activeStringScores = useMemo(() => {
    if (!activeStringItem) {
      return [] as StringScoreRecord[];
    }
    return (scoreByString[activeStringItem.id] ?? []).slice().sort((left, right) => left.createdAt - right.createdAt);
  }, [activeStringItem, scoreByString]);
  const activeStringScope = activeStringItem?.launchScope;
  const activeStringPermissionRequests = useMemo(() => {
    if (!activeStringItem) {
      return [] as PermissionRequestItem[];
    }
    const requestedIds = new Set<string>();
    for (const id of activeStringItem.launchScope?.permissionRequestIds ?? []) {
      if (id.trim()) {
        requestedIds.add(id.trim());
      }
    }
    for (const request of activeStringItem.planningResult?.permissionRequests ?? []) {
      if (request.id.trim()) {
        requestedIds.add(request.id.trim());
      }
    }
    const planId = activeStringItem.launchScope?.planId?.trim() ?? "";
    const directionId = activeStringItem.launchScope?.directionId?.trim() ?? "";
    return permissionRequests.filter((request) => {
      if (requestedIds.has(request.id)) {
        return true;
      }
      if (planId && request.planId === planId) {
        return true;
      }
      if (directionId && request.directionId === directionId) {
        return true;
      }
      return false;
    });
  }, [activeStringItem, permissionRequests]);
  const activeStringApprovalCheckpoints = useMemo(() => {
    if (!activeStringScope) {
      return [] as ApprovalCheckpointItem[];
    }
    const flowIds = new Set(
      (activeStringScope.flowIds ?? []).map((value) => value.trim()).filter(Boolean)
    );
    if (flowIds.size === 0) {
      return [] as ApprovalCheckpointItem[];
    }
    return approvalCheckpoints.filter((checkpoint) =>
      checkpoint.flowId ? flowIds.has(checkpoint.flowId) : false
    );
  }, [activeStringScope, approvalCheckpoints]);
  const activeStringScanRows = useMemo(() => {
    if (!activeStringItem) {
      return [] as StringScanRow[];
    }
    const rows: StringScanRow[] = [];
    const fallbackBaseTs = activeStringItem.updatedAt - Math.max(activeStringItem.turns.length, 1);
    activeStringItem.turns.forEach((turn, index) => {
      const timestamp = inferTurnTimestamp(turn, index, fallbackBaseTs);
      rows.push({
        id: `chat-${activeStringItem.id}-${index}`,
        timestamp,
        stage: "CHAT",
        actorType: turn.role === "owner" ? "HUMAN" : "AI",
        actor: turn.role === "owner" ? "Owner" : "Organization",
        event: "Message",
        details: compactTaskTitle(turn.content, "Message"),
        raw: JSON.stringify(turn)
      });
    });
    if (activeStringItem.planningResult) {
      rows.push({
        id: `plan-${activeStringItem.id}`,
        timestamp: activeStringItem.updatedAt - 3,
        stage: "PLAN",
        actorType: "AI",
        actor: "Planner",
        event: "Primary plan generated",
        details: compactTaskTitle(
          activeStringItem.planningResult.analysis || activeStringItem.planningResult.primaryPlan.summary || "Plan generated.",
          "Plan generated."
        ),
        raw: JSON.stringify(activeStringItem.planningResult)
      });
    }
    (activeStringPlan?.milestones ?? []).forEach((milestone, index) => {
      rows.push({
        id: `milestone-${activeStringItem.id}-${index}`,
        timestamp: activeStringItem.updatedAt - 2,
        stage: "MILESTONE",
        actorType: "AI",
        actor: milestone.ownerRole || "Planner",
        event: milestone.title,
        details: `${milestone.deliverable} | ${milestone.successSignal}`,
        raw: JSON.stringify(milestone)
      });
    });
    activeSteerRecords.forEach((record) => {
      rows.push({
        id: `steer-${activeStringItem.id}-${record.id}`,
        timestamp: record.decidedAt,
        stage: "STEER",
        actorType: record.decidedBy,
        actor: record.decidedBy === "HUMAN" ? "Owner" : "AI",
        event: `${record.lane} decision`,
        details: `${record.label} (${record.source})`,
        raw: JSON.stringify(record)
      });
    });
    activeStringScores.forEach((score) => {
      rows.push({
        id: `score-${score.id}`,
        timestamp: score.createdAt,
        stage: "SCORING",
        actorType: score.scoredByType,
        actor: score.scoredBy,
        event: score.metric,
        details: `${score.score}/${score.maxScore}${score.note ? ` | ${score.note}` : ""}`,
        raw: JSON.stringify(score)
      });
    });
    activeStringPermissionRequests.forEach((request) => {
      rows.push({
        id: `request-${request.id}`,
        timestamp: new Date(request.updatedAt).getTime(),
        stage: "APPROVAL",
        actorType: "HUMAN",
        actor: request.requestedByEmail || "Owner",
        event: `Permission ${request.status}`,
        details: `${request.area} | ${request.workflowTitle} -> ${request.taskTitle}`,
        raw: JSON.stringify(request)
      });
    });
    activeStringApprovalCheckpoints.forEach((checkpoint) => {
      rows.push({
        id: `checkpoint-${checkpoint.id}`,
        timestamp: new Date(checkpoint.resolvedAt ?? checkpoint.requestedAt).getTime(),
        stage: "CHECKPOINT",
        actorType: checkpoint.resolvedByUserId ? "HUMAN" : "SYSTEM",
        actor: checkpoint.resolvedByUserId ? checkpoint.resolvedByUserId : "Runtime",
        event: checkpoint.status,
        details: checkpoint.reason,
        raw: JSON.stringify(checkpoint)
      });
    });
    return rows.sort((left, right) => left.timestamp - right.timestamp);
  }, [
    activeSteerRecords,
    activeStringApprovalCheckpoints,
    activeStringItem,
    activeStringPermissionRequests,
    activeStringPlan?.milestones,
    activeStringScores
  ]);
  const activeStringDiscussionTurns = useMemo(() => {
    if (!activeStringItem) {
      return [] as Array<
        DirectionTurn & { timestamp: number; actorType: ActorType; actorLabel: string }
      >;
    }
    const fallbackBaseTs = activeStringItem.updatedAt - Math.max(activeStringItem.turns.length, 1);
    return activeStringItem.turns
      .map((turn, index) => ({
        ...turn,
        timestamp: inferTurnTimestamp(turn, index, fallbackBaseTs),
        actorType: turn.role === "owner" ? "HUMAN" : "AI",
        actorLabel: turn.role === "owner" ? "Owner" : turn.modelLabel || "Organization"
      }))
      .sort((left, right) => left.timestamp - right.timestamp);
  }, [activeStringItem]);
  const activeStringTimelineFeed = useMemo(
    () => activeStringScanRows.slice().sort((left, right) => right.timestamp - left.timestamp).slice(0, 10),
    [activeStringScanRows]
  );
  const activeStringDateContext = useMemo(() => {
    if (!activeStringItem) {
      return null;
    }
    const firstTimestamp =
      activeStringScanRows[0]?.timestamp ??
      activeStringDiscussionTurns[0]?.timestamp ??
      activeStringItem.updatedAt;
    const lastTimestamp =
      activeStringScanRows[activeStringScanRows.length - 1]?.timestamp ??
      activeStringDiscussionTurns[activeStringDiscussionTurns.length - 1]?.timestamp ??
      activeStringItem.updatedAt;
    const uniqueDays = new Set(
      activeStringScanRows.map((row) => new Date(row.timestamp).toISOString().slice(0, 10))
    ).size || 1;
    return {
      anchorTimestamp: firstTimestamp,
      latestTimestamp: lastTimestamp,
      eventCount: activeStringScanRows.length || activeStringDiscussionTurns.length || 1,
      uniqueDays
    };
  }, [activeStringDiscussionTurns, activeStringItem, activeStringScanRows]);
  const activeStringDirectionText =
    activeStringItem?.planningResult?.directionGiven?.trim() ||
    activeStringItem?.directionGiven.trim() ||
    "";
  const activeStringPlanSummary =
    activeStringPlan?.summary?.trim() ||
    activeStringItem?.planningResult?.analysis?.trim() ||
    "";
  const activeStringResourcePlan = activeStringPlan?.resourcePlan ?? [];
  const activeStringAutoSquad = activeStringItem?.planningResult?.autoSquad ?? null;
  const workspaceTitle = isStringsView
    ? "Strings Workspace"
    : mode === "DIRECTION"
      ? "Direction Workspace"
      : "Discussion Workspace";
  const workspaceSubtitle =
    isStringsView
      ? "Open any discussion or direction string in the same workspace."
      : mode === "DIRECTION"
        ? "Direction-first execution with planning and run trace."
        : "Idea exploration, quick strategy, and freeform discussion.";
  const placeholder =
    mode === "MINDSTORM"
      ? "Ask anything about ideas, planning, or execution..."
      : "Describe the direction. We will analyze, plan, execute, and report in this thread.";
  const heroTitle =
    mode === "MINDSTORM"
      ? "What should we work on next?"
      : "What direction should run next?";

  useEffect(() => {
    setSurfaceTab((current) => (current === "STRINGS" ? current : mode));
  }, [mode]);

  useEffect(() => {
    if (!activeStringItem) {
      return;
    }
    const stringId = activeStringItem.id;
    if (activeStringDeliverables.length === 0) {
      return;
    }
    setSteerByString((previous) => {
      const existing = previous[stringId] ?? {};
      let changed = false;
      const nextForString = { ...existing };
      for (const deliverable of activeStringDeliverables) {
        if (nextForString[deliverable.id]) {
          continue;
        }
        changed = true;
        nextForString[deliverable.id] = {
          ...deliverable,
          lane: "CENTER",
          decidedBy: "SYSTEM",
          decidedAt: activeStringItem.updatedAt
        };
      }
      if (!changed) {
        return previous;
      }
      return {
        ...previous,
        [stringId]: nextForString
      };
    });
  }, [activeStringDeliverables, activeStringItem]);

  useEffect(() => {
    if (!activeStringItem || activeStringDetailScore === null) {
      return;
    }
    const stringId = activeStringItem.id;
    setScoreByString((previous) => {
      const current = previous[stringId] ?? [];
      if (current.some((item) => item.metric === "Plan Detail Score")) {
        return previous;
      }
      const nextEntry: StringScoreRecord = {
        id: `plan-detail-${stringId}`,
        metric: "Plan Detail Score",
        score: activeStringDetailScore,
        maxScore: 100,
        scoredByType: "AI",
        scoredBy: "Planner",
        note: "Imported from plan detailScore.",
        createdAt: activeStringItem.updatedAt
      };
      return {
        ...previous,
        [stringId]: [...current, nextEntry]
      };
    });
  }, [activeStringDetailScore, activeStringItem]);

  useEffect(() => {
    if (!showAttachMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!attachMenuRef.current?.contains(event.target as Node)) {
        setShowAttachMenu(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowAttachMenu(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showAttachMenu]);

  const handleCloseAttachMenu = useCallback(() => {
    setShowAttachMenu(false);
  }, []);

  const handleOpenConnectorsMenuAction = useCallback(() => {
    setShowAttachMenu(false);
    onOpenTools();
  }, [onOpenTools]);

  const handlePickFiles = useCallback(() => {
    setShowAttachMenu(false);
    fileInputRef.current?.click();
  }, []);

  const handleFileSelection = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length > 0) {
      setSelectedFiles((previous) => [...previous, ...picked]);
    }
    event.currentTarget.value = "";
  }, []);

  const handleRemoveSelectedFile = useCallback((targetIndex: number) => {
    setSelectedFiles((previous) => previous.filter((_, index) => index !== targetIndex));
  }, []);

  const handleSend = useCallback(async () => {
    const text = composer.trim();
    if ((!text && selectedFiles.length === 0) || isBusy) {
      return;
    }

    setSending(true);
    try {
      if (!engaged) {
        onEngageWithMode(mode);
      }
      await onSendMessage(text, mode, { files: selectedFiles });
      if (mode === "DIRECTION" && text) {
        onDirectionGivenChange(text);
      }
      setComposer("");
      setSelectedFiles([]);
    } finally {
      setSending(false);
    }
  }, [
    composer,
    engaged,
    isBusy,
    mode,
    onDirectionGivenChange,
    onEngageWithMode,
    onSendMessage,
    selectedFiles
  ]);

  const steerLaneCounts = useMemo(
    () => ({
      CENTER: activeSteerRecords.filter((item) => item.lane === "CENTER").length,
      APPROVED: activeSteerRecords.filter((item) => item.lane === "APPROVED").length,
      RETHINK: activeSteerRecords.filter((item) => item.lane === "RETHINK").length
    }),
    [activeSteerRecords]
  );

  const averageScore = useMemo(() => {
    if (activeStringScores.length === 0) {
      return null;
    }
    const normalized = activeStringScores
      .filter((item) => item.maxScore > 0)
      .map((item) => (item.score / item.maxScore) * 100);
    if (normalized.length === 0) {
      return null;
    }
    return Math.max(
      0,
      Math.min(100, Math.round(normalized.reduce((sum, item) => sum + item, 0) / normalized.length))
    );
  }, [activeStringScores]);

  const transitionSteerLane = useCallback(
    (recordId: string, lane: SteerLane, decidedBy: ActorType) => {
      if (!activeStringItem) {
        return;
      }
      const stringId = activeStringItem.id;
      const changedAt = Date.now();
      setSteerByString((previous) => {
        const current = previous[stringId] ?? {};
        const target = current[recordId];
        if (!target || target.lane === lane) {
          return previous;
        }
        return {
          ...previous,
          [stringId]: {
            ...current,
            [recordId]: {
              ...target,
              lane,
              decidedBy,
              decidedAt: changedAt
            }
          }
        };
      });
      const targetRecord = activeSteerRecords.find((item) => item.id === recordId);
      if (!targetRecord) {
        return;
      }
      setScoreByString((previous) => {
        const current = previous[stringId] ?? [];
        return {
          ...previous,
          [stringId]: [
            ...current,
            {
              id: `steer-${stringId}-${recordId}-${changedAt}`,
              metric: lane === "APPROVED" ? "Steer Approval" : lane === "RETHINK" ? "Steer Rethink" : "Steer Reset",
              score: lane === "APPROVED" ? 1 : 0,
              maxScore: 1,
              scoredByType: decidedBy,
              scoredBy: decidedBy === "HUMAN" ? "Owner" : decidedBy === "AI" ? "AI" : "System",
              note: targetRecord.label,
              createdAt: changedAt
            }
          ]
        };
      });
    },
    [activeSteerRecords, activeStringItem]
  );

  const handleSteerPointerDown = useCallback(
    (recordId: string, event: PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      setSteerDrag({
        id: recordId,
        startX: event.clientX,
        deltaX: 0
      });
    },
    []
  );

  const handleSteerPointerMove = useCallback(
    (recordId: string, event: PointerEvent<HTMLDivElement>) => {
      setSteerDrag((current) => {
        if (!current || current.id !== recordId) {
          return current;
        }
        const nextDelta = Math.max(-180, Math.min(180, event.clientX - current.startX));
        return {
          ...current,
          deltaX: nextDelta
        };
      });
    },
    []
  );

  const handleSteerPointerEnd = useCallback(
    (recordId: string) => {
      setSteerDrag((current) => {
        if (!current || current.id !== recordId) {
          return current;
        }
        if (current.deltaX <= -90) {
          transitionSteerLane(recordId, "RETHINK", "HUMAN");
        } else if (current.deltaX >= 90) {
          transitionSteerLane(recordId, "APPROVED", "HUMAN");
        }
        return null;
      });
    },
    [transitionSteerLane]
  );

  const handleAddScoreRecord = useCallback(() => {
    if (!activeStringItem) {
      return;
    }
    const metric = scoreMetricDraft.trim();
    const note = scoreNoteDraft.trim();
    const score = Number.parseInt(scoreValueDraft, 10);
    const maxScore = Number.parseInt(scoreMaxDraft, 10);
    if (!metric || !Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
      return;
    }

    const boundedScore = Math.max(0, Math.min(maxScore, score));
    const entry: StringScoreRecord = {
      id: `score-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      metric,
      score: boundedScore,
      maxScore,
      scoredByType: scoreByTypeDraft,
      scoredBy: scoreByNameDraft.trim() || (scoreByTypeDraft === "HUMAN" ? "Owner" : "Runtime"),
      note,
      createdAt: Date.now()
    };

    setScoreByString((previous) => {
      const current = previous[activeStringItem.id] ?? [];
      return {
        ...previous,
        [activeStringItem.id]: [...current, entry]
      };
    });
    setScoreNoteDraft("");
  }, [
    activeStringItem,
    scoreByNameDraft,
    scoreByTypeDraft,
    scoreMaxDraft,
    scoreMetricDraft,
    scoreNoteDraft,
    scoreValueDraft
  ]);

  const composerBar = (
    <div className="relative overflow-visible rounded-[24px] border border-white/15 bg-[#02060d]/90 p-1.5 shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:rounded-[30px] sm:p-2">
      <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-[radial-gradient(circle_at_10%_15%,rgba(56,189,248,0.2),transparent_38%),radial-gradient(circle_at_88%_86%,rgba(16,185,129,0.16),transparent_34%)] sm:rounded-[30px]" />
      <div className="relative flex items-end gap-1.5 sm:gap-2">
        <div ref={attachMenuRef} className="relative shrink-0 self-center">
          <button
            type="button"
            onClick={() => setShowAttachMenu((prev) => !prev)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-slate-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white sm:h-9 sm:w-9"
            title="Attach or connect"
            aria-expanded={showAttachMenu}
            aria-haspopup="menu"
          >
            <PlusCircle size={16} />
          </button>

          {showAttachMenu ? (
            <div
              role="menu"
              aria-label="Attach menu"
              className="absolute bottom-[calc(100%+0.6rem)] left-0 z-30 w-[min(16.5rem,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-[#191a1d]/96 p-2 shadow-[0_26px_60px_rgba(0,0,0,0.58)] backdrop-blur-xl"
            >
              <button
                type="button"
                role="menuitem"
                onClick={handlePickFiles}
                className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm font-medium text-slate-100 transition hover:bg-white/10"
              >
                <span className="inline-flex items-center gap-2.5">
                  <Paperclip size={16} className="text-slate-300" />
                  Add files or photos
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={handleCloseAttachMenu}
                className="mt-0.5 flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm font-medium text-slate-100 transition hover:bg-white/10"
              >
                <span className="inline-flex items-center gap-2.5">
                  <Camera size={16} className="text-slate-300" />
                  Take a screenshot
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={handleCloseAttachMenu}
                className="mt-0.5 flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm font-medium text-slate-100 transition hover:bg-white/10"
              >
                <span className="inline-flex items-center gap-2.5">
                  <FolderOpen size={16} className="text-slate-300" />
                  Add to project
                </span>
                <ChevronRight size={15} className="text-slate-500" />
              </button>

              <div className="my-2 h-px bg-white/10" />

              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={webSearchEnabled}
                onClick={() => setWebSearchEnabled((prev) => !prev)}
                className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm font-medium text-blue-300 transition hover:bg-white/10"
              >
                <span className="inline-flex items-center gap-2.5">
                  <Search size={16} className="text-blue-300" />
                  Web search
                </span>
                {webSearchEnabled ? <Check size={15} className="text-blue-300" /> : null}
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={handleCloseAttachMenu}
                className="mt-0.5 flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm font-medium text-slate-100 transition hover:bg-white/10"
              >
                <span className="inline-flex items-center gap-2.5">
                  <Command size={16} className="text-slate-300" />
                  Use style
                </span>
                <ChevronRight size={15} className="text-slate-500" />
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={handleOpenConnectorsMenuAction}
                className="mt-1.5 flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/35 px-2.5 py-2 text-left text-sm font-semibold text-slate-100 transition hover:bg-black/45"
              >
                <span className="inline-flex items-center gap-2.5">
                  <LayoutGrid size={16} className="text-slate-300" />
                  Add connectors
                </span>
              </button>
            </div>
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelection}
          className="hidden"
        />

        <textarea
          value={composer}
          onChange={(event) => setComposer(event.target.value)}
          placeholder={placeholder}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          className="min-h-10 max-h-36 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-2 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500 sm:px-2 sm:text-base"
        />

        <button
          onClick={onVoiceIntent}
          disabled={isRecordingIntent || mode !== "MINDSTORM"}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-slate-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white disabled:opacity-50 sm:h-9 sm:w-9"
          title={isRecordingIntent ? "Listening..." : "Voice Input"}
        >
          {isRecordingIntent ? <MicOff size={16} /> : <Mic size={16} />}
        </button>

        <button
          onClick={() => void handleSend()}
          disabled={isBusy || (!composer.trim() && selectedFiles.length === 0)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-400/45 bg-gradient-to-br from-cyan-300 to-emerald-300 text-slate-950 shadow-[0_10px_24px_rgba(34,211,238,0.35)] transition hover:brightness-105 disabled:opacity-60 sm:h-10 sm:w-10"
          title={mode === "MINDSTORM" ? "Send Message" : "Run Direction"}
        >
          {isBusy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUpRight size={16} />}
        </button>
      </div>

      {selectedFiles.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5 px-1">
          {selectedFiles.map((file, index) => (
            <span
              key={`${file.name}-${file.size}-${index}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2 py-1 text-[11px] text-slate-100"
            >
              <span className="max-w-[11rem] truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => handleRemoveSelectedFile(index)}
                className="rounded-full p-0.5 text-slate-300 transition hover:bg-white/15 hover:text-white"
                aria-label={`Remove ${file.name}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className={`mx-auto flex min-h-0 w-full max-w-6xl flex-col gap-3 sm:gap-4 2xl:max-w-[min(92vw,1700px)] ${
        isStringsView ? "h-[calc(100%+3.5rem)] sm:h-[calc(100%+6rem)] md:h-[calc(100%+7rem)]" : "h-full"
      }`}
    >
      <div
        className={`flex flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between ${
          hideControlDeckScreenshotElements ? "hidden" : ""
        }`}
      >
        <div>
          <p className="text-xs text-slate-500">Control interface</p>
          <p className="text-sm font-medium text-slate-200 sm:text-base">{workspaceTitle}</p>
          <p className="mt-0.5 text-xs text-slate-400">{workspaceSubtitle}</p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          <div className="inline-flex w-full max-w-full flex-wrap rounded-full border border-white/15 bg-black/45 p-1 shadow-[0_10px_30px_rgba(0,0,0,0.35)] sm:w-auto">
            <button
              onClick={() => {
                setSurfaceTab("MINDSTORM");
                onModeChange("MINDSTORM");
              }}
              className={`flex-1 rounded-full px-4 py-2 text-xs font-semibold transition sm:flex-none sm:px-5 ${
                surfaceTab === "MINDSTORM"
                  ? "bg-gradient-to-r from-cyan-200 to-white text-slate-950 shadow-[0_8px_18px_rgba(148,163,184,0.35)]"
                  : "text-slate-300 hover:bg-white/10"
              }`}
            >
              Discussion
            </button>
            <button
              onClick={() => {
                setSurfaceTab("DIRECTION");
                onModeChange("DIRECTION");
              }}
              className={`flex-1 rounded-full px-4 py-2 text-xs font-semibold transition sm:flex-none sm:px-5 ${
                surfaceTab === "DIRECTION"
                  ? "bg-gradient-to-r from-cyan-200 to-white text-slate-950 shadow-[0_8px_18px_rgba(148,163,184,0.35)]"
                  : "text-slate-300 hover:bg-white/10"
              }`}
            >
              Direction
            </button>
            <button
              type="button"
              onClick={() => {
                setSurfaceTab("STRINGS");
                setStringsWorkspaceTab("DETAILS");
                setStringDetailsTab("DISCUSSION");
              }}
              className={`flex-1 rounded-full px-4 py-2 text-xs font-semibold transition sm:flex-none sm:px-5 ${
                surfaceTab === "STRINGS"
                  ? "bg-gradient-to-r from-cyan-200 to-white text-slate-950 shadow-[0_8px_18px_rgba(148,163,184,0.35)]"
                  : "text-slate-300 hover:bg-white/10"
              }`}
            >
              Strings
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              const nextMode = surfaceTab === "STRINGS" ? mode : surfaceTab;
              setSurfaceTab(nextMode);
              onCreateThread(nextMode);
            }}
            className={`inline-flex items-center justify-center rounded-full border px-4 py-2 text-xs font-semibold transition ${
              isStringsView
                ? "border-cyan-400/25 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/15"
                : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            New String
          </button>

          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className={`inline-flex items-center justify-center rounded-full border px-4 py-2 text-xs font-semibold transition ${
              showAdvanced
                ? "border-cyan-400/40 bg-cyan-500/12 text-cyan-200"
                : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            Advanced {showAdvanced ? "On" : "Off"}
          </button>
        </div>
      </div>

      {message ? (
        <div
          className={`inline-flex max-w-full items-center gap-2 self-start rounded-xl border px-3 py-2 text-xs backdrop-blur ${
            message.tone === "success"
              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
              : message.tone === "warning"
                ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                : "border-red-500/40 bg-red-500/15 text-red-300"
          }`}
        >
          <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {message.text}
          </span>
          {onDismissMessage ? (
            <button
              type="button"
              onClick={onDismissMessage}
              className="shrink-0 rounded-full border border-white/20 p-1 text-slate-200 transition hover:bg-white/10"
              aria-label="Dismiss status message"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      ) : null}

      {showAdvanced && !isStringsView && !hideControlDeckScreenshotElements ? (
        <div className={`vx-panel grid gap-3 rounded-2xl p-3 sm:grid-cols-[minmax(0,280px)_1fr] ${themeStyle.border}`}>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">Model</span>
            <div className="relative">
              <select
                value={directionModelId}
                onChange={(event) =>
                  onDirectionModelChange(event.target.value as (typeof DIRECTION_MODELS)[number]["id"])
                }
                className="w-full appearance-none rounded-xl border border-white/15 bg-black/50 px-3 py-2 pr-9 text-sm text-slate-100 outline-none transition hover:border-white/25"
              >
                {directionModels.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
            </div>
          </label>

          <div className="space-y-1">
            <span className="text-xs text-slate-500">Response style</span>
            <div className="inline-flex max-w-full flex-wrap rounded-full border border-white/15 bg-black/45 p-1">
              <button
                onClick={() => onConversationDetailChange("REASONING_MIN")}
                className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                  conversationDetail === "REASONING_MIN"
                    ? "bg-gradient-to-r from-white to-slate-100 text-slate-950"
                    : "text-slate-300 hover:bg-white/10"
                }`}
              >
                Short replies
              </button>
              <button
                onClick={() => onConversationDetailChange("DIRECTION_GIVEN")}
                className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                  conversationDetail === "DIRECTION_GIVEN"
                    ? "bg-gradient-to-r from-white to-slate-100 text-slate-950"
                    : "text-slate-300 hover:bg-white/10"
                }`}
              >
                Show direction context
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={`vx-panel relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#060a10]/96 p-3 shadow-[0_28px_70px_rgba(0,0,0,0.5)] sm:rounded-[30px] sm:p-4 ${
          hideControlDeckScreenshotElements && !isStringsView ? "hidden" : ""
        } ${themeStyle.border}`}
      >
        <div className="pointer-events-none absolute -left-20 top-0 h-52 w-52 rounded-full bg-cyan-500/6 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 bottom-0 h-52 w-52 rounded-full bg-emerald-500/5 blur-3xl" />
        {isStringsView ? (
          <div className="relative flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/25 px-3 py-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Strings</p>
                <p className="text-sm text-slate-300">
                  Review a string, inspect its linked dates and approvals, then jump into FLOW when needed.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-300">
                  {stringItems.length} total
                </span>
                {activeStringDateContext ? (
                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] text-cyan-100">
                    Anchored {new Date(activeStringDateContext.anchorTimestamp).toLocaleDateString()}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
              <aside className="vx-scrollbar min-h-0 space-y-2 overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#050910]/72 p-2.5 sm:p-3">
                {stringItems.length === 0 ? (
                  <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-6 text-center text-sm text-slate-500">
                    No strings yet. Create a new discussion or direction string to get started.
                  </div>
                ) : (
                  stringItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelectThread(item.id);
                        setSurfaceTab("STRINGS");
                        setStringsWorkspaceTab("DETAILS");
                        setStringDetailsTab("DISCUSSION");
                      }}
                      className={`flex w-full items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                        activeHistoryId === item.id
                          ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-100"
                          : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20 hover:bg-white/5"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {controlThreadDisplayTitle(item)}
                        </span>
                        <span className="mt-1 block text-[10px] uppercase tracking-[0.14em] text-slate-500">
                          {controlThreadKindLabel(item.mode)} | {new Date(item.updatedAt).toLocaleString()}
                        </span>
                        <span className="mt-2 block whitespace-pre-wrap text-xs leading-5 text-slate-400 [overflow-wrap:anywhere]">
                          {controlThreadPreview(item)}
                        </span>
                      </span>
                      <ChevronRight size={16} className="mt-1 shrink-0 text-slate-500" />
                    </button>
                  ))
                )}
              </aside>

              <div className="min-h-0 flex flex-col gap-3">
                {!activeStringItem ? (
                  <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-6 text-center text-sm text-slate-500">
                    No strings available for details yet.
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Selected String
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-100">
                          {controlThreadDisplayTitle(activeStringItem)}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {controlThreadKindLabel(activeStringItem.mode)} | {new Date(activeStringItem.updatedAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {activeStringDateContext ? (
                          <div className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] text-cyan-100">
                            {activeStringDateContext.eventCount} events across {activeStringDateContext.uniqueDays} day{activeStringDateContext.uniqueDays === 1 ? "" : "s"}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onOpenStringInFlow(activeStringItem.id)}
                          className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/15"
                        >
                          Open In FLOW
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-2">
                      {([
                        { id: "DETAILS", label: "Details" },
                        { id: "BLUEPRINT", label: "Blueprint" }
                      ] as Array<{ id: StringWorkspaceTab; label: string }>).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setStringsWorkspaceTab(tab.id)}
                          className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                            stringsWorkspaceTab === tab.id
                              ? "border-cyan-400/40 bg-cyan-500/12 text-cyan-100"
                              : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <div className="vx-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#050910]/72 p-2.5 sm:p-3">
                      {stringsWorkspaceTab === "DETAILS" ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-2">
                            {([
                              { id: "DISCUSSION", label: "Discussion" },
                              { id: "DIRECTION", label: "Direction" },
                              { id: "PLAN", label: "Plan" },
                              { id: "COLLABORATION", label: "Collaboration" }
                            ] as Array<{ id: StringDetailsTab; label: string }>).map((tab) => (
                              <button
                                key={tab.id}
                                type="button"
                                onClick={() => setStringDetailsTab(tab.id)}
                                className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                                  stringDetailsTab === tab.id
                                    ? "border-cyan-400/40 bg-cyan-500/12 text-cyan-100"
                                    : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                                }`}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>

                          <div className="grid gap-3 2xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.95fr)]">
                            <div className="space-y-3">
                              {stringDetailsTab === "DISCUSSION" ? (
                                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                      Discussion Turns ({activeStringDiscussionTurns.length})
                                    </p>
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                                      {controlThreadKindLabel(activeStringItem.mode)}
                                    </span>
                                  </div>
                                  {activeStringDiscussionTurns.length === 0 ? (
                                    <p className="mt-2 text-xs text-slate-500">No discussion turns captured yet.</p>
                                  ) : (
                                    <div className="mt-3 space-y-2">
                                      {activeStringDiscussionTurns.map((turn) => (
                                        <article
                                          key={turn.id}
                                          className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2.5"
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
                                            <span className="text-[11px] text-slate-500">{new Date(turn.timestamp).toLocaleString()}</span>
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

                              {stringDetailsTab === "DIRECTION" ? (
                                <div className="space-y-3">
                                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                      Direction Context
                                    </p>
                                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200 [overflow-wrap:anywhere]">
                                      {activeStringDirectionText || "No direction context captured for this string yet."}
                                    </p>
                                  </div>
                                  <div className="grid gap-2 md:grid-cols-3">
                                    <article className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Direction ID</p>
                                      <p className="mt-1 text-xs text-slate-200 [overflow-wrap:anywhere]">{activeStringScope?.directionId || "Not linked"}</p>
                                    </article>
                                    <article className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Plan ID</p>
                                      <p className="mt-1 text-xs text-slate-200 [overflow-wrap:anywhere]">{activeStringScope?.planId || "Not linked"}</p>
                                    </article>
                                    <article className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Flow Links</p>
                                      <p className="mt-1 text-xs text-slate-200">{(activeStringScope?.flowIds ?? []).length} linked flow(s)</p>
                                    </article>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Planning Analysis</p>
                                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200 [overflow-wrap:anywhere]">
                                      {activeStringItem.planningResult?.analysis?.trim() || "No analysis available yet for this string."}
                                    </p>
                                  </div>
                                  {(activeStringItem.planningResult?.requiredToolkits?.length ?? 0) > 0 ? (
                                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Required Toolkits</p>
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {(activeStringItem.planningResult?.requiredToolkits ?? []).map((toolkit) => (
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

                              {stringDetailsTab === "COLLABORATION" ? (
                                <StringCollaborationPanel
                                  stringItem={activeStringItem}
                                  isActiveStringThread={isActiveStringThread}
                                  isApprovalBusy={isApprovalBusy}
                                  discussionTurns={activeStringDiscussionTurns}
                                  permissionRequests={activeStringPermissionRequests}
                                  approvalCheckpoints={activeStringApprovalCheckpoints}
                                  resourcePlan={activeStringResourcePlan}
                                  autoSquad={activeStringAutoSquad}
                                  permissionRequestActionId={permissionRequestActionId}
                                  approvalCheckpointActionId={approvalCheckpointActionId}
                                  onSelectThread={onSelectThread}
                                  onApprovePlanLaunch={onApprovePlanLaunch}
                                  onRejectPlanLaunch={onRejectPlanLaunch}
                                  onApproveEmailDraft={onApproveEmailDraft}
                                  onRejectEmailDraft={onRejectEmailDraft}
                                  onApproveToolkitAccess={onApproveToolkitAccess}
                                  onRejectToolkitAccess={onRejectToolkitAccess}
                                  onPermissionRequestDecision={onPermissionRequestDecision}
                                  onApprovalCheckpointDecision={onApprovalCheckpointDecision}
                                />
                              ) : null}

                              {stringDetailsTab === "PLAN" ? (
                                <div className="space-y-3">
                                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                    {[
                                      ...stringDetailsRows,
                                      { label: "Average Score", value: averageScore === null ? "N/A" : `${averageScore}/100` },
                                      { label: "Steer", value: `${steerLaneCounts.CENTER} center | ${steerLaneCounts.APPROVED} approved | ${steerLaneCounts.RETHINK} rethink` }
                                    ].map((detail) => (
                                      <article
                                        key={detail.label}
                                        className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5"
                                      >
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{detail.label}</p>
                                        <p className="mt-1 text-xs leading-5 text-slate-200 [overflow-wrap:anywhere]">{detail.value}</p>
                                      </article>
                                    ))}
                                  </div>

                                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Plan Summary</p>
                                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200 [overflow-wrap:anywhere]">
                                      {activeStringPlanSummary || "No plan summary available for this string yet."}
                                    </p>
                                  </div>

                                  <div className="grid gap-3 xl:grid-cols-2">
                                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Deliverables ({activeStringDeliverables.length})</p>
                                      {activeStringDeliverables.length === 0 ? (
                                        <p className="mt-2 text-xs text-slate-500">No deliverables captured yet.</p>
                                      ) : (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {activeStringDeliverables.map((deliverable) => (
                                            <span
                                              key={deliverable.id}
                                              className="rounded-full border border-white/15 bg-black/30 px-2.5 py-1 text-[11px] text-slate-200"
                                            >
                                              {deliverable.label}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Milestones ({activeStringPlan?.milestones?.length ?? 0})</p>
                                      {(activeStringPlan?.milestones?.length ?? 0) === 0 ? (
                                        <p className="mt-2 text-xs text-slate-500">No milestones defined yet.</p>
                                      ) : (
                                        <div className="mt-2 space-y-2">
                                          {(activeStringPlan?.milestones ?? []).map((milestone, index) => (
                                            <div
                                              key={`${milestone.title}-${index}`}
                                              className="rounded-xl border border-white/10 bg-black/25 px-2.5 py-2"
                                            >
                                              <p className="text-xs font-semibold text-slate-100">{milestone.title}</p>
                                              <p className="mt-1 text-[11px] text-slate-400">{milestone.deliverable} | {milestone.successSignal}</p>
                                              <p className="mt-1 text-[11px] text-slate-500">{milestone.ownerRole} | {milestone.dueWindow}</p>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {(activeStringPlan?.pathway?.length ?? 0) > 0 ? (
                                    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Pathway</p>
                                      <ol className="mt-2 space-y-1.5 text-xs text-slate-200">
                                        {(activeStringPlan?.pathway ?? []).map((step) => (
                                          <li
                                            key={step.stepId}
                                            className="rounded-lg border border-white/10 bg-black/25 px-2.5 py-1.5"
                                          >
                                            {step.line}. {step.workflowTitle} {"->"} {step.taskTitle} ({step.ownerRole})
                                          </li>
                                        ))}
                                      </ol>
                                    </div>
                                  ) : null}

                                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Workflow Coverage ({activeStringPlan?.workflows?.length ?? 0})</p>
                                    {(activeStringPlan?.workflows?.length ?? 0) === 0 ? (
                                      <p className="mt-2 text-xs text-slate-500">No workflows linked yet.</p>
                                    ) : (
                                      <div className="mt-2 space-y-2">
                                        {(activeStringPlan?.workflows ?? []).map((workflow, workflowIndex) => (
                                          <div
                                            key={`${workflow.title}-${workflowIndex}`}
                                            className="rounded-xl border border-white/10 bg-black/25 px-2.5 py-2"
                                          >
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                              <p className="text-xs font-semibold text-slate-100">{workflow.title}</p>
                                              <span className="rounded-full border border-white/15 bg-black/30 px-2 py-0.5 text-[10px] text-slate-300">
                                                {(workflow.tasks ?? []).length} task(s)
                                              </span>
                                            </div>
                                            {workflow.goal ? <p className="mt-1 text-[11px] text-slate-400">{workflow.goal}</p> : null}
                                            {(workflow.deliverables?.length ?? 0) > 0 ? (
                                              <p className="mt-1 text-[11px] text-slate-500">Deliverables: {workflow.deliverables?.join(" | ")}</p>
                                            ) : null}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Steer</p>
                                      <div className="mt-2 inline-flex rounded-full border border-white/15 bg-black/40 p-1">
                                        {([
                                          { id: "CENTER", label: "Center" },
                                          { id: "APPROVED", label: "Approved" },
                                          { id: "RETHINK", label: "Rethink" }
                                        ] as Array<{ id: SteerLane; label: string }>).map((lane) => (
                                          <button
                                            key={lane.id}
                                            type="button"
                                            onClick={() => setSteerLane(lane.id)}
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
                                      <p className="mt-2 text-xs text-slate-400">Swipe right to approve and left to move into rethink.</p>
                                    </div>
                                    {activeSteerLaneRecords.length === 0 ? (
                                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-3 text-xs text-slate-500">
                                        {steerLane === "CENTER"
                                          ? "No deliverables waiting in Center."
                                          : steerLane === "APPROVED"
                                            ? "No deliverables approved yet."
                                            : "No deliverables in rethink."}
                                      </div>
                                    ) : (
                                      activeSteerLaneRecords.map((record) => {
                                        const dragOffset = steerDrag?.id === record.id ? steerDrag.deltaX : 0;
                                        return (
                                          <div
                                            key={record.id}
                                            onPointerDown={(event) => handleSteerPointerDown(record.id, event)}
                                            onPointerMove={(event) => handleSteerPointerMove(record.id, event)}
                                            onPointerUp={() => handleSteerPointerEnd(record.id)}
                                            onPointerCancel={() => handleSteerPointerEnd(record.id)}
                                            className="rounded-2xl border border-white/10 bg-black/20 p-3 text-left transition"
                                            style={{ transform: `translateX(${dragOffset}px)` }}
                                          >
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                              <p className="text-sm font-semibold text-slate-100">{record.label}</p>
                                              <span className="rounded-full border border-white/15 bg-black/30 px-2 py-0.5 text-[10px] text-slate-300">{record.source}</span>
                                            </div>
                                            <p className="mt-1 text-[11px] text-slate-400">{record.decidedBy} | {new Date(record.decidedAt).toLocaleString()}</p>
                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                              <button
                                                type="button"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  transitionSteerLane(record.id, "RETHINK", "HUMAN");
                                                }}
                                                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200"
                                              >
                                                Move To Rethink
                                              </button>
                                              <button
                                                type="button"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  transitionSteerLane(record.id, "APPROVED", "HUMAN");
                                                }}
                                                className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200"
                                              >
                                                Approve
                                              </button>
                                              <button
                                                type="button"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  transitionSteerLane(record.id, "CENTER", "HUMAN");
                                                }}
                                                className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300"
                                              >
                                                Back To Center
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>

                                  <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Scores</p>
                                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                                        Average {averageScore === null ? "N/A" : `${averageScore}/100`}
                                      </span>
                                    </div>
                                    <div className="grid gap-2 md:grid-cols-5">
                                      <input
                                        value={scoreMetricDraft}
                                        onChange={(event) => setScoreMetricDraft(event.target.value)}
                                        placeholder="Metric"
                                        className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none md:col-span-2"
                                      />
                                      <input
                                        value={scoreValueDraft}
                                        onChange={(event) => setScoreValueDraft(event.target.value)}
                                        placeholder="Score"
                                        className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                                      />
                                      <input
                                        value={scoreMaxDraft}
                                        onChange={(event) => setScoreMaxDraft(event.target.value)}
                                        placeholder="Max"
                                        className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                                      />
                                      <select
                                        value={scoreByTypeDraft}
                                        onChange={(event) => setScoreByTypeDraft(event.target.value as ActorType)}
                                        className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                                      >
                                        <option value="HUMAN">HUMAN</option>
                                        <option value="AI">AI</option>
                                        <option value="SYSTEM">SYSTEM</option>
                                      </select>
                                    </div>
                                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                                      <input
                                        value={scoreByNameDraft}
                                        onChange={(event) => setScoreByNameDraft(event.target.value)}
                                        placeholder="Scored by"
                                        className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                                      />
                                      <button
                                        type="button"
                                        onClick={handleAddScoreRecord}
                                        className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-200"
                                      >
                                        Add Score
                                      </button>
                                    </div>
                                    <textarea
                                      value={scoreNoteDraft}
                                      onChange={(event) => setScoreNoteDraft(event.target.value)}
                                      placeholder="Optional note"
                                      className="h-20 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                                    />
                                    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
                                      {activeStringScores.length === 0 ? (
                                        <div className="px-4 py-3 text-xs text-slate-500">No scores yet for this string.</div>
                                      ) : (
                                        <table className="min-w-full text-left text-xs text-slate-300">
                                          <thead className="border-b border-white/10 bg-black/30 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                                            <tr>
                                              <th className="px-3 py-2">Time</th>
                                              <th className="px-3 py-2">Metric</th>
                                              <th className="px-3 py-2">Score</th>
                                              <th className="px-3 py-2">By</th>
                                              <th className="px-3 py-2">Note</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {activeStringScores.map((score) => (
                                              <tr key={score.id} className="border-b border-white/10">
                                                <td className="whitespace-nowrap px-3 py-2">{new Date(score.createdAt).toLocaleString()}</td>
                                                <td className="px-3 py-2 text-slate-100">{score.metric}</td>
                                                <td className="px-3 py-2">{score.score}/{score.maxScore}</td>
                                                <td className="px-3 py-2">
                                                  <span
                                                    className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                                                      score.scoredByType === "HUMAN"
                                                        ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                                                        : score.scoredByType === "AI"
                                                          ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-200"
                                                          : "border-white/15 bg-white/5 text-slate-300"
                                                    }`}
                                                  >
                                                    {score.scoredByType}
                                                  </span>
                                                  <p className="mt-1 text-[11px] text-slate-400">{score.scoredBy}</p>
                                                </td>
                                                <td className="px-3 py-2 text-slate-400">{score.note || "-"}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            <div className="space-y-3">
                              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Calendar Anchor</p>
                                {activeStringDateContext ? (
                                  <div className="mt-2 space-y-2 text-xs text-slate-300">
                                    <p>Start: {new Date(activeStringDateContext.anchorTimestamp).toLocaleString()}</p>
                                    <p>Latest: {new Date(activeStringDateContext.latestTimestamp).toLocaleString()}</p>
                                    <p>
                                      Timeline rows: {activeStringDateContext.eventCount} across {activeStringDateContext.uniqueDays} day{activeStringDateContext.uniqueDays === 1 ? "" : "s"}
                                    </p>
                                  </div>
                                ) : (
                                  <p className="mt-2 text-xs text-slate-500">No date anchor available yet.</p>
                                )}
                              </div>

                              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Timeline Feed</p>
                                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">{activeStringTimelineFeed.length} shown</span>
                                </div>
                                {activeStringTimelineFeed.length === 0 ? (
                                  <p className="mt-2 text-xs text-slate-500">No timeline feed available yet.</p>
                                ) : (
                                  <div className="mt-3 space-y-2">
                                    {activeStringTimelineFeed.map((row) => (
                                      <div key={row.id} className="rounded-xl border border-white/10 bg-black/25 px-2.5 py-2">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <span className="rounded-full border border-white/15 bg-black/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-300">{row.stage}</span>
                                          <span className="text-[11px] text-slate-500">{new Date(row.timestamp).toLocaleString()}</span>
                                        </div>
                                        <p className="mt-1 text-xs font-semibold text-slate-100">{row.event}</p>
                                        <p className="mt-1 text-[11px] text-slate-400">{row.actor} | {row.details}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <SteerDetailsEditorSurface
                            stringItem={activeStringItem}
                            permissionRequests={activeStringPermissionRequests}
                            approvalCheckpoints={activeStringApprovalCheckpoints}
                            scoreByString={scoreByString}
                            steerLane={steerLane}
                            onSteerLaneChange={setSteerLane}
                            steerDecisions={activeSteerDecisions}
                            readOnly
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : showLanding ? (
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-3">
            <h2 className="text-center font-display text-3xl font-black tracking-[0.01em] text-slate-100 md:text-5xl">
              {heroTitle}
            </h2>

            {planningResult?.analysis ? (
              <div className="mt-4 w-full max-w-4xl rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">
                <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {planningResult.analysis}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col gap-3">
            {showCommandDraftPanel ? (
              <div className="rounded-2xl border border-cyan-400/35 bg-[#0b121b] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-cyan-200">
                    Direction draft
                  </p>
                  <span className="text-xs text-cyan-100/80">
                    {directionGiven.trim().length} chars
                  </span>
                </div>
                <textarea
                  value={directionGiven}
                  onChange={(event) => onDirectionGivenChange(event.target.value)}
                  className="mt-2 h-20 w-full resize-none rounded-xl border border-white/20 bg-[#05080f] px-3 py-2 text-sm leading-6 text-slate-100 outline-none"
                />
              </div>
            ) : null}

            {hasActionCards ? (
              <div className="vx-scrollbar max-h-[17vh] space-y-3 overflow-y-auto pr-0 sm:pr-1">
                <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-200">
                    Action Queue ({actionQueueCount})
                  </p>
                  <p className="text-xs text-slate-500">Review approvals and missing inputs.</p>
                </div>

                {pendingPlanLaunchApproval ? (
                  <div className="rounded-2xl border border-cyan-500/35 bg-gradient-to-b from-cyan-500/14 to-cyan-500/6 p-3">
                    <p className="text-xs font-semibold text-cyan-300">Plan launch approval</p>
                    <p className="mt-2 text-sm text-cyan-100">
                      Review completed plan before workflow launch.
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-cyan-100/90 [overflow-wrap:anywhere]">
                      {pendingPlanLaunchApproval.reason}
                    </p>
                    {pendingPlanLaunchApproval.toolkits.length > 0 ? (
                      <div className="mt-2 rounded-xl border border-cyan-500/25 bg-black/30 p-2">
                        <p className="text-xs text-cyan-300">Required tools</p>
                        <div className="mt-1 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
                          {pendingPlanLaunchApproval.toolkits.map((toolkit, index) => (
                            <span
                              key={`${toolkit}-${index}`}
                              className="inline-flex max-w-full break-all rounded-full border border-cyan-500/35 bg-cyan-500/15 px-2 py-0.5 text-[11px] leading-5 text-cyan-100"
                            >
                              {toolkit}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={onApprovePlanLaunch}
                        disabled={isApprovalBusy}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                      >
                        Approve Launch
                      </button>
                      <button
                        type="button"
                        onClick={onRejectPlanLaunch}
                        disabled={isApprovalBusy}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}

                {pendingToolkitApproval ? (
                  <div className="rounded-2xl border border-amber-500/35 bg-gradient-to-b from-amber-500/14 to-amber-500/6 p-3">
                    <p className="text-xs font-semibold text-amber-300">Tool access approval</p>
                    <div className="mt-2 rounded-xl border border-amber-500/25 bg-black/30 p-2">
                      <p className="text-xs text-amber-300">Required tools</p>
                      <div className="mt-1 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
                        {pendingToolkitApproval.toolkits.map((toolkit, index) => (
                          <span
                            key={`${toolkit}-${index}`}
                            className="inline-flex max-w-full break-all rounded-full border border-amber-500/35 bg-amber-500/15 px-2 py-0.5 text-[11px] leading-5 text-amber-100"
                          >
                            {toolkit}
                          </span>
                        ))}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-amber-100/90">
                      Approve to connect integrations and continue execution, or reject to keep it paused.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={onApproveToolkitAccess}
                        disabled={isApprovalBusy}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={onRejectToolkitAccess}
                        disabled={isApprovalBusy}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}

                {pendingEmailApproval ? (
                  <div className="rounded-2xl border border-white/15 bg-white/[0.04] p-3">
                    <p className="text-xs font-semibold text-slate-300">Email draft approval</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-100">
                      To: {pendingEmailApproval.draft.to}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-xs text-slate-200">
                      Subject: {pendingEmailApproval.draft.subject}
                    </p>
                    <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-white/10 bg-black/30 px-2.5 py-2">
                      <p className="whitespace-pre-wrap break-words font-sans text-sm leading-6 tracking-normal text-slate-100">
                        {pendingEmailApproval.draft.body}
                      </p>
                    </div>
                    <p className="mt-1 text-[11px] text-emerald-200/85">
                      No email is sent until you press Approve.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={onApproveEmailDraft}
                        disabled={isApprovalBusy}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={onRejectEmailDraft}
                        disabled={isApprovalBusy}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}

                {agentRunResult?.status === "needs_input" ? (
                  <div className="space-y-3 rounded-2xl border border-amber-500/35 bg-gradient-to-b from-amber-500/14 to-amber-500/6 p-3">
                    <div>
                      <p className="text-xs font-semibold text-amber-300">Missing input required</p>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-amber-100">
                        {agentRunResult.assistant_message || "Provide missing details to continue."}
                      </p>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      {requiredInputs.map((field) => (
                        <label key={field.key} className="block text-xs text-amber-200">
                          {field.label}
                          <input
                            type={field.type === "number" ? "number" : field.type === "email" ? "email" : "text"}
                            value={agentRunInputValues[field.key] ?? ""}
                            onChange={(event) => onAgentInputValueChange(field.key, event.target.value)}
                            placeholder={field.placeholder}
                            className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none"
                          />
                        </label>
                      ))}
                    </div>

                    <label className="block text-xs text-amber-200">
                      Optional Source URL
                      <input
                        value={agentInputSourceUrl}
                        onChange={(event) => onAgentInputSourceUrlChange(event.target.value)}
                        placeholder="https://docs.example.com/context"
                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none"
                      />
                    </label>

                    <label className="block text-xs text-amber-200">
                      Optional File Upload
                      <div className="mt-1 flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                        <Paperclip size={14} className="shrink-0 text-slate-500" />
                        <input
                          type="file"
                          onChange={(event) => onAgentInputFileChange(event.target.files?.[0] ?? null)}
                          className="min-w-0 w-full text-sm normal-case tracking-normal text-slate-200 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-slate-200"
                        />
                      </div>
                      {agentInputFile ? (
                        <p className="mt-1 text-[11px] normal-case tracking-normal text-amber-100">
                          Selected: {agentInputFile.name}
                        </p>
                      ) : null}
                    </label>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={onSubmitAgentInputs}
                        disabled={isApprovalBusy}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                      >
                        Approve & Continue
                      </button>
                      <button
                        type="button"
                        onClick={onRejectAgentInput}
                        disabled={isApprovalBusy}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="vx-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-[#050910]/72 p-2.5 pb-24 pr-0 sm:p-3 sm:pb-28 sm:pr-1">
              {turns.map((turn) => (
                <div
                  key={turn.id}
                  className={`max-w-full rounded-2xl border px-3 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.35)] backdrop-blur sm:max-w-[94%] sm:px-4 sm:py-3.5 ${
                    turn.role === "owner"
                      ? "ml-auto border-cyan-300/55 bg-cyan-500/22 text-white shadow-[0_14px_34px_rgba(34,211,238,0.2)]"
                      : "mr-auto border-slate-500/55 bg-[#0b1220] text-slate-100"
                  }`}
                >
                  <p
                    className={`text-xs font-semibold ${
                      turn.role === "owner" ? "text-cyan-100" : "text-slate-300"
                    }`}
                  >
                    {turn.role === "owner" ? "You" : "Organization"}
                    {turn.modelLabel ? ` | ${turn.modelLabel}` : ""}
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap break-words font-sans text-[12px] leading-5 tracking-normal text-slate-50 [overflow-wrap:anywhere]">
                    {turn.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {!isStringsView && !hideControlDeckScreenshotElements ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.7rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-3 sm:px-4">
          <div className="pointer-events-auto w-full max-w-4xl">{composerBar}</div>
        </div>
      ) : null}
    </div>
  );
}

