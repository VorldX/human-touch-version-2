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

export function FlowSidebarRail({
  themeStyle,
  selectedDate,
  onSelectedDateChange,
  selectedStringId,
  onSelectedStringChange,
  stringItems
}: {
  themeStyle: { accent: string; accentSoft: string; border: string };
  selectedDate: string | null;
  onSelectedDateChange: (value: string | null) => void;
  selectedStringId: string | null;
  onSelectedStringChange: (value: string | null) => void;
  stringItems: ControlThreadHistoryItem[];
}) {
  const [monthCursor, setMonthCursor] = useState(() => {
    const anchor = selectedDate
      ? new Date(`${selectedDate}T00:00:00`)
      : stringItems[0]?.updatedAt
        ? new Date(stringItems[0].updatedAt)
        : new Date();
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  });

  useEffect(() => {
    if (!selectedDate) {
      return;
    }
    const selectedDay = new Date(`${selectedDate}T00:00:00`);
    if (Number.isNaN(selectedDay.getTime())) {
      return;
    }
    const nextMonthCursor = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), 1);
    if (
      monthCursor.getFullYear() !== nextMonthCursor.getFullYear() ||
      monthCursor.getMonth() !== nextMonthCursor.getMonth()
    ) {
      setMonthCursor(nextMonthCursor);
    }
  }, [monthCursor, selectedDate]);

  const stringCountsByDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of stringItems) {
      const key = toLocalDateKey(item.updatedAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [stringItems]);

  const monthGridDays = useMemo(() => buildLocalMonthGrid(monthCursor), [monthCursor]);

  const visibleStrings = useMemo(() => {
    const filtered = selectedDate
      ? stringItems.filter((item) => toLocalDateKey(item.updatedAt) === selectedDate)
      : stringItems;
    return [...filtered].sort((left, right) => right.updatedAt - left.updatedAt);
  }, [selectedDate, stringItems]);

  useEffect(() => {
    if (!selectedStringId) {
      return;
    }
    if (visibleStrings.some((item) => item.id === selectedStringId)) {
      return;
    }
    onSelectedStringChange(null);
  }, [onSelectedStringChange, selectedStringId, visibleStrings]);

  const scopeSummary = useMemo(() => {
    const summary = {
      FOCUS: 0,
      EXECUTION: 0,
      GOVERNANCE: 0
    };
    for (const item of visibleStrings) {
      summary[controlThreadRailScope(item)] += 1;
    }
    return summary;
  }, [visibleStrings]);

  const selectedDateLabel = selectedDate
    ? new Date(`${selectedDate}T00:00:00`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      })
    : "All dates";

  return (
    <aside className="flex h-auto min-h-0 flex-col xl:h-full xl:w-[clamp(240px,22vw,320px)] xl:self-stretch [@media(min-width:1920px)]:w-[clamp(260px,18vw,360px)]">
      <div
        className={`vx-panel flex h-auto min-h-0 flex-col overflow-hidden rounded-[26px] p-2 xl:h-full ${themeStyle.border}`}
      >
        <div className="mx-auto w-full max-w-[300px] shrink-0 rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(13,18,28,0.92),rgba(8,12,19,0.86))] p-1.5 xl:max-w-[284px] [@media(min-width:1920px)]:max-w-[272px]">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Calendar
              </p>
              <p className="mt-1 text-[13px] font-medium text-slate-100 xl:text-[12px]">
                {monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </p>
              <p className="mt-1 text-[8px] text-slate-400">Filters Flow.</p>
            </div>
            <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 p-1">
              <button
                type="button"
                onClick={() => onSelectedDateChange(null)}
                className={`rounded-full border px-1.5 py-1 text-[10px] transition ${
                  selectedDate === null
                    ? "border-cyan-400/35 bg-cyan-500/12 text-cyan-100"
                    : "border-white/10 text-slate-300 hover:bg-white/10"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() =>
                  setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
                }
                className="rounded-full border border-white/10 px-1.5 py-1 text-[10px] text-slate-300 transition hover:bg-white/10"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() =>
                  setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
                }
                className="rounded-full border border-white/10 px-1.5 py-1 text-[10px] text-slate-300 transition hover:bg-white/10"
              >
                Next
              </button>
            </div>
          </div>

          <div className="mt-1.5 grid grid-cols-7 gap-1 text-center text-[8px] uppercase tracking-[0.16em] text-slate-500">
            {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {monthGridDays.map((day) => {
              const dayKey = toLocalDateKey(day);
              const isSelected = dayKey === selectedDate;
              const isCurrentMonth = day.getMonth() === monthCursor.getMonth();
              const count = stringCountsByDay.get(dayKey) ?? 0;

              return (
                <button
                  key={`${dayKey}-${day.getTime()}`}
                  type="button"
                  onClick={() => onSelectedDateChange(selectedDate === dayKey ? null : dayKey)}
                  className={`flex h-7 flex-col items-center justify-center rounded-md border text-[9px] transition xl:h-[1.625rem] [@media(min-width:1920px)]:h-6 ${
                    isSelected
                      ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.12)]"
                      : isCurrentMonth
                        ? "border-white/10 bg-black/20 text-slate-200 hover:bg-white/10"
                        : "border-transparent text-slate-500 hover:bg-white/5"
                  }`}
                >
                  <span>{day.getDate()}</span>
                  <span
                    className={`mt-0.5 h-1 w-1 rounded-full ${
                      count > 0 ? "bg-cyan-300" : "bg-transparent"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-2.5 flex min-h-0 flex-1 flex-col rounded-[20px] border border-white/10 bg-[#050910]/72 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Signal Chain
              </p>
              <p className="mt-1 text-sm text-slate-200">{selectedDateLabel}</p>
            </div>
            <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] font-semibold text-slate-300">
              {visibleStrings.length}
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {(["FOCUS", "EXECUTION", "GOVERNANCE"] as const).map((scope) => (
              <span
                key={scope}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] ${controlThreadScopeBadgeClass(scope)}`}
              >
                {primaryWorkspaceScopeLabel(scope)}
                <span className="text-slate-100">{scopeSummary[scope]}</span>
              </span>
            ))}
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/20 p-2.5">
            {visibleStrings.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 text-center text-sm text-slate-500">
                {selectedDate ? "No strings for this date." : "No strings yet."}
              </div>
            ) : (
              <div className="vx-scrollbar relative h-full overflow-y-auto overscroll-contain pr-1.5">
                <div className="absolute bottom-3 left-[15px] top-3 w-[2px] bg-gradient-to-b from-emerald-400/80 via-cyan-400/55 to-cyan-500/10 shadow-[0_0_18px_rgba(34,211,238,0.25)]" />
                <div className="space-y-3.5 pl-10">
                  {visibleStrings.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        onSelectedStringChange(selectedStringId === item.id ? null : item.id)
                      }
                      className="relative block w-full text-left"
                    >
                      <span
                        className={`absolute -left-[2.02rem] top-5 h-4 w-4 rounded-full border-2 ring-4 ring-[#050910] ${
                          item.mode === "DIRECTION"
                            ? "border-cyan-200 bg-cyan-400 shadow-[0_0_16px_rgba(34,211,238,0.65)]"
                            : "border-emerald-200 bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.6)]"
                        }`}
                      />
                      <article
                        className={`rounded-[20px] border p-2.5 shadow-[0_14px_36px_rgba(0,0,0,0.28)] transition ${
                          selectedStringId === item.id
                            ? "border-cyan-400/45 bg-[linear-gradient(180deg,rgba(8,24,34,0.98),rgba(6,18,28,0.94))]"
                            : "border-white/10 bg-[linear-gradient(180deg,rgba(8,12,18,0.96),rgba(6,10,16,0.88))] hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex max-w-full items-center rounded-sm border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] ${
                                  item.mode === "DIRECTION"
                                    ? "border-cyan-500/35 bg-cyan-500/12 text-cyan-200"
                                    : "border-emerald-500/35 bg-emerald-500/12 text-emerald-200"
                                }`}
                              >
                                {controlThreadDisplayTitle(item)}
                              </span>
                              <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                                {controlThreadKindLabel(item.mode)}
                              </span>
                              <span
                                className={`inline-flex rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${controlThreadScopeBadgeClass(
                                  controlThreadRailScope(item)
                                )}`}
                              >
                                {controlThreadRailScope(item)}
                              </span>
                            </div>
                            <p className="mt-2 text-[11px] font-semibold text-emerald-300">
                              {new Date(item.updatedAt).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric"
                              })}{" "}
                              |{" "}
                              {new Date(item.updatedAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit"
                              })}
                            </p>
                            <p className="mt-2 text-sm leading-6 text-slate-200">
                              {controlThreadPreview(item)}
                            </p>
                          </div>
                          <span className="shrink-0 pt-0.5 text-[11px] text-slate-500">
                            {formatRelativeTimeShort(item.updatedAt)}
                          </span>
                        </div>
                      </article>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

