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

export function ScanConsoleSurface({
  stringItem,
  allStringItems,
  permissionRequests,
  approvalCheckpoints,
  permissionRequestActionId,
  approvalCheckpointActionId,
  onPermissionDecision,
  onCheckpointDecision
}: {
  stringItem: ControlThreadHistoryItem | null;
  allStringItems: ControlThreadHistoryItem[];
  permissionRequests: PermissionRequestItem[];
  approvalCheckpoints: ApprovalCheckpointItem[];
  permissionRequestActionId: string | null;
  approvalCheckpointActionId: string | null;
  onPermissionDecision: (requestId: string, decision: "APPROVE" | "REJECT") => void;
  onCheckpointDecision: (checkpointId: string, decision: "APPROVE" | "REJECT") => void;
}) {
  const scopedStrings = useMemo(
    () => (stringItem ? [stringItem] : allStringItems),
    [allStringItems, stringItem]
  );

  const permissionRequestsByString = useMemo(() => {
    const next = new Map<string, PermissionRequestItem[]>();
    for (const item of scopedStrings) {
      const requestedIds = new Set<string>();
      for (const requestId of item.launchScope?.permissionRequestIds ?? []) {
        const normalized = requestId.trim();
        if (normalized) {
          requestedIds.add(normalized);
        }
      }
      for (const request of item.planningResult?.permissionRequests ?? []) {
        const normalized = request.id?.trim();
        if (normalized) {
          requestedIds.add(normalized);
        }
      }
      const planId = item.launchScope?.planId?.trim() ?? "";
      const directionId = item.launchScope?.directionId?.trim() ?? "";
      next.set(
        item.id,
        permissionRequests.filter((request) => {
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
        })
      );
    }
    return next;
  }, [permissionRequests, scopedStrings]);

  const approvalCheckpointsByString = useMemo(() => {
    const next = new Map<string, ApprovalCheckpointItem[]>();
    for (const item of scopedStrings) {
      const flowIds = new Set(
        (item.launchScope?.flowIds ?? []).map((value) => value.trim()).filter(Boolean)
      );
      next.set(
        item.id,
        flowIds.size === 0
          ? []
          : approvalCheckpoints.filter((checkpoint) =>
              checkpoint.flowId ? flowIds.has(checkpoint.flowId.trim()) : false
            )
      );
    }
    return next;
  }, [approvalCheckpoints, scopedStrings]);

  const scopedPermissionRequests = useMemo(() => {
    const deduped = new Map<string, PermissionRequestItem>();
    for (const item of scopedStrings) {
      for (const request of permissionRequestsByString.get(item.id) ?? []) {
        deduped.set(request.id, request);
      }
    }
    return [...deduped.values()].sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
  }, [permissionRequestsByString, scopedStrings]);

  const scopedApprovalCheckpoints = useMemo(() => {
    const deduped = new Map<string, ApprovalCheckpointItem>();
    for (const item of scopedStrings) {
      for (const checkpoint of approvalCheckpointsByString.get(item.id) ?? []) {
        deduped.set(checkpoint.id, checkpoint);
      }
    }
    return [...deduped.values()].sort((left, right) => {
      const leftTimestamp = new Date(left.resolvedAt ?? left.requestedAt).getTime();
      const rightTimestamp = new Date(right.resolvedAt ?? right.requestedAt).getTime();
      return rightTimestamp - leftTimestamp;
    });
  }, [approvalCheckpointsByString, scopedStrings]);

  const activityRows = useMemo(
    () =>
      scopedStrings
        .flatMap((item) =>
          buildThreadScanRows({
            item,
            permissionRequests: permissionRequestsByString.get(item.id) ?? [],
            approvalCheckpoints: approvalCheckpointsByString.get(item.id) ?? []
          }).map((row) => ({
            ...row,
            stringTitle: controlThreadDisplayTitle(item)
          }))
        )
        .sort(
          (left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
        ),
    [approvalCheckpointsByString, permissionRequestsByString, scopedStrings]
  );

  const pendingPermissionRequests = scopedPermissionRequests.filter(
    (request) => request.status === "PENDING"
  );
  const pendingApprovalCheckpoints = scopedApprovalCheckpoints.filter(
    (checkpoint) => checkpoint.status === "PENDING"
  );
  const scopeLabel = stringItem ? controlThreadDisplayTitle(stringItem) : "All strings";
  const showStringTitle = !stringItem;

  return (
    <div className="space-y-3">
      <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,15,24,0.94),rgba(8,9,16,0.88))] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.28)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Scan Console
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{scopeLabel}</p>
            <p className="mt-1 text-xs text-slate-400">
              Governance timeline, permission requests, and approval checkpoints.
            </p>
          </div>
          <div className="grid gap-2 text-right sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Events</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">{activityRows.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Requests</p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {scopedPermissionRequests.length}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Checkpoints
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-100">
                {scopedApprovalCheckpoints.length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {pendingPermissionRequests.length > 0 || pendingApprovalCheckpoints.length > 0 ? (
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Pending Permission Requests
              </p>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                {pendingPermissionRequests.length}
              </span>
            </div>
            {pendingPermissionRequests.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No pending permission requests.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {pendingPermissionRequests.map((request) => (
                  <div
                    key={request.id}
                    className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-100">
                        {request.area} | {request.workflowTitle || "Workflow"} {"->"}{" "}
                        {request.taskTitle || "Task"}
                      </p>
                      <span className="text-[11px] text-slate-500">
                        {new Date(request.updatedAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {request.requestedByEmail || "Owner"} | {request.targetRole}
                    </p>
                    <p className="mt-2 text-xs text-slate-300">{request.reason}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onPermissionDecision(request.id, "APPROVE")}
                        disabled={permissionRequestActionId === request.id}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => onPermissionDecision(request.id, "REJECT")}
                        disabled={permissionRequestActionId === request.id}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] font-semibold text-red-200 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Pending Approval Checkpoints
              </p>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                {pendingApprovalCheckpoints.length}
              </span>
            </div>
            {pendingApprovalCheckpoints.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No pending approval checkpoints.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {pendingApprovalCheckpoints.map((checkpoint) => (
                  <div
                    key={checkpoint.id}
                    className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-100">
                        Flow {checkpoint.flowId?.slice(0, 8) ?? "N/A"} | Task{" "}
                        {checkpoint.taskId?.slice(0, 8) ?? "N/A"}
                      </p>
                      <span className="text-[11px] text-slate-500">
                        {new Date(checkpoint.requestedAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-300">{checkpoint.reason}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onCheckpointDecision(checkpoint.id, "APPROVE")}
                        disabled={approvalCheckpointActionId === checkpoint.id}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => onCheckpointDecision(checkpoint.id, "REJECT")}
                        disabled={approvalCheckpointActionId === checkpoint.id}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] font-semibold text-red-200 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,14,22,0.96),rgba(6,9,15,0.9))] p-4 shadow-[0_18px_42px_rgba(0,0,0,0.28)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Activity Timeline
          </p>
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
            {activityRows.length} event(s)
          </span>
        </div>

        {activityRows.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-slate-500">
            No governance activity is available for this scope yet.
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {activityRows.map((row) => (
              <article
                key={row.id}
                className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                        row.actorType === "HUMAN"
                          ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                          : row.actorType === "AI"
                            ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-200"
                            : "border-amber-500/35 bg-amber-500/10 text-amber-200"
                      }`}
                    >
                      {row.actorType}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-300">
                      {row.category}
                    </span>
                    {showStringTitle ? (
                      <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] text-slate-400">
                        {row.stringTitle}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {new Date(row.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="mt-2 text-xs font-semibold text-slate-100">{row.detail}</p>
                <p className="mt-1 text-[11px] text-slate-400">{row.actor}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
