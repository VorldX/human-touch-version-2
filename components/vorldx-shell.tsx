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
  LogOut,
  Menu,
  Mic,
  MicOff,
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
  { id: "openai:gpt-4o-mini", label: "ChatGPT (gpt-4o-mini)" },
  { id: "anthropic:claude-3-5-sonnet", label: "Claude (3.5 Sonnet)" },
  { id: "gemini:gemini-1.5-pro", label: "Gemini (1.5 Pro)" }
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
  const requested = new Set<string>();

  if (/\b(gmail|email|inbox)\b/.test(prompt)) requested.add("gmail");
  if (/\b(slack|channel|workspace)\b/.test(prompt)) requested.add("slack");
  if (/\b(notion|database|workspace page|wiki)\b/.test(prompt)) requested.add("notion");

  return [...requested];
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

  const [activeTab, setActiveTab] =
    useState<(typeof NAV_ITEMS)[number]["id"]>("control");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [intent, setIntent] = useState("");
  const [directionPrompt, setDirectionPrompt] = useState("");
  const [directionTurns, setDirectionTurns] = useState<DirectionTurn[]>([]);
  const [directionModelId, setDirectionModelId] =
    useState<(typeof DIRECTION_MODELS)[number]["id"]>("openai:gpt-4o-mini");
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
  const [controlMessage, setControlMessage] = useState<ControlMessage | null>(null);
  const [agentRunResult, setAgentRunResult] = useState<AgentRunResponse | null>(null);
  const [agentRunInputValues, setAgentRunInputValues] = useState<Record<string, string>>({});
  const [agentRunPromptSnapshot, setAgentRunPromptSnapshot] = useState("");
  const [realtimeSessionId] = useState(
    () => `shell-${Math.random().toString(36).slice(2, 10)}`
  );

  const closeSearch = () => {
    setTimeout(() => setSearchOpen(false), 120);
  };

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
      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        requests?: UserJoinRequest[];
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "Failed loading join requests.");
      }

      setJoinRequestError(null);
      setUserJoinRequests(payload.requests ?? []);
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
      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        canReview?: boolean;
        requests?: PermissionRequestItem[];
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "Failed loading permission requests.");
      }

      setPermissionRequests(payload.requests ?? []);
      setCanReviewPermissionRequests(Boolean(payload.canReview));
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

      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "Failed to submit request.");
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
        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          activeOrgId?: string | null;
          orgs?: Array<{
            id: string;
            name: string;
            role: string;
            theme: AppTheme;
          }>;
        };

        if (!response.ok || !payload.ok) {
          throw new Error(
            payload.message ?? `Unable to load organizations (${response.status}).`
          );
        }

        if (cancelled) {
          return;
        }

        const serverOrgs = payload.orgs ?? [];
        setOrgs(serverOrgs);

        if (serverOrgs.length === 0) {
          setCurrentOrg(null);
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

    socket.on("signature.captured", handleSignatureCaptured);
    socket.on("kill-switch.triggered", handleKillSwitch);

    return () => {
      socket.off("signature.captured", handleSignatureCaptured);
      socket.off("kill-switch.triggered", handleKillSwitch);
    };
  }, [realtimeSessionId, requiredSignatures, resolvedOrg?.id]);

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
        action: () => setActiveTab("control")
      },
      {
        id: "action-ghost",
        label: "Toggle Ghost Protocol",
        action: () => toggleGhostMode()
      }
    ].filter((item) => item.label.toLowerCase().includes(q));

    return { tabs, orgMatches, actions };
  }, [openAddOrganization, orgs, searchQuery, toggleGhostMode]);

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
        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          schedules?: MissionSchedule[];
        };

        if (!response.ok || !payload.ok) {
          throw new Error(payload.message ?? "Failed loading mission schedules.");
        }

        setMissionSchedules(payload.schedules ?? []);
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
    const ownerTurn: DirectionTurn = {
      id: `owner-${Date.now()}`,
      role: "owner",
      content: message
    };
    setDirectionTurns((prev) => [...prev, ownerTurn]);
    if (!rawMessage) {
      setDirectionPrompt("");
    }
    setDirectionChatInFlight(true);
    setControlMessage(null);

    try {
      const response = await fetch("/api/control/direction-chat", {
        method: "POST",
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

      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        reply?: string;
        directionCandidate?: string;
        model?: { provider?: string | null; name?: string | null };
      };

      if (!response.ok || !payload.ok || !payload.reply) {
        setControlMessage({
          tone: "error",
          text: payload.message ?? "Organization did not respond."
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
    } catch (error) {
      setControlMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Direction chat failed."
      });
    } finally {
      setDirectionChatInFlight(false);
    }
  }, [directionModelId, directionPrompt, directionTurns, resolvedOrg?.id]);

  const handleGenerateDirectionPlans = useCallback(
    async (rawDirection?: string) => {
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

      setDirectionPlanningInFlight(true);
      setControlMessage(null);
      try {
        const [provider, model] = directionModelId.split(":");
        const response = await fetch("/api/control/direction-plan", {
          method: "POST",
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

        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          analysis?: string;
          directionGiven?: string;
          primaryPlan?: DirectionExecutionPlan;
          fallbackPlan?: DirectionExecutionPlan;
          requestCount?: number;
          model?: { provider?: string | null; name?: string | null };
        };

        if (
          !response.ok ||
          !payload.ok ||
          !payload.primaryPlan ||
          !payload.fallbackPlan
        ) {
          throw new Error(payload.message ?? "Failed generating plans.");
        }

        const refinedDirection = payload.directionGiven?.trim() || direction;
        const analysis = payload.analysis?.trim() ?? "";
        setIntent(refinedDirection);
        setDirectionPlanningResult({
          analysis,
          directionGiven: refinedDirection,
          primaryPlan: payload.primaryPlan,
          fallbackPlan: payload.fallbackPlan
        });
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

        await loadPermissionRequests();
        setControlMessage({
          tone: "success",
          text: `Primary and fallback plans prepared.${payload.requestCount ? ` ${payload.requestCount} permission requests raised.` : ""}`
        });
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

        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
        };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message ?? "Failed updating request.");
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

      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        schedule?: MissionSchedule;
      };

      if (!response.ok || !payload.ok || !payload.schedule) {
        throw new Error(payload.message ?? "Failed creating schedule.");
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

        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          warning?: string;
          schedule?: MissionSchedule;
          flow?: { id: string; status: string };
        };

        if (!response.ok || !payload.ok || !payload.flow || !payload.schedule) {
          throw new Error(payload.message ?? "Failed running schedule.");
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

      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        launchedCount?: number;
        failedCount?: number;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "Failed running due schedules.");
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
        setActiveTab("flow");
      }
    } catch (error) {
      setControlMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed running due schedules."
      });
    } finally {
      setScheduleTickInFlight(false);
    }
  }, [loadMissionSchedules, resolvedOrg?.id]);

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

        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          schedule?: MissionSchedule;
        };

        if (!response.ok || !payload.ok || !payload.schedule) {
          throw new Error(payload.message ?? "Failed updating schedule.");
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
        const payload = (await response.json()) as { ok?: boolean; message?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.message ?? "Failed deleting schedule.");
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

  const handleLaunchMainAgent = useCallback(async () => {
    const prompt = intent.trim();
    if (!prompt) {
      setControlMessage({
        tone: "error",
        text: "Direction is required before launching the Main Agent."
      });
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
      if (isGmailDirectionPrompt(prompt)) {
        if (!user?.uid || !user.email) {
          setControlMessage({
            tone: "error",
            text: "Sign in first to run Gmail actions through Main Agent."
          });
          return;
        }

        const shouldConfirm =
          agentRunResult?.status === "needs_confirmation" &&
          agentRunPromptSnapshot === prompt;
        const response = await fetch("/api/agent/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": user.uid,
            "x-user-email": user.email
          },
          body: JSON.stringify({
            prompt,
            input: {
              ...agentRunInputValues,
              orgId: resolvedOrg?.id
            },
            confirm: shouldConfirm,
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
        if (payload.draft) {
          setAgentRunInputValues((previous) => ({
            ...previous,
            recipient_email: payload.draft?.to || previous.recipient_email || "",
            subject: payload.draft?.subject || previous.subject || "",
            body: payload.draft?.body || previous.body || ""
          }));
        }

        if (payload.status === "completed") {
          setControlMessage({
            tone: "success",
            text: payload.assistant_message || "Main Agent completed the Gmail action."
          });
        } else if (payload.status === "needs_input") {
          setControlMessage({
            tone: "warning",
            text: payload.assistant_message || "Provide required details and submit again."
          });
        } else if (payload.status === "needs_confirmation") {
          setControlMessage({
            tone: "warning",
            text:
              payload.assistant_message ||
              "Review draft and click Send Direction To Main Agent again to confirm."
          });
        } else {
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
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orgId: resolvedOrg?.id,
          prompt,
          swarmDensity,
          predictedBurn,
          requiredSignatures,
          approvalsProvided: signatureApprovals,
          requestedToolkits: inferToolkitsFromDirectionPrompt(prompt)
        })
      });

      const { payload, rawText } = await parseJsonBody<{
        ok?: boolean;
        warning?: string;
        message?: string;
        flow?: { id: string; status: string };
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
          : `Flow ${payload.flow?.id ?? ""} queued successfully (${payload.flow?.status ?? "QUEUED"}).`
      });
      setActiveTab("flow");
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
    agentRunInputValues,
    agentRunPromptSnapshot,
    agentRunResult?.status,
    predictedBurn,
    requiredSignatures,
    resolvedOrg?.id,
    signatureApprovals,
    swarmDensity,
    user?.uid,
    user?.email
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
          : "") || "/app?tab=settings&settingsLane=integrations&toolkit=gmail"
      : "";

  return (
    <div className="vx-shell relative min-h-screen bg-vx-bg text-slate-100 transition-all duration-500">
      <div className="flex h-screen overflow-hidden">
        <aside
          className={`flex h-full shrink-0 flex-col border-r border-white/10 bg-[#05070a]/95 backdrop-blur-2xl transition-all duration-500 ${
            isSidebarCollapsed ? "w-24" : "w-80"
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
                onClick={() => setActiveTab(item.id)}
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
                      onClick={() => setActiveTab("settings")}
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
                    onClick={() => setActiveTab("settings")}
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

          <div className="border-t border-white/10 p-4">
            <button
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              className="flex w-full items-center justify-center rounded-2xl bg-white/5 p-3 text-slate-300 transition hover:bg-white/10"
            >
              <LayoutGrid size={20} />
            </button>
          </div>
        </aside>

        <main className="relative flex h-full flex-1 flex-col overflow-hidden">
          <header className="relative z-30 flex h-24 shrink-0 items-center justify-between border-b border-white/10 bg-[#05070a]/50 px-5 backdrop-blur-xl md:px-10">
            <div
              className="group flex cursor-pointer items-center gap-3"
              onClick={() => setShowOrgSwitcher((prev) => !prev)}
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
                          setActiveTab(item.id);
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
                    void loadPermissionRequests();
                  }}
                  className="relative inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200 transition hover:bg-white/10"
                >
                  <Bell size={14} />
                  Requests
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
                {isGhostModeActive ? "Ghost Protocol Active" : "Ghost Protocol"}
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

              <button className="md:hidden">
                <Menu size={20} />
              </button>
            </div>

            {showOrgSwitcher && (
              <div className="absolute left-6 top-20 z-50 w-72 rounded-3xl border border-white/10 bg-[#0d1117] p-3 shadow-vx md:left-10">
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
              <div className="absolute right-6 top-20 z-50 w-[420px] rounded-3xl border border-white/10 bg-[#0d1117] p-3 shadow-vx md:right-10">
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
            className={`vx-scrollbar relative flex-1 px-5 py-8 md:px-10 md:py-10 ${
              resolvedOrg && activeTab === "control"
                ? "min-h-0 overflow-hidden py-4 md:py-6"
                : "overflow-y-auto"
            }`}
          >
            {orgBootstrapStatus === "loading" ? (
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
                  }
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
                  setIntent(message);
                  await handleGenerateDirectionPlans(message);
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
                  requestedSettingsLane === "integrations" ||
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
  onModeChange,
  onConversationDetailChange,
  onDirectionGivenChange,
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
  onModeChange: (value: ControlMode) => void;
  onConversationDetailChange: (value: ControlConversationDetail) => void;
  onDirectionGivenChange: (value: string) => void;
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
  const isBusy = directionChatInFlight || directionPlanningInFlight || sending;
  const showLanding = !hasConversation && !hasDirectionDraft;
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
    <div className="rounded-[30px] border border-white/10 bg-white/[0.04] p-2 backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
          title="Tools"
        >
          <PlusCircle size={18} />
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
          className="h-10 flex-1 resize-none bg-transparent px-2 py-2 text-base text-slate-100 outline-none placeholder:text-slate-500"
        />

        <button
          onClick={onVoiceIntent}
          disabled={isRecordingIntent || mode !== "MINDSTORM"}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-slate-200 disabled:opacity-50"
          title={isRecordingIntent ? "Listening..." : "Voice Input"}
        >
          {isRecordingIntent ? <MicOff size={18} /> : <Mic size={18} />}
        </button>

        <button
          onClick={() => void handleSend()}
          disabled={isBusy || !composer.trim()}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-black transition hover:bg-slate-200 disabled:opacity-60"
          title={mode === "MINDSTORM" ? "Send Message" : "Generate Plan"}
        >
          {isBusy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUpRight size={18} />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-300">Talk to your organization</p>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-white/10 bg-black/25 p-1">
            <button
              onClick={() => onModeChange("MINDSTORM")}
              className={`rounded-full px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] transition ${
                mode === "MINDSTORM"
                  ? "bg-white text-black"
                  : "text-slate-300 hover:bg-white/10"
              }`}
            >
              Mindstorming
            </button>
            <button
              onClick={() => onModeChange("DIRECTION")}
              className={`rounded-full px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] transition ${
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
            className="rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm text-slate-100 outline-none"
          >
            {directionModels.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={`vx-panel flex min-h-0 flex-1 flex-col rounded-[28px] p-4 ${themeStyle.border}`}>
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
            <div className="inline-flex w-fit rounded-full border border-white/10 bg-black/25 p-1">
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

            {planningResult?.analysis ? (
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
                {planningResult.analysis}
              </div>
            ) : null}

            <div className="vx-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {turns.map((turn) => (
                <div
                  key={turn.id}
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                    turn.role === "owner"
                      ? "ml-auto bg-white/[0.08] text-slate-100"
                      : "mr-auto bg-white/[0.04] text-slate-200"
                  }`}
                >
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    {turn.role === "owner" ? "You" : "Organization"}
                    {turn.modelLabel ? ` | ${turn.modelLabel}` : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{turn.content}</p>
                </div>
              ))}
            </div>

            <div className="mx-auto w-full max-w-4xl">{composerBar}</div>
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
        <h2 className="font-display text-4xl font-black uppercase tracking-tight">
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
      <div className="flex items-end justify-between border-b border-white/10 pb-6">
        <h2 className="font-display text-4xl font-black uppercase tracking-tight">
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
