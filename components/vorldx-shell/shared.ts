import type { AppTheme } from "@/lib/store/vorldx-store";
import type { AssistantMessageMeta, WorkflowTaskStatus } from "@/src/types/chat";
import {
  CalendarDays,
  ClipboardList,
  Database,
  FolderOpen,
  LayoutDashboard,
  LayoutGrid,
  Settings as SettingsIcon,
  Shield,
  Target,
  Users,
  Workflow
} from "lucide-react";

export const NAV_ITEMS = [
  {
    id: "control",
    label: "Control Deck",
    navLabel: "Compass",
    helper: "Chat + approvals",
    primary: "FOCUS",
    icon: LayoutDashboard
  },
  {
    id: "plan",
    label: "Plan",
    navLabel: "Plan",
    helper: "Execution plan",
    primary: "FOCUS",
    icon: ClipboardList
  },
  {
    id: "flow",
    label: "Workflow",
    navLabel: "Workflow",
    helper: "Runtime",
    primary: "FOCUS",
    icon: Workflow
  },
  {
    id: "direction",
    label: "Direction",
    navLabel: "Pathway",
    helper: "Direction strategy",
    primary: "FOCUS",
    icon: Target
  },
  {
    id: "blueprint",
    label: "Steer",
    navLabel: "Steer",
    helper: "Center, approved, rethink",
    primary: "EXECUTION",
    icon: LayoutGrid
  },
  {
    id: "hub",
    label: "Hub",
    navLabel: "Hub",
    helper: "Data + tools",
    primary: "EXECUTION",
    icon: FolderOpen
  },
  {
    id: "squad",
    label: "WorkForce",
    navLabel: "WorkForce",
    helper: "People + agents",
    primary: "EXECUTION",
    icon: Users
  },
  {
    id: "memory",
    label: "Scan",
    navLabel: "Scan",
    helper: "Raw activity + governance",
    primary: "GOVERNANCE",
    icon: Database
  },
  {
    id: "settings",
    label: "Settings",
    navLabel: "Settings",
    helper: "Policies + utilities",
    primary: "GOVERNANCE",
    icon: SettingsIcon
  },
  {
    id: "calendar",
    label: "Calendar",
    navLabel: "Calendar",
    helper: "Mission schedules",
    primary: "EXECUTION",
    icon: CalendarDays
  }
] as const;

export const PRIMARY_WORKSPACE_TABS = [
  {
    id: "FOCUS",
    label: "Strings",
    helper: "Strings, directions, and pathway",
    icon: Target
  },
  {
    id: "EXECUTION",
    label: "Steer",
    helper: "Deliverables center, approved, and rethink",
    icon: Workflow
  },
  {
    id: "GOVERNANCE",
    label: "Scan",
    helper: "Policy and scan controls",
    icon: Shield
  }
] as const;

export type NavItemId = (typeof NAV_ITEMS)[number]["id"];
export type PrimaryWorkspaceTabId = (typeof PRIMARY_WORKSPACE_TABS)[number]["id"];
export type WorkspaceMode = "COMPASS" | "FLOW" | "HUB";

export const OPERATION_TAB_IDS = [
  "plan",
  "flow",
  "direction",
  "blueprint",
  "calendar",
  "memory"
] as const;
export type OperationTabId = (typeof OPERATION_TAB_IDS)[number];
export const OPERATION_TAB_SET = new Set<string>(OPERATION_TAB_IDS);

export const DEFAULT_PRIMARY_TAB_SUBTAB: Record<PrimaryWorkspaceTabId, NavItemId> = {
  FOCUS: "plan",
  EXECUTION: "blueprint",
  GOVERNANCE: "memory"
};

export const NAV_ITEM_MAP = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.id, item])
) as Record<NavItemId, (typeof NAV_ITEMS)[number]>;

export function getPrimaryWorkspaceTabForNavItem(tab: NavItemId): PrimaryWorkspaceTabId {
  return NAV_ITEM_MAP[tab].primary;
}

export const THEME_STYLES: Record<
  AppTheme,
  {
    accent: string;
    accentSoft: string;
    gradient: string;
    border: string;
  }
> = {
  APEX: {
    accent: "text-blue-400",
    accentSoft: "bg-blue-500/20 text-blue-300",
    gradient: "from-blue-600/20 to-emerald-500/10",
    border: "border-blue-500/25"
  },
  VEDA: {
    accent: "text-amber-400",
    accentSoft: "bg-amber-500/20 text-amber-300",
    gradient: "from-amber-600/20 to-orange-500/10",
    border: "border-amber-500/25"
  },
  NEXUS: {
    accent: "text-emerald-400",
    accentSoft: "bg-emerald-500/20 text-emerald-300",
    gradient: "from-emerald-600/20 to-cyan-500/10",
    border: "border-emerald-500/25"
  }
};

export const PRESENCE_POOL = [
  { id: "u-1", name: "Ava Rao", color: "bg-blue-500" },
  { id: "u-2", name: "M. Thorne", color: "bg-emerald-500" },
  { id: "u-3", name: "K. Iyer", color: "bg-amber-500" },
  { id: "u-4", name: "S. Das", color: "bg-cyan-500" },
  { id: "u-5", name: "R. Patel", color: "bg-rose-500" }
];

export const DIRECTION_MODELS = [
  { id: "gemini:gemini-2.5-flash", label: "Gemini (2.5 Flash)" },
  { id: "openai:gpt-4o-mini", label: "ChatGPT (gpt-4o-mini)" },
  { id: "anthropic:claude-3-5-sonnet", label: "Claude (3.5 Sonnet)" }
] as const;

export const REQUESTS_POLL_INTERVAL_MS = 30000;
export const PIPELINE_POLICY_POLL_INTERVAL_MS = 30000;

export function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase() ?? "")
    .join("");
}

export function randomPresence() {
  const pool = [...PRESENCE_POOL].sort(() => Math.random() - 0.5);
  const count = 2 + Math.floor(Math.random() * 4);
  return pool.slice(0, count);
}

export interface ControlMessage {
  tone: "success" | "warning" | "error";
  text: string;
}

export type AgentRunStatus = "needs_input" | "needs_confirmation" | "completed" | "error";
export type ControlSurfaceTab = ControlMode | "STRINGS";

export interface AgentRunResponse {
  status: AgentRunStatus;
  assistant_message: string;
  runId?: string;
  required_inputs?: Array<{
    key: string;
    label: string;
    type: "text" | "email" | "number";
    placeholder: string;
  }>;
  draft?: {
    to: string;
    subject: string;
    body: string;
  };
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  delivery?: {
    acceptedByProvider: boolean;
    verified: boolean;
    messageId?: string | null;
    providerStatus?: string | null;
  };
}

export interface DirectionTurn {
  id: string;
  role: "owner" | "organization";
  content: string;
  modelLabel?: string;
  meta?: AssistantMessageMeta;
}

export type SetupPanel = "closed" | "chooser" | "onboarding" | "request-access";

export interface UserJoinRequest {
  id: string;
  orgId: string;
  organizationName?: string | null;
  requestedRole: "EMPLOYEE" | "ADMIN";
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  message: string;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface OrgListResponse {
  ok?: boolean;
  message?: string;
  activeOrgId?: string | null;
  orgs?: Array<{
    id: string;
    name: string;
    role: string;
    theme: AppTheme;
  }>;
}

export interface HumanInputRequest {
  taskId: string;
  flowId: string | null;
  reason: string;
}

export interface PendingEmailApproval {
  prompt: string;
  draft: {
    to: string;
    subject: string;
    body: string;
  };
}

export interface PendingToolkitApproval {
  requestId: string;
  prompt: string;
  toolkits: string[];
}

export interface PendingPlanLaunchApproval {
  prompt: string;
  toolkits: string[];
  reason: string;
}

export interface PendingChatPlanRoute {
  prompt: string;
  reason: string;
  toolkitHints: string[];
}

export interface ComposerAttachmentPayload {
  files: File[];
}

export interface ControlThreadHistoryItem {
  id: string;
  title: string;
  mode: ControlMode;
  updatedAt: number;
  turns: DirectionTurn[];
  directionGiven: string;
  planningResult?: DirectionPlanningResult | null;
  pendingPlanLaunchApproval?: PendingPlanLaunchApproval | null;
  pendingToolkitApproval?: PendingToolkitApproval | null;
  pendingEmailApproval?: PendingEmailApproval | null;
  agentRunResult?: AgentRunResponse | null;
  agentRunId?: string;
  agentRunInputValues?: Record<string, string>;
  agentRunPromptSnapshot?: string;
  agentRunInputSourceUrl?: string;
  launchScope?: {
    directionId: string;
    planId: string;
    permissionRequestIds: string[];
    flowIds: string[];
  };
}

export type FlowExecutionSurfaceTab = "STEER" | "DETAILS" | "BLUEPRINT" | "CALENDAR";
export type FlowGovernanceSurfaceTab = "SCAN" | "SETTINGS";
export type FlowStringsSurfaceTab = "DETAILS" | "BLUEPRINT";
export type SteerLaneTab = "CENTER" | "APPROVED" | "RETHINK";
export type SteerSurfaceTab = SteerLaneTab | "DETAILS";

export interface SteerDeliverableCard {
  id: string;
  stringId: string;
  stringTitle: string;
  text: string;
  source: "PLAN" | "WORKFLOW" | "TASK" | "MILESTONE";
  workflowTitle?: string;
}

export interface ScanActivityRow {
  id: string;
  stringId: string;
  timestamp: string;
  actorType: "AI" | "HUMAN" | "SYSTEM";
  actor: string;
  category: string;
  detail: string;
  raw: string;
}

export interface DirectionIntentRouting {
  route: "CHAT_RESPONSE" | "PLAN_REQUIRED";
  reason: string;
  toolkitHints?: string[];
  squadRoleHints?: string[];
  cadenceHint?: "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";
}

export function normalizeHumanInputReason(reason: string | null | undefined) {
  if (typeof reason !== "string") {
    return "";
  }
  const lines = reason
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/^#+\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .trim()
    )
    .filter(Boolean);
  return lines.join("\n").trim();
}

export function summarizeHumanInputReason(reason: string | null | undefined) {
  const normalized = normalizeHumanInputReason(reason);
  if (!normalized) {
    return {
      heading: "Please provide the required input.",
      items: [] as string[]
    };
  }

  const explicitMatch =
    normalized.match(/missing required input\s*:\s*([\s\S]+)/i) ??
    normalized.match(/missing data\s*:\s*([\s\S]+)/i);
  const sourceText = explicitMatch?.[1]?.trim() || normalized;

  const chunks = sourceText
    .replace(/\s+/g, " ")
    .split(/\n|[|;]+/g)
    .flatMap((segment) => segment.split(/\.\s+/g))
    .map((segment) =>
      segment
        .replace(/^(?:[-*]|\d+[\).\-\s]+)\s*/, "")
        .replace(/^human touch intervention required:?/i, "")
        .replace(/^please provide(?: the following)?:?/i, "")
        .replace(/^it is (?:assumed|required) that\s*/i, "")
        .replace(/^this plan assumes\s*/i, "")
        .replace(/^for actual execution,?\s*/i, "")
        .replace(/^for continued execution,?\s*/i, "")
        .trim()
        .replace(/:$/, "")
    )
    .filter(Boolean);

  const shouldKeepChunk = (value: string) =>
    /\b(id|email|url|name|file|upload|workspace|page|database|recipient|subject|body|content|permission|required|missing|provide)\b/i.test(
      value
    );

  const items: string[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    let candidate = chunk;
    const labeled = chunk.match(/^([^:]{2,60}):\s*(.+)$/);
    if (labeled && shouldKeepChunk(labeled[1])) {
      candidate = labeled[1].trim();
    }

    if (!shouldKeepChunk(candidate)) {
      continue;
    }

    candidate = candidate
      .replace(/^the\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!candidate) {
      continue;
    }

    if (candidate.length > 110) {
      candidate = `${candidate.slice(0, 107).trim()}...`;
    }

    const key = candidate.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(candidate);
    if (items.length >= 4) {
      break;
    }
  }

  if (items.length === 0) {
    return {
      heading: "System needs this input to continue:",
      items: [normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized]
    };
  }

  return {
    heading: "Please provide:",
    items
  };
}

export function isApprovalReply(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^(approve|approved|confirm|confirmed|yes|send|go ahead|ok send|okay send)$/i.test(
    normalized
  );
}

export function isRejectReply(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^(reject|rejected|cancel|no|dont send|don't send|stop)$/i.test(normalized);
}

export function formatDraftForChat(draft: { to: string; subject: string; body: string }) {
  return [
    "Draft Email (Approval Required)",
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`,
    "",
    draft.body,
    "",
    "Reply \"approve\" to send this email, or reply with edits."
  ].join("\n");
}

export function makeDirectionTurnId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeWorkflowTaskStatus(status: unknown): WorkflowTaskStatus {
  const normalized = typeof status === "string" ? status.trim().toUpperCase() : "";
  if (
    normalized === "QUEUED" ||
    normalized === "RUNNING" ||
    normalized === "PAUSED" ||
    normalized === "COMPLETED" ||
    normalized === "FAILED" ||
    normalized === "ABORTED" ||
    normalized === "DRAFT" ||
    normalized === "ACTIVE"
  ) {
    return normalized;
  }
  return "UNKNOWN";
}

export function compactTaskTitle(value: string, fallback: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact;
}

export function controlThreadKindLabel(mode: ControlMode) {
  return mode === "DIRECTION" ? "Direction" : "Discussion";
}

export function controlThreadDefaultTitle(mode: ControlMode) {
  return `${controlThreadKindLabel(mode)} String`;
}

export function controlThreadDisplayTitle(item: ControlThreadHistoryItem) {
  const raw = item.title.trim();
  if (!raw || raw === "Command Session" || raw === "Brainstorm Session") {
    return controlThreadDefaultTitle(item.mode);
  }
  return raw;
}

export function controlThreadPreview(item: ControlThreadHistoryItem) {
  const lastOwnerTurn = [...item.turns].reverse().find((turn) => turn.role === "owner")?.content ?? "";
  const source =
    (item.mode === "DIRECTION" ? item.directionGiven : "").trim() ||
    lastOwnerTurn.trim() ||
    item.directionGiven.trim() ||
    item.turns[item.turns.length - 1]?.content?.trim() ||
    "";
  return compactTaskTitle(source, "No discussion or direction yet.");
}

export function buildThreadDeliverableCards(item: ControlThreadHistoryItem): SteerDeliverableCard[] {
  const cards: SteerDeliverableCard[] = [];
  const title = controlThreadDisplayTitle(item);
  const plan = item.planningResult?.primaryPlan;
  if (!plan) {
    return cards;
  }

  const pushCard = (
    text: string,
    source: SteerDeliverableCard["source"],
    index: number,
    workflowTitle?: string
  ) => {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }
    cards.push({
      id: `${item.id}:${source}:${index}:${normalized.toLowerCase().slice(0, 48)}`,
      stringId: item.id,
      stringTitle: title,
      text: normalized,
      source,
      ...(workflowTitle ? { workflowTitle } : {})
    });
  };

  (plan.deliverables ?? []).forEach((deliverable, index) => {
    pushCard(deliverable, "PLAN", index);
  });
  (plan.milestones ?? []).forEach((milestone, index) => {
    pushCard(milestone.deliverable || milestone.title, "MILESTONE", index);
  });
  (plan.workflows ?? []).forEach((workflow, workflowIndex) => {
    (workflow.deliverables ?? []).forEach((deliverable, deliverableIndex) => {
      pushCard(
        deliverable,
        "WORKFLOW",
        workflowIndex * 100 + deliverableIndex,
        workflow.title
      );
    });
    (workflow.tasks ?? []).forEach((task, taskIndex) => {
      if (task.expectedOutput?.trim()) {
        pushCard(
          task.expectedOutput,
          "TASK",
          workflowIndex * 100 + taskIndex,
          workflow.title
        );
      }
    });
  });

  const deduped = new Map<string, SteerDeliverableCard>();
  cards.forEach((card) => {
    const key = `${card.stringId}:${card.text.toLowerCase()}:${card.source}`;
    if (!deduped.has(key)) {
      deduped.set(key, card);
    }
  });
  return [...deduped.values()];
}

export function buildThreadScanRows(input: {
  item: ControlThreadHistoryItem;
  permissionRequests: PermissionRequestItem[];
  approvalCheckpoints: ApprovalCheckpointItem[];
}): ScanActivityRow[] {
  const rows: ScanActivityRow[] = [];
  const { item, permissionRequests, approvalCheckpoints } = input;
  const threadTimestamp = new Date(item.updatedAt).toISOString();
  const plan = item.planningResult?.primaryPlan;
  const planModelLabel = [...item.turns]
    .reverse()
    .find((turn) => turn.role === "organization" && turn.modelLabel)?.modelLabel;

  const push = (row: Omit<ScanActivityRow, "id" | "stringId">) => {
    rows.push({
      id: `${item.id}:scan:${rows.length + 1}`,
      stringId: item.id,
      ...row
    });
  };

  push({
    timestamp: threadTimestamp,
    actorType: "SYSTEM",
    actor: "System",
    category: "STRING_START",
    detail: `String initialized: ${controlThreadDisplayTitle(item)}`,
    raw: JSON.stringify({
      mode: item.mode,
      launchScope: item.launchScope ?? null
    })
  });

  item.turns.forEach((turn, index) => {
    push({
      timestamp: threadTimestamp,
      actorType: turn.role === "owner" ? "HUMAN" : "AI",
      actor:
        turn.role === "owner"
          ? "Human"
          : turn.modelLabel?.trim() || "AI Assistant",
      category: "CHAT_TURN",
      detail: `Turn ${index + 1}: ${compactTaskTitle(turn.content, "No content")}`,
      raw: JSON.stringify(turn)
    });
  });

  if (plan) {
    (plan.deliverables ?? []).forEach((value, index) => {
      push({
        timestamp: threadTimestamp,
        actorType: "AI",
        actor: planModelLabel || "AI Planner",
        category: "DELIVERABLE",
        detail: `Plan deliverable ${index + 1}: ${value}`,
        raw: JSON.stringify({ source: "plan.deliverables", value })
      });
    });

    (plan.milestones ?? []).forEach((milestone, index) => {
      push({
        timestamp: threadTimestamp,
        actorType: "AI",
        actor: planModelLabel || "AI Planner",
        category: "MILESTONE",
        detail: `${milestone.title} | ${milestone.deliverable} | ${milestone.successSignal}`,
        raw: JSON.stringify({ index: index + 1, milestone })
      });
    });

    if (typeof plan.detailScore === "number" && Number.isFinite(plan.detailScore)) {
      push({
        timestamp: threadTimestamp,
        actorType: "AI",
        actor: planModelLabel || "AI Planner",
        category: "SCORE",
        detail: `Detail score: ${Math.max(0, Math.min(100, Math.floor(plan.detailScore)))}`,
        raw: JSON.stringify({
          scoredBy: planModelLabel || "AI Planner",
          score: plan.detailScore
        })
      });
    }

    (plan.pathway ?? []).forEach((step, index) => {
      push({
        timestamp: threadTimestamp,
        actorType: "AI",
        actor: planModelLabel || "AI Planner",
        category: "PATHWAY",
        detail: `${index + 1}. ${step.workflowTitle} -> ${step.taskTitle} | ${step.executionMode}`,
        raw: JSON.stringify(step)
      });
    });
  }

  permissionRequests.forEach((request) => {
    push({
      timestamp: request.updatedAt || request.createdAt || threadTimestamp,
      actorType: "HUMAN",
      actor: request.requestedByEmail || "Human",
      category: "PERMISSION_REQUEST",
      detail: `${request.status} | ${request.area} | ${request.workflowTitle || "N/A"} -> ${request.taskTitle || "N/A"}`,
      raw: JSON.stringify(request)
    });
  });

  approvalCheckpoints.forEach((checkpoint) => {
    push({
      timestamp: checkpoint.resolvedAt || checkpoint.requestedAt || threadTimestamp,
      actorType: checkpoint.resolvedByUserId ? "HUMAN" : "SYSTEM",
      actor: checkpoint.resolvedByUserId ? checkpoint.resolvedByUserId : "System",
      category: "APPROVAL_CHECKPOINT",
      detail: `${checkpoint.status} | Flow ${checkpoint.flowId?.slice(0, 8) ?? "N/A"} | Task ${checkpoint.taskId?.slice(0, 8) ?? "N/A"}`,
      raw: JSON.stringify(checkpoint)
    });
  });

  return rows;
}

export function controlThreadRailScope(item: ControlThreadHistoryItem) {
  if ((item.launchScope?.flowIds?.length ?? 0) > 0) {
    return "EXECUTION" as const;
  }
  if (
    (item.launchScope?.permissionRequestIds?.length ?? 0) > 0 ||
    Boolean(item.pendingPlanLaunchApproval) ||
    Boolean(item.pendingToolkitApproval) ||
    Boolean(item.pendingEmailApproval) ||
    item.agentRunResult?.status === "needs_input"
  ) {
    return "GOVERNANCE" as const;
  }
  return "FOCUS" as const;
}

export function controlThreadScopeBadgeClass(scope: "FOCUS" | "EXECUTION" | "GOVERNANCE") {
  if (scope === "EXECUTION") {
    return "border-cyan-500/35 bg-cyan-500/12 text-cyan-200";
  }
  if (scope === "GOVERNANCE") {
    return "border-amber-500/35 bg-amber-500/12 text-amber-200";
  }
  return "border-emerald-500/35 bg-emerald-500/12 text-emerald-200";
}

export function primaryWorkspaceScopeLabel(scope: "FOCUS" | "EXECUTION" | "GOVERNANCE") {
  if (scope === "FOCUS") {
    return "STRING";
  }
  if (scope === "EXECUTION") {
    return "STL";
  }
  return "SCAN";
}

export function formatRelativeTimeShort(timestamp: number) {
  const deltaMs = Date.now() - timestamp;
  const absMinutes = Math.max(0, Math.round(deltaMs / 60000));
  if (absMinutes < 60) {
    return `~${absMinutes}m ago`;
  }
  const hours = Math.round(absMinutes / 60);
  if (hours < 24) {
    return `~${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `~${days}d ago`;
}

export function inferTurnTimestamp(turn: DirectionTurn, index: number, fallback: number) {
  const idMatch = turn.id.match(/-(\d{10,13})(?:-|$)/);
  if (idMatch) {
    const parsed = Number.parseInt(idMatch[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback + index;
}

export function normalizeDeliverableId(label: string, source: string, index: number) {
  const compact = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${source.toLowerCase()}-${compact || index.toString()}`;
}

export function makeLocalDraftId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function splitDraftLines(value: string | null | undefined) {
  return (value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function buildStringDiscussionTurns(stringItem: ControlThreadHistoryItem | null) {
  if (!stringItem) {
    return [] as Array<
      DirectionTurn & { timestamp: number; actorType: ActorType; actorLabel: string }
    >;
  }
  const fallbackBaseTs = stringItem.updatedAt - Math.max(stringItem.turns.length, 1);
  return stringItem.turns
    .map((turn, index) => ({
      ...turn,
      timestamp: inferTurnTimestamp(turn, index, fallbackBaseTs),
      actorType: turn.role === "owner" ? "HUMAN" : "AI",
      actorLabel: turn.role === "owner" ? "Owner" : turn.modelLabel || "Organization"
    }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function buildEditableStringDraft(input: {
  stringItem: ControlThreadHistoryItem;
  permissionRequests: PermissionRequestItem[];
  approvalCheckpoints: ApprovalCheckpointItem[];
}): EditableStringDraft {
  const { stringItem, permissionRequests, approvalCheckpoints } = input;
  const plan = stringItem.planningResult?.primaryPlan ?? null;
  const detailScore =
    typeof plan?.detailScore === "number" && Number.isFinite(plan.detailScore)
      ? Math.max(0, Math.min(100, Math.floor(plan.detailScore)))
      : null;

  return {
    discussion: buildStringDiscussionTurns(stringItem).map((turn) => ({
      id: turn.id,
      actorType: turn.actorType as ActorType,
      actorLabel: turn.actorLabel,
      content: turn.content
    })),
    direction:
      stringItem.planningResult?.directionGiven?.trim() || stringItem.directionGiven.trim() || "",
    plan: {
      summary: plan?.summary?.trim() || stringItem.planningResult?.analysis?.trim() || "",
      deliverablesText: (plan?.deliverables ?? []).join("\n")
    },
    workflows: (plan?.workflows ?? []).map((workflow, index) => ({
      id: `workflow-${index}`,
      title: workflow.title,
      ownerRole: workflow.ownerRole || "",
      goal: workflow.goal || "",
      deliverablesText: (workflow.deliverables ?? []).join("\n"),
      taskSummary: workflow.tasks.map((task) => task.title).join("\n")
    })),
    pathway: (plan?.pathway ?? []).map((step, index) => ({
      id: step.stepId || `pathway-${index}`,
      workflowTitle: step.workflowTitle,
      taskTitle: step.taskTitle,
      ownerRole: step.ownerRole,
      executionMode: step.executionMode,
      trigger: step.trigger,
      dueWindow: step.dueWindow
    })),
    approvals: [
      ...(plan?.approvalCheckpoints ?? []).map((approval, index) => ({
        id: `plan-approval-${index}`,
        title: approval.name,
        owner: approval.requiredRole,
        reason: approval.reason,
        status: "PLAN"
      })),
      ...permissionRequests.map((request) => ({
        id: `request-${request.id}`,
        title: `${request.area} | ${request.workflowTitle || "Workflow"} -> ${request.taskTitle || "Task"}`,
        owner: request.requestedByEmail || request.targetRole,
        reason: request.reason,
        status: request.status
      })),
      ...approvalCheckpoints.map((checkpoint) => ({
        id: `checkpoint-${checkpoint.id}`,
        title: `Flow ${checkpoint.flowId?.slice(0, 8) ?? "N/A"} | Task ${checkpoint.taskId?.slice(0, 8) ?? "N/A"}`,
        owner: checkpoint.resolvedByUserId || "Runtime",
        reason: checkpoint.reason,
        status: checkpoint.status
      }))
    ],
    milestones: (plan?.milestones ?? []).map((milestone, index) => ({
      id: `milestone-${index}`,
      title: milestone.title,
      ownerRole: milestone.ownerRole,
      dueWindow: milestone.dueWindow,
      deliverable: milestone.deliverable,
      successSignal: milestone.successSignal
    })),
    scoring: {
      detailScore: detailScore === null ? "" : String(detailScore),
      note: stringItem.planningResult?.analysis?.trim() || ""
    }
  };
}

export function getScopedPermissionRequestsForString(
  stringItem: ControlThreadHistoryItem,
  permissionRequests: PermissionRequestItem[]
) {
  const planId = stringItem.launchScope?.planId?.trim() ?? "";
  const directionId = stringItem.launchScope?.directionId?.trim() ?? "";
  const scopedIds = new Set<string>();
  for (const requestId of stringItem.launchScope?.permissionRequestIds ?? []) {
    const normalized = requestId.trim();
    if (normalized) {
      scopedIds.add(normalized);
    }
  }
  for (const request of stringItem.planningResult?.permissionRequests ?? []) {
    const normalized = request.id?.trim() ?? "";
    if (normalized) {
      scopedIds.add(normalized);
    }
  }
  return permissionRequests.filter((request) => {
    if (scopedIds.has(request.id)) {
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
}

export function getScopedApprovalCheckpointsForString(
  stringItem: ControlThreadHistoryItem,
  approvalCheckpoints: ApprovalCheckpointItem[]
) {
  const flowIds = new Set(
    (stringItem.launchScope?.flowIds ?? []).map((value) => value.trim()).filter(Boolean)
  );
  if (flowIds.size === 0) {
    return [] as ApprovalCheckpointItem[];
  }
  return approvalCheckpoints.filter((checkpoint) =>
    checkpoint.flowId ? flowIds.has(checkpoint.flowId.trim()) : false
  );
}

export function buildDraftDeliverableCards(input: {
  stringItem: ControlThreadHistoryItem;
  draft: EditableStringDraft;
}) {
  const { stringItem, draft } = input;
  const cards: SteerDeliverableCard[] = [];
  const title = controlThreadDisplayTitle(stringItem);

  const pushCard = (
    text: string,
    source: SteerDeliverableCard["source"],
    index: number,
    workflowTitle?: string
  ) => {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }
    cards.push({
      id: `${stringItem.id}:${source}:${index}:${normalized.toLowerCase().slice(0, 48)}`,
      stringId: stringItem.id,
      stringTitle: title,
      text: normalized,
      source,
      ...(workflowTitle ? { workflowTitle } : {})
    });
  };

  splitDraftLines(draft.plan.deliverablesText).forEach((deliverable, index) => {
    pushCard(deliverable, "PLAN", index);
  });

  draft.milestones.forEach((milestone, index) => {
    pushCard(milestone.deliverable || milestone.title, "MILESTONE", index);
  });

  draft.workflows.forEach((workflow, workflowIndex) => {
    splitDraftLines(workflow.deliverablesText).forEach((deliverable, deliverableIndex) => {
      pushCard(
        deliverable,
        "WORKFLOW",
        workflowIndex * 100 + deliverableIndex,
        workflow.title
      );
    });
  });

  const deduped = new Map<string, SteerDeliverableCard>();
  cards.forEach((card) => {
    const key = `${card.stringId}:${card.text.toLowerCase()}:${card.source}`;
    if (!deduped.has(key)) {
      deduped.set(key, card);
    }
  });
  return [...deduped.values()];
}

export function toLocalDateKey(input: number | string | Date) {
  const value = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(value.getTime())) {
    return "";
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildLocalMonthGrid(monthCursor: Date) {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const monthStart = new Date(year, month, 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(1 - monthStart.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

export function workflowAgentLabelFromTaskTrace(input: {
  agent?: { name: string; role: string } | null;
  executionTrace?: unknown;
}) {
  if (input.agent?.name && input.agent?.role) {
    return `${input.agent.name} (${input.agent.role})`;
  }
  const trace =
    input.executionTrace && typeof input.executionTrace === "object"
      ? (input.executionTrace as Record<string, unknown>)
      : null;
  const runtime =
    trace?.agentRuntime && typeof trace.agentRuntime === "object"
      ? (trace.agentRuntime as Record<string, unknown>)
      : null;
  const logicalRole =
    typeof runtime?.logicalRole === "string" && runtime.logicalRole.trim().length > 0
      ? runtime.logicalRole.trim()
      : "";
  const logicalAgentId =
    typeof runtime?.logicalAgentId === "string" && runtime.logicalAgentId.trim().length > 0
      ? runtime.logicalAgentId.trim().slice(0, 8)
      : "";
  if (logicalRole && logicalAgentId) {
    return `${logicalRole} (${logicalAgentId})`;
  }
  if (logicalRole) {
    return logicalRole;
  }
  return undefined;
}

export function buildPlanCardMeta(input: {
  direction: string;
  plan: DirectionExecutionPlan;
  requiredToolkits: string[];
}): AssistantMessageMeta {
  const title = input.direction.trim()
    ? `Plan For: ${compactTaskTitle(input.direction, "Direction")}`
    : "Execution Plan";

  return {
    kind: "plan_card",
    title,
    summary: input.plan.summary?.trim() || input.plan.organizationFitSummary?.trim() || "",
    detailScore:
      typeof input.plan.detailScore === "number" && Number.isFinite(input.plan.detailScore)
        ? Math.max(0, Math.min(100, Math.floor(input.plan.detailScore)))
        : undefined,
    requiredToolkits: input.requiredToolkits.slice(0, 16),
    workflows: (input.plan.workflows ?? []).slice(0, 6).map((workflow, workflowIndex) => ({
      title: workflow.title || `Workflow ${workflowIndex + 1}`,
      goal: workflow.goal || "",
      ownerRole: workflow.ownerRole || "",
      tasks: (workflow.tasks ?? []).slice(0, 10).map((task, taskIndex) => ({
        id: `wf${workflowIndex + 1}-task${taskIndex + 1}`,
        title: compactTaskTitle(task.title || "", `Task ${taskIndex + 1}`),
        status: "QUEUED",
        agentLabel: task.ownerRole || workflow.ownerRole || "Agent",
        dependsOn: (task.dependsOn ?? []).slice(0, 4)
      }))
    }))
  };
}

export type ControlMode = "MINDSTORM" | "DIRECTION";
export type ControlConversationDetail = "REASONING_MIN" | "DIRECTION_GIVEN";
export type StringWorkspaceTab = "DETAILS" | "BLUEPRINT";
export type StringDetailsTab = "DISCUSSION" | "DIRECTION" | "COLLABORATION" | "PLAN";
export type FlowStringDetailsSubtab =
  | "OVERVIEW"
  | "DISCUSSION"
  | "DIRECTION"
  | "PLAN"
  | "WORKFLOW"
  | "PATHWAY"
  | "APPROVALS"
  | "MILESTONES"
  | "DELIVERABLES"
  | "SCORING"
  | "COLLABORATION";
export type SteerLane = "CENTER" | "APPROVED" | "RETHINK";
export type ActorType = "AI" | "HUMAN" | "SYSTEM";

export const FLOW_STRING_DETAILS_SUBTABS = [
  { id: "OVERVIEW", label: "Overview" },
  { id: "DISCUSSION", label: "Discussion" },
  { id: "DIRECTION", label: "Direction" },
  { id: "PLAN", label: "Plan" },
  { id: "WORKFLOW", label: "Workflow" },
  { id: "PATHWAY", label: "Pathway" },
  { id: "APPROVALS", label: "Approvals" },
  { id: "MILESTONES", label: "Milestones" },
  { id: "DELIVERABLES", label: "Deliverables" },
  { id: "SCORING", label: "Scoring" },
  { id: "COLLABORATION", label: "Collaboration" }
] as const satisfies Array<{ id: FlowStringDetailsSubtab; label: string }>;

export interface StringDeliverableCard {
  id: string;
  label: string;
  source: "PLAN" | "WORKFLOW" | "MILESTONE";
}

export interface StringSteerDecisionRecord extends StringDeliverableCard {
  lane: SteerLane;
  decidedBy: ActorType;
  decidedAt: number;
}

export interface StringScoreRecord {
  id: string;
  metric: string;
  score: number;
  maxScore: number;
  scoredByType: ActorType;
  scoredBy: string;
  note: string;
  createdAt: number;
}

export interface StringScanRow {
  id: string;
  timestamp: number;
  stage: string;
  actorType: ActorType;
  actor: string;
  event: string;
  details: string;
  raw: string;
}

export interface EditableDiscussionDraft {
  id: string;
  actorType: ActorType;
  actorLabel: string;
  content: string;
}

export interface EditableWorkflowDraft {
  id: string;
  title: string;
  ownerRole: string;
  goal: string;
  deliverablesText: string;
  taskSummary: string;
}

export interface EditablePathwayDraft {
  id: string;
  workflowTitle: string;
  taskTitle: string;
  ownerRole: string;
  executionMode: "HUMAN" | "AGENT" | "HYBRID";
  trigger: string;
  dueWindow: string;
}

export interface EditablePlanDraft {
  summary: string;
  deliverablesText: string;
}

export interface EditableApprovalDraft {
  id: string;
  title: string;
  owner: string;
  reason: string;
  status: string;
}

export interface EditableMilestoneDraft {
  id: string;
  title: string;
  ownerRole: string;
  dueWindow: string;
  deliverable: string;
  successSignal: string;
}

export interface EditableScoringDraft {
  detailScore: string;
  note: string;
}

export interface EditableStringDraft {
  discussion: EditableDiscussionDraft[];
  direction: string;
  plan: EditablePlanDraft;
  workflows: EditableWorkflowDraft[];
  pathway: EditablePathwayDraft[];
  approvals: EditableApprovalDraft[];
  milestones: EditableMilestoneDraft[];
  scoring: EditableScoringDraft;
}

export interface DirectionPlanTask {
  title: string;
  description?: string;
  ownerRole: string;
  dependsOn?: string[];
  subtasks: string[];
  tools: string[];
  expectedOutput?: string;
  estimatedMinutes?: number;
  requiresApproval: boolean;
  approvalRole: string;
  approvalReason: string;
}

export interface DirectionPlanWorkflow {
  title: string;
  goal: string;
  ownerRole?: string;
  ownerType?: "HUMAN" | "AGENT" | "HYBRID";
  dependencies?: string[];
  deliverables?: string[];
  tools?: string[];
  entryCriteria?: string[];
  exitCriteria?: string[];
  successMetrics?: string[];
  estimatedHours?: number;
  tasks: DirectionPlanTask[];
}

export interface DirectionPlanPathwayStep {
  stepId: string;
  line: number;
  workflowTitle: string;
  taskTitle: string;
  ownerRole: string;
  executionMode: "HUMAN" | "AGENT" | "HYBRID";
  trigger: string;
  dueWindow: string;
  dependsOn: string[];
}

export interface DirectionExecutionPlan {
  objective?: string;
  organizationFitSummary?: string;
  summary: string;
  deliverables?: string[];
  milestones?: Array<{
    title: string;
    ownerRole: string;
    dueWindow: string;
    deliverable: string;
    successSignal: string;
  }>;
  resourcePlan?: Array<{
    workforceType: "HUMAN" | "AGENT" | "HYBRID";
    role: string;
    responsibility: string;
    capacityPct: number;
    tools: string[];
  }>;
  approvalCheckpoints?: Array<{
    name: string;
    trigger: string;
    requiredRole: string;
    reason: string;
  }>;
  dependencies?: Array<{
    fromWorkflow: string;
    toWorkflow: string;
    reason: string;
  }>;
  pathway?: DirectionPlanPathwayStep[];
  workflows: DirectionPlanWorkflow[];
  risks: string[];
  successMetrics: string[];
  detailScore?: number;
}

export interface PermissionRequestItem {
  id: string;
  orgId: string;
  direction: string;
  directionId: string | null;
  planId: string | null;
  requestedByUserId: string;
  requestedByEmail: string;
  targetRole: "FOUNDER" | "ADMIN" | "EMPLOYEE";
  area: string;
  reason: string;
  workflowTitle: string;
  taskTitle: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
  decidedByEmail: string | null;
  decisionNote: string | null;
}

export interface ApprovalCheckpointItem {
  id: string;
  orgId: string;
  flowId: string | null;
  taskId: string | null;
  agentId: string | null;
  agentRunId: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason: string;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
}

export interface DirectionPlanningResult {
  analysis: string;
  directionGiven: string;
  primaryPlan: DirectionExecutionPlan;
  fallbackPlan: DirectionExecutionPlan;
  permissionRequests?: PermissionRequestItem[];
  requiredToolkits?: string[];
  autoSquad?: {
    triggered?: boolean;
    domain?: string;
    requestedRoles?: string[];
    created?: Array<{
      id: string;
      name: string;
      role: string;
    }>;
  };
  directionRecord?: { id?: string };
  planRecord?: { id?: string };
}

export type OrchestrationPipelineMode = "OFF" | "AUDIT" | "ENFORCE";

export interface OrchestrationPipelineEffectivePolicy {
  strictFeatureEnabled: boolean;
  mode: OrchestrationPipelineMode;
  enforcePlanBeforeExecution: boolean;
  requirePlanWorkflows: boolean;
  blockDirectWorkflowLaunch: boolean;
  freezeExecutionToApprovedPlan: boolean;
  requireDetailedPlan: boolean;
  requireMultiWorkflowDecomposition: boolean;
  enforceSpecialistToolAssignment: boolean;
  enabledRuleTypes: string[];
}

export function isGmailDirectionPrompt(value: string) {
  const prompt = value.toLowerCase();
  const hasEmailDomain = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(prompt);
  const hasExplicitMailContext =
    /\b(gmail|email|mail|inbox|mailbox|compose (?:email|mail)|send (?:email|mail)|draft (?:email|mail))\b/.test(prompt) ||
    /\b(to:|subject:|cc:|bcc:|recipient)\b/.test(prompt);
  const hasMailAction =
    /\b(send|draft|reply|summarize|summary|find|search|read|list|compose)\b/.test(prompt);
  const hasNonMailPrimaryAction =
    /\b(schedule|meeting|calendar|google meet|gmeet|meet\.google\.com|zoom|workflow|task|plan)\b/.test(
      prompt
    );
  return (hasExplicitMailContext || (hasEmailDomain && /\bemail\b/.test(prompt))) &&
    hasMailAction &&
    !hasNonMailPrimaryAction;
}

export function isRecurringTaskPrompt(value: string) {
  const prompt = value.trim().toLowerCase();
  if (!prompt) return false;

  const informationalQuestion =
    /^(what|why|how|when|where|who|which)\b/.test(prompt) && !/\b(please|can you|could you)\b/.test(prompt);
  if (informationalQuestion) {
    return false;
  }

  const recurringSignal =
    /\b(recurring|recur|repeat|repeating|cadence|cron)\b/.test(prompt) ||
    /\b(daily|weekly|monthly|quarterly|yearly|annually)\b/.test(prompt) ||
    /\b(every|each)\s+(day|week|month|quarter|year|weekday|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
      prompt
    );

  if (!recurringSignal) {
    return false;
  }

  const hasActionIntent =
    /\b(schedule|create|send|email|mail|meeting|report|run|execute|trigger|sync|notify|remind|generate|post|update|check|monitor)\b/.test(
      prompt
    );

  return hasActionIntent;
}

export function shouldDirectWorkflowLaunch(value: string) {
  const prompt = value.trim().toLowerCase();
  if (!prompt) return false;

  if (isRecurringTaskPrompt(prompt)) {
    return false;
  }

  const words = prompt.split(/\s+/g).filter(Boolean);
  const wordCount = words.length;
  const politeActionQuestion = /^(can you|could you|please|pls)\b/.test(prompt);
  const informationalQuestion =
    !politeActionQuestion &&
    (/^(what|why|how|when|where|who|which)\b/.test(prompt) || /\?$/.test(prompt));
  if (informationalQuestion) {
    return false;
  }

  const hasPlanningSignals =
    /\b(direction|strategy|roadmap|plan|planning|decompose|long-term|quarterly|yearly|vision|kpi|team design|org structure)\b/.test(
      prompt
    );
  if (hasPlanningSignals) {
    return false;
  }

  const hasQuickActionVerb =
    /\b(schedule|book|create|send|draft|reply|summarize|search|read|fetch|sync|update|post|notify|remind|launch|run|execute|connect)\b/.test(
      prompt
    );
  const hasToolSignal = inferToolkitsFromDirectionPrompt(prompt).length > 0;
  const likelyShortTask = wordCount <= 90;

  return hasQuickActionVerb && hasToolSignal && likelyShortTask;
}

export function shouldForceDirectionPlanRoute(value: string) {
  const prompt = value.trim().toLowerCase();
  if (!prompt) return false;

  if (isRecurringTaskPrompt(prompt)) {
    return true;
  }

  const informationalQuestion =
    /^(what|why|how|when|where|who|which)\b/.test(prompt) &&
    !/\b(can you|could you|please)\b/.test(prompt);
  if (informationalQuestion) {
    return false;
  }

  const hasExecutionVerb =
    /\b(create|build|generate|prepare|design|draft|develop|produce|implement|execute|launch|run|orchestrate|automate|delegate|set up|setup)\b/.test(
      prompt
    );
  const hasDeliverable =
    /\b(ppt|presentation|pitch deck|investor deck|deck|proposal|workflow|plan|roadmap|campaign|report|playbook)\b/.test(
      prompt
    );

  return hasExecutionVerb || hasDeliverable || shouldDirectWorkflowLaunch(prompt);
}

export function inferToolkitsFromDirectionPrompt(value: string) {
  const prompt = value.toLowerCase();
  const compactPrompt = prompt.replace(/[^a-z0-9]/g, "");
  const requested = new Set<string>();
  const escapeRegex = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const toolkitAliases: Record<string, string[]> = {
    googleslides: [
      "googleslides",
      "google slides",
      "slides",
      "presentation",
      "ppt",
      "powerpoint",
      "pitch deck",
      "investor deck"
    ],
    gmail: ["gmail", "email", "mailbox", "inbox"],
    slack: ["slack", "channel", "workspace", "direct message", "dm"],
    notion: ["notion", "wiki", "knowledge base", "docs", "documentation"],
    github: ["github", "repository", "repo", "pull request", "commit", "issue"],
    googlemeet: ["googlemeet", "google meet", "gmeet", "meet.google.com"],
    googlecalendar: ["googlecalendar", "google calendar", "calendar", "schedule", "availability"],
    googledrive: ["googledrive", "google drive", "drive"],
    googledocs: ["googledocs", "google docs", "document"],
    googlesheets: ["googlesheets", "google sheets", "spreadsheet", "sheet"],
    outlook: ["outlook"],
    microsoftteams: ["microsoftteams", "microsoft teams", "teams"],
    jira: ["jira", "ticket", "backlog", "sprint"],
    trello: ["trello", "board", "card"],
    asana: ["asana"],
    monday: ["monday", "monday.com"],
    linear: ["linear"],
    shopify: ["shopify", "storefront"],
    stripe: ["stripe", "payment"],
    salesforce: ["salesforce", "crm", "opportunity", "pipeline"],
    hubspot: ["hubspot", "crm", "lead"],
    pipedrive: ["pipedrive"],
    quickbooks: ["quickbooks", "quick books", "accounting"],
    zendesk: ["zendesk", "support ticket"],
    whatsapp: ["whatsapp"],
    twitter: ["twitter", "x.com"],
    linkedin: ["linkedin"],
    youtube: ["youtube"],
    zoom: ["zoom", "video call", "video meeting", "webinar", "meeting link"],
    intercom: ["intercom"],
    typeform: ["typeform", "survey"]
  };

  for (const [toolkit, aliases] of Object.entries(toolkitAliases)) {
    const matched = aliases.some((alias) => {
      const normalizedAlias = alias.trim().toLowerCase();
      if (!normalizedAlias) return false;
      const compactAlias = normalizedAlias.replace(/[^a-z0-9]/g, "");
      const shortAlias = compactAlias.length > 0 && compactAlias.length <= 2;
      const allowCompactAliasMatch = compactAlias.length >= 5 || normalizedAlias.includes(" ");
      if (shortAlias) {
        const bounded = new RegExp(`(?:^|\\W)${escapeRegex(normalizedAlias)}(?:$|\\W)`, "i");
        return bounded.test(prompt);
      }
      return (
        prompt.includes(normalizedAlias) ||
        (allowCompactAliasMatch && compactPrompt.includes(compactAlias))
      );
    });
    if (matched) {
      requested.add(toolkit);
    }
  }

  const hasMeetingCreateIntent =
    /\b(set up|setup|schedule|book|arrange|create|plan)\b[\s\S]{0,80}\b(meeting|call|invite|invitation|session)\b/i.test(
      prompt
    ) ||
    /\b(meeting|call|invite|invitation|session)\b[\s\S]{0,80}\b(set up|setup|schedule|book|arrange|create|plan)\b/i.test(
      prompt
    );
  const hasMeetingShareIntent =
    /\b(send|share|mail|email)\b/i.test(prompt) &&
    /\b(details?|invite|invitation|link|meeting)\b/i.test(prompt);
  const hasRecipientEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(prompt);

  if (hasMeetingCreateIntent) {
    requested.add("googlemeet");
    requested.add("googlecalendar");
  }
  if (hasMeetingShareIntent && hasRecipientEmail) {
    requested.add("gmail");
  }

  return [...requested];
}

export function normalizeToolkitAlias(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";

  const aliasMap: Record<string, string> = {
    crm: "hubspot",
    gmeet: "googlemeet",
    "google meet": "googlemeet",
    "google calendar": "googlecalendar",
    calendar: "googlecalendar",
    "google slides": "googleslides",
    slides: "googleslides",
    ppt: "googleslides",
    powerpoint: "googleslides",
    "pitch deck": "googleslides",
    "investor deck": "googleslides",
    "google drive": "googledrive",
    drive: "googledrive",
    teams: "microsoftteams",
    "microsoft teams": "microsoftteams",
    docs: "googledocs"
  };

  return aliasMap[normalized] ?? normalized.replace(/[\s-]+/g, "");
}

export function buildToolkitApprovalRequestId(prompt: string, toolkits: string[]) {
  const normalizedPrompt = prompt.trim().toLowerCase();
  const normalizedToolkits = [...new Set(toolkits.map((item) => item.trim().toLowerCase()))].sort();
  return `${normalizedPrompt}::${normalizedToolkits.join(",")}`;
}

export function formatToolkitList(toolkits: string[]) {
  return [...new Set(toolkits.map((item) => item.trim().toLowerCase()))].join(", ");
}

export function collectPlanToolkits(plan: DirectionExecutionPlan | null | undefined) {
  if (!plan) return [] as string[];
  const set = new Set<string>();
  for (const allocation of plan.resourcePlan ?? []) {
    for (const tool of allocation.tools ?? []) {
      const normalized = tool.trim().toLowerCase();
      if (normalized) {
        set.add(normalized);
      }
    }
  }
  for (const workflow of plan.workflows ?? []) {
    for (const workflowTool of workflow.tools ?? []) {
      const normalizedWorkflowTool = workflowTool.trim().toLowerCase();
      if (normalizedWorkflowTool) {
        set.add(normalizedWorkflowTool);
      }
    }
    for (const task of workflow.tasks ?? []) {
      for (const tool of task.tools ?? []) {
        const normalized = tool.trim().toLowerCase();
        if (normalized) {
          set.add(normalized);
        }
      }
    }
  }
  return [...set];
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function openCenteredPopup(url: string, name: string) {
  const width = Math.max(720, Math.min(980, window.outerWidth - 80));
  const height = Math.max(620, Math.min(760, window.outerHeight - 90));
  const left = Math.max(0, window.screenX + Math.round((window.outerWidth - width) / 2));
  const top = Math.max(0, window.screenY + Math.round((window.outerHeight - height) / 2));

  return window.open(
    url,
    name,
    `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );
}

export async function parseJsonBody<T>(response: Response): Promise<{
  payload: T | null;
  rawText: string;
}> {
  const rawText = await response.text();
  if (!rawText) {
    return { payload: null, rawText: "" };
  }
  try {
    return {
      payload: JSON.parse(rawText) as T,
      rawText
    };
  } catch {
    return {
      payload: null,
      rawText
    };
  }
}

export function normalizePlanAnalysisText(rawValue: string | null | undefined) {
  const raw = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!raw) {
    return "";
  }

  const fenceMatch = raw.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  const candidate = (fenceMatch?.[1] ?? raw).trim();
  if (!candidate) {
    return "";
  }

  if (!candidate.startsWith("{") && !candidate.startsWith("[")) {
    return candidate;
  }

  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (typeof parsed === "string") {
      return parsed.trim();
    }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      let summary = "";
      if (typeof record.analysis === "string") {
        summary = record.analysis;
      } else if (typeof record.summary === "string") {
        summary = record.summary;
      } else if (typeof record.message === "string") {
        summary = record.message;
      }
      return summary.trim();
    }
  } catch {
    return "";
  }

  return "";
}

