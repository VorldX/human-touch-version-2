"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Bell,
  Bot,
  Building2,
  ChevronDown,
  ClipboardList,
  Command,
  Database,
  FileText,
  FolderOpen,
  Ghost,
  Handshake,
  LayoutDashboard,
  LayoutGrid,
  Loader2,
  Link2,
  LogOut,
  Menu,
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
  UserCog,
  Users,
  Workflow,
  X,
  Zap
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { useFirebaseAuth } from "@/components/auth/firebase-auth-provider";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { CollaborationConsole } from "@/components/collab/collab-console";
import { DirectionConsole } from "@/components/direction/direction-console";
import { HubConsole } from "@/components/hub/hub-console";
import { MemoryConsole } from "@/components/memory/memory-console";
import { PlanConsole } from "@/components/plan/plan-console";
import { SettingsConsole } from "@/components/settings/settings-console";
import { SquadConsole } from "@/components/squad/squad-console";
import { NotificationStack } from "@/components/system/notification-stack";
import { WorkflowConsole } from "@/components/workflow/workflow-console";
import { getRealtimeClient } from "@/lib/realtime/client";
import type { AppTheme } from "@/lib/store/vorldx-store";
import { useVorldXStore } from "@/lib/store/vorldx-store";

const NAV_ITEMS = [
  { id: "control", label: "Control Deck", icon: LayoutDashboard },
  { id: "direction", label: "Direction", icon: Target },
  { id: "plan", label: "Plan", icon: ClipboardList },
  { id: "flow", label: "Work Flow", icon: Workflow },
  { id: "hub", label: "Hub", icon: FolderOpen },
  { id: "squad", label: "Squad", icon: Users },
  { id: "memory", label: "Memory", icon: Database },
  { id: "collab", label: "Collaboration", icon: Handshake },
  { id: "settings", label: "Settings", icon: SettingsIcon }
] as const;

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
}

interface DirectionTurn {
  id: string;
  role: "owner" | "organization";
  content: string;
  modelLabel?: string;
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

interface DirectionIntentRouting {
  route: "CHAT_RESPONSE" | "PLAN_REQUIRED";
  reason: string;
  toolkitHints?: string[];
  squadRoleHints?: string[];
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

type ControlMode = "MINDSTORM" | "DIRECTION";
type ControlConversationDetail = "REASONING_MIN" | "DIRECTION_GIVEN";

interface DirectionPlanTask {
  title: string;
  ownerRole: string;
  subtasks: string[];
  tools: string[];
  requiresApproval: boolean;
  approvalRole: string;
  approvalReason: string;
}

interface DirectionPlanWorkflow {
  title: string;
  goal: string;
  tasks: DirectionPlanTask[];
}

interface DirectionExecutionPlan {
  summary: string;
  workflows: DirectionPlanWorkflow[];
  risks: string[];
  successMetrics: string[];
}

interface PermissionRequestItem {
  id: string;
  orgId: string;
  direction: string;
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

interface DirectionPlanningResult {
  analysis: string;
  directionGiven: string;
  primaryPlan: DirectionExecutionPlan;
  fallbackPlan: DirectionExecutionPlan;
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
  const hasMailContext = /\b(gmail|email|mail|inbox)\b/.test(prompt) || hasEmailDomain;
  const hasMailAction =
    /\b(send|draft|reply|summarize|summary|find|search|read|list|compose)\b/.test(prompt);
  return hasMailContext && hasMailAction;
}

function inferToolkitsFromDirectionPrompt(value: string) {
  const prompt = value.toLowerCase();
  const compactPrompt = prompt.replace(/[^a-z0-9]/g, "");
  const requested = new Set<string>();
  const toolkitAliases: Record<string, string[]> = {
    gmail: ["gmail", "email", "mailbox", "inbox"],
    slack: ["slack", "channel", "workspace", "direct message", "dm"],
    notion: ["notion", "wiki", "knowledge base", "docs", "documentation"],
    github: ["github", "repository", "repo", "pull request", "commit", "issue"],
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
    typeform: ["typeform", "form", "survey"]
  };

  for (const [toolkit, aliases] of Object.entries(toolkitAliases)) {
    const matched = aliases.some((alias) => {
      const normalizedAlias = alias.trim().toLowerCase();
      if (!normalizedAlias) return false;
      const compactAlias = normalizedAlias.replace(/[^a-z0-9]/g, "");
      return prompt.includes(normalizedAlias) || (compactAlias && compactPrompt.includes(compactAlias));
    });
    if (matched) {
      requested.add(toolkit);
    }
  }

  return [...requested];
}

function normalizeToolkitAlias(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";

  const aliasMap: Record<string, string> = {
    crm: "hubspot",
    "google calendar": "googlecalendar",
    calendar: "googlecalendar",
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
  for (const workflow of plan.workflows ?? []) {
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

  const [activeTab, setActiveTab] =
    useState<(typeof NAV_ITEMS)[number]["id"]>("control");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);
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
  const [humanPlanDraft, setHumanPlanDraft] = useState("");
  const [directionPlanningInFlight, setDirectionPlanningInFlight] = useState(false);
  const [directionPlanningResult, setDirectionPlanningResult] =
    useState<DirectionPlanningResult | null>(null);
  const [showRequestCenter, setShowRequestCenter] = useState(false);
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequestItem[]>([]);
  const [permissionRequestsLoading, setPermissionRequestsLoading] = useState(false);
  const [permissionRequestActionId, setPermissionRequestActionId] = useState<string | null>(null);
  const [canReviewPermissionRequests, setCanReviewPermissionRequests] = useState(false);
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
  const [controlMessage, setControlMessage] = useState<ControlMessage | null>(null);
  const [agentRunResult, setAgentRunResult] = useState<AgentRunResponse | null>(null);
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

  const handleTabChange = useCallback((tab: (typeof NAV_ITEMS)[number]["id"]) => {
    setActiveTab(tab);
    setIsMobileNavOpen(false);
  }, []);

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
    setIsMobileNavOpen(false);
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

  const loadPermissionRequests = useCallback(async () => {
    const orgId = currentOrg?.id ?? orgs[0]?.id ?? "";
    if (!orgId) {
      setPermissionRequests([]);
      setCanReviewPermissionRequests(false);
      return;
    }

    setPermissionRequestsLoading(true);
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

      setPermissionRequests(payload?.requests ?? []);
      setCanReviewPermissionRequests(Boolean(payload?.canReview));
    } catch (error) {
      setControlMessage({
        tone: "error",
        text:
          error instanceof Error ? error.message : "Failed loading permission requests."
      });
    } finally {
      setPermissionRequestsLoading(false);
    }
  }, [currentOrg?.id, orgs]);

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
      void loadPermissionRequests();
    }, 15000);
    return () => clearInterval(interval);
  }, [loadPermissionRequests, resolvedOrg?.id]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (requestedTab && NAV_ITEMS.some((item) => item.id === requestedTab)) {
      setActiveTab(requestedTab as (typeof NAV_ITEMS)[number]["id"]);
      setIsMobileNavOpen(false);
    }
  }, [searchParams]);

  useEffect(() => {
    setDirectionTurns([]);
    setDirectionPrompt("");
    setIntent("");
    setHumanPlanDraft("");
    setDirectionPlanningResult(null);
    setControlEngaged(false);
    setControlMode("MINDSTORM");
    setControlConversationDetail("REASONING_MIN");
    setShowRequestCenter(false);
    setMissionSchedules([]);
    setScheduleDraft({
      title: "",
      cadence: "DAILY",
      nextRunAt: toDatetimeLocalValue(new Date().toISOString())
    });
    setAgentRunResult(null);
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
    setToolkitConnectInFlight(false);
    setAgentRunInputSourceUrl("");
    setAgentRunInputFile(null);
    setAgentRunInputSubmitting(false);
    setControlMessage(null);
  }, [resolvedOrg?.id]);

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
  const pendingPermissionRequestCount = useMemo(
    () => permissionRequests.filter((item) => item.status === "PENDING").length,
    [permissionRequests]
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

    const handleSignatureCaptured = (envelope: any) => {
      if (envelope?.orgId !== resolvedOrg.id) {
        return;
      }
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
    };

    const handleTaskPaused = (envelope: any) => {
      if (envelope?.orgId !== resolvedOrg.id) {
        return;
      }
      const payload =
        envelope?.payload && typeof envelope.payload === "object"
          ? (envelope.payload as Record<string, unknown>)
          : {};
      const taskId = typeof payload.taskId === "string" ? payload.taskId.trim() : "";
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
      const flowId = typeof payload.flowId === "string" ? payload.flowId.trim() : "";
      promptForHumanInput({
        taskId,
        flowId: flowId || null,
        reason
      });
    };

    const handleTaskResumed = (envelope: any) => {
      if (envelope?.orgId !== resolvedOrg.id) {
        return;
      }
      const payload =
        envelope?.payload && typeof envelope.payload === "object"
          ? (envelope.payload as Record<string, unknown>)
          : {};
      const taskId = typeof payload.taskId === "string" ? payload.taskId.trim() : "";
      if (!taskId) {
        return;
      }
      setPendingHumanInput((current) => (current?.taskId === taskId ? null : current));
    };

    socket.on("signature.captured", handleSignatureCaptured);
    socket.on("kill-switch.triggered", handleKillSwitch);
    socket.on("task.paused", handleTaskPaused);
    socket.on("task.resumed", handleTaskResumed);

    return () => {
      socket.off("signature.captured", handleSignatureCaptured);
      socket.off("kill-switch.triggered", handleKillSwitch);
      socket.off("task.paused", handleTaskPaused);
      socket.off("task.resumed", handleTaskResumed);
    };
  }, [promptForHumanInput, realtimeSessionId, requiredSignatures, resolvedOrg?.id]);

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

    const tabs = NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(q));
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

  const loadMissionSchedules = useCallback(
    async (silent?: boolean) => {
      if (!resolvedOrg?.id) {
        return;
      }
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
      void loadMissionSchedules(true);
    }, 20000);
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

  const handleDirectionChat = useCallback(async (rawMessage?: string) => {
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
          message,
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

      if (payload.directionCandidate) {
        setIntent(payload.directionCandidate);
        setControlConversationDetail("DIRECTION_GIVEN");
        setControlMessage({
          tone: "success",
          text: "Direction candidate updated from organization response."
        });
      }

      if (payload.intentRouting?.route === "PLAN_REQUIRED") {
        const routedPrompt = payload.directionCandidate?.trim() || message;
        setPendingChatPlanRoute({
          prompt: routedPrompt,
          reason:
            payload.intentRouting.reason ||
            "Intent requires planning before workflow launch.",
          toolkitHints: payload.intentRouting.toolkitHints ?? []
        });
        setControlMessage({
          tone: "success",
          text: "Intent routed to planning pipeline."
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
      }
    ) => {
      const direction = (rawDirection ?? intent).trim();
      if (!resolvedOrg?.id) {
        return;
      }
      if (!direction) {
        setControlMessage({
          tone: "warning",
          text: "Write a direction paragraph first."
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
        const analysis = payload.analysis?.trim() ?? "";
        const planToolkits = [
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
        setIntent(refinedDirection);
        setDirectionPlanningResult({
          analysis,
          directionGiven: refinedDirection,
          primaryPlan: payload.primaryPlan,
          fallbackPlan: payload.fallbackPlan,
          requiredToolkits: planToolkits,
          autoSquad: payload.autoSquad,
          directionRecord: payload.directionRecord,
          planRecord: payload.planRecord
        });
        setPendingPlanLaunchApproval({
          prompt: refinedDirection,
          toolkits: planToolkits,
          reason: "Plan ready. User approval required before launching workflow."
        });
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

        await loadPermissionRequests();
        const autoSquadCreatedCount = autoSquadCreated.length;
        setControlMessage({
          tone: "success",
          text: `Plans prepared.${payload.requestCount ? ` ${payload.requestCount} permission requests raised.` : ""}${autoSquadCreatedCount > 0 ? ` Auto-squad created ${autoSquadCreatedCount} agents.` : autoSquad?.triggered ? " Auto-squad detected existing matching agents." : ""} Review in Plan section and approve launch.`
        });
        handleTabChange("plan");
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
      directionModelId,
      directionTurns,
      ensureOrgAccessReady,
      handleTabChange,
      humanPlanDraft,
      intent,
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

        await loadPermissionRequests();
      } catch (error) {
        setControlMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Request update failed."
        });
      } finally {
        setPermissionRequestActionId(null);
      }
    },
    [loadPermissionRequests, resolvedOrg?.id]
  );

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

      await loadMissionSchedules(true);
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

    const payload = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          enabled?: boolean;
          message?: string;
          connections?: Array<{
            toolkit?: string;
            status?: string;
          }>;
        }
      | null;

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.message ?? "Failed to load integration connections.");
    }

    const active = new Set(
      (payload.connections ?? [])
        .map((item) => ({
          toolkit: typeof item.toolkit === "string" ? item.toolkit.trim().toLowerCase() : "",
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
          const payload = (await response.json().catch(() => null)) as
            | {
                ok?: boolean;
                message?: string;
                connectUrl?: string;
              }
            | null;

          if (!response.ok || !payload?.ok || !payload.connectUrl) {
            throw new Error(payload?.message ?? `Unable to connect ${toolkit}.`);
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

      const uniqueRequestedToolkits = [...new Set(requestedToolkits.map((item) => item.toLowerCase()))];
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

    if (launchInFlight) {
      return;
    }

    if (signatureApprovals < requiredSignatures) {
      setControlMessage({
        tone: "warning",
        text: `Collect ${requiredSignatures} signatures before launch. Current: ${signatureApprovals}.`
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

      const requestedToolkits = inferToolkitsFromDirectionPrompt(prompt);
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
            prompt,
            input: runtimeInput,
            confirm: confirmEmailDraft,
            orgId: resolvedOrg?.id
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
              content: payload.assistant_message || "Email sent successfully."
            }
          ]);
          setControlMessage({
            tone: "success",
            text: payload.assistant_message || "Main Agent completed the Gmail action."
          });
        } else if (payload.status === "needs_input") {
          setPendingEmailApproval(null);
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
          setPendingEmailApproval(null);
          const connectUrl =
            payload.error?.code === "INTEGRATION_NOT_CONNECTED" &&
            typeof payload.error?.details?.connectUrl === "string"
              ? payload.error.details.connectUrl
              : "";
          setDirectionTurns((prev) => [
            ...prev,
            {
              id: `org-email-error-${Date.now()}`,
              role: "organization",
              content: [
                payload.error?.message || payload.assistant_message || "Main Agent run failed.",
                connectUrl ? `Connect Gmail first: ${connectUrl}` : ""
              ]
                .filter(Boolean)
                .join("\n")
            }
          ]);
          setControlMessage({
            tone: "error",
            text: payload.error?.message || payload.assistant_message || "Main Agent run failed."
          });
        }
        return;
      }

      setAgentRunResult(null);
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
          swarmDensity,
          predictedBurn,
          requiredSignatures,
          approvalsProvided: signatureApprovals,
          requestedToolkits
        })
      });

      const { payload, rawText } = await parseJsonBody<{
        ok?: boolean;
        warning?: string;
        message?: string;
        flow?: { id: string; status: string; executionMode?: string };
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

      setControlMessage({
        tone: payload.warning ? "warning" : "success",
        text: payload.warning
          ? `Flow ${payload.flow?.id ?? ""} queued with warning: ${payload.warning}`
          : `Flow ${payload.flow?.id ?? ""} queued successfully (${payload.flow?.status ?? "QUEUED"} | ${payload.flow?.executionMode ?? "MULTI_AGENT"}).`
      });
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
    intent,
    launchInFlight,
    agentRunInputValues,
    pendingEmailApproval,
    authHeaders,
    directionPlanningResult?.directionRecord?.id,
    directionPlanningResult?.planRecord?.id,
    handleTabChange,
    ensureOrgAccessReady,
    ensureRequestedToolkitsReady,
    predictedBurn,
    requiredSignatures,
    resolvedOrg?.id,
    signatureApprovals,
    swarmDensity,
    user?.uid,
    user?.email
  ]);

  const handleApprovePlanLaunch = useCallback(async () => {
    if (!pendingPlanLaunchApproval || launchInFlight || toolkitConnectInFlight) {
      return;
    }

    const prompt = pendingPlanLaunchApproval.prompt.trim();
    const requestedToolkits = [...new Set(pendingPlanLaunchApproval.toolkits)];
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

    const run = async () => {
      try {
        await handleGenerateDirectionPlans(pending.prompt, {
          toolkitHints: pending.toolkitHints
        });
      } finally {
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

  const agentRunConnectUrl =
    agentRunResult?.error?.code === "INTEGRATION_NOT_CONNECTED"
      ? (typeof agentRunResult.error?.details?.connectUrl === "string"
          ? agentRunResult.error?.details?.connectUrl
          : "") || "/app?tab=hub&hubScope=TOOLS&toolkit=gmail"
      : "";

  return (
    <div className="vx-shell relative min-h-screen bg-vx-bg text-slate-100 transition-all duration-500">
      <div className="flex h-[100dvh] overflow-hidden">
        {isMobileNavOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setIsMobileNavOpen(false)}
            className="fixed inset-0 z-40 bg-black/70 md:hidden"
          />
        ) : null}
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex h-full w-[84vw] max-w-80 shrink-0 flex-col border-r border-white/10 bg-[#05070a]/95 backdrop-blur-2xl transition-transform duration-300 md:relative md:inset-auto md:z-auto md:w-auto md:max-w-none md:translate-x-0 ${
            isMobileNavOpen ? "translate-x-0" : "-translate-x-full"
          } ${
            isSidebarCollapsed ? "md:w-24" : "md:w-80"
          }`}
        >
          <div className="flex h-24 items-center gap-4 border-b border-white/10 px-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
              <Zap className={themeStyle.accent} size={22} />
            </div>
            {!isSidebarCollapsed && (
              <div className="min-w-0">
                <p className="truncate font-display text-lg font-black uppercase tracking-tight">
                  {resolvedOrg?.name ?? "Workspace Explorer"}
                </p>
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                  Command OS
                </p>
              </div>
            )}
          </div>

          <div className="vx-scrollbar flex-1 space-y-2 overflow-y-auto px-3 py-6">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => handleTabChange(item.id)}
                className={`flex w-full items-center rounded-2xl px-4 py-3 text-left transition ${
                  activeTab === item.id
                    ? `vx-panel ${themeStyle.border}`
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                <item.icon size={20} className={activeTab === item.id ? themeStyle.accent : ""} />
                {!isSidebarCollapsed && (
                  <span className="ml-4 text-[11px] font-semibold uppercase tracking-[0.2em]">
                    {item.label}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="border-t border-white/10 px-3 py-3">
            <div className="rounded-2xl border border-white/10 bg-black/35 p-2">
              {!isSidebarCollapsed ? (
                <>
                  <p className="px-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Account</p>
                  <p className="truncate px-2 pt-1 text-xs text-slate-200">{user?.email ?? "session user"}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleTabChange("settings")}
                      className="inline-flex items-center justify-center gap-1 rounded-xl border border-white/20 bg-white/5 px-2 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-200 transition hover:bg-white/10"
                    >
                      <UserCog size={12} />
                      Settings
                    </button>
                    <button
                      onClick={() => void handleSignOut()}
                      disabled={signOutInFlight}
                      className="inline-flex items-center justify-center gap-1 rounded-xl border border-red-500/35 bg-red-500/10 px-2 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                    >
                      {signOutInFlight ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                      Logout
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => handleTabChange("settings")}
                    className="flex items-center justify-center rounded-xl border border-white/20 bg-white/5 p-2 text-slate-200 transition hover:bg-white/10"
                    title="Account Settings"
                  >
                    <UserCog size={16} />
                  </button>
                  <button
                    onClick={() => void handleSignOut()}
                    disabled={signOutInFlight}
                    className="flex items-center justify-center rounded-xl border border-red-500/35 bg-red-500/10 p-2 text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                    title="Logout"
                  >
                    {signOutInFlight ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="hidden border-t border-white/10 p-4 md:block">
            <button
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              className="flex w-full items-center justify-center rounded-2xl bg-white/5 p-3 text-slate-300 transition hover:bg-white/10"
            >
              <LayoutGrid size={20} />
            </button>
          </div>
        </aside>

        <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <header className="relative z-30 flex min-h-24 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#05070a]/50 px-4 py-3 backdrop-blur-xl md:h-24 md:flex-nowrap md:px-10 md:py-0">
            <div
              className="group flex cursor-pointer items-center gap-3"
              onClick={() => {
                setShowOrgSwitcher((prev) => !prev);
                setShowRequestCenter(false);
              }}
            >
              <Shield size={20} className={themeStyle.accent} />
              <div>
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-white">
                  {resolvedOrg?.name ?? "No Organization"}
                  <ChevronDown size={14} className="text-slate-400 group-hover:text-white" />
                </p>
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                  {(resolvedOrg?.role ?? "Explore")} Context
                </p>
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
                  placeholder="Omni-Search..."
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
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs uppercase tracking-[0.2em] text-slate-200 hover:bg-white/5"
                      >
                        <span>{item.label}</span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}

                    {searchResults.orgMatches.map((org) => (
                      <button
                        key={org.id}
                        onMouseDown={() => {
                          setCurrentOrg(org);
                          setIsMobileNavOpen(false);
                          setSearchQuery("");
                          setSearchOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs uppercase tracking-[0.2em] text-slate-200 hover:bg-white/5"
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
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs uppercase tracking-[0.2em] text-slate-200 hover:bg-white/5"
                      >
                        <span>{item.label}</span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}

                    {searchResults.tabs.length === 0 &&
                      searchResults.orgMatches.length === 0 &&
                      searchResults.actions.length === 0 && (
                        <p className="px-3 py-2 text-xs uppercase tracking-[0.2em] text-slate-500">
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
                  className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300 transition hover:bg-cyan-500/20"
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
                    void loadPermissionRequests();
                  }}
                  className="relative inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200 transition hover:bg-white/10"
                >
                  <Bell size={14} />
                  <span className="hidden sm:inline">Requests</span>
                  {pendingPermissionRequestCount > 0 ? (
                    <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                      {pendingPermissionRequestCount}
                    </span>
                  ) : null}
                </button>
              ) : null}

              <button
                onClick={toggleGhostMode}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition ${
                  isGhostModeActive
                    ? "border-red-500/40 bg-red-900/30 text-red-300 animate-pulse-soft"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                }`}
              >
                {isGhostModeActive ? <Ghost size={14} /> : <UserCheck size={14} />}
                <span className="hidden sm:inline">
                  {isGhostModeActive ? "Ghost Protocol Active" : "Ghost Protocol"}
                </span>
              </button>

              <div className="hidden items-center gap-2 md:flex">
                {activeUsers.slice(0, 4).map((user) => (
                  <div key={user.id} className="relative">
                    <div
                      title={user.name}
                      className={`flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-[11px] font-bold text-white ${user.color}`}
                    >
                      {initials(user.name)}
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/50" />
                    </span>
                  </div>
                ))}
                <span className="ml-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                  {activeUsers.length} online
                </span>
              </div>

              <button
                onClick={() => setIsMobileNavOpen((prev) => !prev)}
                className="md:hidden"
                aria-label="Toggle navigation"
              >
                {isMobileNavOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>

            {showOrgSwitcher && (
              <div className="absolute left-4 right-4 top-24 z-50 w-auto rounded-3xl border border-white/10 bg-[#0d1117] p-3 shadow-vx md:left-10 md:right-auto md:top-20 md:w-72">
                <div className="mb-2 flex items-center justify-between px-2 py-1">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                    Organizations
                  </p>
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
                        setIsMobileNavOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                        resolvedOrg?.id === org.id
                          ? `vx-panel ${themeStyle.border}`
                          : "hover:bg-white/5"
                      }`}
                    >
                      <Building2 size={16} className="text-slate-500" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-white">
                          {org.name}
                        </p>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                          {org.role}
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
                  <span className="text-xs font-semibold uppercase tracking-[0.18em]">
                    Add Organization
                  </span>
                </button>
              </div>
            )}

            {showRequestCenter && resolvedOrg && (
              <div className="absolute left-4 right-4 top-24 z-50 w-auto rounded-3xl border border-white/10 bg-[#0d1117] p-3 shadow-vx md:left-auto md:right-10 md:top-20 md:w-[420px]">
                <div className="mb-2 flex items-center justify-between px-2 py-1">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                      Request Center
                    </p>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-600">
                      Pending {pendingPermissionRequestCount}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowRequestCenter(false)}
                    className="rounded-md p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
                  >
                    <X size={14} />
                  </button>
                </div>

                {permissionRequestsLoading ? (
                  <div className="inline-flex items-center gap-2 px-2 py-3 text-xs text-slate-400">
                    <Loader2 size={13} className="animate-spin" />
                    Loading requests...
                  </div>
                ) : permissionRequests.length === 0 ? (
                  <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-4 text-xs text-slate-500">
                    No permission requests right now.
                  </p>
                ) : (
                  <div className="vx-scrollbar max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                    {permissionRequests.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-white/10 bg-black/25 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-white">
                              {item.area}
                            </p>
                            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                              {item.status} | Target {item.targetRole}
                            </p>
                          </div>
                          {item.status === "PENDING" ? (
                            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-amber-300">
                              Pending
                            </span>
                          ) : (
                            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-emerald-300">
                              {item.status}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-xs text-slate-300">{item.reason}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                          Workflow: {item.workflowTitle || "N/A"} | Task:{" "}
                          {item.taskTitle || "N/A"}
                        </p>
                        <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                          Requested by {item.requestedByEmail}
                        </p>

                        {canReviewPermissionRequests && item.status === "PENDING" ? (
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              onClick={() =>
                                void handlePermissionRequestDecision(item.id, "APPROVE")
                              }
                              disabled={permissionRequestActionId === item.id}
                              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                            >
                              {permissionRequestActionId === item.id
                                ? "Working..."
                                : "Approve"}
                            </button>
                            <button
                              onClick={() =>
                                void handlePermissionRequestDecision(item.id, "REJECT")
                              }
                              disabled={permissionRequestActionId === item.id}
                              className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
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
            className={`vx-scrollbar relative min-w-0 flex-1 overflow-x-hidden px-4 py-6 md:px-10 md:py-10 ${
              resolvedOrg && activeTab === "control"
                ? "min-h-0 overflow-hidden py-4 md:py-6"
                : "overflow-y-auto"
            }`}
          >
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
                themeStyle={themeStyle}
                mode={controlMode}
                conversationDetail={controlConversationDetail}
                engaged={controlEngaged}
                directionGiven={intent}
                turns={directionTurns}
                directionModelId={directionModelId}
                directionModels={DIRECTION_MODELS}
                directionChatInFlight={directionChatInFlight}
                directionPlanningInFlight={directionPlanningInFlight}
                message={controlMessage}
                agentRunResult={agentRunResult}
                agentRunInputValues={agentRunInputValues}
                pendingPlanLaunchApproval={pendingPlanLaunchApproval}
                pendingEmailApproval={pendingEmailApproval}
                pendingToolkitApproval={pendingToolkitApproval}
                agentInputSourceUrl={agentRunInputSourceUrl}
                agentInputFile={agentRunInputFile}
                agentInputSubmitting={agentRunInputSubmitting}
                agentActionBusy={launchInFlight || toolkitConnectInFlight}
                onModeChange={setControlMode}
                onConversationDetailChange={setControlConversationDetail}
                onDirectionGivenChange={(value) => {
                  setIntent(value);
                  if (
                    agentRunPromptSnapshot &&
                    value.trim() !== agentRunPromptSnapshot
                  ) {
                    setAgentRunResult(null);
                    setAgentRunInputValues({});
                    setAgentRunInputSourceUrl("");
                    setAgentRunInputFile(null);
                  }
                }}
                onAgentInputValueChange={(key, value) =>
                  setAgentRunInputValues((prev) => ({
                    ...prev,
                    [key]: value
                  }))
                }
                onAgentInputSourceUrlChange={setAgentRunInputSourceUrl}
                onAgentInputFileChange={setAgentRunInputFile}
                onSubmitAgentInputs={() => void handleSubmitAgentInputs()}
                onRejectAgentInput={handleRejectAgentInput}
                onApprovePlanLaunch={() => void handleApprovePlanLaunch()}
                onRejectPlanLaunch={handleRejectPlanLaunch}
                onApproveEmailDraft={() => void handleApproveEmailDraft()}
                onRejectEmailDraft={handleRejectEmailDraft}
                onApproveToolkitAccess={() => void handleApproveToolkitAccess()}
                onRejectToolkitAccess={handleRejectToolkitAccess}
                onOpenTools={() => {
                  router.replace("/app?tab=hub&hubScope=TOOLS");
                  handleTabChange("hub");
                }}
                onDirectionModelChange={setDirectionModelId}
                onEngageWithMode={(nextMode) => {
                  setControlMode(nextMode);
                  setControlEngaged(true);
                  if (nextMode === "DIRECTION") {
                    setControlConversationDetail("DIRECTION_GIVEN");
                  } else {
                    setControlConversationDetail("REASONING_MIN");
                  }
                }}
                onSendMessage={async (message, modeForMessage) => {
                  if (modeForMessage === "MINDSTORM") {
                    setDirectionPrompt(message);
                    await handleDirectionChat(message);
                    return;
                  }
                  const trimmed = message.trim();
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

                    if (isApprovalReply(trimmed)) {
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

                    if (isRejectReply(trimmed)) {
                      handleRejectEmailDraft();
                      return;
                    }

                    const revisedPrompt = `${pendingEmailApproval.prompt}\n\nAdditional edits from user: ${trimmed}`;
                    setPendingEmailApproval(null);
                    setIntent(revisedPrompt);
                    await handleLaunchMainAgent(revisedPrompt);
                    return;
                  }

                  if (isGmailDirectionPrompt(trimmed)) {
                    setDirectionTurns((prev) => [
                      ...prev,
                      {
                        id: `owner-email-${Date.now()}`,
                        role: "owner",
                        content: trimmed
                      }
                    ]);
                    setIntent(trimmed);
                    await handleLaunchMainAgent(trimmed);
                    return;
                  }

                  setPendingToolkitApproval(null);
                  setApprovedToolkitRequestId(null);
                  setPendingEmailApproval(null);
                  setAgentRunResult(null);
                  setAgentRunInputValues({});
                  setAgentRunInputSourceUrl("");
                  setAgentRunInputFile(null);
                  setIntent(trimmed);
                  await handleDirectionChat(trimmed);
                }}
                onVoiceIntent={handleVoiceIntent}
                isRecordingIntent={isRecordingIntent}
                planningResult={directionPlanningResult}
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
            ) : activeTab === "collab" ? (
              <CollaborationConsole
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
  agentRunResult,
  agentRunInputValues,
  pendingPlanLaunchApproval,
  pendingEmailApproval,
  pendingToolkitApproval,
  agentInputSourceUrl,
  agentInputFile,
  agentInputSubmitting,
  agentActionBusy,
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
  agentRunResult: AgentRunResponse | null;
  agentRunInputValues: Record<string, string>;
  pendingPlanLaunchApproval: PendingPlanLaunchApproval | null;
  pendingEmailApproval: PendingEmailApproval | null;
  pendingToolkitApproval: PendingToolkitApproval | null;
  agentInputSourceUrl: string;
  agentInputFile: File | null;
  agentInputSubmitting: boolean;
  agentActionBusy: boolean;
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
  onSendMessage: (message: string, mode: ControlMode) => Promise<void>;
  onVoiceIntent: () => void;
  isRecordingIntent: boolean;
}) {
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const hasConversation = turns.length > 0;
  const hasDirectionDraft = directionGiven.trim().length > 0;
  const isBusy =
    directionChatInFlight ||
    directionPlanningInFlight ||
    sending ||
    agentActionBusy ||
    agentInputSubmitting;
  const showLanding = !hasConversation && !hasDirectionDraft;
  const requiredInputs = agentRunResult?.status === "needs_input" ? agentRunResult.required_inputs ?? [] : [];
  const hasActionCards =
    Boolean(planningResult?.analysis) ||
    Boolean(pendingPlanLaunchApproval) ||
    Boolean(pendingToolkitApproval) ||
    Boolean(pendingEmailApproval) ||
    agentRunResult?.status === "needs_input";
  const placeholder =
    mode === "MINDSTORM"
      ? "Ask anything about ideas, planning, or execution..."
      : "Give the direction the organization should shift toward...";
  const heroTitle =
    mode === "MINDSTORM"
      ? "What's on your mind today?"
      : "Where should organization move next?";

  const handleSend = useCallback(async () => {
    const text = composer.trim();
    if (!text || isBusy) {
      return;
    }

    setSending(true);
    try {
      if (!engaged) {
        onEngageWithMode(mode);
      }
      await onSendMessage(text, mode);
      if (mode === "DIRECTION") {
        onDirectionGivenChange(text);
      }
      setComposer("");
    } finally {
      setSending(false);
    }
  }, [composer, engaged, isBusy, mode, onDirectionGivenChange, onEngageWithMode, onSendMessage]);

  const composerBar = (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-1.5 backdrop-blur-xl sm:rounded-[30px] sm:p-2">
      <div className="flex items-end gap-1.5 sm:gap-2">
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-slate-200 sm:h-9 sm:w-9"
          title="Tools"
        >
          <PlusCircle size={16} />
        </button>

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
          className="h-10 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 sm:px-2 sm:text-base"
        />

        <button
          onClick={onVoiceIntent}
          disabled={isRecordingIntent || mode !== "MINDSTORM"}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-slate-200 disabled:opacity-50 sm:h-9 sm:w-9"
          title={isRecordingIntent ? "Listening..." : "Voice Input"}
        >
          {isRecordingIntent ? <MicOff size={16} /> : <Mic size={16} />}
        </button>

        <button
          onClick={() => void handleSend()}
          disabled={isBusy || !composer.trim()}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black transition hover:bg-slate-200 disabled:opacity-60 sm:h-10 sm:w-10"
          title={mode === "MINDSTORM" ? "Send Message" : "Generate Plan"}
        >
          {isBusy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUpRight size={16} />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-2 sm:gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
        <p className="text-sm text-slate-300">Talk to your organization</p>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          <div className="inline-flex w-full max-w-full flex-wrap rounded-full border border-white/10 bg-black/25 p-1 sm:w-auto">
            <button
              onClick={() => onModeChange("MINDSTORM")}
              className={`flex-1 rounded-full px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] transition sm:flex-none sm:px-5 sm:text-[11px] sm:tracking-[0.16em] ${
                mode === "MINDSTORM"
                  ? "bg-white text-black"
                  : "text-slate-300 hover:bg-white/10"
              }`}
            >
              Mindstorming
            </button>
            <button
              onClick={() => onModeChange("DIRECTION")}
              className={`flex-1 rounded-full px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] transition sm:flex-none sm:px-5 sm:text-[11px] sm:tracking-[0.16em] ${
                mode === "DIRECTION"
                  ? "bg-white text-black"
                  : "text-slate-300 hover:bg-white/10"
              }`}
            >
              Direction
            </button>
          </div>

          <select
            value={directionModelId}
            onChange={(event) =>
              onDirectionModelChange(event.target.value as (typeof DIRECTION_MODELS)[number]["id"])
            }
            className="w-full rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm text-slate-100 outline-none sm:min-w-[210px] sm:w-auto"
          >
            {directionModels.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={onOpenTools}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-500/35 bg-cyan-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-500/20"
          >
            <Link2 size={14} />
            Connect Tools
          </button>
        </div>
      </div>

      <div className={`vx-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] p-3 sm:rounded-[28px] sm:p-4 ${themeStyle.border}`}>
        {showLanding ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3">
            <h2 className="text-center text-3xl font-medium text-slate-100 md:text-5xl">
              {heroTitle}
            </h2>

            {planningResult?.analysis ? (
              <div className="mt-4 w-full max-w-4xl rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
                {planningResult.analysis}
              </div>
            ) : null}

            <div className="mt-8 w-full max-w-4xl">{composerBar}</div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="inline-flex max-w-full flex-wrap rounded-full border border-white/10 bg-black/25 p-1">
              <button
                onClick={() => onConversationDetailChange("REASONING_MIN")}
                className={`rounded-full px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                  conversationDetail === "REASONING_MIN"
                    ? "bg-white text-black"
                    : "text-slate-300 hover:bg-white/10"
                }`}
              >
                Reasoning Minimized
              </button>
              <button
                onClick={() => onConversationDetailChange("DIRECTION_GIVEN")}
                className={`rounded-full px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                  conversationDetail === "DIRECTION_GIVEN"
                    ? "bg-white text-black"
                    : "text-slate-300 hover:bg-white/10"
                }`}
              >
                Direction Given
              </button>
            </div>

            {conversationDetail === "DIRECTION_GIVEN" && hasDirectionDraft ? (
              <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  Final Direction
                </p>
                <textarea
                  value={directionGiven}
                  onChange={(event) => onDirectionGivenChange(event.target.value)}
                  className="mt-2 h-16 w-full resize-none rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-slate-100 outline-none"
                />
              </div>
            ) : null}

            {hasActionCards ? (
              <div className="vx-scrollbar max-h-[38vh] space-y-2 overflow-y-auto pr-0 sm:pr-1">
                {planningResult?.analysis ? (
                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs leading-relaxed text-blue-200 sm:text-sm">
                    {planningResult.analysis}
                  </div>
                ) : null}

                {pendingPlanLaunchApproval ? (
                  <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-300">
                      Plan Approval Required
                    </p>
                    <p className="mt-2 text-xs text-cyan-100 sm:text-sm">
                      Review completed plan before workflow launch.
                    </p>
                    <p className="mt-1 text-[11px] text-cyan-200/85 sm:text-xs">
                      {pendingPlanLaunchApproval.reason}
                    </p>
                    {pendingPlanLaunchApproval.toolkits.length > 0 ? (
                      <p className="mt-2 text-[11px] text-cyan-100/90">
                        Required tools: {formatToolkitList(pendingPlanLaunchApproval.toolkits)}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={onApprovePlanLaunch}
                        disabled={isBusy}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                      >
                        Approve Launch
                      </button>
                      <button
                        type="button"
                        onClick={onRejectPlanLaunch}
                        disabled={isBusy}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}

                {pendingToolkitApproval ? (
                  <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-amber-300">
                      Tool Access Approval
                    </p>
                    <p className="mt-2 text-xs text-amber-100 sm:text-sm">
                      Required tools: {formatToolkitList(pendingToolkitApproval.toolkits)}
                    </p>
                    <p className="mt-1 text-[11px] text-amber-200/85 sm:text-xs">
                      Approve to connect integrations and continue execution, or reject to keep it paused.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={onApproveToolkitAccess}
                        disabled={isBusy}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={onRejectToolkitAccess}
                        disabled={isBusy}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}

                {pendingEmailApproval ? (
                  <div className="rounded-xl border border-white/15 bg-white/[0.03] p-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-300">
                      Draft Approval Required
                    </p>
                    <p className="mt-2 truncate text-xs text-slate-200">To: {pendingEmailApproval.draft.to}</p>
                    <p className="truncate text-xs text-slate-300">
                      Subject: {pendingEmailApproval.draft.subject}
                    </p>
                    <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-white/10 bg-black/30 px-2.5 py-2">
                      <p className="whitespace-pre-wrap break-words text-xs text-slate-200">
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
                        disabled={isBusy}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={onRejectEmailDraft}
                        disabled={isBusy}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}

                {agentRunResult?.status === "needs_input" ? (
                  <div className="space-y-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-amber-300">
                        Missing Input Required
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-amber-100">
                        {agentRunResult.assistant_message || "Provide missing details to continue."}
                      </p>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      {requiredInputs.map((field) => (
                        <label key={field.key} className="block text-[11px] uppercase tracking-[0.1em] text-amber-200">
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

                    <label className="block text-[11px] uppercase tracking-[0.1em] text-amber-200">
                      Optional Source URL
                      <input
                        value={agentInputSourceUrl}
                        onChange={(event) => onAgentInputSourceUrlChange(event.target.value)}
                        placeholder="https://docs.example.com/context"
                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none"
                      />
                    </label>

                    <label className="block text-[11px] uppercase tracking-[0.1em] text-amber-200">
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
                        disabled={isBusy}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                      >
                        Approve & Continue
                      </button>
                      <button
                        type="button"
                        onClick={onRejectAgentInput}
                        disabled={isBusy}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-red-300 transition hover:bg-red-500/20 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="vx-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-0 sm:pr-1">
              {turns.map((turn) => (
                <div
                  key={turn.id}
                  className={`max-w-full rounded-2xl px-3 py-2.5 text-sm sm:max-w-[85%] sm:px-4 sm:py-3 ${
                    turn.role === "owner"
                      ? "ml-auto bg-white/[0.08] text-slate-100"
                      : "mr-auto bg-white/[0.04] text-slate-200"
                  }`}
                >
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    {turn.role === "owner" ? "You" : "Organization"}
                    {turn.modelLabel ? ` | ${turn.modelLabel}` : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{turn.content}</p>
                </div>
              ))}
            </div>

            <div className="mx-auto w-full max-w-4xl pt-1">{composerBar}</div>
          </div>
        )}

        {message ? (
          <div
            className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
              message.tone === "success"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : message.tone === "warning"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-red-500/40 bg-red-500/10 text-red-300"
            }`}
          >
            {message.text}
          </div>
        ) : null}
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
