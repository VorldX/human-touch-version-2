"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Building2,
  ChevronDown,
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
import { SettingsConsole } from "@/components/settings/settings-console";
import { SquadConsole } from "@/components/squad/squad-console";
import { NotificationStack } from "@/components/system/notification-stack";
import { WorkflowConsole } from "@/components/workflow/workflow-console";
import { getRealtimeClient } from "@/lib/realtime/client";
import type { AppTheme, OrgContext } from "@/lib/store/vorldx-store";
import { useVorldXStore } from "@/lib/store/vorldx-store";

const NAV_ITEMS = [
  { id: "control", label: "Control Deck", icon: LayoutDashboard },
  { id: "direction", label: "Direction", icon: Target },
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
  const { user, signOutCurrentUser } = useFirebaseAuth();
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
  const [orgBootstrapLoading, setOrgBootstrapLoading] = useState(true);
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
  const [onboardingMode, setOnboardingMode] = useState<"initial" | "add-org">("initial");
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
    setOnboardingMode("add-org");
  }, []);

  useEffect(() => {
    let mounted = true;

    async function bootstrapOrganizations() {
      setOrgBootstrapLoading(true);

      try {
        const response = await fetch("/api/orgs", {
          method: "GET",
          cache: "no-store"
        });

        const payload = (await response.json().catch(() => null)) as
          | {
              ok?: boolean;
              activeOrgId?: string | null;
              orgs?: OrgContext[];
            }
          | null;

        if (!mounted) {
          return;
        }

        if (!response.ok || !payload?.ok) {
          throw new Error("Failed to load organizations.");
        }

        const serverOrgs = Array.isArray(payload.orgs) ? payload.orgs : [];
        setOrgs(serverOrgs);

        if (serverOrgs.length === 0) {
          setCurrentOrg(null);
          return;
        }

        const preferredCurrentId = useVorldXStore.getState().currentOrg?.id;
        const nextCurrent =
          (preferredCurrentId
            ? serverOrgs.find((org) => org.id === preferredCurrentId)
            : undefined) ??
          (payload.activeOrgId
            ? serverOrgs.find((org) => org.id === payload.activeOrgId)
            : undefined) ??
          serverOrgs[0];

        if (nextCurrent) {
          setCurrentOrg(nextCurrent);
        }
      } catch {
        // Preserve local org cache as best-effort fallback.
      } finally {
        if (mounted) {
          setOrgBootstrapLoading(false);
        }
      }
    }

    void bootstrapOrganizations();

    return () => {
      mounted = false;
    };
  }, [setCurrentOrg, setOrgs, user?.uid]);

  useEffect(() => {
    if (orgBootstrapLoading) {
      return;
    }
    if (!currentOrg && orgs.length > 0) {
      setCurrentOrg(orgs[0]);
    }
  }, [currentOrg, orgBootstrapLoading, orgs, setCurrentOrg]);

  useEffect(() => {
    document.documentElement.dataset.ghost = isGhostModeActive ? "true" : "false";
  }, [isGhostModeActive]);

  const resolvedOrg = orgBootstrapLoading ? null : currentOrg ?? orgs[0] ?? null;
  const isOnboarding = onboardingMode === "add-org" || !resolvedOrg;
  const themeStyle = THEME_STYLES[theme];
  const requestedSettingsLane = searchParams.get("settingsLane");

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

  const handleDirectionChat = useCallback(async () => {
    const message = directionPrompt.trim();
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
    setDirectionPrompt("");
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

  if (orgBootstrapLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#05070a] text-slate-300">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.16em]">
          <Loader2 size={14} className="animate-spin" />
          Loading Organizations
        </div>
      </main>
    );
  }

  if (isOnboarding) {
    return (
      <OnboardingWizard
        mode={resolvedOrg ? onboardingMode : "initial"}
        onCancel={
          onboardingMode === "add-org"
            ? () => {
                setOnboardingMode("initial");
              }
            : undefined
        }
        onComplete={(org) => {
          addOrg(org);
          setCurrentOrg(org);
          setOnboardingMode("initial");
        }}
      />
    );
  }

  if (!resolvedOrg) {
    return null;
  }

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
                  {resolvedOrg.name}
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
                  {resolvedOrg.name}
                  <ChevronDown size={14} className="text-slate-400 group-hover:text-white" />
                </p>
                <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                  {resolvedOrg.role} Context
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
                        resolvedOrg.id === org.id
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
          </header>

          <section className="vx-scrollbar relative flex-1 overflow-y-auto px-5 py-8 md:px-10 md:py-10">
            {activeTab === "control" ? (
              <div className="mx-auto max-w-5xl space-y-10">
                <div className="space-y-2">
                  <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[28px] bg-white/5">
                    <Target size={34} className={themeStyle.accent} />
                  </div>
                  <h1 className="font-display text-5xl font-black uppercase tracking-tight md:text-6xl">
                    Talk To Organization
                  </h1>
                  <p className="text-xs uppercase tracking-[0.4em] text-slate-500">
                    Main Agent Context For {resolvedOrg.name}
                  </p>
                </div>

                <div className="vx-panel space-y-8 rounded-[42px] p-8 md:p-12">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] uppercase tracking-[0.35em] text-slate-500">
                      Direction Interaction
                    </p>
                    <button
                      onClick={handleVoiceIntent}
                      disabled={isRecordingIntent}
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition ${
                        isRecordingIntent
                          ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                          : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                      } disabled:cursor-not-allowed`}
                    >
                      {isRecordingIntent ? <MicOff size={14} /> : <Mic size={14} />}
                      {isRecordingIntent ? "Listening..." : "Voice Input"}
                    </button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                    <select
                      value={directionModelId}
                      onChange={(event) =>
                        setDirectionModelId(
                          event.target.value as (typeof DIRECTION_MODELS)[number]["id"]
                        )
                      }
                      className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-100 outline-none"
                    >
                      {DIRECTION_MODELS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleDirectionChat}
                      disabled={directionChatInFlight || !directionPrompt.trim()}
                      className="rounded-2xl border border-white/20 bg-white/5 px-5 py-3 text-xs font-bold uppercase tracking-[0.2em] text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {directionChatInFlight ? "Thinking..." : "Talk"}
                    </button>
                  </div>

                  <div className="vx-scrollbar max-h-64 space-y-3 overflow-y-auto rounded-3xl border border-white/10 bg-black/35 p-4">
                    {directionTurns.length === 0 ? (
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        Start a conversation to shape the company direction.
                      </p>
                    ) : (
                      directionTurns.map((turn) => (
                        <div
                          key={turn.id}
                          className={`rounded-2xl border p-3 ${
                            turn.role === "owner"
                              ? "border-cyan-500/30 bg-cyan-500/10"
                              : "border-emerald-500/30 bg-emerald-500/10"
                          }`}
                        >
                          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
                            {turn.role === "owner" ? "Owner" : "Organization"}{" "}
                            {turn.modelLabel ? `| ${turn.modelLabel}` : ""}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-100">
                            {turn.content}
                          </p>
                        </div>
                      ))
                    )}
                  </div>

                  <textarea
                    value={directionPrompt}
                    onChange={(event) => setDirectionPrompt(event.target.value)}
                    placeholder="Ask your organization for analysis, strategy, or planning..."
                    className="min-h-24 w-full resize-y rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-slate-100 outline-none placeholder:text-slate-600"
                  />

                  <div>
                    <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                      Direction To Execute
                    </p>
                    <textarea
                      value={intent}
                      onChange={(event) => {
                        setIntent(event.target.value);
                        if (
                          agentRunPromptSnapshot &&
                          event.target.value.trim() !== agentRunPromptSnapshot
                        ) {
                          setAgentRunResult(null);
                          setAgentRunInputValues({});
                        }
                      }}
                      placeholder="Final direction that will be sent to the Main Agent for task decomposition..."
                      className="min-h-36 w-full resize-y rounded-2xl border border-white/10 bg-black/45 p-4 text-base text-slate-100 outline-none placeholder:text-slate-600"
                    />
                  </div>

                  <div className="grid gap-6 md:grid-cols-3">
                    <div className="rounded-3xl border border-white/10 bg-black/40 p-5">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                        Swarm Density
                      </p>
                      <div className="mt-3 flex items-end justify-between">
                        <p className="text-3xl font-bold text-white">{swarmDensity}</p>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                          Nodes
                        </p>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={100}
                        step={1}
                        value={swarmDensity}
                        onChange={(event) => setSwarmDensity(Number(event.target.value))}
                        className="mt-4 w-full accent-blue-500"
                      />
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-black/40 p-5">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                        Predicted Burn
                      </p>
                      <p className="mt-4 font-display text-4xl font-black text-white">
                        {predictedBurn.toLocaleString()} BTU
                      </p>
                      <p className="mt-4 text-xs text-slate-500">
                        Multi-sig gates and Human Touch checkpoints will be enforced before run start.
                      </p>
                    </div>

                    <div className="rounded-3xl border border-white/10 bg-black/40 p-5">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                        Multi-Sig Gate
                      </p>
                      <p className="mt-4 font-display text-4xl font-black text-white">
                        {signatureApprovals}/{requiredSignatures}
                      </p>
                      <p className="mt-4 text-xs text-slate-500">
                        {requiredSignatures > 1
                          ? `${requiredSignatures} human approvals required for this mission burn.`
                          : "Single principal authorization is sufficient for this burn."}
                      </p>
                      {requiredSignatures > 1 && (
                        <button
                          onClick={() => {
                            const nextApprovals = Math.min(
                              requiredSignatures,
                              signatureApprovals + 1
                            );
                            setSignatureApprovals(nextApprovals);
                            const socket = getRealtimeClient();
                            socket?.emit("signature:capture", {
                              orgId: resolvedOrg.id,
                              senderId: realtimeSessionId,
                              approvalsProvided: nextApprovals,
                              requiredSignatures
                            });
                          }}
                          disabled={signatureApprovals >= requiredSignatures}
                          className="mt-4 rounded-full border border-white/20 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Capture Signature
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4 rounded-3xl border border-white/10 bg-black/35 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                        Direction Schedules
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleRunDueSchedules}
                          disabled={scheduleTickInFlight}
                          className="inline-flex items-center gap-2 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {scheduleTickInFlight ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : null}
                          Run Due
                        </button>
                        <button
                          onClick={() => void loadMissionSchedules(true)}
                          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300 transition hover:bg-white/10"
                        >
                          {schedulesRefreshing ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RefreshCw size={12} />
                          )}
                          Refresh
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
                      <input
                        value={scheduleDraft.title}
                        onChange={(event) =>
                          setScheduleDraft((prev) => ({
                            ...prev,
                            title: event.target.value
                          }))
                        }
                        placeholder="Schedule title"
                        className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600"
                      />
                      <select
                        value={scheduleDraft.cadence}
                        onChange={(event) =>
                          setScheduleDraft((prev) => ({
                            ...prev,
                            cadence: event.target.value as MissionCadence
                          }))
                        }
                        className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
                      >
                        <option value="DAILY">DAILY</option>
                        <option value="WEEKLY">WEEKLY</option>
                        <option value="MONTHLY">MONTHLY</option>
                        <option value="CUSTOM">CUSTOM</option>
                      </select>
                      <input
                        type="datetime-local"
                        value={scheduleDraft.nextRunAt}
                        onChange={(event) =>
                          setScheduleDraft((prev) => ({
                            ...prev,
                            nextRunAt: event.target.value
                          }))
                        }
                        className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
                      />
                      <button
                        onClick={handleCreateSchedule}
                        disabled={scheduleActionInFlight || !intent.trim()}
                        className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {scheduleActionInFlight ? "Saving..." : "Create"}
                      </button>
                    </div>

                    {schedulesLoading ? (
                      <div className="inline-flex items-center gap-2 text-xs text-slate-400">
                        <Loader2 size={13} className="animate-spin" />
                        Loading schedules...
                      </div>
                    ) : missionSchedules.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        No schedules yet. Create one from the current direction.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {missionSchedules.map((schedule) => (
                          <div
                            key={schedule.id}
                            className="rounded-2xl border border-white/10 bg-black/35 p-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-white">
                                  {schedule.title}
                                </p>
                                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                                  {schedule.cadence} | Next:{" "}
                                  {new Date(schedule.nextRunAt).toLocaleString()} | Burn:{" "}
                                  {schedule.predictedBurn.toLocaleString()} BTU
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => void handleRunSchedule(schedule.id)}
                                  disabled={Boolean(scheduleRunInFlightId) || !schedule.enabled}
                                  className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {scheduleRunInFlightId === schedule.id ? "Running..." : "Run"}
                                </button>
                                <button
                                  onClick={() => void handleToggleSchedule(schedule)}
                                  disabled={scheduleActionInFlight}
                                  className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {schedule.enabled ? "Disable" : "Enable"}
                                </button>
                                <button
                                  onClick={() => void handleDeleteSchedule(schedule.id)}
                                  disabled={scheduleActionInFlight}
                                  className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                            <p className="mt-2 line-clamp-2 text-xs text-slate-400">
                              {schedule.direction}
                            </p>
                            {schedule.lastRunAt ? (
                              <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                                Last run: {new Date(schedule.lastRunAt).toLocaleString()}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {agentRunResult ? (
                    <div className="space-y-4 rounded-3xl border border-white/10 bg-black/35 p-5">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                        Main Agent Gmail Action
                      </p>
                      <div
                        className={`rounded-2xl border px-4 py-3 text-xs uppercase tracking-[0.16em] ${
                          agentRunResult.status === "completed"
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                            : agentRunResult.status === "needs_confirmation" ||
                                agentRunResult.status === "needs_input"
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                              : "border-red-500/40 bg-red-500/10 text-red-300"
                        }`}
                      >
                        {agentRunResult.assistant_message}
                      </div>

                      {agentRunResult.required_inputs &&
                      agentRunResult.required_inputs.length > 0 ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          {agentRunResult.required_inputs.map((field) => (
                            <label key={field.key} className="space-y-1">
                              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                                {field.label}
                              </span>
                              <input
                                type={field.type}
                                value={agentRunInputValues[field.key] ?? ""}
                                onChange={(event) =>
                                  setAgentRunInputValues((previous) => ({
                                    ...previous,
                                    [field.key]: event.target.value
                                  }))
                                }
                                placeholder={field.placeholder}
                                className="w-full rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600"
                              />
                            </label>
                          ))}
                        </div>
                      ) : null}

                      {agentRunResult.draft ? (
                        <div className="space-y-2 rounded-2xl border border-white/10 bg-black/30 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                            Draft Preview
                          </p>
                          <label className="space-y-1">
                            <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                              To
                            </span>
                            <input
                              type="email"
                              value={
                                agentRunInputValues.recipient_email ??
                                agentRunResult.draft.to
                              }
                              onChange={(event) =>
                                setAgentRunInputValues((previous) => ({
                                  ...previous,
                                  recipient_email: event.target.value
                                }))
                              }
                              className="w-full rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                              Subject
                            </span>
                            <input
                              value={agentRunInputValues.subject ?? agentRunResult.draft.subject}
                              onChange={(event) =>
                                setAgentRunInputValues((previous) => ({
                                  ...previous,
                                  subject: event.target.value
                                }))
                              }
                              className="w-full rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                              Body
                            </span>
                            <textarea
                              value={agentRunInputValues.body ?? agentRunResult.draft.body}
                              onChange={(event) =>
                                setAgentRunInputValues((previous) => ({
                                  ...previous,
                                  body: event.target.value
                                }))
                              }
                              className="min-h-28 w-full resize-y rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-sm text-slate-100 outline-none"
                            />
                          </label>
                        </div>
                      ) : null}

                      {agentRunConnectUrl ? (
                        <button
                          onClick={() => {
                            const popup = openCenteredPopup(
                              agentRunConnectUrl,
                              "integrations-gmail"
                            );
                            if (!popup) {
                              window.location.assign(agentRunConnectUrl);
                            }
                          }}
                          className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200 transition hover:bg-amber-500/20"
                        >
                          Connect Gmail
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {controlMessage && (
                    <div
                      className={`rounded-2xl border px-4 py-3 text-xs uppercase tracking-[0.16em] ${
                        controlMessage.tone === "success"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : controlMessage.tone === "warning"
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                            : "border-red-500/40 bg-red-500/10 text-red-300"
                      }`}
                    >
                      {controlMessage.text}
                    </div>
                  )}

                  <div className="flex gap-4">
                    <button
                      onClick={handleGlobalKillSwitch}
                      disabled={killSwitchInFlight}
                      className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-7 py-3 text-xs font-bold uppercase tracking-[0.2em] text-red-400 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {killSwitchInFlight && <Loader2 size={14} className="animate-spin" />}
                      Global Kill Switch
                    </button>
                    <button
                      onClick={handleLaunchMainAgent}
                      disabled={
                        launchInFlight || !intent.trim() || signatureApprovals < requiredSignatures
                      }
                      className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-xs font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {launchInFlight && <Loader2 size={14} className="animate-spin" />}
                      {agentRunResult?.status === "needs_confirmation" &&
                      agentRunPromptSnapshot === intent.trim()
                        ? "Confirm Send Direction To Main Agent"
                        : "Send Direction To Main Agent"}
                    </button>
                  </div>
                </div>
              </div>
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
      <NotificationStack />
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
