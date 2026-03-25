"use client";

import { type ChangeEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Globe2,
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
import { useRouter, useSearchParams } from "next/navigation";

import { useFirebaseAuth } from "@/components/auth/firebase-auth-provider";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { CalendarConsole } from "@/components/calendar/calendar-console";
import { DirectionConsole } from "@/components/direction/direction-console";
import { BlueprintConsole } from "@/components/blueprint/blueprint-console";
import { HubConsole } from "@/components/hub/hub-console";
import { MemoryConsole } from "@/components/memory/memory-console";
import { PlanConsole } from "@/components/plan/plan-console";
import { SettingsConsole } from "@/components/settings/settings-console";
import { SquadConsole } from "@/components/squad/squad-console";
import { NotificationStack } from "@/components/system/notification-stack";
import { WorkflowConsole } from "@/components/workflow/workflow-console";
import { classifyEmailDraftReply } from "@/lib/agent/run/email-request-parser";
import { getRealtimeClient } from "@/lib/realtime/client";
import type { AppTheme } from "@/lib/store/vorldx-store";
import {
  buildEarthOrgContext,
  EARTH_ORG_ID,
  isEarthOrgContext,
  useVorldXStore
} from "@/lib/store/vorldx-store";
import type { AssistantMessageMeta, WorkflowTaskStatus } from "@/src/types/chat";
import { enrichMessageForIntent } from "@/src/utils/intentDetector";
import { ControlDeckSurface } from "@/components/vorldx-shell/surfaces/control-deck-surface";
import { FlowSidebarRail } from "@/components/vorldx-shell/surfaces/flow-sidebar-rail";
import { FlowStringsSurface } from "@/components/vorldx-shell/surfaces/flow-strings-surface";
import { ScanConsoleSurface } from "@/components/vorldx-shell/surfaces/scan-console-surface";
import { SteerDetailsEditorSurface } from "@/components/vorldx-shell/surfaces/steer-details-editor-surface";
import { StringBlueprintCanvasSurface } from "@/components/vorldx-shell/surfaces/string-blueprint-canvas-surface";
import { useFlowScope } from "@/components/vorldx-shell/hooks/use-flow-scope";
import { StringChatShell } from "@/components/chat-ui/string-chat-shell";
import type { ChatMessage, ChatString, StringMode } from "@/components/chat-ui/types";

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
  buildThreadEventMeta,
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
  getScopedApprovalCheckpointsForString,
  getScopedPermissionRequestsForString,
  getPrimaryWorkspaceTabForNavItem,
  inferToolkitsFromDirectionPrompt,
  inferTurnTimestamp,
  initials,
  isApprovalReply,
  isGmailDirectionPrompt,
  isTimelineEventMeta,
  isRecurringTaskPrompt,
  isRejectReply,
  makeDirectionTurnId,
  makeLocalDraftId,
  normalizeDeliverableId,
  normalizeEditableStringDraft,
  normalizeHumanInputReason,
  normalizePlanAnalysisText,
  normalizeToolkitAlias,
  normalizeWorkflowTaskStatus,
  openCenteredPopup,
  primaryWorkspaceScopeLabel,
  parseJsonBody,
  randomPresence,
  resolveEditableStringDraft,
  shouldDirectWorkflowLaunch,
  shouldForceDirectionPlanRoute,
  sleep,
  summarizeHumanInputReason,
  toLocalDateKey,
  workflowAgentLabelFromTaskTrace
} from "@/components/vorldx-shell/shared";

const STRINGS_UPDATED_EVENT = "vx:strings-updated";

interface WorkspaceStringsResponse {
  ok?: boolean;
  message?: string;
  strings?: ChatString[];
  string?: ChatString;
}

interface WorkspaceDirectionRecord {
  id: string;
  title: string;
  summary: string;
  direction: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceDirectionsResponse {
  ok?: boolean;
  message?: string;
  directions?: WorkspaceDirectionRecord[];
}

interface WorkspacePlanRecord {
  id: string;
  title: string;
  summary: string;
  direction: string;
  directionId: string | null;
  createdAt: string;
  updatedAt: string;
  primaryPlan?: DirectionExecutionPlan;
  fallbackPlan?: DirectionExecutionPlan;
}

interface WorkspacePlansResponse {
  ok?: boolean;
  message?: string;
  plans?: WorkspacePlanRecord[];
}

function trimWorkspaceText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function toWorkspaceTimestamp(value: string | number | null | undefined) {
  const parsed =
    typeof value === "number" ? value : new Date(typeof value === "string" ? value : "").getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function buildWorkspaceTurnId(
  prefix: "owner" | "organization",
  createdAt: string | undefined,
  index: number
) {
  const timestamp = toWorkspaceTimestamp(createdAt) || Date.now();
  return `${prefix}-${timestamp}-${index}`;
}

function mapStringModeToControlMode(mode: StringMode): ControlMode {
  return mode === "direction" ? "DIRECTION" : "MINDSTORM";
}

function mapChatMessageToDirectionTurn(
  message: ChatMessage,
  index: number
): DirectionTurn | null {
  const content =
    trimWorkspaceText(message.content) ||
    trimWorkspaceText(message.direction?.summary) ||
    trimWorkspaceText(message.direction?.objective);

  if (!content) {
    return null;
  }

  if (message.role === "user") {
    return {
      id: buildWorkspaceTurnId("owner", message.createdAt, index),
      role: "owner",
      content,
      ...(message.meta ? { meta: message.meta } : {})
    };
  }

  const modelLabel =
    trimWorkspaceText(message.authorName) ||
    trimWorkspaceText(message.teamLabel) ||
    trimWorkspaceText(message.authorRole);

  return {
    id: buildWorkspaceTurnId("organization", message.createdAt, index),
    role: "organization",
    content,
    ...(modelLabel ? { modelLabel } : {}),
    ...(message.meta ? { meta: message.meta } : {})
  };
}

function deriveWorkspaceDirectionGiven(input: {
  chatTitle: string;
  mode: ControlMode;
  messages: ChatMessage[];
  linkedDirection: WorkspaceDirectionRecord | null;
  linkedPlan: WorkspacePlanRecord | null;
}) {
  const latestDirectionObjective = [...input.messages]
    .reverse()
    .map((message) => trimWorkspaceText(message.direction?.objective))
    .find(Boolean);
  const latestOwnerMessage = [...input.messages]
    .reverse()
    .find((message) => message.role === "user" && trimWorkspaceText(message.content));
  const latestMessage = [...input.messages]
    .reverse()
    .find(
      (message) =>
        !isTimelineEventMeta(message.meta) && trimWorkspaceText(message.content)
    );

  return (
    trimWorkspaceText(input.linkedDirection?.direction) ||
    trimWorkspaceText(input.linkedPlan?.direction) ||
    latestDirectionObjective ||
    trimWorkspaceText(latestOwnerMessage?.content) ||
    trimWorkspaceText(latestMessage?.content) ||
    trimWorkspaceText(input.chatTitle) ||
    controlThreadDefaultTitle(input.mode)
  );
}

function buildWorkspacePlanningResult(input: {
  directionGiven: string;
  linkedDirection: WorkspaceDirectionRecord | null;
  linkedPlan: WorkspacePlanRecord | null;
  messages: ChatMessage[];
}): DirectionPlanningResult | null {
  const primaryPlan = input.linkedPlan?.primaryPlan;
  if (!primaryPlan) {
    return null;
  }

  const fallbackPlan = input.linkedPlan?.fallbackPlan ?? primaryPlan;
  const analysis =
    trimWorkspaceText(input.linkedPlan?.summary) ||
    trimWorkspaceText(input.linkedDirection?.summary) ||
    trimWorkspaceText(primaryPlan.summary);
  const requiredToolkits = [
    ...new Set(
      [
        ...collectPlanToolkits(primaryPlan),
        ...collectPlanToolkits(fallbackPlan),
        ...input.messages.flatMap((message) => message.direction?.requiredToolkits ?? [])
      ]
        .map((item) => normalizeToolkitAlias(item))
        .filter(Boolean)
    )
  ];

  return {
    analysis,
    directionGiven: input.directionGiven,
    primaryPlan,
    fallbackPlan,
    ...(requiredToolkits.length > 0 ? { requiredToolkits } : {}),
    ...(input.linkedDirection?.id ? { directionRecord: { id: input.linkedDirection.id } } : {}),
    ...(input.linkedPlan?.id ? { planRecord: { id: input.linkedPlan.id } } : {})
  };
}

function buildWorkspaceHistoryItem(input: {
  id: string;
  title: string;
  mode: ControlMode;
  updatedAt: number;
  messages: ChatMessage[];
  linkedDirection: WorkspaceDirectionRecord | null;
  linkedPlan: WorkspacePlanRecord | null;
}) {
  const turns = input.messages
    .map((message, index) => mapChatMessageToDirectionTurn(message, index))
    .filter((item): item is DirectionTurn => Boolean(item));
  const directionGiven = deriveWorkspaceDirectionGiven({
    chatTitle: input.title,
    mode: input.mode,
    messages: input.messages,
    linkedDirection: input.linkedDirection,
    linkedPlan: input.linkedPlan
  });
  const planningResult = buildWorkspacePlanningResult({
    directionGiven,
    linkedDirection: input.linkedDirection,
    linkedPlan: input.linkedPlan,
    messages: input.messages
  });
  const directionId =
    trimWorkspaceText(input.linkedDirection?.id) ||
    trimWorkspaceText(planningResult?.directionRecord?.id);
  const planId =
    trimWorkspaceText(input.linkedPlan?.id) || trimWorkspaceText(planningResult?.planRecord?.id);

  return {
    id: input.id,
    title: trimWorkspaceText(input.title) || controlThreadDefaultTitle(input.mode),
    mode: input.mode,
    updatedAt: input.updatedAt,
    turns,
    directionGiven,
    ...(planningResult ? { planningResult } : {}),
    ...(directionId || planId
      ? {
          launchScope: {
            directionId,
            planId,
            permissionRequestIds: [],
            flowIds: []
          }
        }
      : {})
  } satisfies ControlThreadHistoryItem;
}

function buildWorkspaceDirectionHistoryItem(
  direction: WorkspaceDirectionRecord,
  linkedPlan: WorkspacePlanRecord | null
) {
  const createdAt = trimWorkspaceText(direction.createdAt) || trimWorkspaceText(direction.updatedAt);
  const messages: ChatMessage[] = [
    {
      id: `direction-context-${direction.id}`,
      role: "system",
      content:
        trimWorkspaceText(direction.summary) ||
        trimWorkspaceText(direction.direction) ||
        "Direction loaded.",
      createdAt: createdAt || new Date().toISOString(),
      authorName: "Co-Founder Manager",
      authorRole: "Organization lead"
    }
  ];

  if (linkedPlan?.primaryPlan) {
    messages.push({
      id: `direction-plan-${linkedPlan.id}`,
      role: "system",
      content: trimWorkspaceText(linkedPlan.summary) || "Execution plan linked to this direction.",
      createdAt:
        trimWorkspaceText(linkedPlan.createdAt) ||
        trimWorkspaceText(linkedPlan.updatedAt) ||
        createdAt ||
        new Date().toISOString(),
      authorName: "Co-Founder Manager",
      authorRole: "Direction lead"
    });
  }

  return buildWorkspaceHistoryItem({
    id: `direction:${direction.id}`,
    title: trimWorkspaceText(direction.title) || trimWorkspaceText(direction.direction) || "Direction",
    mode: "DIRECTION",
    updatedAt:
      toWorkspaceTimestamp(linkedPlan?.updatedAt) ||
      toWorkspaceTimestamp(direction.updatedAt) ||
      toWorkspaceTimestamp(createdAt) ||
      Date.now(),
    messages,
    linkedDirection: direction,
    linkedPlan
  });
}

function buildWorkspacePlanHistoryItem(plan: WorkspacePlanRecord) {
  const createdAt = trimWorkspaceText(plan.createdAt) || trimWorkspaceText(plan.updatedAt);
  return buildWorkspaceHistoryItem({
    id: `plan:${plan.id}`,
    title: trimWorkspaceText(plan.title) || trimWorkspaceText(plan.direction) || "Execution plan",
    mode: "DIRECTION",
    updatedAt:
      toWorkspaceTimestamp(plan.updatedAt) || toWorkspaceTimestamp(createdAt) || Date.now(),
    messages: [
      {
        id: `plan-context-${plan.id}`,
        role: "system",
        content: trimWorkspaceText(plan.summary) || "Execution plan loaded.",
        createdAt: createdAt || new Date().toISOString(),
        authorName: "Co-Founder Manager",
        authorRole: "Direction lead"
      }
    ],
    linkedDirection: null,
    linkedPlan: plan
  });
}

function mergeControlThreadHistories(
  preferred: ControlThreadHistoryItem[],
  fallback: ControlThreadHistoryItem[]
) {
  const merged = new Map<string, ControlThreadHistoryItem>();

  for (const item of [...preferred, ...fallback]) {
    if (!merged.has(item.id)) {
      merged.set(item.id, item);
    }
  }

  return [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

function buildWorkspaceStringHistory(input: {
  strings: ChatString[];
  directions: WorkspaceDirectionRecord[];
  plans: WorkspacePlanRecord[];
}) {
  const directionById = new Map(input.directions.map((item) => [item.id, item] as const));
  const planById = new Map(input.plans.map((item) => [item.id, item] as const));
  const latestPlanByDirection = new Map<string, WorkspacePlanRecord>();

  for (const plan of input.plans) {
    const directionId = trimWorkspaceText(plan.directionId);
    if (!directionId) {
      continue;
    }
    const existing = latestPlanByDirection.get(directionId);
    if (!existing || toWorkspaceTimestamp(plan.updatedAt) > toWorkspaceTimestamp(existing.updatedAt)) {
      latestPlanByDirection.set(directionId, plan);
    }
  }

  const knownDirectionIds = new Set(
    input.strings
      .map((item) => trimWorkspaceText(item.directionId))
      .filter((value): value is string => Boolean(value))
  );
  const knownPlanIds = new Set(
    input.strings
      .map((item) => trimWorkspaceText(item.planId))
      .filter((value): value is string => Boolean(value))
  );

  const stringItems = input.strings.map((chat) => {
    const linkedDirection = trimWorkspaceText(chat.directionId)
      ? directionById.get(trimWorkspaceText(chat.directionId)) ?? null
      : null;
    const linkedPlan = trimWorkspaceText(chat.planId)
      ? planById.get(trimWorkspaceText(chat.planId)) ?? null
      : linkedDirection
        ? latestPlanByDirection.get(linkedDirection.id) ?? null
        : null;

    return buildWorkspaceHistoryItem({
      id: chat.id,
      title: chat.title,
      mode: mapStringModeToControlMode(chat.mode),
      updatedAt:
        toWorkspaceTimestamp(chat.updatedAt) ||
        toWorkspaceTimestamp(chat.createdAt) ||
        Date.now(),
      messages: Array.isArray(chat.messages) ? chat.messages : [],
      linkedDirection,
      linkedPlan
    });
  });

  const directionItems = input.directions
    .filter((direction) => !knownDirectionIds.has(direction.id))
    .map((direction) =>
      buildWorkspaceDirectionHistoryItem(
        direction,
        latestPlanByDirection.get(direction.id) ?? null
      )
    );

  const orphanPlanItems = input.plans
    .filter((plan) => !trimWorkspaceText(plan.directionId) && !knownPlanIds.has(plan.id))
    .map((plan) => buildWorkspacePlanHistoryItem(plan));

  return mergeControlThreadHistories([...stringItems, ...directionItems, ...orphanPlanItems], []);
}

function buildWorkspaceLoadError(
  status: number,
  fallback: string,
  payloadMessage?: string,
  rawText?: string
) {
  if (trimWorkspaceText(payloadMessage)) {
    return payloadMessage as string;
  }
  if (trimWorkspaceText(rawText)) {
    return `${fallback} (${status}): ${rawText?.slice(0, 180)}`;
  }
  return `${fallback} (${status}).`;
}

function mapControlModeToStringMode(mode: ControlMode): StringMode {
  return mode === "DIRECTION" ? "direction" : "discussion";
}

function parsePersistedSteerDecisions(
  value: unknown
): Record<string, SteerLaneTab> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const parsed = value as Record<string, unknown>;
  const next: Record<string, SteerLaneTab> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (
      key.trim().length > 0 &&
      (entry === "CENTER" || entry === "APPROVED" || entry === "RETHINK")
    ) {
      next[key] = entry;
    }
  }
  return next;
}

function parsePersistedScoreRecords(value: unknown): StringScoreRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const id = trimWorkspaceText(typeof record.id === "string" ? record.id : "");
      const metric = trimWorkspaceText(typeof record.metric === "string" ? record.metric : "");
      const score =
        typeof record.score === "number" && Number.isFinite(record.score)
          ? record.score
          : null;
      const maxScore =
        typeof record.maxScore === "number" && Number.isFinite(record.maxScore)
          ? record.maxScore
          : null;
      const createdAt =
        typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
          ? record.createdAt
          : null;
      const scoredByType =
        record.scoredByType === "AI" ||
        record.scoredByType === "HUMAN" ||
        record.scoredByType === "SYSTEM"
          ? record.scoredByType
          : null;

      if (!id || !metric || score === null || maxScore === null || createdAt === null || !scoredByType) {
        return null;
      }

      return {
        id,
        metric,
        score,
        maxScore,
        scoredByType,
        scoredBy:
          trimWorkspaceText(typeof record.scoredBy === "string" ? record.scoredBy : "") ||
          "System",
        note: trimWorkspaceText(typeof record.note === "string" ? record.note : ""),
        createdAt
      } satisfies StringScoreRecord;
    })
    .filter((item): item is StringScoreRecord => Boolean(item));
}

function extractWorkspaceStateFromStrings(strings: ChatString[]) {
  const drafts: Record<string, EditableStringDraft> = {};
  const scores: Record<string, StringScoreRecord[]> = {};
  const steer: Record<string, SteerLaneTab> = {};

  for (const string of strings) {
    const state = string.workspaceState;
    if (!state || typeof state !== "object") {
      continue;
    }

    if (state.editableDraft && typeof state.editableDraft === "object" && !Array.isArray(state.editableDraft)) {
      drafts[string.id] = normalizeEditableStringDraft(state.editableDraft);
    }

    const scoreRecords = parsePersistedScoreRecords(state.scoreRecords);
    if (scoreRecords.length > 0) {
      scores[string.id] = scoreRecords;
    }

    Object.assign(steer, parsePersistedSteerDecisions(state.steerDecisions));
  }

  return { drafts, scores, steer };
}

function buildWorkspaceChatMessagesFromTurns(
  item: ControlThreadHistoryItem
): ChatMessage[] {
  const fallbackBaseTs = Math.max(1, item.updatedAt - item.turns.length - 1);
  return item.turns.map((turn, index) => {
    const timestamp = inferTurnTimestamp(turn, index, fallbackBaseTs);
    const isTimelineEvent = isTimelineEventMeta(turn.meta);
    return {
      id: turn.id,
      role: turn.role === "owner" ? "user" : isTimelineEvent ? "system" : "assistant",
      content: turn.content,
      createdAt: new Date(timestamp).toISOString(),
      ...(turn.role === "organization"
        ? {
            authorName: isTimelineEvent ? "System" : turn.modelLabel || "Organization",
            authorRole: isTimelineEvent ? "Timeline Update" : "Organization"
          }
        : {
            authorName: "Owner",
            authorRole: "Owner"
          }),
      ...(turn.meta ? { meta: turn.meta } : {})
    } satisfies ChatMessage;
  });
}

function buildPersistableWorkspaceState(input: {
  stringItem: ControlThreadHistoryItem;
  draftsByString: Record<string, EditableStringDraft>;
  scoreByString: Record<string, StringScoreRecord[]>;
  steerDecisions: Record<string, SteerLaneTab>;
}): ChatString["workspaceState"] | undefined {
  const draft = input.draftsByString[input.stringItem.id];
  const normalizedDraft = draft ? normalizeEditableStringDraft(draft) : undefined;
  const scoreRecords = input.scoreByString[input.stringItem.id] ?? [];
  const cards = normalizedDraft
    ? buildDraftDeliverableCards({
        stringItem: input.stringItem,
        draft: normalizedDraft
      })
    : buildThreadDeliverableCards(input.stringItem);
  const scopedSteerDecisions = Object.fromEntries(
    cards
      .map((card) => [card.id, input.steerDecisions[card.id]] as const)
      .filter((entry): entry is [string, SteerLaneTab] => Boolean(entry[1]))
  );

  if (!normalizedDraft && scoreRecords.length === 0 && Object.keys(scopedSteerDecisions).length === 0) {
    return undefined;
  }

  const nextState: NonNullable<ChatString["workspaceState"]> = {};
  if (normalizedDraft) {
    nextState.editableDraft = normalizedDraft as unknown as Record<string, unknown>;
  }
  if (scoreRecords.length > 0) {
    nextState.scoreRecords = scoreRecords as unknown as Array<Record<string, unknown>>;
  }
  if (Object.keys(scopedSteerDecisions).length > 0) {
    nextState.steerDecisions = scopedSteerDecisions;
  }
  return nextState;
}

function buildSharedStringPayloadFromWorkspaceItem(input: {
  orgId: string;
  stringItem: ControlThreadHistoryItem;
  draftsByString: Record<string, EditableStringDraft>;
  scoreByString: Record<string, StringScoreRecord[]>;
  steerDecisions: Record<string, SteerLaneTab>;
  includeMessages?: boolean;
}) {
  const { stringItem } = input;
  const directionId =
    trimWorkspaceText(stringItem.launchScope?.directionId) ||
    trimWorkspaceText(stringItem.planningResult?.directionRecord?.id) ||
    null;
  const planId =
    trimWorkspaceText(stringItem.launchScope?.planId) ||
    trimWorkspaceText(stringItem.planningResult?.planRecord?.id) ||
    null;
  const workspaceState = buildPersistableWorkspaceState(input);
  const payload = {
    orgId: input.orgId,
    id: stringItem.id,
    title: stringItem.title,
    mode: mapControlModeToStringMode(stringItem.mode),
    updatedAt: new Date(stringItem.updatedAt).toISOString(),
    createdAt:
      stringItem.turns.length > 0
        ? new Date(
            inferTurnTimestamp(
              stringItem.turns[0],
              0,
              Math.max(1, stringItem.updatedAt - stringItem.turns.length - 1)
            )
          ).toISOString()
        : new Date(stringItem.updatedAt).toISOString(),
    directionId,
    planId,
    source: (planId ? "plan" : directionId ? "direction" : "workspace") as ChatString["source"],
    ...(workspaceState ? { workspaceState } : {})
  };

  if (!input.includeMessages) {
    return payload;
  }

  return {
    ...payload,
    messages: buildWorkspaceChatMessagesFromTurns(stringItem)
  };
}

function hasPersistableThreadContent(item: ControlThreadHistoryItem) {
  return (
    item.turns.length > 0 ||
    trimWorkspaceText(item.directionGiven).length > 0 ||
    Boolean(item.planningResult) ||
    Boolean(item.pendingPlanLaunchApproval) ||
    Boolean(item.pendingToolkitApproval) ||
    Boolean(item.pendingEmailApproval) ||
    Boolean(item.agentRunResult)
  );
}

function normalizeOperationTabId(
  value: string | null | undefined,
  primaryTab: PrimaryWorkspaceTabId
): OperationTabId {
  if (value && OPERATION_TAB_SET.has(value)) {
    return value as OperationTabId;
  }

  const fallback = DEFAULT_PRIMARY_TAB_SUBTAB[primaryTab];
  return OPERATION_TAB_SET.has(fallback) ? (fallback as OperationTabId) : "plan";
}

export function VorldXShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, signOutCurrentUser } = useFirebaseAuth();
  const orgs = useVorldXStore((state) => state.orgs);
  const setOrgs = useVorldXStore((state) => state.setOrgs);
  const addOrg = useVorldXStore((state) => state.addOrg);
  const currentOrg = useVorldXStore((state) => state.currentOrg);
  const setCurrentOrg = useVorldXStore((state) => state.setCurrentOrg);
  const earthRole = useVorldXStore((state) => state.earthRole);
  const earthControlLevel = useVorldXStore((state) => state.earthControlLevel);
  const earthMode = useVorldXStore((state) => state.earthMode);
  const earthApprovalMode = useVorldXStore((state) => state.earthApprovalMode);
  const setEarthControlLevel = useVorldXStore((state) => state.setEarthControlLevel);
  const setEarthMode = useVorldXStore((state) => state.setEarthMode);
  const setEarthApprovalMode = useVorldXStore((state) => state.setEarthApprovalMode);
  const theme = useVorldXStore((state) => state.theme);
  const isGhostModeActive = useVorldXStore((state) => state.isGhostModeActive);
  const toggleGhostMode = useVorldXStore((state) => state.toggleGhostMode);
  const activeUsers = useVorldXStore((state) => state.activeUsers);
  const setStoreActiveUsers = useVorldXStore((state) => state.setActiveUsers);
  const pushNotification = useVorldXStore((state) => state.pushNotification);

  const [activeTab, setActiveTab] = useState<NavItemId>("control");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("COMPASS");
  const [operationsTab, setOperationsTab] = useState<OperationTabId>("plan");
  const [primaryWorkspaceTab, setPrimaryWorkspaceTab] =
    useState<PrimaryWorkspaceTabId>("FOCUS");
  const [flowCalendarSelectedDate, setFlowCalendarSelectedDate] = useState<string | null>(null);
  const [flowSelectedStringId, setFlowSelectedStringId] = useState<string | null>(null);
  const [flowStringsTab, setFlowStringsTab] = useState<FlowStringsSurfaceTab>("DETAILS");
  const [flowExecutionTab, setFlowExecutionTab] = useState<FlowExecutionSurfaceTab>("DETAILS");
  const [steerTab, setSteerTab] = useState<SteerLaneTab>("CENTER");
  const [steerDecisions, setSteerDecisions] = useState<Record<string, SteerLaneTab>>({});
  const [editableDraftsByString, setEditableDraftsByString] = useState<
    Record<string, EditableStringDraft>
  >({});
  const [scoreByString, setScoreByString] = useState<Record<string, StringScoreRecord[]>>({});
  const [primaryTabLastSubtab, setPrimaryTabLastSubtab] = useState<
    Record<PrimaryWorkspaceTabId, NavItemId>
  >(DEFAULT_PRIMARY_TAB_SUBTAB);
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);
  const [showUtilityMenu, setShowUtilityMenu] = useState(false);
  const [showCompassStringPanel, setShowCompassStringPanel] = useState(false);
  const [showCompassCollaborationPanel, setShowCompassCollaborationPanel] = useState(false);
  const [squadLaunchIntent, setSquadLaunchIntent] = useState<{
    action: "ADD_MEMBER" | "CREATE_TEAM";
    nonce: number;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [intent, setIntent] = useState("");
  const [directionPrompt, setDirectionPrompt] = useState("");
  const [directionTurns, setDirectionTurns] = useState<DirectionTurn[]>([]);
  const [directionModelId, setDirectionModelId] =
    useState<(typeof DIRECTION_MODELS)[number]["id"]>("gemini:gemini-2.5-flash");
  const [directionChatInFlight, setDirectionChatInFlight] = useState(false);
  const swarmDensity = 24;
  const [setupPanel, setSetupPanel] = useState<SetupPanel>("closed");
  const [joinOrgIdentifier, setJoinOrgIdentifier] = useState("");
  const [joinRequestRole, setJoinRequestRole] = useState<"EMPLOYEE" | "ADMIN">("EMPLOYEE");
  const [joinRequestMessage, setJoinRequestMessage] = useState("");
  const [joinRequestInFlight, setJoinRequestInFlight] = useState(false);
  const [joinRequestError, setJoinRequestError] = useState<string | null>(null);
  const [userJoinRequests, setUserJoinRequests] = useState<UserJoinRequest[]>([]);
  const [loadingUserJoinRequests, setLoadingUserJoinRequests] = useState(false);
  const [orgBootstrapStatus, setOrgBootstrapStatus] =
    useState<"loading" | "ready" | "failed">("loading");
  const [orgBootstrapError, setOrgBootstrapError] = useState<string | null>(null);
  const [orgBootstrapAttempt, setOrgBootstrapAttempt] = useState(0);
  const [controlMode, setControlMode] = useState<ControlMode>("MINDSTORM");
  const [controlConversationDetail, setControlConversationDetail] =
    useState<ControlConversationDetail>("REASONING_MIN");
  const [controlEngaged, setControlEngaged] = useState(false);
  const [controlThreadHistory, setControlThreadHistory] = useState<ControlThreadHistoryItem[]>([]);
  const [backendStringHistory, setBackendStringHistory] = useState<ControlThreadHistoryItem[]>([]);
  const [workspaceStateHydrated, setWorkspaceStateHydrated] = useState(false);
  const [activeControlThreadId, setActiveControlThreadId] = useState<string | null>(null);
  const [controlHistoryHydrated, setControlHistoryHydrated] = useState(false);
  const [humanPlanDraft, setHumanPlanDraft] = useState("");
  const [directionPlanningInFlight, setDirectionPlanningInFlight] = useState(false);
  const [directionPlanningResult, setDirectionPlanningResult] =
    useState<DirectionPlanningResult | null>(null);
  const [showRequestCenter, setShowRequestCenter] = useState(false);
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequestItem[]>([]);
  const [permissionRequestsLoading, setPermissionRequestsLoading] = useState(false);
  const [permissionRequestActionId, setPermissionRequestActionId] = useState<string | null>(null);
  const [approvalCheckpoints, setApprovalCheckpoints] = useState<ApprovalCheckpointItem[]>([]);
  const [approvalCheckpointsLoading, setApprovalCheckpointsLoading] = useState(false);
  const [approvalCheckpointActionId, setApprovalCheckpointActionId] = useState<string | null>(null);
  const [clearPermissionRequestsInFlight, setClearPermissionRequestsInFlight] = useState(false);
  const [showClearPermissionRequestsConfirm, setShowClearPermissionRequestsConfirm] = useState(false);
  const [canReviewPermissionRequests, setCanReviewPermissionRequests] = useState(false);
  const [controlScopedFlowIds, setControlScopedFlowIds] = useState<string[]>([]);
  const [signatureApprovals, setSignatureApprovals] = useState(1);
  const [isRecordingIntent, setIsRecordingIntent] = useState(false);
  const [launchInFlight, setLaunchInFlight] = useState(false);
  const [signOutInFlight, setSignOutInFlight] = useState(false);
  const [pendingChatPlanRoute, setPendingChatPlanRoute] = useState<PendingChatPlanRoute | null>(
    null
  );
  const [pendingPlanLaunchApproval, setPendingPlanLaunchApproval] =
    useState<PendingPlanLaunchApproval | null>(null);
  const [pendingEmailApproval, setPendingEmailApproval] = useState<PendingEmailApproval | null>(
    null
  );
  const [pendingToolkitApproval, setPendingToolkitApproval] = useState<PendingToolkitApproval | null>(
    null
  );
  const [approvedToolkitRequestId, setApprovedToolkitRequestId] = useState<string | null>(null);
  const [toolkitConnectInFlight, setToolkitConnectInFlight] = useState(false);
  const [pipelinePolicy, setPipelinePolicy] = useState<OrchestrationPipelineEffectivePolicy | null>(
    null
  );
  const [controlMessage, setControlMessage] = useState<ControlMessage | null>(null);
  const [agentRunResult, setAgentRunResult] = useState<AgentRunResponse | null>(null);
  const [agentRunId, setAgentRunId] = useState("");
  const [agentRunInputValues, setAgentRunInputValues] = useState<Record<string, string>>({});
  const [agentRunPromptSnapshot, setAgentRunPromptSnapshot] = useState("");
  const [agentRunInputSourceUrl, setAgentRunInputSourceUrl] = useState("");
  const [agentRunInputFile, setAgentRunInputFile] = useState<File | null>(null);
  const [agentRunInputSubmitting, setAgentRunInputSubmitting] = useState(false);
  const [pendingHumanInput, setPendingHumanInput] = useState<HumanInputRequest | null>(null);
  const [humanInputMessage, setHumanInputMessage] = useState("");
  const [humanInputSourceUrl, setHumanInputSourceUrl] = useState("");
  const [humanInputFile, setHumanInputFile] = useState<File | null>(null);
  const [humanInputOverridePrompt, setHumanInputOverridePrompt] = useState("");
  const [humanInputSubmitting, setHumanInputSubmitting] = useState(false);
  const [pendingAutoLaunchPrompt, setPendingAutoLaunchPrompt] = useState<string | null>(null);
  const permissionRequestsFetchSeqRef = useRef(0);
  const permissionRequestsInFlightRef = useRef(false);
  const approvalCheckpointsFetchSeqRef = useRef(0);
  const approvalCheckpointsInFlightRef = useRef(false);
  const pipelinePolicyInFlightRef = useRef(false);
  const backendStringHistorySeqRef = useRef(0);
  const workspacePersistSnapshotRef = useRef<Record<string, string>>({});
  const pendingPlanRouteHandledKeyRef = useRef<string | null>(null);
  const requestedTabHandledRef = useRef<string | null>(null);
  const workflowSnapshotTimersRef = useRef<Map<string, number>>(new Map());
  const workflowEventThrottleRef = useRef<Map<string, number>>(new Map());
  const [realtimeSessionId] = useState(
    () => `shell-${Math.random().toString(36).slice(2, 10)}`
  );
  const authHeaders = useMemo(
    () =>
      user
        ? {
            "x-user-id": user.uid,
            "x-user-email": user.email
          }
        : null,
    [user]
  );
  const humanInputSummary = useMemo(
    () => summarizeHumanInputReason(pendingHumanInput?.reason),
    [pendingHumanInput?.reason]
  );
  const earthOrg = useMemo(() => buildEarthOrgContext(earthRole), [earthRole]);
  const switchableOrgs = useMemo(
    () => [earthOrg, ...orgs.filter((item) => item.id !== EARTH_ORG_ID)],
    [earthOrg, orgs]
  );
  const selectedOrg = useMemo(() => {
    if (currentOrg && isEarthOrgContext(currentOrg)) {
      return earthOrg;
    }
    if (currentOrg && orgs.some((item) => item.id === currentOrg.id)) {
      return currentOrg;
    }
    return orgs[0] ?? earthOrg;
  }, [currentOrg, earthOrg, orgs]);
  const resolvedOrg = isEarthOrgContext(selectedOrg) ? null : selectedOrg;
  const hasOrganization = orgs.length > 0;
  const activeOrgId = resolvedOrg?.id ?? "";
  const currentOrgId = currentOrg?.id ?? null;
  const currentOrgIsEarth = isEarthOrgContext(currentOrg);
  const isEarthWorkspaceActive = isEarthOrgContext(selectedOrg);
  const canManageOrgRuntime =
    selectedOrg.role === "Founder" || selectedOrg.role === "Admin";
  const workspaceStringHistory = useMemo(
    () => mergeControlThreadHistories(backendStringHistory, controlThreadHistory),
    [backendStringHistory, controlThreadHistory]
  );

  useEffect(() => {
    if (!controlMessage || controlMessage.tone === "error") {
      return;
    }
    const timeout = window.setTimeout(() => {
      setControlMessage((current) => {
        if (!current) {
          return null;
        }
        if (current.text !== controlMessage.text || current.tone !== controlMessage.tone) {
          return current;
        }
        return null;
      });
    }, 9000);
    return () => window.clearTimeout(timeout);
  }, [controlMessage]);

  const appendStructuredOrganizationTurn = useCallback((input: {
    content: string;
    meta: AssistantMessageMeta;
    modelLabel?: string;
  }) => {
    setDirectionTurns((prev) => [
      ...prev,
      {
        id: makeDirectionTurnId("org"),
        role: "organization",
        content: input.content,
        ...(input.modelLabel ? { modelLabel: input.modelLabel } : {}),
        meta: input.meta
      }
    ]);
  }, []);

  const appendThreadEventTurn = useCallback((input: {
    content: string;
    title: string;
    message: string;
    eventName: string;
    scope: "MODE" | "MEMBERSHIP" | "PLANNING" | "EXECUTION" | "COLLABORATION";
    status?: string;
  }) => {
    appendStructuredOrganizationTurn({
      content: input.content,
      meta: buildThreadEventMeta({
        title: input.title,
        message: input.message,
        eventName: input.eventName,
        scope: input.scope,
        ...(input.status ? { status: input.status } : {}),
        timestamp: Date.now()
      })
    });
  }, [appendStructuredOrganizationTurn]);

  const shouldEmitWorkflowEvent = useCallback((key: string, minIntervalMs = 1200) => {
    const now = Date.now();
    const last = workflowEventThrottleRef.current.get(key) ?? 0;
    if (now - last < minIntervalMs) {
      return false;
    }
    workflowEventThrottleRef.current.set(key, now);
    return true;
  }, []);

  const appendWorkflowSnapshotTurn = useCallback(
    async (flowId: string, titleOverride?: string) => {
      if (!flowId) {
        return;
      }

      try {
        const response = await fetch(`/api/flows/${encodeURIComponent(flowId)}`, {
          cache: "no-store",
          credentials: "include"
        });
        const { payload } = await parseJsonBody<{
          ok?: boolean;
          flow?: {
            id: string;
            prompt?: string;
            status?: string;
            progress?: number;
            updatedAt?: string;
            tasks?: Array<{
              id: string;
              prompt: string;
              status: string;
              agent?: { name: string; role: string } | null;
              executionTrace?: unknown;
            }>;
          };
        }>(response);

        if (!response.ok || !payload?.ok || !payload.flow?.id) {
          return;
        }

        const flow = payload.flow;
        const tasks = Array.isArray(flow.tasks) ? flow.tasks : [];
        const completedCount = tasks.filter(
          (task) => normalizeWorkflowTaskStatus(task.status) === "COMPLETED"
        ).length;

        appendStructuredOrganizationTurn({
          content: `Workflow ${flow.id.slice(0, 8)} update: ${String(flow.status || "unknown").toLowerCase()} (${completedCount}/${tasks.length} tasks completed).`,
          meta: {
            kind: "workflow_graph",
            title: titleOverride || compactTaskTitle(flow.prompt || "Workflow Runtime", "Workflow Runtime"),
            flowId: flow.id,
            status: flow.status || "UNKNOWN",
            progress:
              typeof flow.progress === "number" && Number.isFinite(flow.progress)
                ? Math.max(0, Math.min(100, Math.floor(flow.progress)))
                : undefined,
            updatedAt:
              typeof flow.updatedAt === "string" && flow.updatedAt.trim().length > 0
                ? flow.updatedAt
                : undefined,
            taskCount: tasks.length,
            completedCount,
            tasks: tasks.slice(0, 16).map((task, index) => ({
              id: task.id || `${flow.id}-task-${index + 1}`,
              title: compactTaskTitle(task.prompt || "", `Task ${index + 1}`),
              status: normalizeWorkflowTaskStatus(task.status),
              agentLabel: workflowAgentLabelFromTaskTrace({
                agent: task.agent ?? null,
                executionTrace: task.executionTrace
              })
            }))
          }
        });
      } catch {
        // Snapshot rendering is best-effort and should never block core workflow operations.
      }
    },
    [appendStructuredOrganizationTurn]
  );

  const queueWorkflowSnapshotTurn = useCallback(
    (flowId: string, titleOverride?: string) => {
      if (typeof window === "undefined" || !flowId) {
        return;
      }

      const existingTimer = workflowSnapshotTimersRef.current.get(flowId);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }

      const timer = window.setTimeout(() => {
        workflowSnapshotTimersRef.current.delete(flowId);
        void appendWorkflowSnapshotTurn(flowId, titleOverride);
      }, 420);

      workflowSnapshotTimersRef.current.set(flowId, timer);
    },
    [appendWorkflowSnapshotTurn]
  );

  useEffect(() => {
    const snapshotTimers = workflowSnapshotTimersRef;
    return () => {
      if (typeof window === "undefined") {
        return;
      }
      for (const timer of snapshotTimers.current.values()) {
        window.clearTimeout(timer);
      }
      snapshotTimers.current.clear();
    };
  }, []);

  const closeSearch = () => {
    setTimeout(() => setSearchOpen(false), 120);
  };

  const promptForHumanInput = useCallback((request: HumanInputRequest) => {
    const reason = normalizeHumanInputReason(request.reason) || "Human input required by agent.";
    setPendingHumanInput((current) => {
      if (current?.taskId === request.taskId) {
        return current;
      }
      return {
        taskId: request.taskId,
        flowId: request.flowId,
        reason
      };
    });
    setControlMessage({
      tone: "warning",
      text: `Task ${request.taskId.slice(0, 8)} paused for human input.`
    });
  }, []);

  const syncOperationSubtab = useCallback((tab: OperationTabId) => {
    setOperationsTab(tab);
  }, []);

  const handleTabChange = useCallback(
    (tab: NavItemId) => {
      const primaryTab = getPrimaryWorkspaceTabForNavItem(tab);
      setActiveTab(tab);
      setPrimaryWorkspaceTab(primaryTab);
      if (OPERATION_TAB_SET.has(tab)) {
        setPrimaryTabLastSubtab((previous) =>
          previous[primaryTab] === tab ? previous : { ...previous, [primaryTab]: tab }
        );
      }

      if (tab === "control") {
        setWorkspaceMode("COMPASS");
        return;
      }

      if (tab === "squad") {
        setWorkspaceMode("COMPASS");
        return;
      }

      if (tab === "hub") {
        setWorkspaceMode("HUB");
        return;
      }

      if (tab === "settings") {
        setWorkspaceMode("COMPASS");
        return;
      }

      if (OPERATION_TAB_SET.has(tab)) {
        syncOperationSubtab(tab as OperationTabId);
        setWorkspaceMode("FLOW");
        return;
      }
    },
    [syncOperationSubtab]
  );

  const handleOperationTabChange = useCallback(
    (tab: OperationTabId) => {
      handleTabChange(tab);
    },
    [handleTabChange]
  );

  const handleSignOut = useCallback(async () => {
    setSignOutInFlight(true);
    try {
      await signOutCurrentUser();
    } finally {
      setSignOutInFlight(false);
      router.replace("/");
    }
  }, [router, signOutCurrentUser]);

  const openAddOrganization = useCallback(() => {
    setShowOrgSwitcher(false);
    setSetupPanel("onboarding");
  }, []);

  const loadUserJoinRequests = useCallback(async () => {
    setLoadingUserJoinRequests(true);
    try {
      const response = await fetch("/api/squad/join-requests", {
        cache: "no-store"
      });
      const { payload, rawText } = await parseJsonBody<{
        ok?: boolean;
        message?: string;
        requests?: UserJoinRequest[];
      }>(response);

      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed loading join requests (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed loading join requests.")
        );
      }

      setJoinRequestError(null);
      setUserJoinRequests(payload?.requests ?? []);
    } catch (error) {
      setJoinRequestError(
        error instanceof Error ? error.message : "Failed loading join requests."
      );
    } finally {
      setLoadingUserJoinRequests(false);
    }
  }, []);

  const openSetupChooser = useCallback(() => {
    setJoinRequestError(null);
    setSetupPanel("chooser");
    void loadUserJoinRequests();
  }, [loadUserJoinRequests]);

  const loadPermissionRequests = useCallback(
    async (options?: { silent?: boolean; force?: boolean }) => {
      if (!options?.force && permissionRequestsInFlightRef.current) {
        return;
      }

      permissionRequestsInFlightRef.current = true;

      const fetchSeq = ++permissionRequestsFetchSeqRef.current;
      const orgId = activeOrgId;
      if (!orgId) {
        if (fetchSeq === permissionRequestsFetchSeqRef.current) {
          setPermissionRequests([]);
          setCanReviewPermissionRequests(false);
          setPermissionRequestsLoading(false);
        }
        permissionRequestsInFlightRef.current = false;
        return;
      }

      if (!options?.silent) {
        setPermissionRequestsLoading(true);
      }
      try {
        const response = await fetch(
          `/api/requests?orgId=${encodeURIComponent(orgId)}`,
          {
            cache: "no-store"
          }
        );
        const { payload, rawText } = await parseJsonBody<{
          ok?: boolean;
          message?: string;
          canReview?: boolean;
          requests?: PermissionRequestItem[];
        }>(response);

        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed loading permission requests (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed loading permission requests.")
          );
        }

        if (fetchSeq !== permissionRequestsFetchSeqRef.current) {
          return;
        }
        setPermissionRequests(payload?.requests ?? []);
        setCanReviewPermissionRequests(Boolean(payload?.canReview));
      } catch (error) {
        if (fetchSeq !== permissionRequestsFetchSeqRef.current) {
          return;
        }
        if (!options?.silent) {
          setControlMessage({
            tone: "error",
            text:
              error instanceof Error ? error.message : "Failed loading permission requests."
          });
        }
      } finally {
        if (fetchSeq === permissionRequestsFetchSeqRef.current && !options?.silent) {
          setPermissionRequestsLoading(false);
        }
        permissionRequestsInFlightRef.current = false;
      }
    },
    [activeOrgId]
  );

  const loadApprovalCheckpoints = useCallback(
    async (options?: { silent?: boolean; force?: boolean }) => {
      if (!options?.force && approvalCheckpointsInFlightRef.current) {
        return;
      }
      approvalCheckpointsInFlightRef.current = true;

      const fetchSeq = ++approvalCheckpointsFetchSeqRef.current;
      const orgId = activeOrgId;
      if (!orgId) {
        if (fetchSeq === approvalCheckpointsFetchSeqRef.current) {
          setApprovalCheckpoints([]);
          setApprovalCheckpointsLoading(false);
        }
        approvalCheckpointsInFlightRef.current = false;
        return;
      }

      if (!options?.silent) {
        setApprovalCheckpointsLoading(true);
      }

      try {
        const response = await fetch(
          `/api/approvals/checkpoints?orgId=${encodeURIComponent(orgId)}&limit=180`,
          {
            cache: "no-store"
          }
        );
        const { payload, rawText } = await parseJsonBody<{
          ok?: boolean;
          message?: string;
          checkpoints?: ApprovalCheckpointItem[];
        }>(response);

        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed loading approval checkpoints (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed loading approval checkpoints.")
          );
        }

        if (fetchSeq !== approvalCheckpointsFetchSeqRef.current) {
          return;
        }

        setApprovalCheckpoints(payload.checkpoints ?? []);
      } catch (error) {
        if (fetchSeq !== approvalCheckpointsFetchSeqRef.current) {
          return;
        }
        if (!options?.silent) {
          setControlMessage({
            tone: "error",
            text:
              error instanceof Error ? error.message : "Failed loading approval checkpoints."
          });
        }
      } finally {
        if (fetchSeq === approvalCheckpointsFetchSeqRef.current && !options?.silent) {
          setApprovalCheckpointsLoading(false);
        }
        approvalCheckpointsInFlightRef.current = false;
      }
    },
    [activeOrgId]
  );

  const loadPipelinePolicy = useCallback(
    async (options?: { force?: boolean }) => {
      const orgId = activeOrgId;
      if (!orgId) {
        setPipelinePolicy(null);
        return;
      }

      if (!options?.force && pipelinePolicyInFlightRef.current) {
        return;
      }
      pipelinePolicyInFlightRef.current = true;

      try {
        const response = await fetch(
          `/api/settings/orchestration-rules?orgId=${encodeURIComponent(orgId)}`,
          {
            cache: "no-store"
          }
        );
        const { payload } = await parseJsonBody<{
          ok?: boolean;
          effectivePolicy?: OrchestrationPipelineEffectivePolicy;
        }>(response);
        if (!response.ok || !payload?.ok) {
          return;
        }
        setPipelinePolicy(payload.effectivePolicy ?? null);
      } catch {
        // Best effort only; launch API still enforces policy server-side.
      } finally {
        pipelinePolicyInFlightRef.current = false;
      }
    },
    [activeOrgId]
  );

  const handleSubmitJoinRequest = useCallback(async () => {
    const identifier = joinOrgIdentifier.trim();
    if (!identifier) {
      setJoinRequestError("Enter organization id or name.");
      return;
    }

    setJoinRequestInFlight(true);
    try {
      const response = await fetch("/api/squad/join-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          organizationIdentifier: identifier,
          requestedRole: joinRequestRole,
          message: joinRequestMessage.trim()
        })
      });

      const { payload, rawText } = await parseJsonBody<{
        ok?: boolean;
        message?: string;
      }>(response);

      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed to submit request (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed to submit request.")
        );
      }

      setJoinRequestError(null);
      setJoinOrgIdentifier("");
      setJoinRequestMessage("");
      setSetupPanel("chooser");
      await loadUserJoinRequests();
    } catch (error) {
      setJoinRequestError(
        error instanceof Error ? error.message : "Failed to submit request."
      );
    } finally {
      setJoinRequestInFlight(false);
    }
  }, [
    joinOrgIdentifier,
    joinRequestMessage,
    joinRequestRole,
    loadUserJoinRequests
  ]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user?.uid || !user.email) {
      setOrgs([]);
      setCurrentOrg(null);
      setOrgBootstrapError(null);
      setOrgBootstrapStatus("ready");
      return;
    }

    let cancelled = false;
    setOrgBootstrapError(null);
    setOrgBootstrapStatus("loading");

    const bootstrapOrgs = async () => {
      try {
        const response = await fetch("/api/orgs", {
          cache: "no-store",
          credentials: "include"
        });
        const { payload, rawText } = await parseJsonBody<OrgListResponse>(response);

        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Unable to load organizations (${response.status}): ${rawText.slice(0, 180)}`
                : `Unable to load organizations (${response.status}).`)
          );
        }

        if (cancelled) {
          return;
        }

        const serverOrgs = payload.orgs ?? [];
        setOrgs(serverOrgs);

        if (serverOrgs.length === 0) {
          setCurrentOrg(null);
          setOrgBootstrapStatus("ready");
          return;
        }

        const preferredOrg = currentOrgIsEarth
          ? earthOrg
          : serverOrgs.find((item) => item.id === currentOrgId) ??
            serverOrgs.find((item) => item.id === payload.activeOrgId) ??
            serverOrgs[0];
        setCurrentOrg(preferredOrg ?? null);
        setOrgBootstrapStatus("ready");
      } catch (error) {
        // Keep persisted store data when org bootstrap fails.
        if (cancelled) {
          return;
        }
        setOrgBootstrapError(
          error instanceof Error ? error.message : "Unable to load organizations."
        );
        setOrgBootstrapStatus("failed");
      }
    };

    void bootstrapOrgs();
    void loadUserJoinRequests();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    earthOrg,
    loadUserJoinRequests,
    setCurrentOrg,
    setOrgs,
    currentOrgId,
    currentOrgIsEarth,
    user?.email,
    user?.uid,
    orgBootstrapAttempt
  ]);

  useEffect(() => {
    document.documentElement.dataset.ghost = isGhostModeActive ? "true" : "false";
  }, [isGhostModeActive]);

  const themeStyle = THEME_STYLES[theme];
  const requestedSettingsLane = searchParams.get("settingsLane");
  const requestedHubScope = searchParams.get("hubScope");
  const userDisplayName = useMemo(
    () => formatUserDisplayName(user?.username, user?.email),
    [user?.email, user?.username]
  );
  const activeProfileOrganizationName = selectedOrg.name;
  const activeProfileRole = selectedOrg.role;
  const hubInitialScope =
    requestedHubScope === "ORGANIZATIONAL" ||
    requestedHubScope === "DNA" ||
    requestedHubScope === "STORAGE" ||
    requestedHubScope === "TOOLS"
      ? requestedHubScope
      : requestedHubScope === "DIRECTIONAL" || requestedHubScope === "WORKFLOW"
        ? "DIRECTIONAL"
        : undefined;
  const userHubProfile = useMemo(
    () => ({
      name: userDisplayName,
      email: user?.email ?? "",
      personalOrganizationName: "Earth",
      personalType: earthRole,
      personalControlLevel: earthControlLevel,
      personalMode: earthMode,
      personalApprovalMode: earthApprovalMode,
      workspaceOrganizationName: selectedOrg.name,
      workspaceRole: selectedOrg.role,
      organizationCount: orgs.length,
      isEarthWorkspaceActive: isEarthOrgContext(selectedOrg)
    }),
    [
      earthApprovalMode,
      earthControlLevel,
      earthMode,
      earthRole,
      orgs.length,
      selectedOrg,
      user?.email,
      userDisplayName
    ]
  );
  const personalEarthProfile = useMemo(
    () => ({
      name: userDisplayName,
      email: user?.email ?? "",
      role: earthRole,
      controlLevel: earthControlLevel,
      mode: earthMode,
      approvalMode: earthApprovalMode
    }),
    [earthApprovalMode, earthControlLevel, earthMode, earthRole, user?.email, userDisplayName]
  );

  const handleSelectOrganization = useCallback(
    async (orgId: string) => {
      if (orgId === EARTH_ORG_ID) {
        setCurrentOrg(earthOrg);
        return;
      }

      const nextOrg = orgs.find((item) => item.id === orgId);
      if (!nextOrg) {
        return;
      }

      setCurrentOrg(nextOrg);

      try {
        const response = await fetch("/api/orgs", {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orgId
          })
        });
        const { payload, rawText } = await parseJsonBody<OrgListResponse>(response);

        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Unable to switch organization (${response.status}): ${rawText.slice(0, 180)}`
                : `Unable to switch organization (${response.status}).`)
          );
        }

        const serverOrgs = payload.orgs ?? [];
        if (serverOrgs.length > 0) {
          setOrgs(serverOrgs);
          setCurrentOrg(serverOrgs.find((item) => item.id === orgId) ?? nextOrg);
        }
      } catch (error) {
        setControlMessage({
          tone: "warning",
          text:
            error instanceof Error
              ? error.message
              : "Organization changed locally, but the selection could not be saved."
        });
      }
    },
    [earthOrg, orgs, setControlMessage, setCurrentOrg, setOrgs]
  );

  const ensureOrgAccessReady = useCallback(async () => {
    if (!resolvedOrg?.id) {
      return false;
    }

    const response = await fetch("/api/orgs", {
      cache: "no-store",
      credentials: "include"
    });
    const { payload, rawText } = await parseJsonBody<OrgListResponse>(response);

    if (!response.ok || !payload?.ok) {
      throw new Error(
        payload?.message ??
          (rawText
            ? `Unable to verify organization access (${response.status}): ${rawText.slice(0, 180)}`
            : `Unable to verify organization access (${response.status}).`)
      );
    }

    const serverOrgs = payload.orgs ?? [];
    if (serverOrgs.length === 0) {
      setOrgs([]);
      setCurrentOrg(null);
      setControlMessage({
        tone: "warning",
        text: "No organization access found. Join or create an organization first."
      });
      return false;
    }

    setOrgs(serverOrgs);
    if (serverOrgs.some((item) => item.id === resolvedOrg.id)) {
      return true;
    }

    const fallbackOrg =
      serverOrgs.find((item) => item.id === payload.activeOrgId) ?? serverOrgs[0] ?? null;
    setCurrentOrg(fallbackOrg);
    setControlMessage({
      tone: "warning",
      text: `Switched to ${fallbackOrg?.name ?? "an accessible organization"}. Send direction again.`
    });
    return false;
  }, [resolvedOrg?.id, setCurrentOrg, setOrgs]);

  const loadBackendStringHistory = useCallback(async () => {
    if (!resolvedOrg?.id || !user?.uid) {
      setBackendStringHistory([]);
      setEditableDraftsByString({});
      setScoreByString({});
      setSteerDecisions({});
      setWorkspaceStateHydrated(false);
      workspacePersistSnapshotRef.current = {};
      return;
    }

    const loadId = backendStringHistorySeqRef.current + 1;
    backendStringHistorySeqRef.current = loadId;
    setBackendStringHistory([]);

    try {
      const [stringsResponse, directionsResponse, plansResponse] = await Promise.all([
        fetch(`/api/strings?orgId=${encodeURIComponent(resolvedOrg.id)}`, {
          cache: "no-store",
          credentials: "include"
        }),
        fetch(`/api/directions?orgId=${encodeURIComponent(resolvedOrg.id)}`, {
          cache: "no-store",
          credentials: "include"
        }),
        fetch(`/api/plans?orgId=${encodeURIComponent(resolvedOrg.id)}`, {
          cache: "no-store",
          credentials: "include"
        })
      ]);

      const [
        { payload: stringsPayload, rawText: stringsRaw },
        { payload: directionsPayload, rawText: directionsRaw },
        { payload: plansPayload, rawText: plansRaw }
      ] = await Promise.all([
        parseJsonBody<WorkspaceStringsResponse>(stringsResponse),
        parseJsonBody<WorkspaceDirectionsResponse>(directionsResponse),
        parseJsonBody<WorkspacePlansResponse>(plansResponse)
      ]);

      if (!stringsResponse.ok || !stringsPayload?.ok) {
        throw new Error(
          buildWorkspaceLoadError(
            stringsResponse.status,
            "Failed to load strings",
            stringsPayload?.message,
            stringsRaw
          )
        );
      }

      if (!directionsResponse.ok || !directionsPayload?.ok) {
        throw new Error(
          buildWorkspaceLoadError(
            directionsResponse.status,
            "Failed to load directions",
            directionsPayload?.message,
            directionsRaw
          )
        );
      }

      if (!plansResponse.ok || !plansPayload?.ok) {
        throw new Error(
          buildWorkspaceLoadError(
            plansResponse.status,
            "Failed to load plans",
            plansPayload?.message,
            plansRaw
          )
        );
      }

      if (backendStringHistorySeqRef.current !== loadId) {
        return;
      }

      const backendStrings = Array.isArray(stringsPayload.strings) ? stringsPayload.strings : [];
      const persistedWorkspaceState = extractWorkspaceStateFromStrings(backendStrings);
      setEditableDraftsByString(persistedWorkspaceState.drafts);
      setScoreByString(persistedWorkspaceState.scores);
      setSteerDecisions(persistedWorkspaceState.steer);
      setBackendStringHistory(
        buildWorkspaceStringHistory({
          strings: backendStrings,
          directions: Array.isArray(directionsPayload.directions) ? directionsPayload.directions : [],
          plans: Array.isArray(plansPayload.plans) ? plansPayload.plans : []
        })
      );
      setWorkspaceStateHydrated(true);
      workspacePersistSnapshotRef.current = {};
    } catch (error) {
      if (backendStringHistorySeqRef.current !== loadId) {
        return;
      }
      setWorkspaceStateHydrated(false);
      console.error("[VorldXShell] Failed to sync workspace strings into Flow.", error);
    }
  }, [resolvedOrg?.id, user?.uid]);

  useEffect(() => {
    if (!resolvedOrg?.id) {
      setPermissionRequests([]);
      setCanReviewPermissionRequests(false);
      return;
    }
    void loadPermissionRequests();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      void loadPermissionRequests({ silent: true });
    }, REQUESTS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadPermissionRequests, resolvedOrg?.id]);

  useEffect(() => {
    if (!resolvedOrg?.id) {
      setApprovalCheckpoints([]);
      return;
    }
    void loadApprovalCheckpoints();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      void loadApprovalCheckpoints({ silent: true });
    }, REQUESTS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadApprovalCheckpoints, resolvedOrg?.id]);

  useEffect(() => {
    if (!resolvedOrg?.id) {
      setPipelinePolicy(null);
      return;
    }
    void loadPipelinePolicy();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      void loadPipelinePolicy();
    }, PIPELINE_POLICY_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadPipelinePolicy, resolvedOrg?.id]);

  useEffect(() => {
    if (!resolvedOrg?.id || !user?.uid) {
      setBackendStringHistory([]);
      return;
    }
    void loadBackendStringHistory();
  }, [loadBackendStringHistory, resolvedOrg?.id, user?.uid]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleStringsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ orgId?: string | null }>).detail;
      if (detail?.orgId && resolvedOrg?.id && detail.orgId !== resolvedOrg.id) {
        return;
      }
      void loadBackendStringHistory();
    };

    window.addEventListener(STRINGS_UPDATED_EVENT, handleStringsUpdated);
    return () => {
      window.removeEventListener(STRINGS_UPDATED_EVENT, handleStringsUpdated);
    };
  }, [loadBackendStringHistory, resolvedOrg?.id]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (!requestedTab) {
      requestedTabHandledRef.current = null;
      return;
    }
    if (!NAV_ITEMS.some((item) => item.id === requestedTab)) {
      return;
    }
    if (requestedTabHandledRef.current === requestedTab) {
      return;
    }
    requestedTabHandledRef.current = requestedTab;
    handleTabChange(requestedTab as NavItemId);
  }, [handleTabChange, searchParams]);

  useEffect(() => {
    const composioStatus = searchParams.get("composio");
    if (!composioStatus) {
      return;
    }

    const toolkit = searchParams.get("toolkit")?.trim().toLowerCase();
    const toolkitLabel = toolkit ? normalizeToolkitAlias(toolkit) : "tool";

    if (composioStatus === "connected") {
      setControlMessage({
        tone: "success",
        text: `Toolkit connected: ${toolkitLabel}.`
      });
    } else if (composioStatus === "failed" || composioStatus === "error") {
      setControlMessage({
        tone: "error",
        text: `Toolkit connection failed: ${toolkitLabel}.`
      });
    }

    handleTabChange("control");
    router.replace("/app");
  }, [handleTabChange, router, searchParams]);

  useEffect(() => {
    permissionRequestsFetchSeqRef.current += 1;
    permissionRequestsInFlightRef.current = false;
    approvalCheckpointsFetchSeqRef.current += 1;
    approvalCheckpointsInFlightRef.current = false;
    pipelinePolicyInFlightRef.current = false;
    setDirectionTurns([]);
    setDirectionPrompt("");
    setIntent("");
    setHumanPlanDraft("");
    setDirectionPlanningResult(null);
    setControlEngaged(false);
    setActiveTab("control");
    setControlMode("MINDSTORM");
    setWorkspaceMode("COMPASS");
    setOperationsTab("plan");
    setPrimaryWorkspaceTab("FOCUS");
    setPrimaryTabLastSubtab(DEFAULT_PRIMARY_TAB_SUBTAB);
    setFlowCalendarSelectedDate(null);
    setFlowSelectedStringId(null);
    setFlowStringsTab("DETAILS");
    setFlowExecutionTab("DETAILS");
    setSteerTab("CENTER");
    setSteerDecisions({});
    setEditableDraftsByString({});
    setScoreByString({});
    setWorkspaceStateHydrated(false);
    workspacePersistSnapshotRef.current = {};
    setControlConversationDetail("REASONING_MIN");
    setControlThreadHistory([]);
    setActiveControlThreadId(null);
    setControlHistoryHydrated(false);
    setShowRequestCenter(false);
    setPermissionRequestsLoading(false);
    setPermissionRequestActionId(null);
    setApprovalCheckpoints([]);
    setApprovalCheckpointsLoading(false);
    setApprovalCheckpointActionId(null);
    setClearPermissionRequestsInFlight(false);
    setShowClearPermissionRequestsConfirm(false);
    setControlScopedFlowIds([]);
    setAgentRunResult(null);
    setAgentRunId("");
    setAgentRunInputValues({});
    setAgentRunPromptSnapshot("");
    setPendingHumanInput(null);
    setHumanInputMessage("");
    setHumanInputSourceUrl("");
    setHumanInputFile(null);
    setHumanInputOverridePrompt("");
    setPendingChatPlanRoute(null);
    setPendingPlanLaunchApproval(null);
    setPendingEmailApproval(null);
    setPendingToolkitApproval(null);
    setApprovedToolkitRequestId(null);
    pendingPlanRouteHandledKeyRef.current = null;
    setToolkitConnectInFlight(false);
    setAgentRunInputSourceUrl("");
    setAgentRunInputFile(null);
    setAgentRunInputSubmitting(false);
    setPipelinePolicy(null);
    setControlMessage(null);
    setPendingAutoLaunchPrompt(null);
  }, [resolvedOrg?.id]);

  useEffect(() => {
    if (activeTab !== "control") {
      return;
    }
    if (workspaceMode === "COMPASS") {
      return;
    }
    setWorkspaceMode("COMPASS");
  }, [activeTab, workspaceMode]);

  useEffect(() => {
    if (activeTab === "control" && resolvedOrg?.id) {
      return;
    }
    setShowCompassStringPanel(false);
    setShowCompassCollaborationPanel(false);
  }, [activeTab, resolvedOrg?.id]);

  const controlHistoryStorageKey = useMemo(
    () => (resolvedOrg?.id ? `vx-control-history:${resolvedOrg.id}` : ""),
    [resolvedOrg?.id]
  );

  useEffect(() => {
    if (!controlHistoryStorageKey || typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(controlHistoryStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          const restored: ControlThreadHistoryItem[] = [];
          for (const candidate of parsed) {
            const item =
              candidate && typeof candidate === "object"
                ? (candidate as Record<string, unknown>)
                : null;
            if (!item || typeof item.id !== "string" || typeof item.title !== "string") {
              continue;
            }
            const mode = item.mode === "DIRECTION" ? "DIRECTION" : "MINDSTORM";
            const launchScopeCandidate =
              item.launchScope && typeof item.launchScope === "object"
                ? (item.launchScope as Record<string, unknown>)
                : null;
            const launchScope =
              launchScopeCandidate
                ? {
                    directionId:
                      typeof launchScopeCandidate.directionId === "string"
                        ? launchScopeCandidate.directionId
                        : "",
                    planId:
                      typeof launchScopeCandidate.planId === "string"
                        ? launchScopeCandidate.planId
                        : "",
                    permissionRequestIds: Array.isArray(launchScopeCandidate.permissionRequestIds)
                      ? launchScopeCandidate.permissionRequestIds
                          .map((value) => (typeof value === "string" ? value : ""))
                          .filter(Boolean)
                          .slice(0, 80)
                      : [],
                    flowIds: Array.isArray(launchScopeCandidate.flowIds)
                      ? launchScopeCandidate.flowIds
                          .map((value) => (typeof value === "string" ? value : ""))
                          .filter(Boolean)
                          .slice(0, 40)
                      : []
                  }
                : undefined;
            restored.push({
              id: item.id,
              title: item.title,
              mode,
              updatedAt:
                typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
                  ? item.updatedAt
                  : Date.now(),
              turns: Array.isArray(item.turns) ? (item.turns as DirectionTurn[]) : [],
              directionGiven: typeof item.directionGiven === "string" ? item.directionGiven : "",
              planningResult:
                item.planningResult && typeof item.planningResult === "object"
                  ? (item.planningResult as DirectionPlanningResult)
                  : null,
              pendingPlanLaunchApproval:
                item.pendingPlanLaunchApproval &&
                typeof item.pendingPlanLaunchApproval === "object"
                  ? (item.pendingPlanLaunchApproval as PendingPlanLaunchApproval)
                  : null,
              pendingToolkitApproval:
                item.pendingToolkitApproval &&
                typeof item.pendingToolkitApproval === "object"
                  ? (item.pendingToolkitApproval as PendingToolkitApproval)
                  : null,
              pendingEmailApproval:
                item.pendingEmailApproval && typeof item.pendingEmailApproval === "object"
                  ? (item.pendingEmailApproval as PendingEmailApproval)
                  : null,
              agentRunResult:
                item.agentRunResult && typeof item.agentRunResult === "object"
                  ? (item.agentRunResult as AgentRunResponse)
                  : null,
              agentRunId: typeof item.agentRunId === "string" ? item.agentRunId : "",
              agentRunInputValues:
                item.agentRunInputValues && typeof item.agentRunInputValues === "object"
                  ? Object.fromEntries(
                      Object.entries(item.agentRunInputValues as Record<string, unknown>)
                        .map(([key, value]) => [key, typeof value === "string" ? value : ""])
                        .filter(([key]) => key.trim().length > 0)
                    )
                  : {},
              agentRunPromptSnapshot:
                typeof item.agentRunPromptSnapshot === "string"
                  ? item.agentRunPromptSnapshot
                  : "",
              agentRunInputSourceUrl:
                typeof item.agentRunInputSourceUrl === "string"
                  ? item.agentRunInputSourceUrl
                  : "",
              launchScope
            });
          }
          restored.sort((a, b) => b.updatedAt - a.updatedAt);
          const slicedRestored = restored.slice(0, 30);

          if (slicedRestored.length > 0) {
            const first = slicedRestored[0];
            setControlThreadHistory(slicedRestored);
            setActiveControlThreadId(first.id);
            setControlMode(first.mode);
            setControlConversationDetail(
              first.mode === "DIRECTION" ? "DIRECTION_GIVEN" : "REASONING_MIN"
            );
            setDirectionTurns(first.turns);
            setDirectionPrompt(first.directionGiven);
            setIntent(first.directionGiven);
            setDirectionPlanningResult(first.planningResult ?? null);
            setPendingPlanLaunchApproval(first.pendingPlanLaunchApproval ?? null);
            setPendingToolkitApproval(first.pendingToolkitApproval ?? null);
            setPendingEmailApproval(first.pendingEmailApproval ?? null);
            setAgentRunResult(first.agentRunResult ?? null);
            setAgentRunId(first.agentRunId ?? "");
            setAgentRunInputValues(first.agentRunInputValues ?? {});
            setAgentRunPromptSnapshot(first.agentRunPromptSnapshot ?? "");
            setAgentRunInputSourceUrl(first.agentRunInputSourceUrl ?? "");
            setControlScopedFlowIds(first.launchScope?.flowIds ?? []);
            setControlEngaged(
              first.turns.length > 0 ||
                first.directionGiven.length > 0 ||
                Boolean(first.planningResult) ||
                Boolean(first.pendingPlanLaunchApproval) ||
                Boolean(first.pendingToolkitApproval) ||
                Boolean(first.pendingEmailApproval) ||
                Boolean(first.agentRunResult)
            );
          }
        }
      }
    } catch {
      // Local history hydration is best-effort.
    } finally {
      setControlHistoryHydrated(true);
    }
  }, [controlHistoryStorageKey]);

  useEffect(() => {
    if (!controlHistoryStorageKey || typeof window === "undefined" || !controlHistoryHydrated) {
      return;
    }
    try {
      window.localStorage.setItem(
        controlHistoryStorageKey,
        JSON.stringify(controlThreadHistory.slice(0, 30))
      );
    } catch {
      // Local history persistence should never break core chat behavior.
    }
  }, [controlHistoryHydrated, controlHistoryStorageKey, controlThreadHistory]);

  useEffect(() => {
    if (!activeControlThreadId) {
      return;
    }
    const scopedDirectionId = directionPlanningResult?.directionRecord?.id?.trim() ?? "";
    const scopedPlanId = directionPlanningResult?.planRecord?.id?.trim() ?? "";
    const scopedPermissionRequestIds = [
      ...new Set(
        (directionPlanningResult?.permissionRequests ?? [])
          .map((item) => item.id?.trim())
          .filter((value): value is string => Boolean(value))
      )
    ];
    const scopedFlowIds = [
      ...new Set(controlScopedFlowIds.map((item) => item.trim()).filter(Boolean))
    ];
    const launchScope =
      scopedDirectionId ||
      scopedPlanId ||
      scopedPermissionRequestIds.length > 0 ||
      scopedFlowIds.length > 0
        ? {
            directionId: scopedDirectionId,
            planId: scopedPlanId,
            permissionRequestIds: scopedPermissionRequestIds,
            flowIds: scopedFlowIds
          }
        : undefined;
    const hasThreadContent =
      directionTurns.length > 0 ||
      directionPrompt.trim().length > 0 ||
      intent.trim().length > 0 ||
      Boolean(directionPlanningResult) ||
      Boolean(pendingPlanLaunchApproval) ||
      Boolean(pendingToolkitApproval) ||
      Boolean(pendingEmailApproval) ||
      Boolean(agentRunResult);
    if (!hasThreadContent) {
      return;
    }

    const directionGiven = (intent.trim() || directionPrompt.trim()).slice(0, 1600);
    const ownerTurn = directionTurns.find((turn) => turn.role === "owner");
    const titleSource = ownerTurn?.content || directionGiven;
    const title = titleSource
      ? compactTaskTitle(titleSource, controlThreadDefaultTitle(controlMode))
      : controlThreadDefaultTitle(controlMode);

    setControlThreadHistory((previous) => {
      const now = Date.now();
      const next = [
        {
          id: activeControlThreadId,
          title,
          mode: controlMode,
          updatedAt: now,
          turns: directionTurns,
          directionGiven,
          planningResult: directionPlanningResult,
          pendingPlanLaunchApproval,
          pendingToolkitApproval,
          pendingEmailApproval,
          agentRunResult,
          agentRunId,
          agentRunInputValues,
          agentRunPromptSnapshot,
          agentRunInputSourceUrl,
          launchScope
        },
        ...previous.filter((item) => item.id !== activeControlThreadId)
      ].slice(0, 30);
      return next;
    });
  }, [
    activeControlThreadId,
    controlMode,
    directionPrompt,
    directionPlanningResult,
    directionTurns,
    intent,
    pendingPlanLaunchApproval,
    pendingToolkitApproval,
    pendingEmailApproval,
    agentRunResult,
    agentRunId,
    agentRunInputValues,
    agentRunPromptSnapshot,
    agentRunInputSourceUrl,
    controlScopedFlowIds
  ]);

  const handleCreateControlThread = useCallback(
    (modeOverride?: ControlMode) => {
      const nextMode = modeOverride ?? controlMode;
      const nextId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const title = controlThreadDefaultTitle(nextMode);
      setActiveControlThreadId(nextId);
      setControlThreadHistory((previous) => [
        {
          id: nextId,
          title,
          mode: nextMode,
          updatedAt: Date.now(),
          turns: [],
          directionGiven: "",
          planningResult: null,
          pendingPlanLaunchApproval: null,
          pendingToolkitApproval: null,
          pendingEmailApproval: null,
          agentRunResult: null,
          agentRunId: "",
          agentRunInputValues: {},
          agentRunPromptSnapshot: "",
          agentRunInputSourceUrl: "",
          launchScope: {
            directionId: "",
            planId: "",
            permissionRequestIds: [],
            flowIds: []
          }
        },
        ...previous.filter((item) => item.id !== nextId)
      ].slice(0, 30));
      setDirectionTurns([]);
      setDirectionPrompt("");
      setIntent("");
      setDirectionPlanningResult(null);
      setPendingPlanLaunchApproval(null);
      setPendingToolkitApproval(null);
      setPendingEmailApproval(null);
      setApprovedToolkitRequestId(null);
      setAgentRunResult(null);
      setAgentRunId("");
      setAgentRunInputValues({});
      setAgentRunPromptSnapshot("");
      setAgentRunInputSourceUrl("");
      setAgentRunInputFile(null);
      setControlScopedFlowIds([]);
      setControlMessage(null);
      setControlMode(nextMode);
      setControlConversationDetail(nextMode === "DIRECTION" ? "DIRECTION_GIVEN" : "REASONING_MIN");
      setControlEngaged(false);
      handleTabChange("control");
    },
    [controlMode, handleTabChange]
  );

  const handleLoadControlThread = useCallback(
    (threadId: string) => {
      const target = controlThreadHistory.find((item) => item.id === threadId);
      if (!target) {
        return;
      }
      setActiveControlThreadId(target.id);
      setDirectionTurns(target.turns);
      setDirectionPrompt(target.directionGiven);
      setIntent(target.directionGiven);
      setControlMode(target.mode);
      setControlConversationDetail(target.mode === "DIRECTION" ? "DIRECTION_GIVEN" : "REASONING_MIN");
      setDirectionPlanningResult(target.planningResult ?? null);
      setPendingPlanLaunchApproval(target.pendingPlanLaunchApproval ?? null);
      setPendingToolkitApproval(target.pendingToolkitApproval ?? null);
      setPendingEmailApproval(target.pendingEmailApproval ?? null);
      setApprovedToolkitRequestId(null);
      setAgentRunResult(target.agentRunResult ?? null);
      setAgentRunId(target.agentRunId ?? "");
      setAgentRunInputValues(target.agentRunInputValues ?? {});
      setAgentRunPromptSnapshot(target.agentRunPromptSnapshot ?? "");
      setAgentRunInputSourceUrl(target.agentRunInputSourceUrl ?? "");
      setAgentRunInputFile(null);
      setControlScopedFlowIds(target.launchScope?.flowIds ?? []);
      setControlMessage(null);
      setControlEngaged(
        target.turns.length > 0 ||
          target.directionGiven.length > 0 ||
          Boolean(target.planningResult) ||
          Boolean(target.pendingPlanLaunchApproval) ||
          Boolean(target.pendingToolkitApproval) ||
          Boolean(target.pendingEmailApproval) ||
          Boolean(target.agentRunResult)
      );
      handleTabChange("control");
    },
    [controlThreadHistory, handleTabChange]
  );

  const handleSwitchControlMode = useCallback(
    (nextMode: ControlMode) => {
      const currentThread = activeControlThreadId
        ? controlThreadHistory.find((item) => item.id === activeControlThreadId) ?? null
        : null;
      if (currentThread?.mode === nextMode) {
        setControlMode(nextMode);
        setControlConversationDetail(nextMode === "DIRECTION" ? "DIRECTION_GIVEN" : "REASONING_MIN");
        if (workspaceMode !== "COMPASS") {
          setWorkspaceMode("COMPASS");
        }
        setControlEngaged(
          currentThread.turns.length > 0 ||
            currentThread.directionGiven.length > 0 ||
            Boolean(currentThread.planningResult) ||
            Boolean(currentThread.pendingPlanLaunchApproval) ||
            Boolean(currentThread.pendingToolkitApproval) ||
            Boolean(currentThread.pendingEmailApproval) ||
            Boolean(currentThread.agentRunResult)
        );
        handleTabChange("control");
        return;
      }

      const latestForMode = controlThreadHistory.find((item) => item.mode === nextMode);
      if (latestForMode) {
        handleLoadControlThread(latestForMode.id);
        return;
      }

      handleCreateControlThread(nextMode);
    },
    [
      activeControlThreadId,
      controlThreadHistory,
      handleTabChange,
      handleCreateControlThread,
      handleLoadControlThread,
      workspaceMode
    ]
  );

  useEffect(() => {
    if (activeControlThreadId || !resolvedOrg?.id || !controlHistoryHydrated) {
      return;
    }
    handleCreateControlThread(controlMode);
  }, [
    activeControlThreadId,
    controlHistoryHydrated,
    controlMode,
    handleCreateControlThread,
    resolvedOrg?.id
  ]);

  const presenceColor = useMemo(() => {
    const seed = Array.from(realtimeSessionId).reduce((sum, value) => sum + value.charCodeAt(0), 0);
    return PRESENCE_POOL[seed % PRESENCE_POOL.length]?.color ?? "bg-cyan-500";
  }, [realtimeSessionId]);

  useEffect(() => {
    const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL?.trim();
    if (!realtimeUrl) {
      if (activeUsers.length === 0) {
        setStoreActiveUsers(PRESENCE_POOL.slice(0, 3));
      }
      const interval = setInterval(() => {
        setStoreActiveUsers(randomPresence());
      }, 12000);
      return () => clearInterval(interval);
    }

    const socket = getRealtimeClient();
    if (!socket || !resolvedOrg?.id) {
      return;
    }

    const joinOrg = () => {
      socket.emit("org:join", {
        orgId: resolvedOrg.id,
        user: {
          id: realtimeSessionId,
          name: "Carbon Node",
          color: presenceColor
        }
      });
    };

    const handlePresence = (payload: any) => {
      if (payload?.orgId !== resolvedOrg.id) {
        return;
      }
      if (Array.isArray(payload?.users)) {
        setStoreActiveUsers(payload.users);
      }
    };

    socket.on("connect", joinOrg);
    socket.on("presence:update", handlePresence);

    if (socket.connected) {
      joinOrg();
    }

    return () => {
      socket.off("connect", joinOrg);
      socket.off("presence:update", handlePresence);
    };
  }, [
    activeUsers.length,
    presenceColor,
    realtimeSessionId,
    resolvedOrg?.id,
    setStoreActiveUsers
  ]);

  const predictedBurn = useMemo(
    () => Math.max(900, Math.floor((intent.length || 8) * swarmDensity * 1.8)),
    [intent.length, swarmDensity]
  );
  const requiredSignatures = useMemo(() => {
    if (predictedBurn >= 250000) {
      return 3;
    }
    if (predictedBurn >= 75000) {
      return 2;
    }
    return 1;
  }, [predictedBurn]);
  const activeControlThread = useMemo(
    () =>
      activeControlThreadId
        ? controlThreadHistory.find((item) => item.id === activeControlThreadId) ?? null
        : null,
    [activeControlThreadId, controlThreadHistory]
  );
  const {
    flowCalendarStringItems,
    flowScopedApprovalCheckpoints,
    flowScopedPermissionRequests,
    flowSelectedString,
    flowSelectedStringDirectionId,
    flowSelectedStringFlowIds,
    flowSelectedStringLabel,
    flowSelectedStringPlanId,
    flowVisibleStringItems,
    isRequestCenterScopedToCommand,
    launchPermissionRequestIds,
    pendingLaunchPermissionRequestCount,
    rejectedLaunchPermissionRequestCount,
    requestCenterApprovalCheckpoints,
    requestCenterCheckpointPendingCount,
    requestCenterPendingCount,
    requestCenterPermissionPendingCount,
    requestCenterPermissionRequests
  } = useFlowScope({
    activeControlThread,
    activeTab,
    approvalCheckpoints,
    controlMode,
    controlScopedFlowIds,
    controlThreadHistory: workspaceStringHistory,
    directionPlanningResult,
    flowCalendarSelectedDate,
    flowSelectedStringId,
    permissionRequests,
    setFlowSelectedStringId
  });

  const steerCardLookup = useMemo(() => {
    const lookup = new Map<string, SteerDeliverableCard>();
    for (const item of workspaceStringHistory) {
      const draft = editableDraftsByString[item.id];
      const cards = draft
        ? buildDraftDeliverableCards({
            stringItem: item,
            draft
          })
        : buildThreadDeliverableCards(item);
      cards.forEach((card) => {
        lookup.set(card.id, card);
      });
    }
    return lookup;
  }, [editableDraftsByString, workspaceStringHistory]);

  useEffect(() => {
    if (workspaceStringHistory.length === 0) {
      return;
    }
    setScoreByString((previous) => {
      let changed = false;
      const next = { ...previous };

      for (const item of workspaceStringHistory) {
        const value = item.planningResult?.primaryPlan?.detailScore;
        if (typeof value !== "number" || !Number.isFinite(value)) {
          continue;
        }
        const stringId = item.id;
        const entryId = `plan-detail-${stringId}`;
        const nextEntry: StringScoreRecord = {
          id: entryId,
          metric: "Plan Detail Score",
          score: Math.max(0, Math.min(100, Math.floor(value))),
          maxScore: 100,
          scoredByType: "AI",
          scoredBy: "Planner",
          note: "Imported from plan detailScore.",
          createdAt: item.updatedAt
        };
        const current = next[stringId] ?? [];
        const existingIndex = current.findIndex((record) => record.id === entryId);

        if (existingIndex === -1) {
          next[stringId] = [...current, nextEntry];
          changed = true;
          continue;
        }

        const existing = current[existingIndex];
        if (
          existing.score === nextEntry.score &&
          existing.maxScore === nextEntry.maxScore &&
          existing.createdAt === nextEntry.createdAt
        ) {
          continue;
        }

        const updated = [...current];
        updated[existingIndex] = nextEntry;
        next[stringId] = updated;
        changed = true;
      }

      return changed ? next : previous;
    });
  }, [workspaceStringHistory]);

  useEffect(() => {
    if (!workspaceStateHydrated || workspaceStringHistory.length === 0) {
      return;
    }

    setEditableDraftsByString((previous) => {
      let changed = false;
      const next = { ...previous };

      for (const item of workspaceStringHistory) {
        if (next[item.id]) {
          continue;
        }
        if (!trimWorkspaceText(item.directionGiven) && !item.planningResult) {
          continue;
        }

        next[item.id] = resolveEditableStringDraft({
          stringItem: item,
          permissionRequests: getScopedPermissionRequestsForString(item, permissionRequests),
          approvalCheckpoints: getScopedApprovalCheckpointsForString(
            item,
            approvalCheckpoints
          )
        });
        changed = true;
      }

      return changed ? next : previous;
    });
  }, [
    approvalCheckpoints,
    permissionRequests,
    workspaceStateHydrated,
    workspaceStringHistory
  ]);

  const persistSharedStringRecord = useCallback(
    async (
      payload:
        | ReturnType<typeof buildSharedStringPayloadFromWorkspaceItem>
        | (ReturnType<typeof buildSharedStringPayloadFromWorkspaceItem> & {
            workspaceState?: null;
          })
    ) => {
      const response = await fetch("/api/strings", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const { payload: parsed, rawText } = await parseJsonBody<WorkspaceStringsResponse>(response);
      if (!response.ok || !parsed?.ok) {
        throw new Error(
          buildWorkspaceLoadError(response.status, "Failed to persist string workspace state", parsed?.message, rawText)
        );
      }
    },
    []
  );

  useEffect(() => {
    if (!resolvedOrg?.id || !workspaceStateHydrated) {
      return;
    }

    const nextPayloads = new Map<
      string,
      ReturnType<typeof buildSharedStringPayloadFromWorkspaceItem>
    >();

    for (const item of workspaceStringHistory) {
      const workspaceState = buildPersistableWorkspaceState({
        stringItem: item,
        draftsByString: editableDraftsByString,
        scoreByString,
        steerDecisions
      });
      const isControlThread = item.id.startsWith("thread-");
      const isDerivedThread =
        item.id.startsWith("direction:") || item.id.startsWith("plan:");

      if (!isControlThread && !workspaceState) {
        continue;
      }
      if (isControlThread && !workspaceState && !hasPersistableThreadContent(item)) {
        continue;
      }
      if (isDerivedThread && !workspaceState) {
        continue;
      }

      const payload = buildSharedStringPayloadFromWorkspaceItem({
        orgId: resolvedOrg.id,
        stringItem: item,
        draftsByString: editableDraftsByString,
        scoreByString,
        steerDecisions,
        includeMessages: isControlThread
      });
      nextPayloads.set(item.id, payload);
    }

    const changedPayloads = [...nextPayloads.entries()].filter(([id, payload]) => {
      const snapshot = JSON.stringify(payload);
      return workspacePersistSnapshotRef.current[id] !== snapshot;
    });

    if (changedPayloads.length === 0) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const [id, payload] of changedPayloads) {
          try {
            await persistSharedStringRecord(payload);
            if (cancelled) {
              return;
            }
            workspacePersistSnapshotRef.current[id] = JSON.stringify(payload);
          } catch (error) {
            if (cancelled) {
              return;
            }
            console.error("[VorldXShell] Failed to persist shared string state.", error);
            setControlMessage({
              tone: "error",
              text:
                error instanceof Error
                  ? error.message
                  : "Failed to persist shared string state."
            });
            return;
          }
        }
      })();
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    editableDraftsByString,
    persistSharedStringRecord,
    resolvedOrg?.id,
    scoreByString,
    steerDecisions,
    workspaceStateHydrated,
    workspaceStringHistory
  ]);

  useEffect(() => {
    if (signatureApprovals > requiredSignatures) {
      setSignatureApprovals(requiredSignatures);
    }
  }, [requiredSignatures, signatureApprovals]);

  useEffect(() => {
    const socket = getRealtimeClient();
    if (!socket || !resolvedOrg?.id) {
      return;
    }

    const readPayload = (envelope: any) =>
      envelope?.payload && typeof envelope.payload === "object"
        ? (envelope.payload as Record<string, unknown>)
        : {};

    const readFlowId = (payload: Record<string, unknown>) => {
      const flowId =
        typeof payload.flowId === "string" && payload.flowId.trim().length > 0
          ? payload.flowId.trim()
          : typeof payload.branchFlowId === "string" && payload.branchFlowId.trim().length > 0
            ? payload.branchFlowId.trim()
            : "";
      return flowId;
    };

    const readTaskId = (payload: Record<string, unknown>) =>
      typeof payload.taskId === "string" && payload.taskId.trim().length > 0
        ? payload.taskId.trim()
        : "";

    const handleSignatureCaptured = (envelope: any) => {
      if (envelope?.orgId !== resolvedOrg.id) {
        return;
      }
      const payload = readPayload(envelope);
      const senderId = envelope?.payload?.senderId;
      if (senderId && senderId === realtimeSessionId) {
        return;
      }

      const approvalsProvided =
        typeof envelope?.payload?.approvalsProvided === "number"
          ? envelope.payload.approvalsProvided
          : null;
      const remoteRequiredSignatures =
        typeof envelope?.payload?.requiredSignatures === "number"
          ? envelope.payload.requiredSignatures
          : requiredSignatures;

      setSignatureApprovals((prev) => {
        if (approvalsProvided !== null) {
          return Math.min(remoteRequiredSignatures, Math.max(prev, approvalsProvided));
        }
        return Math.min(remoteRequiredSignatures, prev + 1);
      });

      const flowId = readFlowId(payload);
      if (shouldEmitWorkflowEvent(`signature:${flowId || "global"}`, 2200)) {
        appendStructuredOrganizationTurn({
          content:
            approvalsProvided !== null
              ? `Signature captured (${approvalsProvided}/${remoteRequiredSignatures}).`
              : "A new launch signature was captured.",
          meta: {
            kind: "workflow_event",
            title: "Signature Captured",
            message:
              approvalsProvided !== null
                ? `Launch signatures now at ${approvalsProvided}/${remoteRequiredSignatures}.`
                : "A launch signature was captured by another authorized user.",
            eventName: "signature.captured",
            flowId: flowId || undefined,
            timestamp: Date.now()
          }
        });
      }

      if (flowId) {
        queueWorkflowSnapshotTurn(flowId, "Launch Signature Progress");
      }
    };

    const handleKillSwitch = (envelope: any) => {
      if (envelope?.orgId !== resolvedOrg.id) {
        return;
      }
      setControlMessage({
        tone: "warning",
        text: "Kill switch broadcast received. Active missions aborted."
      });
      setSignatureApprovals(0);
      appendStructuredOrganizationTurn({
        content: "Kill switch triggered. Active workflows were aborted.",
        meta: {
          kind: "workflow_event",
          title: "Kill Switch Triggered",
          message: "All active missions were aborted for this organization.",
          eventName: "kill-switch.triggered",
          status: "ABORTED",
          timestamp: Date.now()
        }
      });
    };

    const handleTaskPaused = (envelope: any) => {
      if (envelope?.orgId !== resolvedOrg.id) {
        return;
      }
      const payload = readPayload(envelope);
      const taskId = readTaskId(payload);
      if (!taskId) {
        return;
      }

      const integrationError =
        payload.integrationError && typeof payload.integrationError === "object"
          ? (payload.integrationError as Record<string, unknown>)
          : null;

      const reasonFromPayload =
        typeof payload.reason === "string" && payload.reason.trim().length > 0
          ? payload.reason.trim()
          : "";
      const reasonFromIntegration =
        integrationError?.code === "INTEGRATION_NOT_CONNECTED" &&
        typeof integrationError.toolkit === "string" &&
        integrationError.toolkit.trim().length > 0
          ? `Connect ${integrationError.toolkit.trim().toLowerCase()} integration before resume.`
          : "";
      const reason = reasonFromPayload || reasonFromIntegration || "Human input required by agent.";
      const flowId = readFlowId(payload);
      promptForHumanInput({
        taskId,
        flowId: flowId || null,
        reason
      });

      if (shouldEmitWorkflowEvent(`task.paused:${taskId}`, 900)) {
        appendStructuredOrganizationTurn({
          content: `Task ${taskId.slice(0, 8)} paused: ${reason}`,
          meta: {
            kind: "workflow_event",
            title: "Task Paused",
            message: reason,
            eventName: "task.paused",
            flowId: flowId || undefined,
            taskId,
            status: "PAUSED",
            timestamp: Date.now()
          }
        });
      }
      if (flowId) {
        queueWorkflowSnapshotTurn(flowId, "Task Paused");
      }
    };

    const handleTaskResumed = (envelope: any) => {
      if (envelope?.orgId !== resolvedOrg.id) {
        return;
      }
      const payload = readPayload(envelope);
      const taskId = readTaskId(payload);
      if (!taskId) {
        return;
      }
      setPendingHumanInput((current) => (current?.taskId === taskId ? null : current));
      const flowId = readFlowId(payload);
      if (shouldEmitWorkflowEvent(`task.resumed:${taskId}`, 900)) {
        appendStructuredOrganizationTurn({
          content: `Task ${taskId.slice(0, 8)} resumed.`,
          meta: {
            kind: "workflow_event",
            title: "Task Resumed",
            message: "Execution resumed after pause/human input.",
            eventName: "task.resumed",
            flowId: flowId || undefined,
            taskId,
            status: "RUNNING",
            timestamp: Date.now()
          }
        });
      }
      if (flowId) {
        queueWorkflowSnapshotTurn(flowId, "Task Resumed");
      }
    };

    const handleFlowUpdated = (envelope: any) => {
      if (envelope?.orgId !== resolvedOrg.id) {
        return;
      }
      const payload = readPayload(envelope);
      const flowId = readFlowId(payload);
      if (!flowId || !shouldEmitWorkflowEvent(`flow.updated:${flowId}`, 1300)) {
        return;
      }
      const status =
        typeof payload.status === "string" && payload.status.trim().length > 0
          ? payload.status.trim().toUpperCase()
          : "UPDATED";
      appendStructuredOrganizationTurn({
        content: `Workflow ${flowId.slice(0, 8)} updated: ${status}.`,
        meta: {
          kind: "workflow_event",
          title: "Workflow Updated",
          message: `Workflow state changed to ${status}.`,
          eventName: "flow.updated",
          flowId,
          status,
          timestamp: Date.now()
        }
      });
      queueWorkflowSnapshotTurn(flowId, "Workflow Update");
    };

    const handleFlowProgress = (envelope: any) => {
      if (envelope?.orgId !== resolvedOrg.id) {
        return;
      }
      const payload = readPayload(envelope);
      const flowId = readFlowId(payload);
      if (!flowId || !shouldEmitWorkflowEvent(`flow.progress:${flowId}`, 1800)) {
        return;
      }
      const progress =
        typeof payload.progress === "number" && Number.isFinite(payload.progress)
          ? Math.max(0, Math.min(100, Math.floor(payload.progress)))
          : null;
      appendStructuredOrganizationTurn({
        content:
          progress !== null
            ? `Workflow ${flowId.slice(0, 8)} progress: ${progress}%.`
            : `Workflow ${flowId.slice(0, 8)} progress updated.`,
        meta: {
          kind: "workflow_event",
          title: "Workflow Progress",
          message:
            progress !== null
              ? `Execution progress reached ${progress}%.`
              : "Execution progress changed.",
          eventName: "flow.progress",
          flowId,
          status: "RUNNING",
          timestamp: Date.now()
        }
      });
      queueWorkflowSnapshotTurn(flowId, "Live Progress");
    };

    const handleTaskCompleted = (envelope: any) => {
      if (envelope?.orgId !== resolvedOrg.id) {
        return;
      }
      const payload = readPayload(envelope);
      const flowId = readFlowId(payload);
      const taskId = readTaskId(payload);
      if (!taskId || !shouldEmitWorkflowEvent(`task.completed:${taskId}`, 900)) {
        return;
      }
      const runtime =
        payload.executionTrace && typeof payload.executionTrace === "object"
          ? ((payload.executionTrace as Record<string, unknown>).agentRuntime as
              | Record<string, unknown>
              | undefined)
          : undefined;
      const logicalRole =
        runtime && typeof runtime.logicalRole === "string" ? runtime.logicalRole.trim() : "";
      appendStructuredOrganizationTurn({
        content: `Task ${taskId.slice(0, 8)} completed${logicalRole ? ` by ${logicalRole}` : ""}.`,
        meta: {
          kind: "workflow_event",
          title: "Task Completed",
          message: "A workflow task finished successfully.",
          eventName: "task.completed",
          flowId: flowId || undefined,
          taskId,
          status: "COMPLETED",
          ...(logicalRole ? { agentLabel: logicalRole } : {}),
          timestamp: Date.now()
        }
      });
      if (flowId) {
        queueWorkflowSnapshotTurn(flowId, "Task Completed");
      }
    };

    const handleTaskFailed = (envelope: any) => {
      if (envelope?.orgId !== resolvedOrg.id) {
        return;
      }
      const payload = readPayload(envelope);
      const flowId = readFlowId(payload);
      const taskId = readTaskId(payload);
      if (!taskId || !shouldEmitWorkflowEvent(`task.failed:${taskId}`, 900)) {
        return;
      }
      appendStructuredOrganizationTurn({
        content: `Task ${taskId.slice(0, 8)} failed and needs intervention.`,
        meta: {
          kind: "workflow_event",
          title: "Task Failed",
          message: "A task failed during execution. Review context and resume or rewind.",
          eventName: "task.failed",
          flowId: flowId || undefined,
          taskId,
          status: "FAILED",
          timestamp: Date.now()
        }
      });
      if (flowId) {
        queueWorkflowSnapshotTurn(flowId, "Failure Snapshot");
      }
    };

    const handleAgentDelegated = (envelope: any) => {
      if (envelope?.orgId !== resolvedOrg.id) {
        return;
      }
      const payload = readPayload(envelope);
      const flowId = readFlowId(payload);
      const taskId = readTaskId(payload);
      const toRole =
        typeof payload.toRole === "string" && payload.toRole.trim().length > 0
          ? payload.toRole.trim()
          : "Specialist";
      if (!shouldEmitWorkflowEvent(`agent.delegated:${taskId || flowId || toRole}`, 900)) {
        return;
      }
      appendStructuredOrganizationTurn({
        content: `Task delegated to ${toRole}.`,
        meta: {
          kind: "workflow_event",
          title: "Agent Delegation",
          message: `Main agent delegated execution to ${toRole}.`,
          eventName: "agent.delegated",
          flowId: flowId || undefined,
          taskId: taskId || undefined,
          ...(toRole ? { agentLabel: toRole } : {}),
          timestamp: Date.now()
        }
      });
      if (flowId) {
        queueWorkflowSnapshotTurn(flowId, "Delegation Update");
      }
    };

    const handleFlowRewound = (envelope: any) => {
      if (envelope?.orgId !== resolvedOrg.id) {
        return;
      }
      const payload = readPayload(envelope);
      const flowId = readFlowId(payload);
      const branchFlowId =
        typeof payload.branchFlowId === "string" && payload.branchFlowId.trim().length > 0
          ? payload.branchFlowId.trim()
          : "";
      if (!shouldEmitWorkflowEvent(`flow.rewound:${flowId || branchFlowId}`, 900)) {
        return;
      }
      appendStructuredOrganizationTurn({
        content: branchFlowId
          ? `Workflow rewound. New branch ${branchFlowId.slice(0, 8)} created.`
          : "Workflow rewound and branched from selected task.",
        meta: {
          kind: "workflow_event",
          title: "Workflow Rewound",
          message: branchFlowId
            ? `A branch workflow was created: ${branchFlowId.slice(0, 8)}.`
            : "A workflow branch was created from rewind.",
          eventName: "flow.rewound",
          flowId: branchFlowId || flowId || undefined,
          status: "QUEUED",
          timestamp: Date.now()
        }
      });
      if (branchFlowId) {
        queueWorkflowSnapshotTurn(branchFlowId, "Branched Workflow");
      } else if (flowId) {
        queueWorkflowSnapshotTurn(flowId, "Rewind Snapshot");
      }
    };

    const handleApprovalResolved = (envelope: any) => {
      if (envelope?.orgId !== resolvedOrg.id) {
        return;
      }
      void loadApprovalCheckpoints({ force: true, silent: true });
    };

    socket.on("signature.captured", handleSignatureCaptured);
    socket.on("kill-switch.triggered", handleKillSwitch);
    socket.on("flow.updated", handleFlowUpdated);
    socket.on("flow.progress", handleFlowProgress);
    socket.on("task.completed", handleTaskCompleted);
    socket.on("task.failed", handleTaskFailed);
    socket.on("agent.delegated", handleAgentDelegated);
    socket.on("flow.rewound", handleFlowRewound);
    socket.on("task.paused", handleTaskPaused);
    socket.on("task.resumed", handleTaskResumed);
    socket.on("approval.resolved", handleApprovalResolved);

    return () => {
      socket.off("signature.captured", handleSignatureCaptured);
      socket.off("kill-switch.triggered", handleKillSwitch);
      socket.off("flow.updated", handleFlowUpdated);
      socket.off("flow.progress", handleFlowProgress);
      socket.off("task.completed", handleTaskCompleted);
      socket.off("task.failed", handleTaskFailed);
      socket.off("agent.delegated", handleAgentDelegated);
      socket.off("flow.rewound", handleFlowRewound);
      socket.off("task.paused", handleTaskPaused);
      socket.off("task.resumed", handleTaskResumed);
      socket.off("approval.resolved", handleApprovalResolved);
    };
  }, [
    appendStructuredOrganizationTurn,
    loadApprovalCheckpoints,
    promptForHumanInput,
    queueWorkflowSnapshotTurn,
    realtimeSessionId,
    requiredSignatures,
    resolvedOrg?.id,
    shouldEmitWorkflowEvent
  ]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return {
        tabs: [],
        orgMatches: [],
        actions: [
          { id: "action-ghost", label: "Toggle Ghost Protocol", action: () => toggleGhostMode() },
          { id: "action-org", label: "Add Organization", action: () => openAddOrganization() }
        ]
      };
    }

    const tabs = NAV_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.helper.toLowerCase().includes(q)
    );
    const orgMatches = switchableOrgs.filter((item) => item.name.toLowerCase().includes(q));
    const actions = [
      {
        id: "action-control",
        label: "Go to Control Deck",
        action: () => handleTabChange("control")
      },
      {
        id: "action-ghost",
        label: "Toggle Ghost Protocol",
        action: () => toggleGhostMode()
      }
    ].filter((item) => item.label.toLowerCase().includes(q));

    return { tabs, orgMatches, actions };
  }, [handleTabChange, openAddOrganization, searchQuery, switchableOrgs, toggleGhostMode]);

  const operationNavItems = useMemo(
    () =>
      OPERATION_TAB_IDS.map((id) => NAV_ITEM_MAP[id]).filter(
        (item): item is (typeof NAV_ITEMS)[number] => Boolean(item)
      ),
    []
  );

  const activePrimaryNavItems = useMemo(
    () => operationNavItems.filter((item) => item.primary === primaryWorkspaceTab),
    [operationNavItems, primaryWorkspaceTab]
  );
  const safeOperationsTab = useMemo(
    () => normalizeOperationTabId(operationsTab, primaryWorkspaceTab),
    [operationsTab, primaryWorkspaceTab]
  );

  const handlePrimaryWorkspaceTabSwitch = useCallback(
    (nextTab: PrimaryWorkspaceTabId) => {
      if (nextTab === "GOVERNANCE") {
        handleOperationTabChange("memory");
        return;
      }
      handleOperationTabChange(normalizeOperationTabId(primaryTabLastSubtab[nextTab], nextTab));
    },
    [handleOperationTabChange, primaryTabLastSubtab]
  );

  const handleWorkspaceModeSwitch = useCallback(
    (nextMode: WorkspaceMode) => {
      if (nextMode === "COMPASS") {
        handleTabChange("control");
        return;
      }
      if (nextMode === "FLOW") {
        handleOperationTabChange(safeOperationsTab);
        return;
      }
      handleTabChange("hub");
    },
    [handleOperationTabChange, handleTabChange, safeOperationsTab]
  );

  const isRequestCenterActive = showRequestCenter;
  const isWorkforceTabActive = activeTab === "squad";
  const isSettingsTabActive = activeTab === "settings";
  const isUtilityMenuActive = showUtilityMenu;
  const isCompassModeActive = activeTab === "control";
  const isCompassCollaborationPanelActive = activeTab === "control" && showCompassCollaborationPanel;
  const isFlowModeActive = OPERATION_TAB_SET.has(activeTab);
  const isHubModeActive = activeTab === "hub";

  useEffect(() => {
    if (operationsTab === safeOperationsTab) {
      return;
    }
    setOperationsTab(safeOperationsTab);
  }, [operationsTab, safeOperationsTab]);

  useEffect(() => {
    if (primaryWorkspaceTab !== "EXECUTION") {
      return;
    }
    if (activeTab === "blueprint") {
      setFlowExecutionTab("BLUEPRINT");
      return;
    }
    if (activeTab === "calendar") {
      setFlowExecutionTab("CALENDAR");
    }
  }, [activeTab, primaryWorkspaceTab]);

  const handleEditableDraftChange = useCallback((stringId: string, nextDraft: EditableStringDraft) => {
    setEditableDraftsByString((previous) => ({
      ...previous,
      [stringId]: normalizeEditableStringDraft(nextDraft)
    }));
  }, []);

  const handleSteerDecision = useCallback(
    (cardId: string, lane: SteerLaneTab) => {
      const currentLane = steerDecisions[cardId] ?? "CENTER";
      if (currentLane === lane) {
        return;
      }

      setSteerDecisions((previous) => ({
        ...previous,
        [cardId]: lane
      }));

      const card = steerCardLookup.get(cardId);
      if (!card) {
        return;
      }

      const changedAt = Date.now();
      const nextEntry: StringScoreRecord = {
        id: `steer-${card.stringId}-${cardId}-${changedAt}`,
        metric:
          lane === "APPROVED"
            ? "Steer Approval"
            : lane === "RETHINK"
              ? "Steer Rethink"
              : "Steer Reset",
        score: lane === "APPROVED" ? 1 : 0,
        maxScore: 1,
        scoredByType: "HUMAN",
        scoredBy: "Owner",
        note: `${card.text}${card.workflowTitle ? ` | ${card.workflowTitle}` : ""}`,
        createdAt: changedAt
      };

      setScoreByString((previous) => {
        const current = previous[card.stringId] ?? [];
        return {
          ...previous,
          [card.stringId]: [...current, nextEntry]
        };
      });
    },
    [steerCardLookup, steerDecisions]
  );

  const uploadHumanInputToHub = useCallback(
    async (input: { file?: File; sourceUrl?: string; name?: string }) => {
      if (!resolvedOrg?.id) {
        throw new Error("Organization is required to upload input.");
      }

      const hasFile = input.file instanceof File;
      const hasSourceUrl = typeof input.sourceUrl === "string" && input.sourceUrl.trim().length > 0;
      if (!hasFile && !hasSourceUrl) {
        throw new Error("Provide a file or source URL.");
      }

      let response: Response;
      if (hasFile && input.file) {
        const formData = new FormData();
        formData.set("orgId", resolvedOrg.id);
        formData.set("type", "INPUT");
        formData.set("name", input.name?.trim() || input.file.name || "human-input.txt");
        formData.set("isAmnesiaProtected", "false");
        formData.set("file", input.file);
        response = await fetch("/api/hub/files", {
          method: "POST",
          credentials: "include",
          body: formData
        });
      } else {
        response = await fetch("/api/hub/files", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orgId: resolvedOrg.id,
            type: "INPUT",
            name: input.name?.trim() || "human-input-link",
            sourceUrl: input.sourceUrl?.trim(),
            isAmnesiaProtected: false
          })
        });
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            message?: string;
            file?: {
              id?: string;
              url?: string;
            };
          }
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message ?? "Failed to store input in Hub.");
      }

      const ref = payload.file?.id?.trim() || payload.file?.url?.trim() || "";
      if (!ref) {
        throw new Error("Hub file reference missing in upload response.");
      }
      return ref;
    },
    [resolvedOrg?.id]
  );

  const handleSubmitHumanInput = useCallback(async () => {
    if (!resolvedOrg?.id || !pendingHumanInput) {
      return;
    }

    const message = humanInputMessage.trim();
    const sourceUrl = humanInputSourceUrl.trim();
    const overridePrompt = humanInputOverridePrompt.trim();
    const hasFile = humanInputFile instanceof File;
    if (!message && !sourceUrl && !hasFile && !overridePrompt) {
      pushNotification({
        title: "Human Input Required",
        message: "Add message, file, source URL, or override prompt before resuming.",
        type: "warning"
      });
      return;
    }

    setHumanInputSubmitting(true);
    try {
      const fileRefs: string[] = [];

      if (hasFile && humanInputFile) {
        const fileRef = await uploadHumanInputToHub({
          file: humanInputFile,
          name: humanInputFile.name
        });
        fileRefs.push(fileRef);
      }

      if (sourceUrl) {
        const fileRef = await uploadHumanInputToHub({
          sourceUrl,
          name: `task-${pendingHumanInput.taskId.slice(0, 8)}-source`
        });
        fileRefs.push(fileRef);
      }

      if (message) {
        const content = [
          `Task: ${pendingHumanInput.taskId}`,
          `SubmittedAt: ${new Date().toISOString()}`,
          "",
          message
        ].join("\n");
        const file = new File([content], `task-${pendingHumanInput.taskId.slice(0, 8)}-input.txt`, {
          type: "text/plain"
        });
        const fileRef = await uploadHumanInputToHub({
          file,
          name: file.name
        });
        fileRefs.push(fileRef);
      }

      const response = await fetch(`/api/tasks/${pendingHumanInput.taskId}/resume`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orgId: resolvedOrg.id,
          fileUrls: fileRefs,
          overridePrompt: overridePrompt || undefined,
          note: message || pendingHumanInput.reason
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            message?: string;
            warning?: string;
          }
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.message ?? "Failed to resume task with human input.");
      }

      pushNotification({
        title: "Input Submitted",
        message:
          payload.warning ||
          `Task ${pendingHumanInput.taskId.slice(0, 8)} resumed. Input stored in Hub.`,
        type: payload.warning ? "warning" : "success"
      });
      setControlMessage({
        tone: "success",
        text: `Task ${pendingHumanInput.taskId.slice(0, 8)} resumed with human input.`
      });

      setPendingHumanInput(null);
      setHumanInputMessage("");
      setHumanInputSourceUrl("");
      setHumanInputFile(null);
      setHumanInputOverridePrompt("");
      if (pendingHumanInput.flowId) {
        handleTabChange("flow");
      }
    } catch (error) {
      pushNotification({
        title: "Human Input Failed",
        message: error instanceof Error ? error.message : "Unable to submit human input.",
        type: "error"
      });
    } finally {
      setHumanInputSubmitting(false);
    }
  }, [
    handleTabChange,
    humanInputFile,
    humanInputMessage,
    humanInputOverridePrompt,
    humanInputSourceUrl,
    pendingHumanInput,
    pushNotification,
    resolvedOrg?.id,
    uploadHumanInputToHub
  ]);

  const handleVoiceIntent = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const recognitionCtor =
      (window as Window & { SpeechRecognition?: any; webkitSpeechRecognition?: any })
        .SpeechRecognition ??
      (window as Window & { SpeechRecognition?: any; webkitSpeechRecognition?: any })
        .webkitSpeechRecognition;

    if (!recognitionCtor) {
      setControlMessage({
        tone: "warning",
        text: "Voice capture is not supported in this browser. Use text input instead."
      });
      return;
    }

    const recognition = new recognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    setControlMessage(null);
    setIsRecordingIntent(true);

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) {
        setDirectionPrompt(transcript);
      }
    };

    recognition.onerror = () => {
      setControlMessage({
        tone: "warning",
        text: "Voice capture failed. Check microphone permissions and try again."
      });
    };

    recognition.onend = () => {
      setIsRecordingIntent(false);
    };

    recognition.start();
  }, []);

  const handleDirectionChat = useCallback(async (rawMessage?: string, sourceMode?: ControlMode) => {
    const message = (rawMessage ?? directionPrompt).trim();
    if (!resolvedOrg?.id) {
      return;
    }
    if (!message) {
      setControlMessage({
        tone: "warning",
        text: "Type a message before talking to your organization."
      });
      return;
    }

    const intentEnrichment = enrichMessageForIntent(message);

    const [provider, model] = directionModelId.split(":");
    setDirectionChatInFlight(true);
    setControlMessage(null);

    try {
      const orgReady = await ensureOrgAccessReady();
      if (!orgReady) {
        return;
      }

      const ownerTurn: DirectionTurn = {
        id: `owner-${Date.now()}`,
        role: "owner",
        content: message
      };
      setDirectionTurns((prev) => [...prev, ownerTurn]);
      if (!rawMessage) {
        setDirectionPrompt("");
      }

      const response = await fetch("/api/control/direction-chat", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orgId: resolvedOrg.id,
          message: intentEnrichment.message,
          history: directionTurns.filter((turn) => !isTimelineEventMeta(turn.meta)).slice(-10).map((turn) => ({
            role: turn.role,
            content: turn.content
          })),
          provider,
          model
        })
      });

      const { payload, rawText } = await parseJsonBody<{
        ok?: boolean;
        message?: string;
        reply?: string;
        directionCandidate?: string;
        intentRouting?: DirectionIntentRouting;
        model?: { provider?: string | null; name?: string | null };
      }>(response);

      if (!response.ok || !payload?.ok || !payload.reply) {
        setControlMessage({
          tone: "error",
          text:
            payload?.message ??
            (rawText
              ? `Organization did not respond (${response.status}): ${rawText.slice(0, 180)}`
              : "Organization did not respond.")
        });
        return;
      }

      const modelLabel = [payload.model?.provider, payload.model?.name]
        .filter((value): value is string => Boolean(value))
        .join(" / ");
      setDirectionTurns((prev) => [
        ...prev,
        {
          id: `org-${Date.now()}`,
          role: "organization",
          content: payload.reply ?? "",
          ...(modelLabel ? { modelLabel } : {})
        }
      ]);

      const shouldPromoteDirectionCandidate =
        Boolean(payload.directionCandidate) &&
        sourceMode === "DIRECTION";

      if (shouldPromoteDirectionCandidate && payload.directionCandidate) {
        setIntent(payload.directionCandidate);
        setControlConversationDetail("DIRECTION_GIVEN");
        setControlMessage({
          tone: "success",
          text: "Direction candidate updated from organization response."
        });
      }

      if (payload.intentRouting?.route === "PLAN_REQUIRED") {
        const routedPrompt = message;
        const cadenceHint = payload.intentRouting.cadenceHint;
        const routeReason =
          payload.intentRouting.reason ||
          "Intent requires planning before workflow launch.";
        setPendingChatPlanRoute({
          prompt: routedPrompt,
          reason: routeReason,
          toolkitHints: payload.intentRouting.toolkitHints ?? []
        });
        if (sourceMode !== "DIRECTION") {
          appendThreadEventTurn({
            content: "Moved to direction.",
            title: "Moved To Direction",
            message: routeReason,
            eventName: "thread.mode.direction",
            scope: "MODE"
          });
        }
        setControlMode("DIRECTION");
        setControlConversationDetail("DIRECTION_GIVEN");
        setControlMessage({
          tone: "success",
          text: cadenceHint
            ? `Intent routed to planning pipeline (${cadenceHint.toLowerCase()} cadence).`
            : "Intent routed to planning pipeline."
        });
      } else if (sourceMode === "DIRECTION" && shouldForceDirectionPlanRoute(message)) {
        const toolkitHints = inferToolkitsFromDirectionPrompt(message);
        setPendingChatPlanRoute({
          prompt: message,
          reason:
            payload.intentRouting?.reason ||
            "Direction mode detected execution intent. Routing to planning pipeline.",
          toolkitHints
        });
        setControlMode("DIRECTION");
        setControlConversationDetail("DIRECTION_GIVEN");
        setControlMessage({
          tone: "success",
          text: "Direction intent routed to planning pipeline."
        });
      }
    } catch (error) {
      setControlMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Direction chat failed."
      });
    } finally {
      setDirectionChatInFlight(false);
    }
  }, [
    appendThreadEventTurn,
    directionModelId,
    directionPrompt,
    directionTurns,
    ensureOrgAccessReady,
    resolvedOrg?.id
  ]);

  const handleGenerateDirectionPlans = useCallback(
    async (
      rawDirection?: string,
      options?: {
        toolkitHints?: string[];
        navigateToPlanTab?: boolean;
        autoLaunch?: boolean;
      }
    ) => {
      const direction = (rawDirection ?? intent).trim();
      if (!resolvedOrg?.id) {
        return;
      }
      if (!direction) {
        setControlMessage({
          tone: "warning",
          text: "Write a direction prompt first."
        });
        return;
      }

      setPendingEmailApproval(null);
      setDirectionPlanningInFlight(true);
      setControlMessage(null);
      try {
        const orgReady = await ensureOrgAccessReady();
        if (!orgReady) {
          return;
        }

        if (rawDirection?.trim()) {
          setDirectionTurns((prev) => [
            ...prev,
            {
              id: `owner-direction-${Date.now()}`,
              role: "owner",
              content: rawDirection.trim()
            }
          ]);
        }

        const [provider, model] = directionModelId.split(":");
        const response = await fetch("/api/control/direction-plan", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orgId: resolvedOrg.id,
            direction,
            history: directionTurns.filter((turn) => !isTimelineEventMeta(turn.meta)).slice(-10).map((turn) => ({
              role: turn.role,
              content: turn.content
            })),
            humanPlan: humanPlanDraft.trim(),
            provider,
            model
          })
        });

        const { payload, rawText } = await parseJsonBody<{
          ok?: boolean;
          message?: string;
          analysis?: string;
          directionGiven?: string;
          primaryPlan?: DirectionExecutionPlan;
          fallbackPlan?: DirectionExecutionPlan;
          requiredToolkits?: string[];
          autoSquad?: {
            triggered?: boolean;
            domain?: string;
            requestedRoles?: string[];
            created?: Array<{ id: string; name: string; role: string }>;
          };
          directionRecord?: { id?: string };
          planRecord?: { id?: string };
          permissionRequests?: PermissionRequestItem[];
          requestCount?: number;
          model?: { provider?: string | null; name?: string | null };
        }>(response);

        if (
          !response.ok ||
          !payload?.ok ||
          !payload.primaryPlan ||
          !payload.fallbackPlan
        ) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed generating plans (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed generating plans.")
          );
        }

        const refinedDirection = payload.directionGiven?.trim() || direction;
        const analysis = normalizePlanAnalysisText(payload.analysis);
        const planToolkitsRaw = [
          ...new Set(
            [
              ...(payload.requiredToolkits ?? []),
              ...collectPlanToolkits(payload.primaryPlan),
              ...collectPlanToolkits(payload.fallbackPlan),
              ...(options?.toolkitHints ?? [])
            ]
              .map((item) => normalizeToolkitAlias(item))
              .filter(Boolean)
          )
        ];
        const planToolkits = isGmailDirectionPrompt(refinedDirection)
          ? ["gmail"]
          : planToolkitsRaw;
        setIntent(refinedDirection);
        setDirectionPlanningResult({
          analysis,
          directionGiven: refinedDirection,
          primaryPlan: payload.primaryPlan,
          fallbackPlan: payload.fallbackPlan,
          permissionRequests: payload.permissionRequests ?? [],
          requiredToolkits: planToolkits,
          autoSquad: payload.autoSquad,
          directionRecord: payload.directionRecord,
          planRecord: payload.planRecord
        });
        appendStructuredOrganizationTurn({
          content: `Plan prepared with ${payload.primaryPlan.workflows.length} workflows and ${payload.primaryPlan.workflows.reduce((sum, workflow) => sum + workflow.tasks.length, 0)} tasks.`,
          meta: buildPlanCardMeta({
            direction: refinedDirection,
            plan: payload.primaryPlan,
            requiredToolkits: planToolkits
          })
        });
        const pathwaySteps = payload.primaryPlan.pathway ?? [];
        if (pathwaySteps.length > 0) {
          const preview = pathwaySteps
            .slice(0, 4)
            .map((step) => `${step.line}. ${step.taskTitle} -> ${step.ownerRole}`)
            .join("\n");
          setDirectionTurns((prev) => [
            ...prev,
            {
              id: `pathway-${Date.now()}`,
              role: "organization",
              content: `Pathway ready with ${pathwaySteps.length} ordered step(s).\n${preview}`
            }
          ]);
        }
        if (options?.autoLaunch) {
          setPendingPlanLaunchApproval(null);
          setPendingAutoLaunchPrompt(refinedDirection);
          appendStructuredOrganizationTurn({
            content: "Plan approved for automatic launch. Moving from planning to execution.",
            meta: {
              kind: "workflow_event",
              title: "Auto Launch Scheduled",
              message:
                "Direction mode generated a plan and queued immediate launch using this approved direction.",
              eventName: "plan.auto_launch",
              status: "QUEUED",
              timestamp: Date.now()
            }
          });
        } else {
          setPendingPlanLaunchApproval({
            prompt: refinedDirection,
            toolkits: planToolkits,
            reason: "Plan ready. User approval required before launching workflow."
          });
        }
        setPendingToolkitApproval(null);
        setApprovedToolkitRequestId(null);
        setControlConversationDetail("DIRECTION_GIVEN");

        const modelLabel = [payload.model?.provider, payload.model?.name]
          .filter((value): value is string => Boolean(value))
          .join(" / ");
        if (analysis) {
          setDirectionTurns((prev) => [
            ...prev,
            {
              id: `plan-${Date.now()}`,
              role: "organization",
              content: analysis,
              ...(modelLabel ? { modelLabel } : {})
            }
          ]);
        }

        const autoSquad = payload.autoSquad;
        const autoSquadCreated = autoSquad?.created ?? [];

        if (autoSquadCreated.length > 0) {
          const createdLabel = autoSquadCreated
            .map((item) => item.role)
            .join(", ");
          setDirectionTurns((prev) => [
            ...prev,
            {
              id: `auto-squad-${Date.now()}`,
              role: "organization",
              content: `Auto-WorkForce bootstrap completed (${autoSquad?.domain ?? "general"}): ${createdLabel}.`
            }
          ]);
        } else if (autoSquad?.triggered) {
          const roleLabel = (autoSquad.requestedRoles ?? []).join(", ");
          setDirectionTurns((prev) => [
            ...prev,
            {
              id: `auto-squad-existing-${Date.now()}`,
              role: "organization",
              content: roleLabel
                ? `WorkForce intent detected (${autoSquad.domain ?? "general"}). Matching agents already exist: ${roleLabel}.`
                : `WorkForce intent detected (${autoSquad.domain ?? "general"}). Matching agents already exist.`
            }
          ]);
        }

        await Promise.all([
          loadPermissionRequests({ force: true }),
          loadApprovalCheckpoints({ force: true })
        ]);
        const autoSquadCreatedCount = autoSquadCreated.length;
        setControlMessage({
          tone: "success",
          text: options?.autoLaunch
            ? `Plans prepared and queued for auto launch.${payload.requestCount ? ` ${payload.requestCount} permission requests raised.` : ""}${autoSquadCreatedCount > 0 ? ` Auto-WorkForce created ${autoSquadCreatedCount} agents.` : autoSquad?.triggered ? " Auto-WorkForce detected existing matching agents." : ""}`
            : `Plans prepared.${payload.requestCount ? ` ${payload.requestCount} permission requests raised.` : ""}${autoSquadCreatedCount > 0 ? ` Auto-WorkForce created ${autoSquadCreatedCount} agents.` : autoSquad?.triggered ? " Auto-WorkForce detected existing matching agents." : ""} Review in Plan section and approve launch.`
        });
        if (options?.navigateToPlanTab !== false && !options?.autoLaunch) {
          handleTabChange("plan");
        }
      } catch (error) {
        setControlMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Plan generation failed."
        });
      } finally {
        setDirectionPlanningInFlight(false);
      }
    },
    [
      appendThreadEventTurn,
      appendStructuredOrganizationTurn,
      directionModelId,
      directionTurns,
      ensureOrgAccessReady,
      handleTabChange,
      humanPlanDraft,
      intent,
      loadApprovalCheckpoints,
      loadPermissionRequests,
      resolvedOrg?.id
    ]
  );

  const handlePermissionRequestDecision = useCallback(
    async (requestId: string, decision: "APPROVE" | "REJECT") => {
      if (!resolvedOrg?.id) {
        return;
      }
      setPermissionRequestActionId(requestId);
      try {
        const response = await fetch(`/api/requests/${requestId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orgId: resolvedOrg.id,
            decision
          })
        });

        const { payload, rawText } = await parseJsonBody<{
          ok?: boolean;
          message?: string;
        }>(response);
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed updating request (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed updating request.")
          );
        }

        await Promise.all([
          loadPermissionRequests({ force: true }),
          loadApprovalCheckpoints({ force: true })
        ]);
      } catch (error) {
        setControlMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Request update failed."
        });
      } finally {
        setPermissionRequestActionId(null);
      }
    },
    [loadApprovalCheckpoints, loadPermissionRequests, resolvedOrg?.id]
  );

  const handleApprovalCheckpointDecision = useCallback(
    async (checkpointId: string, decision: "APPROVE" | "REJECT") => {
      if (!resolvedOrg?.id) {
        return;
      }
      setApprovalCheckpointActionId(checkpointId);
      try {
        const response = await fetch(
          `/api/approvals/checkpoints/${encodeURIComponent(checkpointId)}/resolve`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              orgId: resolvedOrg.id,
              decision
            })
          }
        );

        const { payload, rawText } = await parseJsonBody<{
          ok?: boolean;
          message?: string;
          warning?: string;
        }>(response);
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed updating checkpoint (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed updating checkpoint.")
          );
        }

        await loadApprovalCheckpoints({ force: true });
        if (payload.warning) {
          setControlMessage({
            tone: "warning",
            text: payload.warning
          });
        }
      } catch (error) {
        setControlMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Checkpoint update failed."
        });
      } finally {
        setApprovalCheckpointActionId(null);
      }
    },
    [loadApprovalCheckpoints, resolvedOrg?.id]
  );

  const handleClearPermissionRequests = useCallback(async () => {
    if (!resolvedOrg?.id || clearPermissionRequestsInFlight) {
      return;
    }

    setClearPermissionRequestsInFlight(true);
    setShowClearPermissionRequestsConfirm(false);
    try {
      const response = await fetch(
        `/api/requests?orgId=${encodeURIComponent(resolvedOrg.id)}`,
        {
          method: "DELETE"
        }
      );

      const { payload, rawText } = await parseJsonBody<{
        ok?: boolean;
        message?: string;
        clearedCount?: number;
      }>(response);

      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed clearing requests (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed clearing requests.")
        );
      }

      await loadPermissionRequests({ force: true });
      setControlMessage({
        tone: "success",
        text: `Cleared ${payload.clearedCount ?? 0} permission requests.`
      });
    } catch (error) {
      setControlMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed clearing requests."
      });
    } finally {
      setClearPermissionRequestsInFlight(false);
    }
  }, [clearPermissionRequestsInFlight, loadPermissionRequests, resolvedOrg?.id]);

  const getConnectedToolkits = useCallback(async () => {
    if (!resolvedOrg?.id) {
      return {
        enabled: false,
        active: new Set<string>()
      };
    }
    if (!authHeaders) {
      throw new Error("Sign in first to use connected tools.");
    }

    const response = await fetch(
      `/api/integrations/composio/connections?orgId=${encodeURIComponent(resolvedOrg.id)}`,
      {
        method: "GET",
        cache: "no-store",
        headers: authHeaders
      }
    );

    const { payload, rawText } = await parseJsonBody<{
      ok?: boolean;
      enabled?: boolean;
      message?: string;
      connections?: Array<{
        toolkit?: string;
        status?: string;
      }>;
    }>(response);

    if (!response.ok || !payload?.ok) {
      throw new Error(
        payload?.message ??
          (rawText
            ? `Failed to load integration connections (${response.status}): ${rawText.slice(0, 180)}`
            : "Failed to load integration connections.")
      );
    }

    const active = new Set(
      (payload.connections ?? [])
        .map((item) => ({
          toolkit:
            typeof item.toolkit === "string" ? normalizeToolkitAlias(item.toolkit) : "",
          status: typeof item.status === "string" ? item.status.trim().toUpperCase() : ""
        }))
        .filter((item) => item.toolkit && item.status === "ACTIVE")
        .map((item) => item.toolkit)
    );

    return {
      enabled: payload.enabled !== false,
      active
    };
  }, [authHeaders, resolvedOrg?.id]);

  const connectToolkitsWithOauth = useCallback(
    async (missing: string[], prompt: string) => {
      if (!resolvedOrg?.id || missing.length === 0) {
        return true;
      }
      if (!authHeaders) {
        setControlMessage({
          tone: "error",
          text: "Sign in first to connect required tools."
        });
        return false;
      }

      setToolkitConnectInFlight(true);
      try {
        for (const toolkit of missing) {
          const response = await fetch("/api/integrations/composio/connect", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeaders
            },
            body: JSON.stringify({
              orgId: resolvedOrg.id,
              toolkit,
              returnTo: `${window.location.origin}/app?tab=control`
            })
          });
          const { payload, rawText } = await parseJsonBody<{
            ok?: boolean;
            message?: string;
            connectUrl?: string;
          }>(response);

          if (!response.ok || !payload?.ok || !payload.connectUrl) {
            throw new Error(
              payload?.message ??
                (rawText
                  ? `Unable to connect ${toolkit} (${response.status}): ${rawText.slice(0, 180)}`
                  : `Unable to connect ${toolkit}.`)
            );
          }

          setControlMessage({
            tone: "warning",
            text: `Connect ${toolkit} in popup. Main Agent will continue once linked.`
          });
          const popup = openCenteredPopup(payload.connectUrl, `integrations-${toolkit}`);
          if (!popup) {
            window.location.assign(payload.connectUrl);
            return false;
          }

          const timeoutMs = 120000;
          const startedAt = Date.now();
          let connected = false;

          while (Date.now() - startedAt < timeoutMs) {
            await sleep(2500);
            const current = await getConnectedToolkits();
            if (current.active.has(toolkit)) {
              connected = true;
              break;
            }
          }

          if (!connected) {
            setControlMessage({
              tone: "warning",
              text: `Still waiting for ${toolkit} connection. Complete OAuth, then approve again.`
            });
            return false;
          }
        }

        setControlMessage({
          tone: "success",
          text: `Required integrations connected. Continuing task: ${prompt.slice(0, 80)}`
        });
        setPendingToolkitApproval(null);
        setApprovedToolkitRequestId(null);
        return true;
      } finally {
        setToolkitConnectInFlight(false);
      }
    },
    [authHeaders, getConnectedToolkits, resolvedOrg?.id]
  );

  const ensureRequestedToolkitsReady = useCallback(
    async (requestedToolkits: string[], prompt: string) => {
      if (!resolvedOrg?.id || requestedToolkits.length === 0) {
        setPendingToolkitApproval(null);
        setApprovedToolkitRequestId(null);
        return true;
      }

      const uniqueRequestedToolkits = [
        ...new Set(requestedToolkits.map((item) => normalizeToolkitAlias(item)).filter(Boolean))
      ];
      const firstPass = await getConnectedToolkits();
      if (!firstPass.enabled) {
        setControlMessage({
          tone: "warning",
          text:
            "Tool integrations are disabled for this workspace. Enable integrations to execute app actions."
        });
        return false;
      }

      const missing = uniqueRequestedToolkits.filter((toolkit) => !firstPass.active.has(toolkit));
      if (missing.length === 0) {
        setPendingToolkitApproval(null);
        setApprovedToolkitRequestId(null);
        return true;
      }

      const requestId = buildToolkitApprovalRequestId(prompt, missing);
      if (approvedToolkitRequestId !== requestId) {
        if (pendingToolkitApproval?.requestId !== requestId) {
          setPendingToolkitApproval({
            requestId,
            prompt,
            toolkits: missing
          });
          setDirectionTurns((prev) => [
            ...prev,
            {
              id: `org-toolkit-approval-${Date.now()}`,
              role: "organization",
              content: [
                `Required tool access: ${formatToolkitList(missing)}.`,
                "Approve to connect these integrations now, or reject to keep the workflow paused."
              ].join("\n")
            }
          ]);
        }
        setControlMessage({
          tone: "warning",
          text: `Approval required: connect ${formatToolkitList(missing)} to continue.`
        });
        return false;
      }

      return connectToolkitsWithOauth(missing, prompt);
    },
    [
      approvedToolkitRequestId,
      connectToolkitsWithOauth,
      getConnectedToolkits,
      pendingToolkitApproval?.requestId,
      resolvedOrg?.id
    ]
  );

  const handleLaunchMainAgent = useCallback(async (
    promptOverride?: string,
    inputOverride?: Record<string, string>,
    options?: { confirmEmailDraft?: boolean }
  ) => {
    const prompt = (promptOverride ?? intent).trim();
    const confirmEmailDraft = options?.confirmEmailDraft === true;
    if (!prompt) {
      setControlMessage({
        tone: "error",
        text: "Direction is required before launching the Main Agent."
      });
      return;
    }

    const strictPlanFirst =
      (pipelinePolicy?.enforcePlanBeforeExecution === true ||
        pipelinePolicy?.requireDetailedPlan === true ||
        pipelinePolicy?.requireMultiWorkflowDecomposition === true) &&
      pipelinePolicy?.strictFeatureEnabled === true;
    if (strictPlanFirst && !directionPlanningResult?.planRecord?.id) {
      const toolkitHints = inferToolkitsFromDirectionPrompt(prompt);
      setIntent(prompt);
      if (controlMode !== "DIRECTION") {
        appendThreadEventTurn({
          content: "Moved to direction.",
          title: "Moved To Direction",
          message:
            "Plan-first policy is active, so this thread moved into direction before execution launch.",
          eventName: "thread.mode.direction",
          scope: "MODE"
        });
      }
      setControlMode("DIRECTION");
      setControlConversationDetail("DIRECTION_GIVEN");
      setPendingChatPlanRoute(null);
      setControlMessage({
        tone: "warning",
        text:
          "Plan-first policy is active. Creating plan now; approve the plan before execution launch."
      });
      await handleGenerateDirectionPlans(prompt, {
        toolkitHints,
        navigateToPlanTab: true
      });
      return;
    }

    if (launchInFlight) {
      return;
    }

    if (pendingLaunchPermissionRequestCount > 0) {
      setControlMessage({
        tone: "warning",
        text: `Resolve ${pendingLaunchPermissionRequestCount} pending permission request(s) before launch.`
      });
      return;
    }

    if (rejectedLaunchPermissionRequestCount > 0) {
      setControlMessage({
        tone: "error",
        text: `Launch blocked: ${rejectedLaunchPermissionRequestCount} permission request(s) were rejected. Regenerate plan or update direction.`
      });
      return;
    }

    setLaunchInFlight(true);
    setControlMessage(null);

    try {
      const orgReady = await ensureOrgAccessReady();
      if (!orgReady) {
        return;
      }

      const inferredToolkits = inferToolkitsFromDirectionPrompt(prompt);
      const requestedToolkits = isGmailDirectionPrompt(prompt)
        ? ["gmail"]
        : inferredToolkits;
      const toolkitsReady = await ensureRequestedToolkitsReady(requestedToolkits, prompt);
      if (!toolkitsReady) {
        return;
      }

      if (isGmailDirectionPrompt(prompt)) {
        if (!user?.uid || !user.email) {
          setControlMessage({
            tone: "error",
            text: "Sign in first to run Gmail actions through Main Agent."
          });
          return;
        }

        if (confirmEmailDraft) {
          if (!pendingEmailApproval) {
            setControlMessage({
              tone: "warning",
              text: "No pending draft found. Generate preview first, then approve."
            });
            return;
          }
          if (pendingEmailApproval.prompt.trim() !== prompt) {
            setControlMessage({
              tone: "warning",
              text: "Draft approval expired due to prompt change. Regenerate draft first."
            });
            return;
          }
        }

        const intentEnrichment = enrichMessageForIntent(prompt);
        const runtimeInput: Record<string, string> = {
          ...(inputOverride ?? agentRunInputValues),
          orgId: resolvedOrg?.id ?? ""
        };
        if (confirmEmailDraft && pendingEmailApproval) {
          runtimeInput.recipient_email = pendingEmailApproval.draft.to;
          runtimeInput.subject = pendingEmailApproval.draft.subject;
          runtimeInput.body = pendingEmailApproval.draft.body;
        }
        const response = await fetch("/api/agent/run", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(authHeaders ?? {})
          },
          body: JSON.stringify({
            prompt: intentEnrichment.message,
            input: runtimeInput,
            confirm: confirmEmailDraft,
            orgId: resolvedOrg?.id,
            ...(agentRunId ? { runId: agentRunId } : {})
          })
        });

        const { payload, rawText } = await parseJsonBody<AgentRunResponse>(response);
        if (!payload) {
          throw new Error(
            rawText
              ? `Main Agent returned a non-JSON response (${response.status}).`
              : `Main Agent request failed (${response.status}).`
          );
        }

        setAgentRunPromptSnapshot(prompt);
        setAgentRunResult(payload);
        if (typeof payload.runId === "string" && payload.runId.trim()) {
          setAgentRunId(payload.runId.trim());
        }
        if (payload.status !== "needs_input") {
          setAgentRunInputSourceUrl("");
          setAgentRunInputFile(null);
        }
        if (payload.draft) {
          setAgentRunInputValues((previous) => ({
            ...previous,
            recipient_email: payload.draft?.to || previous.recipient_email || "",
            subject: payload.draft?.subject || previous.subject || "",
            body: payload.draft?.body || previous.body || ""
          }));
        }

        if (payload.status === "completed") {
          const hasDelivery = Boolean(payload.delivery);
          const deliveryVerified = payload.delivery?.verified === true;
          const deliveryAccepted =
            payload.delivery?.acceptedByProvider === true || deliveryVerified;
          const completionMessage =
            payload.assistant_message?.trim() ||
            (hasDelivery
              ? deliveryVerified
                ? "Email sent."
                : deliveryAccepted
                  ? "Email submission accepted, but delivery is not yet verified."
                  : "Email send state is uncertain. Verify in Sent folder."
              : "Main Agent completed the Gmail action.");
          const recipient =
            pendingEmailApproval?.draft.to ||
            (typeof runtimeInput["recipient_email"] === "string"
              ? runtimeInput["recipient_email"]
              : "") ||
            "manager";
          setPendingEmailApproval(null);
          setPendingChatPlanRoute({
            prompt: `Track leave request status for ${recipient} and prepare next action plan.`,
            reason: "Follow-up execution plan requested after completed email action.",
            toolkitHints: []
          });
          setDirectionTurns((prev) => [
            ...prev,
            {
              id: `org-email-complete-${Date.now()}`,
              role: "organization",
              content: completionMessage
            }
          ]);
          setControlMessage({
            tone: hasDelivery ? (deliveryVerified ? "success" : "warning") : "success",
            text: completionMessage
          });
        } else if (payload.status === "needs_input") {
          const requiredInputLines = (payload.required_inputs ?? [])
            .map((item) => `- ${item.label}`)
            .join("\n");
          setDirectionTurns((prev) => [
            ...prev,
            {
              id: `org-email-input-${Date.now()}`,
              role: "organization",
              content: [
                payload.assistant_message || "I need more information to continue.",
                requiredInputLines ? `\nRequired:\n${requiredInputLines}` : ""
              ]
                .filter(Boolean)
                .join("\n")
            }
          ]);
          setControlMessage({
            tone: "warning",
            text: payload.assistant_message || "Provide required details and submit again."
          });
        } else if (payload.status === "needs_confirmation") {
          const draft =
            payload.draft && payload.draft.to && payload.draft.subject && payload.draft.body
              ? payload.draft
              : runtimeInput.recipient_email && runtimeInput.subject && runtimeInput.body
                ? {
                    to: runtimeInput.recipient_email,
                    subject: runtimeInput.subject,
                    body: runtimeInput.body
                  }
                : null;
          if (draft) {
            setPendingEmailApproval({
              prompt,
              draft
            });
            setDirectionTurns((prev) => [
              ...prev,
              {
                id: `org-email-draft-${Date.now()}`,
                role: "organization",
                content: [
                  payload.assistant_message || "Draft ready for your approval.",
                  "",
                  formatDraftForChat(draft)
                ].join("\n")
              }
            ]);
          }
          setControlMessage({
            tone: "warning",
            text: payload.assistant_message
              ? `${payload.assistant_message} No email sent yet. Reply "approve" in chat to send.`
              : "Draft ready. No email has been sent yet. Reply \"approve\" in chat to send."
          });
        } else {
          const connectUrl =
            payload.error?.code === "INTEGRATION_NOT_CONNECTED" &&
            typeof payload.error?.details?.connectUrl === "string"
              ? payload.error.details.connectUrl
              : "";
          setControlMessage({
            tone: "error",
            text: [
              payload.error?.message || payload.assistant_message || "Main Agent run failed.",
              connectUrl ? `Connect Gmail first: ${connectUrl}` : ""
            ]
              .filter(Boolean)
              .join("\n")
          });
        }
        return;
      }

      setAgentRunResult(null);
      setAgentRunId("");
      setAgentRunInputValues({});
      setAgentRunPromptSnapshot("");

      const response = await fetch("/api/flows", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orgId: resolvedOrg?.id,
          prompt,
          directionId: directionPlanningResult?.directionRecord?.id || undefined,
          planId: directionPlanningResult?.planRecord?.id || undefined,
          planWorkflows: directionPlanningResult?.primaryPlan?.workflows ?? undefined,
          planPathway: directionPlanningResult?.primaryPlan?.pathway ?? undefined,
          swarmDensity,
          predictedBurn,
          requiredSignatures,
          permissionRequestIds:
            launchPermissionRequestIds.length > 0
              ? launchPermissionRequestIds
              : undefined,
          requestedToolkits
        })
      });

      const { payload, rawText } = await parseJsonBody<{
        ok?: boolean;
        warning?: string;
        message?: string;
        flow?: {
          id: string;
          status: string;
          executionMode?: string;
          approvalsCaptured?: number;
          requiredSignatures?: number;
        };
      }>(response);

      if (!payload) {
        throw new Error(
          rawText
            ? `Flow launch failed (${response.status}): ${rawText.slice(0, 200)}`
            : `Flow launch failed (${response.status}).`
        );
      }

      if (!response.ok || !payload.ok) {
        setControlMessage({
          tone: "error",
          text: payload.message ?? "Failed to launch workflow."
        });
        return;
      }

      const flowStatus = (payload.flow?.status ?? "").toUpperCase();
      if (flowStatus === "DRAFT") {
        const approvalsCaptured = payload.flow?.approvalsCaptured ?? 1;
        const required = payload.flow?.requiredSignatures ?? requiredSignatures;
        setControlMessage({
          tone: "warning",
          text:
            payload.warning ??
            `Flow ${payload.flow?.id ?? ""} created in draft. Additional signatures required (${approvalsCaptured}/${required}).`
        });
      } else {
        setControlMessage({
          tone: payload.warning ? "warning" : "success",
          text: payload.warning
            ? `Flow ${payload.flow?.id ?? ""} queued with warning: ${payload.warning}`
            : `Flow ${payload.flow?.id ?? ""} queued successfully (${payload.flow?.status ?? "QUEUED"} | ${payload.flow?.executionMode ?? "MULTI_AGENT"}).`
        });
      }

      const launchedFlowId =
        typeof payload.flow?.id === "string" && payload.flow.id.trim().length > 0
          ? payload.flow.id.trim()
          : "";
      if (launchedFlowId) {
        setControlScopedFlowIds((previous) => [
          launchedFlowId,
          ...previous.filter((item) => item !== launchedFlowId)
        ].slice(0, 40));
        appendThreadEventTurn({
          content: "Moved to flow.",
          title: "Moved To Flow",
          message:
            flowStatus === "DRAFT"
              ? `Approved work moved from planning into FLOW and is waiting on signatures for ${launchedFlowId.slice(0, 8)}.`
              : `Approved work moved from planning into FLOW for workflow ${launchedFlowId.slice(0, 8)}.`,
          eventName: "thread.mode.flow",
          scope: "EXECUTION",
          status: payload.flow?.status ?? "QUEUED"
        });
        appendStructuredOrganizationTurn({
          content:
            flowStatus === "DRAFT"
              ? `Workflow ${launchedFlowId.slice(0, 8)} is waiting for signatures before execution.`
              : `Workflow ${launchedFlowId.slice(0, 8)} is now running through agent tasks.`,
          meta: {
            kind: "workflow_event",
            title: flowStatus === "DRAFT" ? "Workflow Awaiting Signatures" : "Workflow Launched",
            message:
              flowStatus === "DRAFT"
                ? `Flow ${launchedFlowId.slice(0, 8)} created in draft mode. Capture remaining signatures to begin execution.`
                : `Flow ${launchedFlowId.slice(0, 8)} queued. Live task graph is now tracking agent assignments and task progress.`,
            eventName: flowStatus === "DRAFT" ? "flow.created" : "flow.queued",
            flowId: launchedFlowId,
            status: payload.flow?.status ?? "QUEUED",
            timestamp: Date.now()
          }
        });
        queueWorkflowSnapshotTurn(launchedFlowId, "Live Workflow Runtime");
        void loadApprovalCheckpoints({ force: true });
      }

      handleTabChange("flow");
    } catch (error) {
      setControlMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Unexpected launch error."
      });
    } finally {
      setLaunchInFlight(false);
    }
  }, [
    appendThreadEventTurn,
    appendStructuredOrganizationTurn,
    intent,
    launchInFlight,
    agentRunId,
    agentRunInputValues,
    pendingEmailApproval,
    authHeaders,
    handleGenerateDirectionPlans,
    directionPlanningResult?.directionRecord?.id,
    directionPlanningResult?.planRecord?.id,
    directionPlanningResult?.primaryPlan,
    handleTabChange,
    ensureOrgAccessReady,
    ensureRequestedToolkitsReady,
    predictedBurn,
    pendingLaunchPermissionRequestCount,
    rejectedLaunchPermissionRequestCount,
    requiredSignatures,
    resolvedOrg?.id,
    controlMode,
    queueWorkflowSnapshotTurn,
    launchPermissionRequestIds,
    loadApprovalCheckpoints,
    pipelinePolicy?.enforcePlanBeforeExecution,
    pipelinePolicy?.requireDetailedPlan,
    pipelinePolicy?.requireMultiWorkflowDecomposition,
    pipelinePolicy?.strictFeatureEnabled,
    swarmDensity,
    user?.uid,
    user?.email
  ]);

  const handleApprovePlanLaunch = useCallback(async () => {
    if (!pendingPlanLaunchApproval || launchInFlight || toolkitConnectInFlight) {
      return;
    }

    const prompt = pendingPlanLaunchApproval.prompt.trim();
    const requestedToolkitsRaw = [...new Set(pendingPlanLaunchApproval.toolkits)];
    const requestedToolkits = isGmailDirectionPrompt(prompt)
      ? ["gmail"]
      : requestedToolkitsRaw;
    if (!prompt) {
      setControlMessage({
        tone: "warning",
        text: "Plan approval requires a direction prompt."
      });
      return;
    }

    if (requestedToolkits.length > 0) {
      const requestId = buildToolkitApprovalRequestId(prompt, requestedToolkits);
      setPendingToolkitApproval({
        requestId,
        prompt,
        toolkits: requestedToolkits
      });
      setPendingPlanLaunchApproval(null);
      setControlMessage({
        tone: "warning",
        text: `Tool approval required before launch: ${formatToolkitList(requestedToolkits)}.`
      });
      setDirectionTurns((prev) => [
        ...prev,
        {
          id: `org-plan-toolkit-approval-${Date.now()}`,
          role: "organization",
          content: `Before launch, approve tools: ${formatToolkitList(requestedToolkits)}.`
        }
      ]);
      return;
    }

    setIntent(prompt);
    setPendingPlanLaunchApproval(null);
    await handleLaunchMainAgent(prompt);
  }, [
    handleLaunchMainAgent,
    launchInFlight,
    pendingPlanLaunchApproval,
    toolkitConnectInFlight
  ]);

  const handleRejectPlanLaunch = useCallback(() => {
    if (!pendingPlanLaunchApproval) {
      return;
    }
    setPendingPlanLaunchApproval(null);
    setControlMessage({
      tone: "warning",
      text: "Plan launch rejected. You can revise the plan and approve later."
    });
  }, [pendingPlanLaunchApproval]);

  const handleApproveToolkitAccess = useCallback(async () => {
    if (!pendingToolkitApproval || launchInFlight || toolkitConnectInFlight) {
      return;
    }
    setApprovedToolkitRequestId(pendingToolkitApproval.requestId);
    setIntent(pendingToolkitApproval.prompt);
    await handleLaunchMainAgent(pendingToolkitApproval.prompt);
  }, [
    handleLaunchMainAgent,
    launchInFlight,
    pendingToolkitApproval,
    toolkitConnectInFlight
  ]);

  const handleRejectToolkitAccess = useCallback(() => {
    if (!pendingToolkitApproval) {
      return;
    }
    const toolkitLabel = formatToolkitList(pendingToolkitApproval.toolkits);
    setPendingToolkitApproval(null);
    setApprovedToolkitRequestId(null);
    setDirectionTurns((prev) => [
      ...prev,
      {
        id: `org-toolkit-reject-${Date.now()}`,
        role: "organization",
        content: `Tool access rejected for ${toolkitLabel}. Workflow remains paused until approval.`
      }
    ]);
    setControlMessage({
      tone: "warning",
      text: `Tool access rejected for ${toolkitLabel}.`
    });
  }, [pendingToolkitApproval]);

  const handleApproveEmailDraft = useCallback(async () => {
    if (!pendingEmailApproval || launchInFlight) {
      return;
    }
    setIntent(pendingEmailApproval.prompt);
    await handleLaunchMainAgent(pendingEmailApproval.prompt, undefined, {
      confirmEmailDraft: true
    });
  }, [handleLaunchMainAgent, launchInFlight, pendingEmailApproval]);

  const handleRejectEmailDraft = useCallback(() => {
    if (!pendingEmailApproval) {
      return;
    }
    setPendingEmailApproval(null);
    setDirectionTurns((prev) => [
      ...prev,
      {
        id: `org-email-cancel-${Date.now()}`,
        role: "organization",
        content: "Draft canceled. Share updated instructions when you want a new draft."
      }
    ]);
    setControlMessage({
      tone: "warning",
      text: "Draft rejected. No email was sent."
    });
  }, [pendingEmailApproval]);

  const handleRejectAgentInput = useCallback(() => {
    setAgentRunResult(null);
    setAgentRunId("");
    setAgentRunInputValues({});
    setAgentRunInputSourceUrl("");
    setAgentRunInputFile(null);
    setAgentRunInputSubmitting(false);
    setControlMessage({
      tone: "warning",
      text: "Missing-input request rejected. Task paused until you provide required details."
    });
  }, []);

  const handleSubmitAgentInputs = useCallback(async () => {
    if (agentRunInputSubmitting) {
      return;
    }
    if (agentRunResult?.status !== "needs_input") {
      return;
    }
    const requiredInputs = agentRunResult.required_inputs ?? [];
    const missingField = requiredInputs.find((item) => {
      const value = (agentRunInputValues[item.key] ?? "").trim();
      return value.length === 0;
    });
    if (missingField) {
      setControlMessage({
        tone: "warning",
        text: `Missing required field: ${missingField.label}.`
      });
      return;
    }

    const prompt = (agentRunPromptSnapshot || intent).trim();
    if (!prompt) {
      setControlMessage({
        tone: "error",
        text: "Direction prompt is missing. Send direction again."
      });
      return;
    }

    setAgentRunInputSubmitting(true);
    try {
      const runtimeInput = { ...agentRunInputValues };
      const uploadedRefs: string[] = [];
      const sourceUrl = agentRunInputSourceUrl.trim();

      if (sourceUrl) {
        const sourceRef = await uploadHumanInputToHub({
          sourceUrl,
          name: `agent-input-source-${Date.now()}`
        });
        uploadedRefs.push(sourceRef);
      }

      if (agentRunInputFile instanceof File) {
        const fileRef = await uploadHumanInputToHub({
          file: agentRunInputFile,
          name: agentRunInputFile.name
        });
        uploadedRefs.push(fileRef);
      }

      if (uploadedRefs.length > 0) {
        const existingContext = (runtimeInput.context ?? "").trim();
        runtimeInput.context = [
          existingContext,
          `Additional Hub context refs: ${uploadedRefs.join(", ")}`
        ]
          .filter(Boolean)
          .join("\n");
      }

      setAgentRunInputValues(runtimeInput);
      setAgentRunInputSourceUrl("");
      setAgentRunInputFile(null);
      await handleLaunchMainAgent(prompt, runtimeInput);
    } catch (error) {
      setControlMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to submit required input."
      });
    } finally {
      setAgentRunInputSubmitting(false);
    }
  }, [
    agentRunInputFile,
    agentRunInputSourceUrl,
    agentRunInputSubmitting,
    agentRunInputValues,
    agentRunPromptSnapshot,
    agentRunResult,
    handleLaunchMainAgent,
    intent,
    uploadHumanInputToHub
  ]);

  useEffect(() => {
    if (!pendingChatPlanRoute) {
      return;
    }
    if (directionPlanningInFlight || launchInFlight) {
      return;
    }

    let cancelled = false;
    const pending = pendingChatPlanRoute;
    const routeKey = [
      pending.prompt.trim().toLowerCase(),
      [...new Set((pending.toolkitHints ?? []).map((item) => item.trim().toLowerCase()))]
        .sort()
        .join(",")
    ].join("|");

    if (pendingPlanRouteHandledKeyRef.current === routeKey) {
      setPendingChatPlanRoute((current) => (current === pending ? null : current));
      return;
    }
    pendingPlanRouteHandledKeyRef.current = routeKey;
    setPendingChatPlanRoute((current) => (current === pending ? null : current));

    const run = async () => {
      try {
        await handleGenerateDirectionPlans(pending.prompt, {
          toolkitHints: pending.toolkitHints,
          navigateToPlanTab: false
        });
      } finally {
        pendingPlanRouteHandledKeyRef.current = null;
        if (!cancelled) {
          setPendingChatPlanRoute((current) => (current === pending ? null : current));
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    directionPlanningInFlight,
    handleGenerateDirectionPlans,
    launchInFlight,
    pendingChatPlanRoute
  ]);

  useEffect(() => {
    const prompt = pendingAutoLaunchPrompt?.trim();
    if (!prompt) {
      return;
    }
    if (directionPlanningInFlight || launchInFlight) {
      return;
    }
    if (!directionPlanningResult?.planRecord?.id) {
      return;
    }

    let cancelled = false;
    setPendingAutoLaunchPrompt(null);
    const run = async () => {
      try {
        await handleLaunchMainAgent(prompt);
      } finally {
        if (!cancelled) {
          setPendingAutoLaunchPrompt(null);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    directionPlanningInFlight,
    directionPlanningResult?.planRecord?.id,
    handleLaunchMainAgent,
    launchInFlight,
    pendingAutoLaunchPrompt
  ]);

  return (
    <div className="vx-shell relative h-[100dvh] overflow-x-hidden overflow-y-hidden bg-vx-bg text-slate-100 transition-all duration-500">
      <div className="flex h-full min-w-0 overflow-hidden">
        <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <header className="relative z-30 flex min-h-[4.5rem] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#05070a]/50 px-4 py-3 backdrop-blur-xl md:h-[4.75rem] md:min-h-[4.75rem] md:flex-nowrap md:px-6 md:py-0 lg:h-20 lg:min-h-20 lg:px-8 xl:px-10">
            <div
              className="group flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-1 transition hover:bg-white/[0.04]"
              onClick={() => {
                setShowOrgSwitcher((prev) => !prev);
                setShowRequestCenter(false);
                setShowUtilityMenu(false);
                setShowCompassStringPanel(false);
                setShowCompassCollaborationPanel(false);
              }}
            >
              <Shield size={20} className={themeStyle.accent} />
              <div className="min-w-[140px]">
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  <span className="truncate">{userDisplayName}</span>
                  <ChevronDown size={14} className="shrink-0 text-slate-400 group-hover:text-white" />
                </p>
                <p className="truncate text-xs text-slate-300">{activeProfileOrganizationName}</p>
                <div className="my-1 h-px w-full max-w-[8rem] bg-white/10" />
                <p className="text-xs text-slate-500">{activeProfileRole}</p>
              </div>
            </div>

            <div className="relative mx-4 hidden max-w-xl flex-1 md:flex lg:max-w-2xl 2xl:max-w-3xl">
              <div className="flex w-full items-center rounded-full border border-white/10 bg-white/5 px-4 py-2">
                <Command size={14} className="mr-2 text-slate-500" />
                <Search size={16} className="mr-2 text-slate-500" />
                <input
                  value={searchQuery}
                  onFocus={() => setSearchOpen(true)}
                  onBlur={closeSearch}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search screens, organizations, actions"
                  className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
                />
              </div>

              {searchOpen && (
                <div className="absolute left-0 top-12 z-50 w-full rounded-2xl border border-white/10 bg-[#0d1117] p-3 shadow-vx">
                  <div className="space-y-2">
                    {searchResults.tabs.map((item) => (
                      <button
                        key={item.id}
                        onMouseDown={() => {
                          handleTabChange(item.id);
                          setSearchQuery("");
                          setSearchOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                      >
                        <span>
                          {item.label}
                          <span className="ml-2 text-xs text-slate-500">{item.helper}</span>
                        </span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}

                    {searchResults.orgMatches.map((org) => (
                      <button
                        key={org.id}
                        onMouseDown={() => {
                          void handleSelectOrganization(org.id);
                          setSearchQuery("");
                          setSearchOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                      >
                        <span>{org.name}</span>
                        {isEarthOrgContext(org) ? <Globe2 size={14} /> : <Building2 size={14} />}
                      </button>
                    ))}

                    {searchResults.actions.map((item) => (
                      <button
                        key={item.id}
                        onMouseDown={() => {
                          item.action();
                          setSearchQuery("");
                          setSearchOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                      >
                        <span>{item.label}</span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}

                    {searchResults.tabs.length === 0 &&
                      searchResults.orgMatches.length === 0 &&
                      searchResults.actions.length === 0 && (
                        <p className="px-3 py-2 text-xs text-slate-500">
                          No matches found
                        </p>
                      )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:gap-3">
              {orgBootstrapStatus === "ready" && !hasOrganization ? (
                <button
                  onClick={openSetupChooser}
                  className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/20"
                >
                  <Building2 size={14} />
                  Setup
                </button>
              ) : null}

              {resolvedOrg ? (
                <div className="relative">
                  <button
                    onClick={() => {
                      setShowRequestCenter((prev) => !prev);
                      setShowOrgSwitcher(false);
                      setShowUtilityMenu(false);
                      setShowCompassStringPanel(false);
                      setShowCompassCollaborationPanel(false);
                      void Promise.all([
                        loadPermissionRequests({ force: true }),
                        loadApprovalCheckpoints({ force: true })
                      ]);
                    }}
                    className={`relative inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                      isRequestCenterActive
                        ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                        : "border-white/20 bg-white/5 text-slate-200 hover:bg-white/10"
                    }`}
                  >
                    <Bell size={14} />
                    <span className="hidden sm:inline">Requests</span>
                    {requestCenterPendingCount > 0 ? (
                      <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
                        {requestCenterPendingCount}
                      </span>
                    ) : null}
                  </button>

                  {showRequestCenter ? (
                    <div className="vx-scrollbar absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(26.25rem,calc(100vw-1rem))] max-h-[80vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#0d1117] p-3 shadow-vx md:max-h-[75vh]">
                      <div className="mb-2 flex items-center justify-between px-2 py-1">
                        <div>
                          <p className="text-xs font-medium text-slate-500">Request center</p>
                          <p className="text-xs text-slate-600">
                            Pending {requestCenterPendingCount} (Permissions {requestCenterPermissionPendingCount} | Checkpoints {requestCenterCheckpointPendingCount})
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {isRequestCenterScopedToCommand
                              ? "Scope: current direction string"
                              : "Scope: organization"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {canReviewPermissionRequests &&
                          requestCenterPermissionRequests.length > 0 &&
                          !isRequestCenterScopedToCommand ? (
                            <button
                              onClick={() => setShowClearPermissionRequestsConfirm(true)}
                              disabled={clearPermissionRequestsInFlight}
                              className="rounded-lg border border-red-500/35 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                            >
                              {clearPermissionRequestsInFlight ? "Clearing..." : "Clear all"}
                            </button>
                          ) : null}

                          <button
                            onClick={() => setShowRequestCenter(false)}
                            className="rounded-md p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>

                      {permissionRequestsLoading || approvalCheckpointsLoading ? (
                        <div className="inline-flex items-center gap-2 px-2 py-3 text-xs text-slate-400">
                          <Loader2 size={13} className="animate-spin" />
                          Loading requests...
                        </div>
                      ) : requestCenterPermissionRequests.length === 0 &&
                        requestCenterApprovalCheckpoints.length === 0 ? (
                        <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-4 text-xs text-slate-500">
                          No permission requests or checkpoints right now.
                        </p>
                      ) : (
                        <div className="vx-scrollbar max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                          {requestCenterPermissionRequests.length > 0 ? (
                            <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/8 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200">
                                Permission Requests
                              </p>
                            </div>
                          ) : null}
                          {requestCenterPermissionRequests.map((item) => (
                            <div
                              key={item.id}
                              className="rounded-2xl border border-white/10 bg-black/25 p-3"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-white">{item.area}</p>
                                  <p className="text-xs text-slate-500">{item.status} | Target {item.targetRole}</p>
                                </div>
                                {item.status === "PENDING" ? (
                                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-300">
                                    Pending
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-300">
                                    {item.status}
                                  </span>
                                )}
                              </div>
                              <p className="mt-2 text-xs text-slate-300">{item.reason}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                Workflow: {item.workflowTitle || "N/A"} | Task:{" "}
                                {item.taskTitle || "N/A"}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                Requested by {item.requestedByEmail}
                              </p>

                              {canReviewPermissionRequests && item.status === "PENDING" ? (
                                <div className="mt-2 flex items-center gap-2">
                                  <button
                                    onClick={() =>
                                      void handlePermissionRequestDecision(item.id, "APPROVE")
                                    }
                                    disabled={
                                      permissionRequestActionId === item.id ||
                                      clearPermissionRequestsInFlight
                                    }
                                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                                  >
                                    {permissionRequestActionId === item.id
                                      ? "Working..."
                                      : "Approve"}
                                  </button>
                                  <button
                                    onClick={() =>
                                      void handlePermissionRequestDecision(item.id, "REJECT")
                                    }
                                    disabled={
                                      permissionRequestActionId === item.id ||
                                      clearPermissionRequestsInFlight
                                    }
                                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ))}

                          {requestCenterApprovalCheckpoints.length > 0 ? (
                            <div className="rounded-xl border border-violet-500/25 bg-violet-500/8 p-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-200">
                                Approval Checkpoints
                              </p>
                            </div>
                          ) : null}
                          {requestCenterApprovalCheckpoints.map((item) => (
                            <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-white">Checkpoint {item.id.slice(0, 8)}</p>
                                  <p className="text-xs text-slate-500">
                                    {item.status} | Flow {item.flowId ? item.flowId.slice(0, 8) : "N/A"} | Task {item.taskId ? item.taskId.slice(0, 8) : "N/A"}
                                  </p>
                                </div>
                                {item.status === "PENDING" ? (
                                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-300">
                                    Pending
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-300">
                                    {item.status}
                                  </span>
                                )}
                              </div>
                              <p className="mt-2 text-xs text-slate-300">{item.reason}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                Requested {new Date(item.requestedAt).toLocaleString()}
                              </p>
                              {item.resolutionNote ? (
                                <p className="mt-1 text-xs text-slate-400">Resolution note: {item.resolutionNote}</p>
                              ) : null}

                              {item.status === "PENDING" ? (
                                <div className="mt-2 flex items-center gap-2">
                                  <button
                                    onClick={() =>
                                      void handleApprovalCheckpointDecision(item.id, "APPROVE")
                                    }
                                    disabled={approvalCheckpointActionId === item.id}
                                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                                  >
                                    {approvalCheckpointActionId === item.id ? "Working..." : "Approve"}
                                  </button>
                                  <button
                                    onClick={() =>
                                      void handleApprovalCheckpointDecision(item.id, "REJECT")
                                    }
                                    disabled={approvalCheckpointActionId === item.id}
                                    className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {resolvedOrg || isEarthWorkspaceActive ? (
                <button
                  onClick={() => {
                    handleTabChange("squad");
                    setShowRequestCenter(false);
                    setShowOrgSwitcher(false);
                    setShowUtilityMenu(false);
                    setShowCompassStringPanel(false);
                    setShowCompassCollaborationPanel(false);
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                    isWorkforceTabActive
                      ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                      : "border-white/20 bg-white/5 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  <Users size={14} />
                  <span className="hidden sm:inline">WorkForce</span>
                </button>
              ) : null}

              {resolvedOrg ? (
                <button
                  onClick={() => {
                    handleTabChange("settings");
                    setShowRequestCenter(false);
                    setShowOrgSwitcher(false);
                    setShowUtilityMenu(false);
                    setShowCompassStringPanel(false);
                    setShowCompassCollaborationPanel(false);
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                    isSettingsTabActive
                      ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                      : "border-white/20 bg-white/5 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  <SettingsIcon size={14} />
                  <span className="hidden sm:inline">Settings</span>
                </button>
              ) : null}

              {resolvedOrg && activeTab === "control" ? (
                <button
                  onClick={() => {
                    setShowCompassCollaborationPanel((prev) => !prev);
                    setShowCompassStringPanel(false);
                    setShowRequestCenter(false);
                    setShowOrgSwitcher(false);
                    setShowUtilityMenu(false);
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                    isCompassCollaborationPanelActive
                      ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                      : "border-white/20 bg-white/5 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  <Users size={14} />
                  <span className="hidden sm:inline">Participants</span>
                </button>
              ) : null}

                <button
                  onClick={() => {
                    setShowUtilityMenu((prev) => !prev);
                    setShowRequestCenter(false);
                    setShowOrgSwitcher(false);
                    setShowCompassStringPanel(false);
                    setShowCompassCollaborationPanel(false);
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                    isUtilityMenuActive
                    ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                    : "border-white/20 bg-white/5 text-slate-200 hover:bg-white/10"
                }`}
                >
                  <Activity size={14} />
                  <span className="hidden sm:inline">Utilities</span>
                </button>

              </div>

            {showUtilityMenu ? (
              <div className="vx-scrollbar absolute right-2 top-[calc(100%+0.5rem)] z-50 w-[min(20rem,calc(100vw-1rem))] max-h-[70vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#0d1117] p-3 shadow-vx md:right-10 md:top-20 md:w-[320px] md:max-h-[75vh]">
                <div className="mb-2 flex items-center justify-between px-2 py-1">
                  <p className="text-xs font-medium text-slate-500">Utilities</p>
                  <button
                    onClick={() => setShowUtilityMenu(false)}
                    className="rounded-md p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
                  >
                    <X size={14} />
                  </button>
                </div>

                <button
                  onClick={() => {
                    toggleGhostMode();
                    setShowUtilityMenu(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                    isGhostModeActive
                      ? "border-red-500/35 bg-red-500/10 text-red-200"
                      : "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    {isGhostModeActive ? <Ghost size={14} /> : <UserCheck size={14} />}
                    Ghost protocol
                  </span>
                  <span className="text-xs">{isGhostModeActive ? "On" : "Off"}</span>
                </button>

                <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-xs font-medium text-slate-500">Active collaborators</p>
                  <div className="mt-2 flex items-center gap-2">
                    {activeUsers.slice(0, 4).map((user) => (
                      <div key={user.id} className="relative">
                        <div
                          title={user.name}
                          className={`flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-[11px] font-bold text-white ${user.color}`}
                        >
                          {initials(user.name)}
                        </div>
                        <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/50" />
                        </span>
                      </div>
                    ))}
                    <span className="ml-1 text-xs text-slate-400">{activeUsers.length} online</span>
                  </div>
                </div>

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    disabled={signOutInFlight}
                    className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-red-500/35 bg-red-500/10 px-2.5 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                  >
                    {signOutInFlight ? <Loader2 size={12} className="animate-spin" /> : null}
                    Logout
                  </button>
                </div>
              </div>
            ) : null}

            {showOrgSwitcher && switchableOrgs.length > 0 && (
              <div className="vx-scrollbar absolute left-2 right-2 top-[calc(100%+0.5rem)] z-50 w-auto max-h-[70vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#0d1117] p-3 shadow-vx md:left-10 md:right-auto md:top-20 md:w-72 md:max-h-[75vh]">
                <div className="mb-2 flex items-center justify-between px-2 py-1">
                  <p className="text-xs font-medium text-slate-500">Workspace Profiles</p>
                  <button
                    onClick={() => setShowOrgSwitcher(false)}
                    className="rounded-md p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="space-y-1">
                  {switchableOrgs.map((org) => (
                    <button
                      key={org.id}
                      onClick={() => {
                        void handleSelectOrganization(org.id);
                        setShowOrgSwitcher(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                        selectedOrg.id === org.id
                          ? `vx-panel ${themeStyle.border}`
                          : "hover:bg-white/5"
                      }`}
                    >
                      {isEarthOrgContext(org) ? (
                        <Globe2 size={16} className="text-slate-500" />
                      ) : (
                        <Building2 size={16} className="text-slate-500" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{org.name}</p>
                        <p className="text-xs text-slate-500">
                          {isEarthOrgContext(org) ? `${org.role} | Fallback profile` : org.role}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>

                <button
                  onClick={openAddOrganization}
                  className="mt-2 flex w-full items-center gap-3 rounded-xl border-t border-white/10 px-3 py-3 text-left text-emerald-400 transition hover:bg-white/5"
                >
                  <PlusCircle size={16} />
                  <span className="text-sm font-semibold">Add organization</span>
                </button>
              </div>
            )}

          </header>

          <section
            className={`vx-scrollbar relative min-w-0 flex-1 overflow-x-hidden px-3 py-4 pb-24 sm:px-4 md:px-6 md:py-6 md:pb-28 lg:px-8 xl:px-10 2xl:px-12 ${
              resolvedOrg && activeTab === "control"
                ? "flex min-h-0 flex-col overflow-hidden py-2.5 pb-12 md:py-3 md:pb-14"
                : resolvedOrg && workspaceMode === "FLOW"
                  ? "min-h-0 overflow-hidden py-2 pb-4 md:py-3 md:pb-5"
                : "overflow-y-auto"
            }`}
          >
            {orgBootstrapStatus === "loading" && !resolvedOrg && !hasOrganization ? (
              <WorkspaceBootstrapState themeStyle={themeStyle} />
            ) : orgBootstrapStatus === "failed" && !resolvedOrg && !hasOrganization ? (
              <WorkspaceBootstrapError
                themeStyle={themeStyle}
                message={orgBootstrapError}
                onRetry={() => setOrgBootstrapAttempt((value) => value + 1)}
              />
            ) : !resolvedOrg ? (
              activeTab === "hub" ? (
              <HubConsole
                orgId={null}
                orgs={orgs}
                currentOrgId={null}
                onSelectOrg={handleSelectOrganization}
                userProfile={userHubProfile}
                onEarthControlLevelChange={setEarthControlLevel}
                onEarthModeChange={setEarthMode}
                onEarthApprovalModeChange={setEarthApprovalMode}
                themeStyle={{
                  accent: themeStyle.accent,
                  accentSoft: themeStyle.accentSoft,
                  border: themeStyle.border
                  }}
                  initialScope={hubInitialScope}
                />
              ) : activeTab === "squad" ? (
              <SquadConsole
                orgId={null}
                personalEarthProfile={personalEarthProfile}
                onPersonalEarthModeChange={setEarthMode}
                launchIntent={null}
                onLaunchIntentHandled={() => setSquadLaunchIntent(null)}
                themeStyle={{
                  accent: themeStyle.accent,
                  accentSoft: themeStyle.accentSoft,
                    border: themeStyle.border
                  }}
                />
              ) : (
                <NoOrganizationExplore
                  activeTab={activeTab}
                  hasOrganizationAccess={hasOrganization}
                  isEarthWorkspaceActive={isEarthWorkspaceActive}
                  themeStyle={themeStyle}
                  userJoinRequests={userJoinRequests}
                  loadingUserJoinRequests={loadingUserJoinRequests}
                  onOpenSetup={openSetupChooser}
                  onOpenEarthWorkforce={() => handleTabChange("squad")}
                  onOpenEarthHub={() => handleTabChange("hub")}
                />
              )
            ) : activeTab === "control" ? (
              <StringChatShell
                key={`string-shell:${resolvedOrg?.id ?? "none"}`}
                embedded
                orgId={resolvedOrg?.id ?? null}
                stringPanelOpen={showCompassStringPanel}
                onStringPanelOpenChange={setShowCompassStringPanel}
                collaborationPanelOpen={showCompassCollaborationPanel}
                onCollaborationPanelOpenChange={setShowCompassCollaborationPanel}
              />
            ) : resolvedOrg && workspaceMode === "FLOW" ? (
              <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[clamp(240px,22vw,320px)_minmax(0,1fr)] [@media(min-width:1920px)]:grid-cols-[clamp(260px,18vw,360px)_minmax(0,1fr)]">
                <FlowSidebarRail
                  themeStyle={{
                    accent: themeStyle.accent,
                    accentSoft: themeStyle.accentSoft,
                    border: themeStyle.border
                  }}
                  selectedDate={flowCalendarSelectedDate}
                  onSelectedDateChange={setFlowCalendarSelectedDate}
                  selectedStringId={flowSelectedStringId}
                  onSelectedStringChange={setFlowSelectedStringId}
                  stringItems={workspaceStringHistory}
                />
                <div className="flex min-h-0 flex-col gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/35 p-2">
                      {PRIMARY_WORKSPACE_TABS.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => handlePrimaryWorkspaceTabSwitch(tab.id)}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                            primaryWorkspaceTab === tab.id
                              ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                              : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                          }`}
                        >
                          <tab.icon size={13} />
                          {tab.label}
                          <span className="hidden text-[10px] font-normal text-slate-400 lg:inline">
                            {tab.helper}
                          </span>
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/25 p-2">
                      {primaryWorkspaceTab === "FOCUS" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setFlowStringsTab("DETAILS")}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                              flowStringsTab === "DETAILS"
                                ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                                : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                            }`}
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            onClick={() => setFlowStringsTab("BLUEPRINT")}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                              flowStringsTab === "BLUEPRINT"
                                ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                                : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                            }`}
                          >
                            Blueprint
                          </button>
                        </>
                      ) : primaryWorkspaceTab === "EXECUTION" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setFlowExecutionTab("DETAILS")}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                              flowExecutionTab === "DETAILS" || flowExecutionTab === "STEER"
                                ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                                : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                            }`}
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setFlowExecutionTab("BLUEPRINT");
                              handleOperationTabChange("blueprint");
                            }}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                              flowExecutionTab === "BLUEPRINT"
                                ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                                : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                            }`}
                          >
                            Blueprint
                          </button>
                        </>
                      ) : primaryWorkspaceTab === "GOVERNANCE" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              handleOperationTabChange("memory");
                            }}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                              activeTab === "memory"
                                ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                                : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                            }`}
                          >
                            Scan
                          </button>
                        </>
                      ) : (
                        activePrimaryNavItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleOperationTabChange(item.id as OperationTabId)}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                              activeTab === item.id
                                ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                                : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                            }`}
                          >
                            <item.icon size={13} />
                            {item.navLabel}
                          </button>
                        ))
                      )}
                    </div>

                    {flowCalendarSelectedDate ? (
                      <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-100">
                        Flow filtered to {new Date(`${flowCalendarSelectedDate}T00:00:00`).toLocaleDateString()}
                      </div>
                    ) : null}

                    {flowSelectedString ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
                        <span className="line-clamp-1">String filter: {flowSelectedStringLabel}</span>
                        <button
                          type="button"
                          onClick={() => setFlowSelectedStringId(null)}
                          className="rounded-full border border-white/15 bg-black/25 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:bg-white/10"
                        >
                          Clear
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="vx-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
                    {primaryWorkspaceTab === "FOCUS" && flowStringsTab === "DETAILS" ? (
                      <FlowStringsSurface
                        calendarDate={flowCalendarSelectedDate}
                        stringItem={flowSelectedString}
                        allStringItems={flowVisibleStringItems}
                        permissionRequests={flowScopedPermissionRequests}
                        approvalCheckpoints={flowScopedApprovalCheckpoints}
                        draftsByString={editableDraftsByString}
                        scoreByString={scoreByString}
                        steerDecisions={steerDecisions}
                        onSteerDecision={handleSteerDecision}
                        initialDetailsTab="OVERVIEW"
                      />
                    ) : primaryWorkspaceTab === "FOCUS" && flowStringsTab === "BLUEPRINT" ? (
                      <StringBlueprintCanvasSurface
                        key={`strings-blueprint-${flowCalendarSelectedDate ?? "all"}-${flowSelectedStringId ?? "all"}`}
                        themeStyle={{
                          accent: themeStyle.accent,
                          accentSoft: themeStyle.accentSoft,
                          border: themeStyle.border
                        }}
                        calendarDate={flowCalendarSelectedDate}
                        stringItem={flowSelectedString}
                        allStringItems={flowVisibleStringItems}
                        permissionRequests={flowScopedPermissionRequests}
                        approvalCheckpoints={flowScopedApprovalCheckpoints}
                        draftsByString={editableDraftsByString}
                        scoreByString={scoreByString}
                        steerDecisions={steerDecisions}
                        selectedStringId={flowSelectedStringId}
                        onSelectedStringChange={setFlowSelectedStringId}
                      />
                    ) : primaryWorkspaceTab === "EXECUTION" &&
                      (flowExecutionTab === "STEER" || flowExecutionTab === "DETAILS") ? (
                      <SteerDetailsEditorSurface
                        stringItem={flowSelectedString}
                        calendarDate={flowCalendarSelectedDate}
                        permissionRequests={flowScopedPermissionRequests}
                        approvalCheckpoints={flowScopedApprovalCheckpoints}
                        draftsByString={editableDraftsByString}
                        onDraftChange={handleEditableDraftChange}
                        scoreByString={scoreByString}
                        steerLane={steerTab}
                        onSteerLaneChange={setSteerTab}
                        steerDecisions={steerDecisions}
                        onSteerDecision={handleSteerDecision}
                        initialDetailsTab={flowExecutionTab === "STEER" ? "SCORING" : undefined}
                      />
                    ) : primaryWorkspaceTab === "EXECUTION" && flowExecutionTab === "BLUEPRINT" ? (
                      <StringBlueprintCanvasSurface
                        key={`blueprint-${flowCalendarSelectedDate ?? "all"}-${flowSelectedStringId ?? "all"}`}
                        themeStyle={{
                          accent: themeStyle.accent,
                          accentSoft: themeStyle.accentSoft,
                          border: themeStyle.border
                        }}
                        calendarDate={flowCalendarSelectedDate}
                        stringItem={flowSelectedString}
                        allStringItems={flowVisibleStringItems}
                        permissionRequests={flowScopedPermissionRequests}
                        approvalCheckpoints={flowScopedApprovalCheckpoints}
                        draftsByString={editableDraftsByString}
                        scoreByString={scoreByString}
                        steerDecisions={steerDecisions}
                        selectedStringId={flowSelectedStringId}
                        onSelectedStringChange={setFlowSelectedStringId}
                      />
                    ) : primaryWorkspaceTab === "EXECUTION" && flowExecutionTab === "CALENDAR" ? (
                      <CalendarConsole
                        key={`calendar-${flowCalendarSelectedDate ?? "all"}-${flowSelectedStringId ?? "all"}`}
                        orgId={resolvedOrg.id}
                        themeStyle={{
                          accent: themeStyle.accent,
                          accentSoft: themeStyle.accentSoft,
                          border: themeStyle.border
                        }}
                        dateFilter={flowCalendarSelectedDate}
                        onDateFilterChange={setFlowCalendarSelectedDate}
                        selectedStringId={flowSelectedStringId}
                        stringFilterLabel={flowSelectedStringLabel || null}
                        planIdFilter={flowSelectedStringPlanId || null}
                        directionIdFilter={flowSelectedStringDirectionId || null}
                        flowIdFilter={flowSelectedStringFlowIds}
                        stringItems={flowCalendarStringItems}
                      />
                    ) : primaryWorkspaceTab === "GOVERNANCE" ? (
                      <ScanConsoleSurface
                        stringItem={flowSelectedString}
                        allStringItems={flowVisibleStringItems}
                        permissionRequests={flowScopedPermissionRequests}
                        approvalCheckpoints={flowScopedApprovalCheckpoints}
                        permissionRequestActionId={permissionRequestActionId}
                        approvalCheckpointActionId={approvalCheckpointActionId}
                        onPermissionDecision={(requestId, decision) => {
                          void handlePermissionRequestDecision(requestId, decision);
                        }}
                        onCheckpointDecision={(checkpointId, decision) => {
                          void handleApprovalCheckpointDecision(checkpointId, decision);
                        }}
                      />
                    ) : activeTab === "flow" ? (
                      <WorkflowConsole
                        key={`flow-${flowCalendarSelectedDate ?? "all"}-${flowSelectedStringId ?? "all"}`}
                        orgId={resolvedOrg.id}
                        themeStyle={{
                          accent: themeStyle.accent,
                          accentSoft: themeStyle.accentSoft,
                          border: themeStyle.border
                        }}
                        dateFilter={flowCalendarSelectedDate}
                        flowIdFilter={flowSelectedStringFlowIds}
                        stringFilterLabel={flowSelectedStringLabel || null}
                        onTaskNeedsInput={promptForHumanInput}
                      />
                    ) : activeTab === "blueprint" ? (
                      <BlueprintConsole
                        key={`blueprint-${flowCalendarSelectedDate ?? "all"}-${flowSelectedStringId ?? "all"}`}
                        orgId={resolvedOrg.id}
                        themeStyle={{
                          accent: themeStyle.accent,
                          accentSoft: themeStyle.accentSoft,
                          border: themeStyle.border
                        }}
                      />
                    ) : activeTab === "direction" ? (
                      <DirectionConsole
                        key={`direction-${flowCalendarSelectedDate ?? "all"}-${flowSelectedStringId ?? "all"}`}
                        orgId={resolvedOrg.id}
                        themeStyle={{
                          accent: themeStyle.accent,
                          accentSoft: themeStyle.accentSoft,
                          border: themeStyle.border
                        }}
                        dateFilter={flowCalendarSelectedDate}
                        directionIdFilter={flowSelectedStringDirectionId || null}
                        flowIdFilter={flowSelectedStringFlowIds}
                        stringFilterLabel={flowSelectedStringLabel || null}
                      />
                    ) : activeTab === "plan" ? (
                      <PlanConsole
                        key={`plan-${flowCalendarSelectedDate ?? "all"}-${flowSelectedStringId ?? "all"}`}
                        orgId={resolvedOrg.id}
                        themeStyle={{
                          accent: themeStyle.accent,
                          accentSoft: themeStyle.accentSoft,
                          border: themeStyle.border
                        }}
                        dateFilter={flowCalendarSelectedDate}
                        planIdFilter={flowSelectedStringPlanId || null}
                        directionIdFilter={flowSelectedStringDirectionId || null}
                        stringFilterLabel={flowSelectedStringLabel || null}
                      />
                    ) : activeTab === "calendar" ? (
                      <CalendarConsole
                        key={`calendar-${flowCalendarSelectedDate ?? "all"}-${flowSelectedStringId ?? "all"}`}
                        orgId={resolvedOrg.id}
                        themeStyle={{
                          accent: themeStyle.accent,
                          accentSoft: themeStyle.accentSoft,
                          border: themeStyle.border
                        }}
                      />
                    ) : activeTab === "memory" ? (
                      <MemoryConsole
                        key={`memory-${flowCalendarSelectedDate ?? "all"}-${flowSelectedStringId ?? "all"}`}
                        orgId={resolvedOrg.id}
                        themeStyle={{
                          accent: themeStyle.accent,
                          accentSoft: themeStyle.accentSoft,
                          border: themeStyle.border
                        }}
                        dateFilter={flowCalendarSelectedDate}
                        flowIdFilter={flowSelectedStringFlowIds}
                        stringFilterLabel={flowSelectedStringLabel || null}
                      />
                    ) : activeTab === "settings" ? (
                      <SettingsConsole
                        key={`settings-${flowCalendarSelectedDate ?? "all"}-${flowSelectedStringId ?? "all"}`}
                        orgId={resolvedOrg.id}
                        canManageRuntime={canManageOrgRuntime}
                        themeStyle={{
                          accent: themeStyle.accent,
                          accentSoft: themeStyle.accentSoft,
                          border: themeStyle.border
                        }}
                        initialLane={
                          requestedSettingsLane === "webhooks" ||
                          requestedSettingsLane === "identity" ||
                          requestedSettingsLane === "rails" ||
                          requestedSettingsLane === "orchestration"
                            ? requestedSettingsLane
                            : undefined
                        }
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            ) : activeTab === "hub" ? (
              <HubConsole
                orgId={resolvedOrg.id}
                orgs={orgs}
                currentOrgId={resolvedOrg.id}
                onSelectOrg={handleSelectOrganization}
                userProfile={userHubProfile}
                onEarthControlLevelChange={setEarthControlLevel}
                onEarthModeChange={setEarthMode}
                onEarthApprovalModeChange={setEarthApprovalMode}
                themeStyle={{
                  accent: themeStyle.accent,
                  accentSoft: themeStyle.accentSoft,
                  border: themeStyle.border
                }}
                initialScope={hubInitialScope}
              />
            ) : activeTab === "squad" ? (
              <SquadConsole
                orgId={resolvedOrg.id}
                personalEarthProfile={personalEarthProfile}
                onPersonalEarthModeChange={setEarthMode}
                launchIntent={squadLaunchIntent}
                onLaunchIntentHandled={() => setSquadLaunchIntent(null)}
                themeStyle={{
                  accent: themeStyle.accent,
                  accentSoft: themeStyle.accentSoft,
                  border: themeStyle.border
                }}
              />
            ) : activeTab === "memory" ? (
              <MemoryConsole
                orgId={resolvedOrg.id}
                themeStyle={{
                  accent: themeStyle.accent,
                  accentSoft: themeStyle.accentSoft,
                  border: themeStyle.border
                }}
              />
            ) : activeTab === "settings" ? (
              <SettingsConsole
                orgId={resolvedOrg.id}
                canManageRuntime={canManageOrgRuntime}
                themeStyle={{
                  accent: themeStyle.accent,
                  accentSoft: themeStyle.accentSoft,
                  border: themeStyle.border
                }}
                initialLane={
                  requestedSettingsLane === "webhooks" ||
                  requestedSettingsLane === "identity" ||
                  requestedSettingsLane === "rails" ||
                  requestedSettingsLane === "orchestration"
                    ? requestedSettingsLane
                    : undefined
                }
              />
            ) : (
              <SectionPlaceholder activeTab={activeTab} query={searchQuery} themeStyle={themeStyle} />
            )}
          </section>
        </main>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3 sm:px-4">
        <div className="pointer-events-auto inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/15 bg-[#060b13]/92 p-1 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          <button
            type="button"
            onClick={() => handleWorkspaceModeSwitch("COMPASS")}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition ${
              isCompassModeActive
                ? "bg-cyan-500/20 text-cyan-100"
                : "text-slate-300 hover:bg-white/10"
            }`}
          >
            <Compass size={14} />
            Compass
          </button>
          <button
            type="button"
            onClick={() => handleWorkspaceModeSwitch("FLOW")}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition ${
              isFlowModeActive
                ? "bg-cyan-500/20 text-cyan-100"
                : "text-slate-300 hover:bg-white/10"
            }`}
          >
            <Workflow size={14} />
            Flow
          </button>
          <button
            type="button"
            onClick={() => handleWorkspaceModeSwitch("HUB")}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition ${
              isHubModeActive
                ? "bg-cyan-500/20 text-cyan-100"
                : "text-slate-300 hover:bg-white/10"
            }`}
          >
            <FolderOpen size={14} />
            Hub
          </button>
        </div>
      </div>

      <div
        className={`pointer-events-none fixed -bottom-56 -left-56 h-[580px] w-[580px] rounded-full bg-gradient-to-r blur-[140px] transition-all duration-700 ${themeStyle.gradient}`}
      />

      {isGhostModeActive && (
        <>
          <div className="vx-ghost-overlay pointer-events-none fixed inset-0 z-50" />
          <div className="vx-ghost-vignette pointer-events-none fixed inset-0 z-50" />
        </>
      )}

      {showClearPermissionRequestsConfirm && resolvedOrg ? (
        <div
          className="fixed inset-0 z-[84] flex items-center justify-center bg-black/75 p-4"
          onClick={() => {
            if (!clearPermissionRequestsInFlight) {
              setShowClearPermissionRequestsConfirm(false);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-[28px] border border-white/15 bg-[#0d1117] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-300">
                  Clear Requests
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-100">
                  Remove all permission requests for this organization?
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowClearPermissionRequestsConfirm(false)}
                disabled={clearPermissionRequestsInFlight}
                className="rounded-full border border-white/20 p-2 text-slate-300 transition hover:bg-white/10 disabled:opacity-60"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-3 text-sm text-slate-300">
              This clears all organization-level permission requests from the request center. This action cannot be undone.
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <span className="text-xs uppercase tracking-[0.16em] text-slate-500">Pending requests</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200">
                {requestCenterPermissionRequests.length}
              </span>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowClearPermissionRequestsConfirm(false)}
                disabled={clearPermissionRequestsInFlight}
                className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleClearPermissionRequests()}
                disabled={clearPermissionRequestsInFlight}
                className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-60"
              >
                {clearPermissionRequestsInFlight ? <Loader2 size={12} className="animate-spin" /> : null}
                {clearPermissionRequestsInFlight ? "Clearing..." : "Clear all"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingHumanInput && (
        <div className="fixed inset-0 z-[82] flex items-center justify-center bg-black/75 p-4">
          <div className="vx-scrollbar w-full max-w-2xl overflow-y-auto rounded-[28px] border border-white/15 bg-[#0d1117] p-5 md:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
                  Human Input Required
                </p>
                <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                  Task {pendingHumanInput.taskId}
                </p>
              </div>
              <button
                onClick={() => {
                  if (!humanInputSubmitting) {
                    setPendingHumanInput(null);
                  }
                }}
                disabled={humanInputSubmitting}
                className="rounded-full border border-white/20 p-2 text-slate-300 transition hover:bg-white/10 disabled:opacity-60"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <p className="text-[10px] uppercase tracking-[0.14em] text-amber-300">
                  {humanInputSummary.heading}
                </p>
                <ul className="mt-2 space-y-1 text-[12px] text-amber-100">
                  {humanInputSummary.items.map((item) => (
                    <li key={item} className="whitespace-pre-wrap break-words">
                      - {item}
                    </li>
                  ))}
                </ul>
              </div>

              <label className="block text-xs uppercase tracking-[0.14em] text-slate-400">
                Message Input
                <textarea
                  value={humanInputMessage}
                  onChange={(event) => setHumanInputMessage(event.target.value)}
                  placeholder="Add human guidance for this task..."
                  className="mt-1 h-24 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                />
              </label>

              <label className="block text-xs uppercase tracking-[0.14em] text-slate-400">
                Optional Source URL
                <input
                  value={humanInputSourceUrl}
                  onChange={(event) => setHumanInputSourceUrl(event.target.value)}
                  placeholder="https://docs.example.com/context"
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                />
              </label>

              <label className="block text-xs uppercase tracking-[0.14em] text-slate-400">
                Optional File Upload
                <div className="mt-1 flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                  <Paperclip size={14} className="text-slate-500" />
                  <input
                    type="file"
                    onChange={(event) => setHumanInputFile(event.target.files?.[0] ?? null)}
                    className="w-full text-sm text-slate-200 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-slate-200"
                  />
                </div>
              </label>

              <label className="block text-xs uppercase tracking-[0.14em] text-slate-400">
                Optional Prompt Override
                <textarea
                  value={humanInputOverridePrompt}
                  onChange={(event) => setHumanInputOverridePrompt(event.target.value)}
                  placeholder="If needed, rewrite task prompt before resume..."
                  className="mt-1 h-20 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                />
              </label>

              <p className="text-[11px] text-slate-500">
                Submitted message/files are stored in Hub INPUT and attached to this task context.
              </p>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => {
                    if (!humanInputSubmitting) {
                      setPendingHumanInput(null);
                    }
                  }}
                  disabled={humanInputSubmitting}
                  className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/10 disabled:opacity-60"
                >
                  Later
                </button>
                <button
                  onClick={() => void handleSubmitHumanInput()}
                  disabled={humanInputSubmitting}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                >
                  {humanInputSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
                  Submit Input & Resume
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {setupPanel === "chooser" && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
          <div className="vx-scrollbar max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[30px] border border-white/15 bg-[#0d1117] p-5 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                  Organization Setup
                </p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                  Choose how to continue
                </p>
              </div>
              <button
                onClick={() => setSetupPanel("closed")}
                className="rounded-full border border-white/20 p-2 text-slate-300 transition hover:bg-white/10"
              >
                <X size={14} />
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <button
                onClick={() => setSetupPanel("onboarding")}
                className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-left transition hover:bg-emerald-500/20"
              >
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-200">
                  Set Up New Organization
                </p>
                <p className="mt-2 text-xs text-slate-300">
                  Create organization, assign founder access, and configure runtime.
                </p>
              </button>
              <button
                onClick={() => {
                  setJoinRequestError(null);
                  setSetupPanel("request-access");
                  void loadUserJoinRequests();
                }}
                className="rounded-2xl border border-cyan-500/40 bg-cyan-500/10 p-4 text-left transition hover:bg-cyan-500/20"
              >
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">
                  Request Existing Access
                </p>
                <p className="mt-2 text-xs text-slate-300">
                  Request membership in an existing organization for WorkForce approval.
                </p>
              </button>
            </div>

            {!hasOrganization && (
              <p className="mt-4 text-xs text-slate-400">
                You can keep exploring the platform without an organization and complete setup later.
              </p>
            )}
          </div>
        </div>
      )}

      {setupPanel === "request-access" && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
          <div className="vx-scrollbar max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[30px] border border-white/15 bg-[#0d1117] p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                  Request Organization Access
                </p>
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                  Send request for admin review
                </p>
              </div>
              <button
                onClick={() => setSetupPanel("chooser")}
                className="rounded-full border border-white/20 p-2 text-slate-300 transition hover:bg-white/10"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
              <label className="block text-xs text-slate-300">
                Organization Id or Name
                <input
                  value={joinOrgIdentifier}
                  onChange={(event) => setJoinOrgIdentifier(event.target.value)}
                  placeholder="org id or company name"
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                />
              </label>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="text-xs text-slate-300">
                  Requested Role
                  <select
                    value={joinRequestRole}
                    onChange={(event) =>
                      setJoinRequestRole(event.target.value as "EMPLOYEE" | "ADMIN")
                    }
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    <option value="EMPLOYEE">EMPLOYEE</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </label>
                <label className="text-xs text-slate-300">
                  Optional Message
                  <input
                    value={joinRequestMessage}
                    onChange={(event) => setJoinRequestMessage(event.target.value)}
                    placeholder="why you need access"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
              </div>

              {joinRequestError && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {joinRequestError}
                </div>
              )}

              <button
                onClick={() => void handleSubmitJoinRequest()}
                disabled={joinRequestInFlight}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200 transition hover:bg-white/10 disabled:opacity-60"
              >
                {joinRequestInFlight ? <Loader2 size={13} className="animate-spin" /> : null}
                Send Request
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                Your Requests
              </p>
              {loadingUserJoinRequests ? (
                <div className="inline-flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 size={13} className="animate-spin" />
                  Loading requests...
                </div>
              ) : userJoinRequests.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-500">
                  No requests yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {userJoinRequests.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-white/10 bg-black/25 p-3"
                    >
                      <p className="text-xs font-semibold text-slate-100">
                        {item.organizationName || item.orgId}
                      </p>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        {item.status} | Requested {item.requestedRole} |{" "}
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                      {item.message ? (
                        <p className="mt-1 text-xs text-slate-300">{item.message}</p>
                      ) : null}
                      {item.decisionNote ? (
                        <p className="mt-1 text-xs text-slate-400">
                          Decision Note: {item.decisionNote}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {setupPanel === "onboarding" && (
        <div className="fixed inset-0 z-[80] overflow-y-auto">
          <OnboardingWizard
            mode={hasOrganization ? "add-org" : "initial"}
            onCancel={() => setSetupPanel("chooser")}
            onComplete={(org) => {
              addOrg(org);
              setCurrentOrg(org);
              setSetupPanel("closed");
            }}
          />
        </div>
      )}

      <NotificationStack />
    </div>
  );
}

function formatUserDisplayName(username?: string | null, email?: string | null) {
  const raw = username?.trim() || email?.split("@")[0]?.trim() || "Human";
  return raw
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}

function WorkspaceBootstrapState({
  themeStyle
}: {
  themeStyle: { accent: string; accentSoft: string; border: string };
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className={`vx-panel rounded-[34px] p-6 ${themeStyle.border}`}>
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-300">
          <Loader2 size={14} className="animate-spin" />
          Loading Organization Context
        </div>
      </div>
    </div>
  );
}

function WorkspaceBootstrapError({
  themeStyle,
  message,
  onRetry
}: {
  themeStyle: { accent: string; accentSoft: string; border: string };
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className={`vx-panel space-y-3 rounded-[34px] p-6 ${themeStyle.border}`}>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-rose-300">
          Unable To Load Organization Context
        </p>
        <p className="text-sm text-slate-300">
          {message ?? "Please retry. Setup is hidden until organization data loads correctly."}
        </p>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200 transition hover:bg-white/10"
        >
          <RefreshCw size={12} />
          Retry
        </button>
      </div>
    </div>
  );
}

function NoOrganizationExplore({
  activeTab,
  hasOrganizationAccess,
  isEarthWorkspaceActive,
  themeStyle,
  onOpenSetup,
  onOpenEarthWorkforce,
  onOpenEarthHub,
  userJoinRequests,
  loadingUserJoinRequests
}: {
  activeTab: (typeof NAV_ITEMS)[number]["id"];
  hasOrganizationAccess: boolean;
  isEarthWorkspaceActive: boolean;
  themeStyle: { accent: string; accentSoft: string; border: string };
  onOpenSetup: () => void;
  onOpenEarthWorkforce: () => void;
  onOpenEarthHub: () => void;
  userJoinRequests: UserJoinRequest[];
  loadingUserJoinRequests: boolean;
}) {
  const tabLabel = NAV_ITEMS.find((item) => item.id === activeTab)?.label ?? "Workspace";
  const pendingCount = userJoinRequests.filter((item) => item.status === "PENDING").length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className={`vx-panel space-y-4 rounded-[34px] p-6 ${themeStyle.border}`}>
        <h2 className="font-display text-3xl font-black uppercase tracking-tight md:text-4xl">
          {hasOrganizationAccess ? "Earth Profile Active" : `Explore ${tabLabel}`}
        </h2>
        <p className="text-sm text-slate-300">
          {hasOrganizationAccess
            ? "Earth is active as your fallback workspace. Switch back to any organization from the top-left selector when you want live workforce, memory, workflow, and settings surfaces."
            : "Platform preview is active. Connect to an organization when you are ready to run live workforce, memory, workflows, and settings."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {isEarthWorkspaceActive ? (
            <>
              <button
                onClick={onOpenEarthWorkforce}
                className="rounded-full bg-white px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-500 hover:text-white"
              >
                Open WorkForce
              </button>
              <button
                onClick={onOpenEarthHub}
                className="rounded-full border border-white/20 bg-white/5 px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200 transition hover:bg-white/10"
              >
                Open Earth Hub
              </button>
            </>
          ) : hasOrganizationAccess ? (
            <span className="rounded-full border border-white/20 bg-white/5 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-300">
              Use the top-left switcher to re-enter an organization
            </span>
          ) : (
            <button
              onClick={onOpenSetup}
              className="rounded-full bg-white px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-500 hover:text-white"
            >
              Open Setup
            </button>
          )}
          <span className="rounded-full border border-white/20 bg-white/5 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-300">
            Pending Requests: {loadingUserJoinRequests ? "..." : pendingCount}
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Direction</p>
          <p className="mt-2 text-xs text-slate-300">
            Talk-to-organization mode, mission scheduling, and multi-signature execution gates.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">WorkForce</p>
          <p className="mt-2 text-xs text-slate-300">
            Human and AI roster management, OAuth delegation, and join-request approvals.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Settings</p>
          <p className="mt-2 text-xs text-slate-300">
            Orchestration mode (BYOK/platform-managed), model preferences, and credit wallet.
          </p>
        </div>
      </div>
    </div>
  );
}

function SectionPlaceholder({
  activeTab,
  query,
  themeStyle
}: {
  activeTab: string;
  query: string;
  themeStyle: { accent: string; accentSoft: string };
}) {
  const cards = [
    {
      title: "Durable Job Runtime",
      description: "Inngest checkpoints are wired for pause/resume and human intervention.",
      icon: Activity
    },
    {
      title: "Neural Autopsy Canvas",
      description: "React Flow runtime initialized for explainability graphs.",
      icon: Bot
    },
    {
      title: "Hub DNA Sector",
      description: "pgvector-backed semantic memory schema prepared for embeddings.",
      icon: FileText
    }
  ].filter((card) => card.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-6">
        <h2 className="font-display text-3xl font-black uppercase tracking-tight md:text-4xl">
          {NAV_ITEMS.find((tab) => tab.id === activeTab)?.label ?? "Workspace"}
        </h2>
        <span className={`rounded-full px-4 py-2 text-[10px] uppercase tracking-[0.3em] ${themeStyle.accentSoft}`}>
          Phase 5 Runtime Live
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {cards.map((card) => (
          <div key={card.title} className="vx-panel rounded-[34px] p-6 transition hover:border-white/20">
            <div className={`mb-5 inline-flex rounded-2xl bg-white/5 p-3 ${themeStyle.accent}`}>
              <card.icon size={20} />
            </div>
            <h3 className="font-display text-lg font-bold uppercase">{card.title}</h3>
            <p className="mt-3 text-sm text-slate-400">{card.description}</p>
            <div className={`mt-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.25em] ${themeStyle.accent}`}>
              Open
              <ArrowUpRight size={14} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
