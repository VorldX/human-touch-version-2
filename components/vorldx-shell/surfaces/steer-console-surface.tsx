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
  summarizeHumanInputReason,
  toLocalDateKey,
  workflowAgentLabelFromTaskTrace
} from "@/components/vorldx-shell/shared";
import { SteerDetailsEditorSurface } from "@/components/vorldx-shell/surfaces/steer-details-editor-surface";

export function SteerConsoleSurface({
  stringItem,
  allStringItems,
  calendarDate,
  activeLane,
  onActiveLaneChange,
  draftsByString = {},
  onDraftChange,
  scoreByString = {},
  decisions,
  onDecision,
  permissionRequests,
  approvalCheckpoints
}: {
  stringItem: ControlThreadHistoryItem | null;
  allStringItems: ControlThreadHistoryItem[];
  calendarDate?: string | null;
  activeLane: SteerSurfaceTab;
  onActiveLaneChange: (value: SteerSurfaceTab) => void;
  draftsByString?: Record<string, EditableStringDraft>;
  onDraftChange?: (stringId: string, nextDraft: EditableStringDraft) => void;
  scoreByString?: Record<string, StringScoreRecord[]>;
  decisions: Record<string, SteerLaneTab>;
  onDecision: (cardId: string, lane: SteerLaneTab) => void;
  permissionRequests: PermissionRequestItem[];
  approvalCheckpoints: ApprovalCheckpointItem[];
}) {
  const scopedStrings = useMemo(
    () => (stringItem ? [stringItem] : allStringItems),
    [allStringItems, stringItem]
  );
  const steerCards = useMemo(
    () =>
      scopedStrings.flatMap((item) =>
        (draftsByString[item.id]
          ? buildDraftDeliverableCards({
              stringItem: item,
              draft: draftsByString[item.id]
            })
          : buildThreadDeliverableCards(item)
        ).map((card) => ({
          ...card,
          lane: decisions[card.id] ?? "CENTER"
        }))
      ),
    [decisions, draftsByString, scopedStrings]
  );
  const laneCounts = useMemo(
    () => ({
      CENTER: steerCards.filter((card) => card.lane === "CENTER").length,
      APPROVED: steerCards.filter((card) => card.lane === "APPROVED").length,
      RETHINK: steerCards.filter((card) => card.lane === "RETHINK").length
    }),
    [steerCards]
  );
  const visibleCards = useMemo(
    () =>
      activeLane === "DETAILS" ? steerCards : steerCards.filter((card) => card.lane === activeLane),
    [activeLane, steerCards]
  );
  const scopeLabel = stringItem ? controlThreadDisplayTitle(stringItem) : "All strings";
  const hasPlanContent = scopedStrings.some((item) => Boolean(item.planningResult?.primaryPlan));

  return (
    <div className="space-y-3">
      <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(9,14,24,0.94),rgba(5,9,16,0.88))] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.28)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Steer Console
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{scopeLabel}</p>
            <p className="mt-1 text-xs text-slate-400">
              Review plan deliverables and move them between Center, Approved, and Rethink, or
              open editable Details.
            </p>
          </div>
          <div className="inline-flex flex-wrap rounded-full border border-white/15 bg-black/30 p-1">
            {([
              { id: "CENTER", label: "Center" },
              { id: "APPROVED", label: "Approved" },
              { id: "RETHINK", label: "Rethink" }
            ] as Array<{ id: SteerLaneTab; label: string }>).map((lane) => (
              <button
                key={lane.id}
                type="button"
                onClick={() => onActiveLaneChange(lane.id)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                  activeLane === lane.id
                    ? "bg-gradient-to-r from-cyan-200 to-white text-slate-950"
                    : "text-slate-300 hover:bg-white/10"
                }`}
              >
                {lane.label} ({laneCounts[lane.id]})
              </button>
            ))}
            <button
              type="button"
              onClick={() => onActiveLaneChange("DETAILS")}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                activeLane === "DETAILS"
                  ? "bg-gradient-to-r from-cyan-200 to-white text-slate-950"
                  : "text-slate-300 hover:bg-white/10"
              }`}
            >
              Details
            </button>
          </div>
        </div>
      </div>

      {activeLane === "DETAILS" ? (
        <SteerDetailsEditorSurface
          stringItem={stringItem}
          calendarDate={calendarDate}
          permissionRequests={permissionRequests}
          approvalCheckpoints={approvalCheckpoints}
          draftsByString={draftsByString}
          onDraftChange={onDraftChange}
          scoreByString={scoreByString}
        />
      ) : !hasPlanContent ? (
        <div className="rounded-[24px] border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-slate-500">
          {stringItem
            ? "This string does not have plan deliverables to steer yet."
            : "No plan deliverables are available to steer yet."}
        </div>
      ) : visibleCards.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-slate-500">
          {activeLane === "CENTER"
            ? "No deliverables waiting in Center."
            : activeLane === "APPROVED"
              ? "No deliverables approved yet."
              : "No deliverables are in Rethink."}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleCards.map((card) => (
            <article
              key={card.id}
              className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,14,22,0.96),rgba(6,9,15,0.9))] p-4 shadow-[0_18px_42px_rgba(0,0,0,0.28)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
                      {card.source}
                    </span>
                    <span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                      {card.stringTitle}
                    </span>
                    {card.workflowTitle ? (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-400">
                        {card.workflowTitle}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm font-semibold leading-6 text-slate-100">{card.text}</p>
                </div>
                <div
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                    card.lane === "APPROVED"
                      ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                      : card.lane === "RETHINK"
                        ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                        : "border-white/10 bg-white/5 text-slate-300"
                  }`}
                >
                  {card.lane}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onDecision(card.id, "CENTER")}
                  className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                >
                  Back To Center
                </button>
                <button
                  type="button"
                  onClick={() => onDecision(card.id, "APPROVED")}
                  className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => onDecision(card.id, "RETHINK")}
                  className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-200 transition hover:bg-amber-500/20"
                >
                  Move To Rethink
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
