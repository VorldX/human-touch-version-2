"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useVorldXStore } from "@/lib/store/vorldx-store";
import type { AssistantMessageMeta, WorkflowTaskStatus } from "@/src/types/chat";
import { enrichMessageForIntent } from "@/src/utils/intentDetector";

const NAV_ITEMS = [
  {
    id: "control",
    label: "Control Deck",
    navLabel: "All Commands",
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
    label: "Command",
    navLabel: "Pathway",
    helper: "Command strategy",
    primary: "FOCUS",
    icon: Target
  },
  {
    id: "blueprint",
    label: "Blueprint",
    navLabel: "Blueprint",
    helper: "Workforce graph",
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
    label: "Squad",
    navLabel: "Squad",
    helper: "People + agents",
    primary: "EXECUTION",
    icon: Users
  },
  {
    id: "memory",
    label: "Memory",
    navLabel: "Memory",
    helper: "Audit",
    primary: "GOVERNANCE",
    icon: Database
  },
  {
    id: "settings",
    label: "Settings",
    navLabel: "Settings",
    helper: "Policies",
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

const PRIMARY_WORKSPACE_TABS = [
  {
    id: "FOCUS",
    label: "Focus",
    helper: "Commands, planning, and pathway",
    icon: Target
  },
  {
    id: "EXECUTION",
    label: "Execution",
    helper: "Runtime, delivery, and orchestration",
    icon: Workflow
  },
  {
    id: "GOVERNANCE",
    label: "Governance",
    helper: "Policy, memory, and controls",
    icon: Shield
  }
] as const;

type NavItemId = (typeof NAV_ITEMS)[number]["id"];
type PrimaryWorkspaceTabId = (typeof PRIMARY_WORKSPACE_TABS)[number]["id"];
type WorkspaceMode = "BRAINSTORM" | "COMMAND" | "OPERATIONS" | "HUB" | "CALENDAR";

const OPERATION_TAB_IDS = [
  "plan",
  "flow",
  "direction",
  "blueprint",
  "squad",
  "memory",
  "settings"
] as const;
type OperationTabId = (typeof OPERATION_TAB_IDS)[number];
const OPERATION_TAB_SET = new Set<string>(OPERATION_TAB_IDS);

const DEFAULT_PRIMARY_TAB_SUBTAB: Record<PrimaryWorkspaceTabId, NavItemId> = {
  FOCUS: "plan",
  EXECUTION: "blueprint",
  GOVERNANCE: "memory"
};

const NAV_ITEM_MAP = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.id, item])
) as Record<NavItemId, (typeof NAV_ITEMS)[number]>;

function getPrimaryWorkspaceTabForNavItem(tab: NavItemId): PrimaryWorkspaceTabId {
  return NAV_ITEM_MAP[tab].primary;
}

const THEME_STYLES: Record<
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

const PRESENCE_POOL = [
  { id: "u-1", name: "Ava Rao", color: "bg-blue-500" },
  { id: "u-2", name: "M. Thorne", color: "bg-emerald-500" },
  { id: "u-3", name: "K. Iyer", color: "bg-amber-500" },
  { id: "u-4", name: "S. Das", color: "bg-cyan-500" },
  { id: "u-5", name: "R. Patel", color: "bg-rose-500" }
];

const DIRECTION_MODELS = [
  { id: "gemini:gemini-2.5-flash", label: "Gemini (2.5 Flash)" },
  { id: "openai:gpt-4o-mini", label: "ChatGPT (gpt-4o-mini)" },
  { id: "anthropic:claude-3-5-sonnet", label: "Claude (3.5 Sonnet)" }
] as const;

const REQUESTS_POLL_INTERVAL_MS = 30000;
const PIPELINE_POLICY_POLL_INTERVAL_MS = 30000;
const MISSION_SCHEDULES_POLL_INTERVAL_MS = 45000;

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase() ?? "")
    .join("");
}

function randomPresence() {
  const pool = [...PRESENCE_POOL].sort(() => Math.random() - 0.5);
  const count = 2 + Math.floor(Math.random() * 4);
  return pool.slice(0, count);
}

interface ControlMessage {
  tone: "success" | "warning" | "error";
  text: string;
}

type AgentRunStatus = "needs_input" | "needs_confirmation" | "completed" | "error";

interface AgentRunResponse {
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

interface DirectionTurn {
  id: string;
  role: "owner" | "organization";
  content: string;
  modelLabel?: string;
  meta?: AssistantMessageMeta;
}

type MissionCadence = "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";

interface MissionSchedule {
  id: string;
  title: string;
  direction: string;
  cadence: MissionCadence;
  nextRunAt: string;
  timezone: string;
  swarmDensity: number;
  requiredSignatures: number;
  predictedBurn: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

interface MissionScheduleDraft {
  title: string;
  cadence: MissionCadence;
  nextRunAt: string;
}

type SetupPanel = "closed" | "chooser" | "onboarding" | "request-access";

interface UserJoinRequest {
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

interface OrgListResponse {
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

interface HumanInputRequest {
  taskId: string;
  flowId: string | null;
  reason: string;
}

interface PendingEmailApproval {
  prompt: string;
  draft: {
    to: string;
    subject: string;
    body: string;
  };
}

interface PendingToolkitApproval {
  requestId: string;
  prompt: string;
  toolkits: string[];
}

interface PendingPlanLaunchApproval {
  prompt: string;
  toolkits: string[];
  reason: string;
}

interface PendingChatPlanRoute {
  prompt: string;
  reason: string;
  toolkitHints: string[];
}

interface ComposerAttachmentPayload {
  files: File[];
}

interface ControlThreadHistoryItem {
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

interface DirectionIntentRouting {
  route: "CHAT_RESPONSE" | "PLAN_REQUIRED";
  reason: string;
  toolkitHints?: string[];
  squadRoleHints?: string[];
  cadenceHint?: "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";
}

function normalizeHumanInputReason(reason: string | null | undefined) {
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

function summarizeHumanInputReason(reason: string | null | undefined) {
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

function isApprovalReply(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^(approve|approved|confirm|confirmed|yes|send|go ahead|ok send|okay send)$/i.test(
    normalized
  );
}

function isRejectReply(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^(reject|rejected|cancel|no|dont send|don't send|stop)$/i.test(normalized);
}

function formatDraftForChat(draft: { to: string; subject: string; body: string }) {
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

function makeDirectionTurnId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeWorkflowTaskStatus(status: unknown): WorkflowTaskStatus {
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

function compactTaskTitle(value: string, fallback: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact;
}

function workflowAgentLabelFromTaskTrace(input: {
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

function buildPlanCardMeta(input: {
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

type ControlMode = "MINDSTORM" | "DIRECTION";
type ControlConversationDetail = "REASONING_MIN" | "DIRECTION_GIVEN";

interface DirectionPlanTask {
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

interface DirectionPlanWorkflow {
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

interface DirectionPlanPathwayStep {
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

interface DirectionExecutionPlan {
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

interface PermissionRequestItem {
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

interface ApprovalCheckpointItem {
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

interface DirectionPlanningResult {
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

type OrchestrationPipelineMode = "OFF" | "AUDIT" | "ENFORCE";

interface OrchestrationPipelineEffectivePolicy {
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

function toDatetimeLocalValue(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toIsoFromDatetimeLocal(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function isGmailDirectionPrompt(value: string) {
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

function isRecurringTaskPrompt(value: string) {
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

function shouldDirectWorkflowLaunch(value: string) {
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

function shouldForceDirectionPlanRoute(value: string) {
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

function inferToolkitsFromDirectionPrompt(value: string) {
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

function normalizeToolkitAlias(value: string) {
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

function buildToolkitApprovalRequestId(prompt: string, toolkits: string[]) {
  const normalizedPrompt = prompt.trim().toLowerCase();
  const normalizedToolkits = [...new Set(toolkits.map((item) => item.trim().toLowerCase()))].sort();
  return `${normalizedPrompt}::${normalizedToolkits.join(",")}`;
}

function formatToolkitList(toolkits: string[]) {
  return [...new Set(toolkits.map((item) => item.trim().toLowerCase()))].join(", ");
}

function collectPlanToolkits(plan: DirectionExecutionPlan | null | undefined) {
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openCenteredPopup(url: string, name: string) {
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

async function parseJsonBody<T>(response: Response): Promise<{
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

function normalizePlanAnalysisText(rawValue: string | null | undefined) {
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

export function VorldXShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, signOutCurrentUser } = useFirebaseAuth();
  const orgs = useVorldXStore((state) => state.orgs);
  const setOrgs = useVorldXStore((state) => state.setOrgs);
  const addOrg = useVorldXStore((state) => state.addOrg);
  const currentOrg = useVorldXStore((state) => state.currentOrg);
  const setCurrentOrg = useVorldXStore((state) => state.setCurrentOrg);
  const theme = useVorldXStore((state) => state.theme);
  const isGhostModeActive = useVorldXStore((state) => state.isGhostModeActive);
  const toggleGhostMode = useVorldXStore((state) => state.toggleGhostMode);
  const activeUsers = useVorldXStore((state) => state.activeUsers);
  const setStoreActiveUsers = useVorldXStore((state) => state.setActiveUsers);
  const pushNotification = useVorldXStore((state) => state.pushNotification);

  const [activeTab, setActiveTab] = useState<NavItemId>("control");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("BRAINSTORM");
  const [operationsTab, setOperationsTab] = useState<OperationTabId>("plan");
  const [primaryWorkspaceTab, setPrimaryWorkspaceTab] =
    useState<PrimaryWorkspaceTabId>("FOCUS");
  const [primaryTabLastSubtab, setPrimaryTabLastSubtab] = useState<
    Record<PrimaryWorkspaceTabId, NavItemId>
  >(DEFAULT_PRIMARY_TAB_SUBTAB);
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);
  const [showUtilityMenu, setShowUtilityMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [intent, setIntent] = useState("");
  const [directionPrompt, setDirectionPrompt] = useState("");
  const [directionTurns, setDirectionTurns] = useState<DirectionTurn[]>([]);
  const [directionModelId, setDirectionModelId] =
    useState<(typeof DIRECTION_MODELS)[number]["id"]>("gemini:gemini-2.5-flash");
  const [directionChatInFlight, setDirectionChatInFlight] = useState(false);
  const [missionSchedules, setMissionSchedules] = useState<MissionSchedule[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [schedulesRefreshing, setSchedulesRefreshing] = useState(false);
  const [scheduleActionInFlight, setScheduleActionInFlight] = useState(false);
  const [scheduleRunInFlightId, setScheduleRunInFlightId] = useState<string | null>(null);
  const [scheduleTickInFlight, setScheduleTickInFlight] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<MissionScheduleDraft>(() => ({
    title: "",
    cadence: "DAILY",
    nextRunAt: toDatetimeLocalValue(new Date().toISOString())
  }));
  const [swarmDensity, setSwarmDensity] = useState(24);
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
  const [canReviewPermissionRequests, setCanReviewPermissionRequests] = useState(false);
  const [controlScopedFlowIds, setControlScopedFlowIds] = useState<string[]>([]);
  const [signatureApprovals, setSignatureApprovals] = useState(1);
  const [isRecordingIntent, setIsRecordingIntent] = useState(false);
  const [launchInFlight, setLaunchInFlight] = useState(false);
  const [killSwitchInFlight, setKillSwitchInFlight] = useState(false);
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
  const missionSchedulesInFlightRef = useRef(false);
  const pendingPlanRouteHandledKeyRef = useRef<string | null>(null);
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

  const activeOrgId = currentOrg?.id ?? orgs[0]?.id ?? "";

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
      if (tab === "control" || OPERATION_TAB_SET.has(tab)) {
        setPrimaryTabLastSubtab((previous) =>
          previous[primaryTab] === tab ? previous : { ...previous, [primaryTab]: tab }
        );
      }

      if (tab === "control") {
        setWorkspaceMode(controlMode === "DIRECTION" ? "COMMAND" : "BRAINSTORM");
        return;
      }

      if (tab === "hub") {
        setWorkspaceMode("HUB");
        return;
      }

      if (tab === "calendar") {
        setWorkspaceMode("CALENDAR");
        return;
      }

      if (OPERATION_TAB_SET.has(tab)) {
        syncOperationSubtab(tab as OperationTabId);
        setWorkspaceMode("OPERATIONS");
        return;
      }
    },
    [controlMode, syncOperationSubtab]
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

        const preferredOrg =
          serverOrgs.find((item) => item.id === payload.activeOrgId) ?? serverOrgs[0];
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
    loadUserJoinRequests,
    setCurrentOrg,
    setOrgs,
    user?.email,
    user?.uid,
    orgBootstrapAttempt
  ]);

  useEffect(() => {
    document.documentElement.dataset.ghost = isGhostModeActive ? "true" : "false";
  }, [isGhostModeActive]);

  const resolvedOrg = currentOrg ?? orgs[0] ?? null;
  const hasOrganization = Boolean(resolvedOrg);
  const themeStyle = THEME_STYLES[theme];
  const requestedSettingsLane = searchParams.get("settingsLane");
  const requestedHubScope = searchParams.get("hubScope");

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
    const requestedTab = searchParams.get("tab");
    if (requestedTab && NAV_ITEMS.some((item) => item.id === requestedTab)) {
      handleTabChange(requestedTab as NavItemId);
    }
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
    missionSchedulesInFlightRef.current = false;
    setDirectionTurns([]);
    setDirectionPrompt("");
    setIntent("");
    setHumanPlanDraft("");
    setDirectionPlanningResult(null);
    setControlEngaged(false);
    setActiveTab("control");
    setControlMode("MINDSTORM");
    setWorkspaceMode("BRAINSTORM");
    setOperationsTab("plan");
    setPrimaryWorkspaceTab("FOCUS");
    setPrimaryTabLastSubtab(DEFAULT_PRIMARY_TAB_SUBTAB);
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
    setControlScopedFlowIds([]);
    setMissionSchedules([]);
    setScheduleDraft({
      title: "",
      cadence: "DAILY",
      nextRunAt: toDatetimeLocalValue(new Date().toISOString())
    });
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
    if (workspaceMode !== "BRAINSTORM" && workspaceMode !== "COMMAND") {
      return;
    }
    setWorkspaceMode(controlMode === "DIRECTION" ? "COMMAND" : "BRAINSTORM");
  }, [activeTab, controlMode, workspaceMode]);

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
      ? compactTaskTitle(titleSource, controlMode === "DIRECTION" ? "Command Session" : "Brainstorm Session")
      : controlMode === "DIRECTION"
        ? "Command Session"
        : "Brainstorm Session";

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
      const title = nextMode === "DIRECTION" ? "Command Session" : "Brainstorm Session";
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
        if (workspaceMode === "BRAINSTORM" || workspaceMode === "COMMAND") {
          setWorkspaceMode(nextMode === "DIRECTION" ? "COMMAND" : "BRAINSTORM");
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
  const activePlanId =
    activeControlThread?.launchScope?.planId?.trim() ??
    directionPlanningResult?.planRecord?.id?.trim() ??
    "";
  const activeDirectionId =
    activeControlThread?.launchScope?.directionId?.trim() ??
    directionPlanningResult?.directionRecord?.id?.trim() ??
    "";
  const activeScopedPermissionRequestIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of activeControlThread?.launchScope?.permissionRequestIds ?? []) {
      const normalized = item.trim();
      if (normalized) {
        ids.add(normalized);
      }
    }
    for (const request of directionPlanningResult?.permissionRequests ?? []) {
      if (request.id?.trim()) {
        ids.add(request.id.trim());
      }
    }
    return [...ids];
  }, [
    activeControlThread?.launchScope?.permissionRequestIds,
    directionPlanningResult?.permissionRequests
  ]);
  const activeScopedFlowIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of activeControlThread?.launchScope?.flowIds ?? []) {
      const normalized = item.trim();
      if (normalized) {
        ids.add(normalized);
      }
    }
    for (const item of controlScopedFlowIds) {
      const normalized = item.trim();
      if (normalized) {
        ids.add(normalized);
      }
    }
    return [...ids];
  }, [activeControlThread?.launchScope?.flowIds, controlScopedFlowIds]);
  const launchScopedPermissionRequests = useMemo(() => {
    const byId = new Map<string, PermissionRequestItem>();
    const scopedIdSet = new Set(activeScopedPermissionRequestIds);

    for (const request of directionPlanningResult?.permissionRequests ?? []) {
      byId.set(request.id, request);
    }

    for (const request of permissionRequests) {
      const matchesPlan = activePlanId.length > 0 && request.planId === activePlanId;
      const matchesDirection =
        !matchesPlan &&
        activeDirectionId.length > 0 &&
        request.directionId === activeDirectionId;
      const matchesScopedIds = scopedIdSet.has(request.id);
      if (matchesPlan || matchesDirection || matchesScopedIds || byId.has(request.id)) {
        byId.set(request.id, request);
      }
    }

    return [...byId.values()];
  }, [
    activeDirectionId,
    activePlanId,
    activeScopedPermissionRequestIds,
    directionPlanningResult?.permissionRequests,
    permissionRequests
  ]);
  const pendingLaunchPermissionRequestCount = useMemo(
    () =>
      launchScopedPermissionRequests.filter((item) => item.status === "PENDING").length,
    [launchScopedPermissionRequests]
  );
  const rejectedLaunchPermissionRequestCount = useMemo(
    () =>
      launchScopedPermissionRequests.filter((item) => item.status === "REJECTED").length,
    [launchScopedPermissionRequests]
  );
  const launchPermissionRequestIds = useMemo(
    () => launchScopedPermissionRequests.map((item) => item.id),
    [launchScopedPermissionRequests]
  );
  const launchScopedApprovalCheckpoints = useMemo(() => {
    const scopedFlowSet = new Set(activeScopedFlowIds);
    if (scopedFlowSet.size === 0) {
      return [] as ApprovalCheckpointItem[];
    }
    return approvalCheckpoints.filter((item) => {
      const flowId = item.flowId?.trim();
      return Boolean(flowId && scopedFlowSet.has(flowId));
    });
  }, [activeScopedFlowIds, approvalCheckpoints]);
  const requestCenterPermissionRequests = useMemo(() => {
    const commandScoped =
      activeTab === "control" &&
      controlMode === "DIRECTION" &&
      launchScopedPermissionRequests.length > 0;
    return commandScoped ? launchScopedPermissionRequests : permissionRequests;
  }, [activeTab, controlMode, launchScopedPermissionRequests, permissionRequests]);
  const requestCenterApprovalCheckpoints = useMemo(() => {
    const commandScoped =
      activeTab === "control" &&
      controlMode === "DIRECTION" &&
      launchScopedApprovalCheckpoints.length > 0;
    return commandScoped ? launchScopedApprovalCheckpoints : approvalCheckpoints;
  }, [activeTab, approvalCheckpoints, controlMode, launchScopedApprovalCheckpoints]);
  const isRequestCenterScopedToCommand =
    activeTab === "control" &&
    controlMode === "DIRECTION" &&
    (launchScopedPermissionRequests.length > 0 || launchScopedApprovalCheckpoints.length > 0);
  const requestCenterPermissionPendingCount = useMemo(
    () => requestCenterPermissionRequests.filter((item) => item.status === "PENDING").length,
    [requestCenterPermissionRequests]
  );
  const requestCenterCheckpointPendingCount = useMemo(
    () => requestCenterApprovalCheckpoints.filter((item) => item.status === "PENDING").length,
    [requestCenterApprovalCheckpoints]
  );
  const requestCenterPendingCount = useMemo(
    () => requestCenterPermissionPendingCount + requestCenterCheckpointPendingCount,
    [requestCenterCheckpointPendingCount, requestCenterPermissionPendingCount]
  );

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
    const orgMatches = orgs.filter((item) => item.name.toLowerCase().includes(q));
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
  }, [handleTabChange, openAddOrganization, orgs, searchQuery, toggleGhostMode]);

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

  const handlePrimaryWorkspaceTabSwitch = useCallback(
    (nextTab: PrimaryWorkspaceTabId) => {
      const targetSubTab = primaryTabLastSubtab[nextTab] ?? DEFAULT_PRIMARY_TAB_SUBTAB[nextTab];
      if (OPERATION_TAB_SET.has(targetSubTab)) {
        handleOperationTabChange(targetSubTab as OperationTabId);
        return;
      }
      handleTabChange(targetSubTab);
    },
    [handleOperationTabChange, handleTabChange, primaryTabLastSubtab]
  );

  const handleWorkspaceModeSwitch = useCallback(
    (nextMode: WorkspaceMode) => {
      if (nextMode === "BRAINSTORM") {
        handleSwitchControlMode("MINDSTORM");
        setWorkspaceMode("BRAINSTORM");
        return;
      }
      if (nextMode === "COMMAND") {
        handleSwitchControlMode("DIRECTION");
        setWorkspaceMode("COMMAND");
        return;
      }
      if (nextMode === "OPERATIONS") {
        handleOperationTabChange(operationsTab);
        return;
      }
      if (nextMode === "HUB") {
        handleTabChange("hub");
        return;
      }
      handleTabChange("calendar");
    },
    [handleOperationTabChange, handleSwitchControlMode, handleTabChange, operationsTab]
  );

  const loadMissionSchedules = useCallback(
    async (silent?: boolean, force?: boolean) => {
      if (!resolvedOrg?.id) {
        return;
      }
      if (!force && missionSchedulesInFlightRef.current) {
        return;
      }
      missionSchedulesInFlightRef.current = true;
      if (silent) {
        setSchedulesRefreshing(true);
      } else {
        setSchedulesLoading(true);
      }

      try {
        const response = await fetch(
          `/api/schedules/missions?orgId=${encodeURIComponent(resolvedOrg.id)}`,
          { cache: "no-store" }
        );
        const { payload, rawText } = await parseJsonBody<{
          ok?: boolean;
          message?: string;
          schedules?: MissionSchedule[];
        }>(response);

        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed loading mission schedules (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed loading mission schedules.")
          );
        }

        setMissionSchedules(payload?.schedules ?? []);
      } catch (error) {
        setControlMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Failed loading mission schedules."
        });
      } finally {
        setSchedulesLoading(false);
        setSchedulesRefreshing(false);
        missionSchedulesInFlightRef.current = false;
      }
    },
    [resolvedOrg?.id]
  );

  useEffect(() => {
    if (!resolvedOrg?.id) {
      return;
    }
    void loadMissionSchedules();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      void loadMissionSchedules(true);
    }, MISSION_SCHEDULES_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadMissionSchedules, resolvedOrg?.id]);

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
          history: directionTurns.slice(-10).map((turn) => ({
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
          text: "Command candidate updated from organization response."
        });
      }

      if (payload.intentRouting?.route === "PLAN_REQUIRED") {
        const routedPrompt = message;
        const cadenceHint = payload.intentRouting.cadenceHint;
        setPendingChatPlanRoute({
          prompt: routedPrompt,
          reason:
            payload.intentRouting.reason ||
            "Intent requires planning before workflow launch.",
          toolkitHints: payload.intentRouting.toolkitHints ?? []
        });
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
            "Command mode detected execution intent. Routing to planning pipeline.",
          toolkitHints
        });
        setControlMode("DIRECTION");
        setControlConversationDetail("DIRECTION_GIVEN");
        setControlMessage({
          tone: "success",
          text: "Command intent routed to planning pipeline."
        });
      }
    } catch (error) {
      setControlMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Command chat failed."
      });
    } finally {
      setDirectionChatInFlight(false);
    }
  }, [
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
          text: "Write a command prompt first."
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
            history: directionTurns.slice(-10).map((turn) => ({
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
                "Command mode generated a plan and queued immediate launch using this approved command.",
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
              content: `Auto-squad bootstrap completed (${autoSquad?.domain ?? "general"}): ${createdLabel}.`
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
                ? `Squad intent detected (${autoSquad.domain ?? "general"}). Matching agents already exist: ${roleLabel}.`
                : `Squad intent detected (${autoSquad.domain ?? "general"}). Matching agents already exist.`
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
            ? `Plans prepared and queued for auto launch.${payload.requestCount ? ` ${payload.requestCount} permission requests raised.` : ""}${autoSquadCreatedCount > 0 ? ` Auto-squad created ${autoSquadCreatedCount} agents.` : autoSquad?.triggered ? " Auto-squad detected existing matching agents." : ""}`
            : `Plans prepared.${payload.requestCount ? ` ${payload.requestCount} permission requests raised.` : ""}${autoSquadCreatedCount > 0 ? ` Auto-squad created ${autoSquadCreatedCount} agents.` : autoSquad?.triggered ? " Auto-squad detected existing matching agents." : ""} Review in Plan section and approve launch.`
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

    const confirmed = window.confirm(
      "Clear all permission requests for this organization? This cannot be undone."
    );
    if (!confirmed) {
      return;
    }

    setClearPermissionRequestsInFlight(true);
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

  const handleCreateSchedule = useCallback(async () => {
    if (!resolvedOrg?.id) {
      return;
    }
    const direction = intent.trim();
    if (!direction) {
      setControlMessage({
        tone: "warning",
        text: "Add a direction before creating a schedule."
      });
      return;
    }

    setScheduleActionInFlight(true);
    setControlMessage(null);

    try {
      const response = await fetch("/api/schedules/missions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orgId: resolvedOrg.id,
          title: scheduleDraft.title.trim() || "Scheduled Direction",
          direction,
          cadence: scheduleDraft.cadence,
          nextRunAt: toIsoFromDatetimeLocal(scheduleDraft.nextRunAt),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          swarmDensity,
          requiredSignatures,
          predictedBurn,
          enabled: true
        })
      });

      const { payload, rawText } = await parseJsonBody<{
        ok?: boolean;
        message?: string;
        schedule?: MissionSchedule;
      }>(response);

      if (!response.ok || !payload?.ok || !payload.schedule) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed creating schedule (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed creating schedule.")
        );
      }

      setMissionSchedules((prev) => [payload.schedule!, ...prev]);
      setScheduleDraft((prev) => ({
        ...prev,
        title: ""
      }));
      setControlMessage({
        tone: "success",
        text: "Direction schedule created."
      });
    } catch (error) {
      setControlMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed creating schedule."
      });
    } finally {
      setScheduleActionInFlight(false);
    }
  }, [intent, predictedBurn, requiredSignatures, resolvedOrg?.id, scheduleDraft, swarmDensity]);

  const handleRunSchedule = useCallback(
    async (scheduleId: string) => {
      if (!resolvedOrg?.id) {
        return;
      }

      setScheduleRunInFlightId(scheduleId);
      setControlMessage(null);

      try {
        const response = await fetch(`/api/schedules/missions/${scheduleId}/run`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orgId: resolvedOrg.id
          })
        });

        const { payload, rawText } = await parseJsonBody<{
          ok?: boolean;
          message?: string;
          warning?: string;
          schedule?: MissionSchedule;
          flow?: { id: string; status: string };
        }>(response);

        if (!response.ok || !payload?.ok || !payload.flow || !payload.schedule) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed running schedule (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed running schedule.")
          );
        }

        setMissionSchedules((prev) =>
          prev.map((item) => (item.id === payload.schedule!.id ? payload.schedule! : item))
        );
        setControlMessage({
          tone: payload.warning ? "warning" : "success",
          text: payload.warning
            ? `Schedule launched flow ${payload.flow.id} with warning: ${payload.warning}`
            : `Schedule launched flow ${payload.flow.id}.`
        });
      } catch (error) {
        setControlMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Failed running schedule."
        });
      } finally {
        setScheduleRunInFlightId(null);
      }
    },
    [resolvedOrg?.id]
  );

  const handleRunDueSchedules = useCallback(async () => {
    if (!resolvedOrg?.id) {
      return;
    }

    setScheduleTickInFlight(true);
    setControlMessage(null);
    try {
      const response = await fetch("/api/schedules/tick", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orgId: resolvedOrg.id,
          limit: 25
        })
      });

      const { payload, rawText } = await parseJsonBody<{
        ok?: boolean;
        message?: string;
        launchedCount?: number;
        failedCount?: number;
      }>(response);

      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed running due schedules (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed running due schedules.")
        );
      }

      await loadMissionSchedules(true, true);
      const launchedCount = payload.launchedCount ?? 0;
      const failedCount = payload.failedCount ?? 0;
      setControlMessage({
        tone: failedCount > 0 ? "warning" : "success",
        text:
          failedCount > 0
            ? `Due schedules processed. Launched: ${launchedCount}, failed: ${failedCount}.`
            : `Due schedules processed. Launched: ${launchedCount}.`
      });
      if (launchedCount > 0) {
        handleTabChange("flow");
      }
    } catch (error) {
      setControlMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed running due schedules."
      });
    } finally {
      setScheduleTickInFlight(false);
    }
  }, [handleTabChange, loadMissionSchedules, resolvedOrg?.id]);

  const handleToggleSchedule = useCallback(
    async (schedule: MissionSchedule) => {
      if (!resolvedOrg?.id) {
        return;
      }

      setScheduleActionInFlight(true);
      try {
        const response = await fetch(`/api/schedules/missions/${schedule.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orgId: resolvedOrg.id,
            enabled: !schedule.enabled
          })
        });

        const { payload, rawText } = await parseJsonBody<{
          ok?: boolean;
          message?: string;
          schedule?: MissionSchedule;
        }>(response);

        if (!response.ok || !payload?.ok || !payload.schedule) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed updating schedule (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed updating schedule.")
          );
        }

        setMissionSchedules((prev) =>
          prev.map((item) => (item.id === payload.schedule!.id ? payload.schedule! : item))
        );
      } catch (error) {
        setControlMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Failed updating schedule."
        });
      } finally {
        setScheduleActionInFlight(false);
      }
    },
    [resolvedOrg?.id]
  );

  const handleDeleteSchedule = useCallback(
    async (scheduleId: string) => {
      if (!resolvedOrg?.id) {
        return;
      }

      if (typeof window !== "undefined") {
        const confirmed = window.confirm("Delete this schedule?");
        if (!confirmed) {
          return;
        }
      }

      setScheduleActionInFlight(true);
      try {
        const response = await fetch(
          `/api/schedules/missions/${scheduleId}?orgId=${encodeURIComponent(resolvedOrg.id)}`,
          {
            method: "DELETE"
          }
        );
        const { payload, rawText } = await parseJsonBody<{ ok?: boolean; message?: string }>(
          response
        );
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed deleting schedule (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed deleting schedule.")
          );
        }
        setMissionSchedules((prev) => prev.filter((item) => item.id !== scheduleId));
      } catch (error) {
        setControlMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Failed deleting schedule."
        });
      } finally {
        setScheduleActionInFlight(false);
      }
    },
    [resolvedOrg?.id]
  );

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

  const handleGlobalKillSwitch = useCallback(async () => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Abort all active and queued missions for this organization?"
      );
      if (!confirmed) {
        return;
      }
    }

    setKillSwitchInFlight(true);
    setControlMessage(null);

    try {
      const response = await fetch("/api/kill-switch", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orgId: resolvedOrg?.id
        })
      });

      const { payload, rawText } = await parseJsonBody<{
        ok?: boolean;
        warning?: string;
        message?: string;
        result?: { flowsAborted: number; tasksAborted: number };
      }>(response);

      if (!payload) {
        throw new Error(
          rawText
            ? `Kill switch failed (${response.status}): ${rawText.slice(0, 200)}`
            : `Kill switch failed (${response.status}).`
        );
      }

      if (!response.ok || !payload.ok) {
        setControlMessage({
          tone: "error",
          text: payload.message ?? "Kill switch failed."
        });
        return;
      }

      setControlMessage({
        tone: payload.warning ? "warning" : "success",
        text: payload.warning
          ? `${payload.message ?? "Kill switch executed"} Warning: ${payload.warning}`
          : payload.message ??
            `Global kill switch executed. Flows: ${payload.result?.flowsAborted ?? 0}, Tasks: ${payload.result?.tasksAborted ?? 0}.`
      });
    } catch (error) {
      setControlMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Unexpected kill switch error."
      });
    } finally {
      setKillSwitchInFlight(false);
    }
  }, [resolvedOrg?.id]);

  return (
    <div className="vx-shell relative min-h-screen bg-vx-bg text-slate-100 transition-all duration-500">
      <div className="flex h-[100dvh] overflow-hidden">
        <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <header className="relative z-30 flex min-h-24 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#05070a]/50 px-4 py-3 backdrop-blur-xl md:h-24 md:flex-nowrap md:px-10 md:py-0">
            <div
              className="group flex cursor-pointer items-center gap-3"
              onClick={() => {
                setShowOrgSwitcher((prev) => !prev);
                setShowRequestCenter(false);
                setShowUtilityMenu(false);
              }}
            >
              <Shield size={20} className={themeStyle.accent} />
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  {resolvedOrg?.name ?? "No organization"}
                  <ChevronDown size={14} className="text-slate-400 group-hover:text-white" />
                </p>
                <p className="text-xs text-slate-500">{resolvedOrg?.role ?? "Explore"} context</p>
              </div>
            </div>

            <div className="relative mx-4 hidden max-w-xl flex-1 md:flex">
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
                          setCurrentOrg(org);
                          setSearchQuery("");
                          setSearchOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5"
                      >
                        <span>{org.name}</span>
                        <Building2 size={14} />
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

            <div className="flex items-center gap-3">
              {orgBootstrapStatus === "ready" && !resolvedOrg ? (
                <button
                  onClick={() => {
                    setJoinRequestError(null);
                    setSetupPanel("chooser");
                    void loadUserJoinRequests();
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-500/20"
                >
                  <Building2 size={14} />
                  Setup
                </button>
              ) : null}

              {resolvedOrg ? (
                <button
                  onClick={() => {
                    setShowRequestCenter((prev) => !prev);
                    setShowOrgSwitcher(false);
                    setShowUtilityMenu(false);
                    void Promise.all([
                      loadPermissionRequests({ force: true }),
                      loadApprovalCheckpoints({ force: true })
                    ]);
                  }}
                  className="relative inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                >
                  <Bell size={14} />
                  <span className="hidden sm:inline">Requests</span>
                  {requestCenterPendingCount > 0 ? (
                    <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
                      {requestCenterPendingCount}
                    </span>
                  ) : null}
                </button>
              ) : null}

              <button
                onClick={() => {
                  setShowUtilityMenu((prev) => !prev);
                  setShowRequestCenter(false);
                  setShowOrgSwitcher(false);
                }}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
              >
                <Activity size={14} />
                <span className="hidden sm:inline">Utilities</span>
              </button>
            </div>

            {showUtilityMenu ? (
              <div className="absolute right-4 top-24 z-50 w-[320px] rounded-3xl border border-white/10 bg-[#0d1117] p-3 shadow-vx md:right-10 md:top-20">
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

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      handleTabChange("settings");
                      setShowUtilityMenu(false);
                    }}
                    className="rounded-xl border border-white/20 bg-white/5 px-2.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                  >
                    Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    disabled={signOutInFlight}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-red-500/35 bg-red-500/10 px-2.5 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                  >
                    {signOutInFlight ? <Loader2 size={12} className="animate-spin" /> : null}
                    Logout
                  </button>
                </div>
              </div>
            ) : null}

            {showOrgSwitcher && (
              <div className="absolute left-4 right-4 top-24 z-50 w-auto rounded-3xl border border-white/10 bg-[#0d1117] p-3 shadow-vx md:left-10 md:right-auto md:top-20 md:w-72">
                <div className="mb-2 flex items-center justify-between px-2 py-1">
                  <p className="text-xs font-medium text-slate-500">Organizations</p>
                  <button
                    onClick={() => setShowOrgSwitcher(false)}
                    className="rounded-md p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="space-y-1">
                  {orgs.map((org) => (
                    <button
                      key={org.id}
                      onClick={() => {
                        setCurrentOrg(org);
                        setShowOrgSwitcher(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                        resolvedOrg?.id === org.id
                          ? `vx-panel ${themeStyle.border}`
                          : "hover:bg-white/5"
                      }`}
                    >
                      <Building2 size={16} className="text-slate-500" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{org.name}</p>
                        <p className="text-xs text-slate-500">{org.role}</p>
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

            {showRequestCenter && resolvedOrg && (
              <div className="absolute left-4 right-4 top-24 z-50 w-auto rounded-3xl border border-white/10 bg-[#0d1117] p-3 shadow-vx md:left-auto md:right-10 md:top-20 md:w-[420px]">
                <div className="mb-2 flex items-center justify-between px-2 py-1">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Request center</p>
                    <p className="text-xs text-slate-600">
                      Pending {requestCenterPendingCount} (Permissions {requestCenterPermissionPendingCount} | Checkpoints {requestCenterCheckpointPendingCount})
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {isRequestCenterScopedToCommand ? "Scope: current command chat" : "Scope: organization"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canReviewPermissionRequests &&
                    requestCenterPermissionRequests.length > 0 &&
                    !isRequestCenterScopedToCommand ? (
                      <button
                        onClick={() => void handleClearPermissionRequests()}
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
            )}
          </header>

          <section
            className={`vx-scrollbar relative min-w-0 flex-1 overflow-x-hidden px-4 py-6 pb-28 md:px-10 md:py-10 md:pb-32 ${
              resolvedOrg && activeTab === "control"
                ? "min-h-0 overflow-y-auto py-4 pb-44 md:py-6 md:pb-48"
                : "overflow-y-auto"
            }`}
          >
            {resolvedOrg && workspaceMode === "OPERATIONS" ? (
              <div className="mb-4 space-y-2">
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
                  {activePrimaryNavItems.map((item) => (
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
                  ))}
                </div>
              </div>
            ) : null}

            {orgBootstrapStatus === "loading" && !resolvedOrg ? (
              <WorkspaceBootstrapState themeStyle={themeStyle} />
            ) : orgBootstrapStatus === "failed" && !resolvedOrg ? (
              <WorkspaceBootstrapError
                themeStyle={themeStyle}
                message={orgBootstrapError}
                onRetry={() => setOrgBootstrapAttempt((value) => value + 1)}
              />
            ) : !resolvedOrg ? (
              <NoOrganizationExplore
                activeTab={activeTab}
                themeStyle={themeStyle}
                userJoinRequests={userJoinRequests}
                loadingUserJoinRequests={loadingUserJoinRequests}
                onOpenSetup={() => {
                  setJoinRequestError(null);
                  setSetupPanel("chooser");
                  void loadUserJoinRequests();
                }}
              />
            ) : activeTab === "control" ? (
              <ControlDeckSurface
                themeStyle={{
                  accent: themeStyle.accent,
                  accentSoft: themeStyle.accentSoft,
                  border: themeStyle.border
                }}
                mode={controlMode}
                conversationDetail={controlConversationDetail}
                engaged={controlEngaged}
                directionGiven={intent}
                turns={directionTurns}
                directionModelId={directionModelId}
                directionModels={DIRECTION_MODELS}
                directionChatInFlight={directionChatInFlight}
                directionPlanningInFlight={directionPlanningInFlight}
                planningResult={directionPlanningResult}
                message={controlMessage}
                onDismissMessage={() => setControlMessage(null)}
                agentRunResult={agentRunResult}
                agentRunInputValues={agentRunInputValues}
                pendingPlanLaunchApproval={pendingPlanLaunchApproval}
                pendingEmailApproval={pendingEmailApproval}
                pendingToolkitApproval={pendingToolkitApproval}
                agentInputSourceUrl={agentRunInputSourceUrl}
                agentInputFile={agentRunInputFile}
                agentInputSubmitting={agentRunInputSubmitting}
                agentActionBusy={launchInFlight || toolkitConnectInFlight}
                historyItems={controlThreadHistory}
                activeHistoryId={activeControlThreadId}
                onCreateThread={handleCreateControlThread}
                onSelectThread={handleLoadControlThread}
                onModeChange={handleSwitchControlMode}
                onConversationDetailChange={setControlConversationDetail}
                onDirectionGivenChange={setIntent}
                onAgentInputValueChange={(key, value) =>
                  setAgentRunInputValues((prev) => ({
                    ...prev,
                    [key]: value
                  }))
                }
                onAgentInputSourceUrlChange={setAgentRunInputSourceUrl}
                onAgentInputFileChange={setAgentRunInputFile}
                onSubmitAgentInputs={() => {
                  void handleSubmitAgentInputs();
                }}
                onRejectAgentInput={handleRejectAgentInput}
                onApprovePlanLaunch={() => {
                  void handleApprovePlanLaunch();
                }}
                onRejectPlanLaunch={handleRejectPlanLaunch}
                onApproveEmailDraft={() => {
                  void handleApproveEmailDraft();
                }}
                onRejectEmailDraft={handleRejectEmailDraft}
                onApproveToolkitAccess={() => {
                  void handleApproveToolkitAccess();
                }}
                onRejectToolkitAccess={handleRejectToolkitAccess}
                onOpenTools={() => handleTabChange("hub")}
                onDirectionModelChange={setDirectionModelId}
                onEngageWithMode={(nextMode) => {
                  handleSwitchControlMode(nextMode);
                  setControlEngaged(true);
                }}
                onVoiceIntent={handleVoiceIntent}
                isRecordingIntent={isRecordingIntent}
                onSendMessage={async (message, modeForMessage, attachmentPayload) => {
                  const attachments = attachmentPayload?.files ?? [];
                  const basePrompt = message.trim();
                  if (!basePrompt && attachments.length === 0) {
                    return;
                  }

                  if (!activeControlThreadId) {
                    handleCreateControlThread(modeForMessage);
                  }

                  let prompt = basePrompt || "Use the attached files as the command context.";
                  const attachmentRefs: string[] = [];
                  if (attachments.length > 0) {
                    try {
                      for (const file of attachments) {
                        const fileRef = await uploadHumanInputToHub({
                          file,
                          name: file.name
                        });
                        attachmentRefs.push(fileRef);
                      }
                    } catch (error) {
                      setControlMessage({
                        tone: "error",
                        text: error instanceof Error ? error.message : "Failed to upload attachments."
                      });
                      return;
                    }
                    prompt = `${prompt}\n\nHub attachment refs: ${attachmentRefs.join(", ")}`;
                    setControlMessage({
                      tone: "success",
                      text: `Attached ${attachments.length} file(s) to Hub input context.`
                    });
                  }

                  if (modeForMessage === "MINDSTORM") {
                    const trimmed = prompt.trim();
                    if (!trimmed) {
                      return;
                    }

                    if (isRecurringTaskPrompt(trimmed)) {
                      setPendingToolkitApproval(null);
                      setApprovedToolkitRequestId(null);
                      setPendingEmailApproval(null);
                      setPendingPlanLaunchApproval(null);
                      setAgentRunResult(null);
                      setAgentRunId("");
                      setAgentRunInputValues({});
                      setAgentRunInputSourceUrl("");
                      setAgentRunInputFile(null);
                      setControlMode("DIRECTION");
                      setControlConversationDetail("DIRECTION_GIVEN");
                      setIntent(trimmed);
                      setDirectionPrompt(trimmed);
                      setControlMessage({
                        tone: "success",
                        text: "Recurring task detected. Routed to Direction planning."
                      });
                      await handleDirectionChat(trimmed, "MINDSTORM");
                      return;
                    }

                    const directLaunchBlockedByPolicy =
                      pipelinePolicy?.strictFeatureEnabled === true &&
                      (pipelinePolicy.blockDirectWorkflowLaunch ||
                        pipelinePolicy.enforcePlanBeforeExecution ||
                        pipelinePolicy.requireDetailedPlan ||
                        pipelinePolicy.requireMultiWorkflowDecomposition);

                    if (directLaunchBlockedByPolicy && shouldDirectWorkflowLaunch(trimmed)) {
                      setPendingToolkitApproval(null);
                      setApprovedToolkitRequestId(null);
                      setPendingEmailApproval(null);
                      setPendingPlanLaunchApproval(null);
                      setPendingChatPlanRoute(null);
                      setControlMode("DIRECTION");
                      setControlConversationDetail("DIRECTION_GIVEN");
                      setIntent(trimmed);
                      setDirectionPrompt(trimmed);
                      setControlMessage({
                        tone: "warning",
                        text: "Direct launch blocked by strict pipeline policy. Routing to planning."
                      });
                      await handleGenerateDirectionPlans(trimmed, {
                        toolkitHints: inferToolkitsFromDirectionPrompt(trimmed),
                        navigateToPlanTab: true
                      });
                      return;
                    }

                    if (shouldDirectWorkflowLaunch(trimmed)) {
                      setPendingToolkitApproval(null);
                      setApprovedToolkitRequestId(null);
                      setPendingEmailApproval(null);
                      setPendingPlanLaunchApproval(null);
                      setPendingChatPlanRoute(null);
                      setAgentRunResult(null);
                      setAgentRunId("");
                      setAgentRunInputValues({});
                      setAgentRunInputSourceUrl("");
                      setAgentRunInputFile(null);
                      setDirectionTurns((prev) => [
                        ...prev,
                        {
                          id: `owner-direct-flow-${Date.now()}`,
                          role: "owner",
                          content: trimmed
                        }
                      ]);
                      setIntent(trimmed);
                      setControlConversationDetail("DIRECTION_GIVEN");
                      setControlMessage({
                        tone: "success",
                        text: "Quick execution intent detected. Launching workflow directly."
                      });
                      await handleLaunchMainAgent(trimmed);
                      return;
                    }

                    setDirectionPrompt(trimmed);
                    await handleDirectionChat(trimmed, "MINDSTORM");
                    return;
                  }
                  const trimmed = prompt.trim();
                  if (!trimmed) {
                    return;
                  }

                  if (pendingPlanLaunchApproval) {
                    setDirectionTurns((prev) => [
                      ...prev,
                      {
                        id: `owner-plan-approval-${Date.now()}`,
                        role: "owner",
                        content: trimmed
                      }
                    ]);

                    if (isApprovalReply(trimmed)) {
                      await handleApprovePlanLaunch();
                      return;
                    }

                    if (isRejectReply(trimmed)) {
                      handleRejectPlanLaunch();
                      return;
                    }

                    setDirectionTurns((prev) => [
                      ...prev,
                      {
                        id: `org-plan-approval-hint-${Date.now()}`,
                        role: "organization",
                        content:
                          "Reply with \"approve\" to launch this plan, or \"reject\" to keep it in planning."
                      }
                    ]);
                    return;
                  }

                  if (pendingToolkitApproval) {
                    setDirectionTurns((prev) => [
                      ...prev,
                      {
                        id: `owner-toolkit-approval-${Date.now()}`,
                        role: "owner",
                        content: trimmed
                      }
                    ]);

                    if (isApprovalReply(trimmed)) {
                      await handleApproveToolkitAccess();
                      return;
                    }

                    if (isRejectReply(trimmed)) {
                      handleRejectToolkitAccess();
                      return;
                    }

                    setDirectionTurns((prev) => [
                      ...prev,
                      {
                        id: `org-toolkit-approval-hint-${Date.now()}`,
                        role: "organization",
                        content:
                          "Reply with \"approve\" to grant tool access, or \"reject\" to keep the task paused."
                      }
                    ]);
                    return;
                  }

                  if (pendingEmailApproval) {
                    setDirectionTurns((prev) => [
                      ...prev,
                      {
                        id: `owner-email-approval-${Date.now()}`,
                        role: "owner",
                        content: trimmed
                      }
                    ]);

                    const draftReplyIntent = classifyEmailDraftReply(trimmed);

                    if (draftReplyIntent === "approve") {
                      setIntent(pendingEmailApproval.prompt);
                      await handleLaunchMainAgent(
                        pendingEmailApproval.prompt,
                        undefined,
                        {
                          confirmEmailDraft: true
                        }
                      );
                      return;
                    }

                    if (draftReplyIntent === "cancel") {
                      handleRejectEmailDraft();
                      return;
                    }

                    const revisedPrompt = `${pendingEmailApproval.prompt}\n\nAdditional edits from user: ${trimmed}`;
                    setIntent(revisedPrompt);
                    await handleLaunchMainAgent(revisedPrompt);
                    return;
                  }

                  setPendingToolkitApproval(null);
                  setApprovedToolkitRequestId(null);
                  setPendingEmailApproval(null);
                  setAgentRunResult(null);
                  setAgentRunId("");
                  setAgentRunInputValues({});
                  setAgentRunInputSourceUrl("");
                  setAgentRunInputFile(null);
                  setIntent(trimmed);
                  setDirectionPrompt(trimmed);
                  await handleGenerateDirectionPlans(trimmed, {
                    toolkitHints: inferToolkitsFromDirectionPrompt(trimmed),
                    navigateToPlanTab: false,
                    autoLaunch: true
                  });
                }}
              />
            ) : activeTab === "flow" ? (
              <WorkflowConsole
                orgId={resolvedOrg.id}
                themeStyle={{
                  accent: themeStyle.accent,
                  accentSoft: themeStyle.accentSoft,
                  border: themeStyle.border
                }}
                onTaskNeedsInput={promptForHumanInput}
              />
            ) : activeTab === "blueprint" ? (
              <BlueprintConsole
                orgId={resolvedOrg.id}
                themeStyle={{
                  accent: themeStyle.accent,
                  accentSoft: themeStyle.accentSoft,
                  border: themeStyle.border
                }}
              />
            ) : activeTab === "direction" ? (
              <DirectionConsole
                orgId={resolvedOrg.id}
                themeStyle={{
                  accent: themeStyle.accent,
                  accentSoft: themeStyle.accentSoft,
                  border: themeStyle.border
                }}
              />
            ) : activeTab === "plan" ? (
              <PlanConsole
                orgId={resolvedOrg.id}
                themeStyle={{
                  accent: themeStyle.accent,
                  accentSoft: themeStyle.accentSoft,
                  border: themeStyle.border
                }}
              />
            ) : activeTab === "calendar" ? (
              <CalendarConsole
                orgId={resolvedOrg.id}
                themeStyle={{
                  accent: themeStyle.accent,
                  accentSoft: themeStyle.accentSoft,
                  border: themeStyle.border
                }}
              />
            ) : activeTab === "hub" ? (
              <HubConsole
                orgId={resolvedOrg.id}
                themeStyle={{
                  accent: themeStyle.accent,
                  accentSoft: themeStyle.accentSoft,
                  border: themeStyle.border
                }}
                initialScope={
                  requestedHubScope === "ORGANIZATIONAL" ||
                  requestedHubScope === "DIRECTIONAL" ||
                  requestedHubScope === "WORKFLOW" ||
                  requestedHubScope === "DNA" ||
                  requestedHubScope === "STORAGE" ||
                  requestedHubScope === "TOOLS"
                    ? requestedHubScope
                    : undefined
                }
              />
            ) : activeTab === "squad" ? (
              <SquadConsole
                orgId={resolvedOrg.id}
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

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        <div className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-white/15 bg-[#060b13]/92 p-1 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          <button
            type="button"
            onClick={() => handleWorkspaceModeSwitch("BRAINSTORM")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition ${
              workspaceMode === "BRAINSTORM"
                ? "bg-cyan-500/20 text-cyan-100"
                : "text-slate-300 hover:bg-white/10"
            }`}
          >
            <Bot size={14} />
            Brainstorming
          </button>
          <button
            type="button"
            onClick={() => handleWorkspaceModeSwitch("COMMAND")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition ${
              workspaceMode === "COMMAND"
                ? "bg-cyan-500/20 text-cyan-100"
                : "text-slate-300 hover:bg-white/10"
            }`}
          >
            <Command size={14} />
            Command
          </button>
          <button
            type="button"
            onClick={() => handleWorkspaceModeSwitch("OPERATIONS")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition ${
              workspaceMode === "OPERATIONS"
                ? "bg-cyan-500/20 text-cyan-100"
                : "text-slate-300 hover:bg-white/10"
            }`}
          >
            <Workflow size={14} />
            Operations
          </button>
          <button
            type="button"
            onClick={() => handleWorkspaceModeSwitch("HUB")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition ${
              workspaceMode === "HUB"
                ? "bg-cyan-500/20 text-cyan-100"
                : "text-slate-300 hover:bg-white/10"
            }`}
          >
            <FolderOpen size={14} />
            Hub
          </button>
          <button
            type="button"
            onClick={() => handleWorkspaceModeSwitch("CALENDAR")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold transition ${
              workspaceMode === "CALENDAR"
                ? "bg-cyan-500/20 text-cyan-100"
                : "text-slate-300 hover:bg-white/10"
            }`}
          >
            <CalendarDays size={14} />
            Calendar
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
          <div className="w-full max-w-xl rounded-[30px] border border-white/15 bg-[#0d1117] p-6">
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
                  Request membership in an existing organization for squad approval.
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

function ControlDeckSurface({
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
  onOpenTools,
  onDirectionModelChange,
  onEngageWithMode,
  onSendMessage,
  onVoiceIntent,
  isRecordingIntent
}: {
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
  onOpenTools: () => void;
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
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
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
  const actionQueueCount = Number(Boolean(pendingPlanLaunchApproval)) +
    Number(Boolean(pendingToolkitApproval)) +
    Number(Boolean(pendingEmailApproval)) +
    Number(agentRunResult?.status === "needs_input");
  const showCommandDraftPanel = false;
  const modeHistoryItems = useMemo(
    () => historyItems.filter((item) => item.mode === mode),
    [historyItems, mode]
  );
  const workspaceTitle = mode === "DIRECTION" ? "Command Workspace" : "Brainstorm Workspace";
  const workspaceSubtitle =
    mode === "DIRECTION"
      ? "Codex-style command execution with planning and run trace."
      : "Idea exploration, quick strategy, and freeform discussion.";
  const placeholder =
    mode === "MINDSTORM"
      ? "Ask anything about ideas, planning, or execution..."
      : "Describe the command. We will analyze, plan, execute, and report in this thread.";
  const heroTitle =
    mode === "MINDSTORM"
      ? "What should we work on next?"
      : "What command should run next?";

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
          title={mode === "MINDSTORM" ? "Send Message" : "Run Command"}
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
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-3 sm:gap-4">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs text-slate-500">Control interface</p>
          <p className="text-sm font-medium text-slate-200 sm:text-base">{workspaceTitle}</p>
          <p className="mt-0.5 text-xs text-slate-400">{workspaceSubtitle}</p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          <div className="inline-flex w-full max-w-full flex-wrap rounded-full border border-white/15 bg-black/45 p-1 shadow-[0_10px_30px_rgba(0,0,0,0.35)] sm:w-auto">
            <button
              onClick={() => onModeChange("MINDSTORM")}
              className={`flex-1 rounded-full px-4 py-2 text-xs font-semibold transition sm:flex-none sm:px-5 ${
                mode === "MINDSTORM"
                  ? "bg-gradient-to-r from-cyan-200 to-white text-slate-950 shadow-[0_8px_18px_rgba(148,163,184,0.35)]"
                  : "text-slate-300 hover:bg-white/10"
              }`}
            >
              Brainstorm
            </button>
            <button
              onClick={() => onModeChange("DIRECTION")}
              className={`flex-1 rounded-full px-4 py-2 text-xs font-semibold transition sm:flex-none sm:px-5 ${
                mode === "DIRECTION"
                  ? "bg-gradient-to-r from-cyan-200 to-white text-slate-950 shadow-[0_8px_18px_rgba(148,163,184,0.35)]"
                  : "text-slate-300 hover:bg-white/10"
              }`}
            >
              Command
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowHistoryPanel((prev) => !prev)}
            className={`inline-flex items-center justify-center rounded-full border px-4 py-2 text-xs font-semibold transition ${
              showHistoryPanel
                ? "border-cyan-400/40 bg-cyan-500/12 text-cyan-200"
                : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            History
          </button>

          <button
            type="button"
            onClick={() => onCreateThread(mode)}
            className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/10"
          >
            New Chat
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

      {showHistoryPanel ? (
        <div className="vx-scrollbar max-h-44 overflow-y-auto rounded-2xl border border-white/10 bg-black/25 p-2">
          <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">
            {mode === "DIRECTION" ? "Command history" : "Brainstorm history"}
          </p>
          {modeHistoryItems.length === 0 ? (
            <p className="px-2 py-2 text-xs text-slate-500">
              No {mode === "DIRECTION" ? "command" : "brainstorm"} history yet.
            </p>
          ) : (
            <div className="space-y-1">
              {modeHistoryItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectThread(item.id);
                    setShowHistoryPanel(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition ${
                    activeHistoryId === item.id
                      ? "border border-cyan-500/35 bg-cyan-500/10 text-cyan-100"
                      : "border border-transparent text-slate-300 hover:border-white/10 hover:bg-white/5"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">
                      {item.title || "Untitled Session"}
                    </span>
                    <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {item.mode === "DIRECTION" ? "Command" : "Brainstorm"} |{" "}
                      {new Date(item.updatedAt).toLocaleString()}
                    </span>
                  </span>
                  <ChevronRight size={14} className="shrink-0 text-slate-500" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {showAdvanced ? (
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
                Show command context
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={`vx-panel relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#060a10]/96 p-3 shadow-[0_28px_70px_rgba(0,0,0,0.5)] sm:rounded-[30px] sm:p-4 ${themeStyle.border}`}
      >
        <div className="pointer-events-none absolute -left-20 top-0 h-52 w-52 rounded-full bg-cyan-500/6 blur-3xl" />
        <div className="pointer-events-none absolute -right-16 bottom-0 h-52 w-52 rounded-full bg-emerald-500/5 blur-3xl" />
        {showLanding ? (
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
                    Command draft
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

            <div className="vx-scrollbar h-[50vh] min-h-[320px] max-h-[65vh] flex-1 space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-[#050910]/72 p-2.5 pb-24 pr-0 sm:h-[58vh] sm:min-h-[420px] sm:max-h-[72vh] sm:pr-1 sm:p-3 sm:pb-28">
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

      <div className="pointer-events-none fixed inset-x-0 bottom-[4.7rem] z-30 flex justify-center px-4">
        <div className="pointer-events-auto w-full max-w-4xl">{composerBar}</div>
      </div>
    </div>
  );
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
  themeStyle,
  onOpenSetup,
  userJoinRequests,
  loadingUserJoinRequests
}: {
  activeTab: (typeof NAV_ITEMS)[number]["id"];
  themeStyle: { accent: string; accentSoft: string; border: string };
  onOpenSetup: () => void;
  userJoinRequests: UserJoinRequest[];
  loadingUserJoinRequests: boolean;
}) {
  const tabLabel = NAV_ITEMS.find((item) => item.id === activeTab)?.label ?? "Workspace";
  const pendingCount = userJoinRequests.filter((item) => item.status === "PENDING").length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className={`vx-panel space-y-4 rounded-[34px] p-6 ${themeStyle.border}`}>
        <h2 className="font-display text-3xl font-black uppercase tracking-tight md:text-4xl">
          Explore {tabLabel}
        </h2>
        <p className="text-sm text-slate-300">
          Platform preview is active. Connect to an organization when you are ready to run live
          squads, memory, workflows, and settings.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onOpenSetup}
            className="rounded-full bg-white px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-500 hover:text-white"
          >
            Open Setup
          </button>
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
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Squad</p>
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
