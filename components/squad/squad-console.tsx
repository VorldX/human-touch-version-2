"use client";

import { type ComponentType, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  BadgeInfo,
  Loader2,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Store,
  Users,
  UserCircle2,
  X
} from "lucide-react";

import { parseJsonResponse } from "@/lib/http/json-response";
import {
  earthApprovalModeLabel,
  earthControlLevelFromRole,
  earthProfileRoleFromControlLevel,
  normalizeEarthApprovalMode,
  normalizeEarthControlLevel,
  type EarthApprovalMode,
  type EarthProfileMode,
  type EarthProfileRole,
  useVorldXStore
} from "@/lib/store/vorldx-store";
import {
  ControlCollaborationPanel,
  type CollaborationSurfaceTab
} from "@/components/vorldx-shell/surfaces/control-collaboration-panel";

type PersonnelType = "HUMAN" | "AI";
type PersonnelStatus = "IDLE" | "ACTIVE" | "PAUSED" | "DISABLED" | "RENTED";
type PricingModel = "TOKEN" | "SUBSCRIPTION" | "OUTCOME";
type JoinRequestRole = "EMPLOYEE" | "ADMIN";
type WorkforceConsoleTab = "ROSTER" | "COLLABORATION" | "MARKETPLACE";
type WorkforceMarketplaceTab =
  | "EXPLORE"
  | "EARTH_REGISTRY"
  | "RECRUIT_PATHS"
  | "MARKET_SETTINGS";
type MarketplaceFitFilter = "ALL" | "NEW_TEAM" | "EXISTING_TEAM" | "AUTOMATION_LAYER";
type EarthProfileType = PersonnelType | "MIXED";
type RecruitmentLevel = "L1" | "L2" | "L3" | "L4" | "L5";

interface EarthProfile {
  id: string;
  type: EarthProfileType;
  aiControlLevel: number;
  approvalMode: EarthApprovalMode;
  name: string;
  role: string;
  summary: string;
  skills: string[];
  expertise: string | null;
  autonomyScore: number;
  pricingModel: PricingModel | null;
  salary: string | number | null;
  cost: string | number | null;
  rentRate: string | number | null;
  mode: EarthProfileMode;
  defaultLevel: RecruitmentLevel;
  brainConfig: Record<string, unknown> | null;
  fallbackBrainConfig: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

interface EarthRecruitmentRecord {
  id: string;
  profileId: string;
  profileName: string;
  profileRole: string;
  targetOrgId: string;
  targetOrgName: string;
  level: RecruitmentLevel;
  recruitedAs: PersonnelType;
  sourceMode: EarthProfileMode;
  status: "ACTIVE" | "QUEUED";
  personnelId: string | null;
  createdAt: number;
}

interface PersonalEarthProfileDescriptor {
  name: string;
  email: string;
  role: EarthProfileRole;
  controlLevel: number;
  mode: EarthProfileMode;
  approvalMode: EarthApprovalMode;
}

interface PersonnelItem {
  id: string;
  type: PersonnelType;
  name: string;
  role: string;
  expertise: string | null;
  autonomyScore: number;
  pricingModel: PricingModel | null;
  status: PersonnelStatus;
  assignedOAuthIds: string[];
  brainConfig: unknown;
  fallbackBrainConfig: unknown;
  rentRate: string | number | null;
  cost: string | number | null;
  salary: string | number | null;
}

interface LinkedAccountItem {
  id: string;
  provider: "GOOGLE" | "LINKEDIN" | "X";
  providerAccountId: string;
  user: {
    id: string;
    username: string;
    email: string;
  };
}

interface CapabilityGrantItem {
  id: string;
  agentId: string;
  linkedAccountId: string;
  scopes: Record<string, unknown>;
  createdAt: string;
}

interface JoinRequestItem {
  id: string;
  orgId: string;
  requesterUserId: string;
  requesterEmail: string;
  requesterName: string | null;
  requestedRole: JoinRequestRole;
  message: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
  decidedByEmail: string | null;
  decisionNote: string | null;
}

interface WorkforceTeam {
  id: string;
  name: string;
  objective: string;
  memberIds: string[];
  createdAt: number;
}

interface MarketplaceListing {
  id: string;
  type: PersonnelType;
  name: string;
  category: string;
  summary: string;
  skills: string[];
  availability: "AVAILABLE" | "LIMITED";
  rateLabel: string;
}

interface MarketplaceListingWithFit extends MarketplaceListing {
  teamFit: {
    key: Exclude<MarketplaceFitFilter, "ALL">;
    label: string;
    detail: string;
  };
}

interface SquadConsoleProps {
  orgId: string | null;
  personalEarthProfile: PersonalEarthProfileDescriptor;
  onPersonalEarthModeChange: (mode: EarthProfileMode) => void;
  launchIntent?: {
    action: "ADD_MEMBER" | "CREATE_TEAM";
    nonce: number;
  } | null;
  onLaunchIntentHandled?: () => void;
  themeStyle: {
    accent: string;
    accentSoft: string;
    border: string;
  };
}

interface RecruitFormState {
  type: PersonnelType;
  name: string;
  role: string;
  expertise: string;
  autonomyScore: string;
  pricingModel: "" | PricingModel;
  salary: string;
  cost: string;
  rentRate: string;
  status: PersonnelStatus;
  isRented: boolean;
  brainConfig: string;
  fallbackBrainConfig: string;
  brainKey: string;
  fallbackBrainKey: string;
  capabilityScopes: string;
}

interface EarthProfileDraftState {
  aiControlLevel: string;
  approvalMode: EarthApprovalMode;
  name: string;
  role: string;
  summary: string;
  skills: string;
  expertise: string;
  autonomyScore: string;
  pricingModel: "" | PricingModel;
  salary: string;
  cost: string;
  rentRate: string;
  mode: EarthProfileMode;
  defaultLevel: RecruitmentLevel;
}

const INITIAL_FORM: RecruitFormState = {
  type: "HUMAN",
  name: "",
  role: "",
  expertise: "",
  autonomyScore: "0.5",
  pricingModel: "",
  salary: "",
  cost: "",
  rentRate: "",
  status: "IDLE",
  isRented: false,
  brainConfig: "{}",
  fallbackBrainConfig: "{}",
  brainKey: "",
  fallbackBrainKey: "",
  capabilityScopes: "{\"read\": true}"
};

const INITIAL_EARTH_PROFILE_FORM: EarthProfileDraftState = {
  aiControlLevel: "0",
  approvalMode: "HUMAN_ONLY",
  name: "",
  role: "",
  summary: "",
  skills: "",
  expertise: "",
  autonomyScore: "0.55",
  pricingModel: "",
  salary: "",
  cost: "",
  rentRate: "",
  mode: "LIVE",
  defaultLevel: "L2"
};

const PERSONAL_EARTH_PROFILE_ID = "earth-personal-profile";
const EARTH_PROFILE_STORAGE_KEY = "vx-earth-workforce-profiles";
const EARTH_RECRUITMENT_STORAGE_KEY = "vx-earth-workforce-recruitments";
const EARTH_RECRUIT_LEVELS: Array<{
  id: RecruitmentLevel;
  label: string;
  detail: string;
}> = [
  { id: "L1", label: "Level 1", detail: "Foundation" },
  { id: "L2", label: "Level 2", detail: "Specialist" },
  { id: "L3", label: "Level 3", detail: "Lead" },
  { id: "L4", label: "Level 4", detail: "Director" },
  { id: "L5", label: "Level 5", detail: "Executive" }
];
const EARTH_PROFILE_MODES: Array<{
  id: EarthProfileMode;
  label: string;
  detail: string;
}> = [
  {
    id: "OFFLINE",
    label: "Offline",
    detail: "Stays out of the workspace and cannot be hired into organizations."
  },
  {
    id: "LIVE",
    label: "Live",
    detail: "Visible and hireable, but stays focused on a single active organization."
  },
  {
    id: "MIXED",
    label: "Mixed",
    detail: "Can stay active in one organization and still be hired into more."
  }
];
const SEEDED_EARTH_PROFILES: EarthProfile[] = [
  {
    id: "earth-human-builder",
    type: "HUMAN",
    aiControlLevel: 20,
    approvalMode: "HUMAN_ONLY",
    name: "Earth Builder",
    role: "Program Builder",
    summary: "Owns rollout planning, delivery sequencing, and handoff quality across live teams.",
    skills: ["Execution design", "Cross-team handoff", "Rollout review"],
    expertise: "Execution systems",
    autonomyScore: 0.62,
    pricingModel: "SUBSCRIPTION",
    salary: "7200",
    cost: "0",
    rentRate: "1800",
    mode: "LIVE",
    defaultLevel: "L3",
    brainConfig: null,
    fallbackBrainConfig: null,
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: "earth-ai-orchestrator",
    type: "AI",
    aiControlLevel: 100,
    approvalMode: "AI_REQUESTS_HUMAN",
    name: "Earth Orchestrator",
    role: "Workflow Agent",
    summary: "Coordinates tasks, routing, and execution traces for organization workstreams.",
    skills: ["Workflow orchestration", "Task routing", "Trace synthesis"],
    expertise: "Automation",
    autonomyScore: 0.78,
    pricingModel: "TOKEN",
    salary: "0",
    cost: "0.004",
    rentRate: "0.012",
    mode: "LIVE",
    defaultLevel: "L2",
    brainConfig: {
      source: "earth",
      style: "operator",
      specialty: "orchestration"
    },
    fallbackBrainConfig: {
      source: "earth",
      style: "fallback",
      specialty: "workflow"
    },
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: "earth-mixed-relationship",
    type: "MIXED",
    aiControlLevel: 50,
    approvalMode: "HUMAN_ONLY",
    name: "Earth Relationship Node",
    role: "Growth + Operator",
    summary: "Blends human judgment and AI follow-through for sales, growth loops, and response systems.",
    skills: ["Growth loops", "Outbound systems", "Follow-up automation"],
    expertise: "Growth operations",
    autonomyScore: 0.69,
    pricingModel: "OUTCOME",
    salary: "3400",
    cost: "0.003",
    rentRate: "950",
    mode: "MIXED",
    defaultLevel: "L3",
    brainConfig: {
      source: "earth",
      style: "hybrid",
      specialty: "growth"
    },
    fallbackBrainConfig: {
      source: "earth",
      style: "fallback",
      specialty: "support"
    },
    createdAt: 0,
    updatedAt: 0
  },
  {
    id: "earth-human-governance",
    type: "HUMAN",
    aiControlLevel: 0,
    approvalMode: "HUMAN_ONLY",
    name: "Earth Governance Lead",
    role: "Governance Lead",
    summary: "Keeps controls, documentation, and reviews aligned when organizations need structure.",
    skills: ["Controls", "Review cadence", "Policy mapping"],
    expertise: "Governance",
    autonomyScore: 0.51,
    pricingModel: "SUBSCRIPTION",
    salary: "6800",
    cost: "0",
    rentRate: "1500",
    mode: "OFFLINE",
    defaultLevel: "L4",
    brainConfig: null,
    fallbackBrainConfig: null,
    createdAt: 0,
    updatedAt: 0
  }
];

const MARKETPLACE_LISTINGS: MarketplaceListing[] = [
  {
    id: "mk-human-growth-01",
    type: "HUMAN",
    name: "Growth Ops Specialist",
    category: "Growth",
    summary: "Builds funnel instrumentation, campaign loops, and conversion reviews.",
    skills: ["Funnel Analytics", "Lifecycle", "Experiment Design"],
    availability: "AVAILABLE",
    rateLabel: "$42/hr"
  },
  {
    id: "mk-human-legal-01",
    type: "HUMAN",
    name: "Compliance Coordinator",
    category: "Governance",
    summary: "Supports policy review, document controls, and audit readiness.",
    skills: ["Policy Mapping", "Audit Pack", "Controls"],
    availability: "LIMITED",
    rateLabel: "$58/hr"
  },
  {
    id: "mk-ai-research-01",
    type: "AI",
    name: "Agent: Insight Miner",
    category: "Research",
    summary: "Scans source material and produces concise decision-ready findings.",
    skills: ["Research Synthesis", "Source Mapping", "Briefing"],
    availability: "AVAILABLE",
    rateLabel: "0.003 token/sec"
  },
  {
    id: "mk-ai-ops-01",
    type: "AI",
    name: "Agent: Workflow Orchestrator",
    category: "Execution",
    summary: "Breaks objective into tasks and tracks dependencies across teams.",
    skills: ["Task Decomposition", "Dependency Graph", "Runtime Routing"],
    availability: "AVAILABLE",
    rateLabel: "0.005 token/sec"
  }
];

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseJsonObject(
  raw: string,
  label: string
): { ok: true; value: Record<string, unknown> | undefined } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> };
    }
    return {
      ok: false,
      message: `${label} must be a JSON object.`
    };
  } catch (error) {
    return {
      ok: false,
      message: `${label} JSON is invalid: ${error instanceof Error ? error.message : "parse error"}`
    };
  }
}

function shortProvider(provider: LinkedAccountItem["provider"]) {
  if (provider === "GOOGLE") return "GO";
  if (provider === "LINKEDIN") return "LI";
  return "X";
}

function squadEmail(member: PersonnelItem) {
  const slug = member.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return `${slug || `member-${member.id.slice(-6)}`}@squad.local`;
}

function squadPresenceColor(member: PersonnelItem) {
  if (member.type === "AI") {
    return member.status === "ACTIVE" ? "bg-cyan-500" : "bg-slate-500";
  }
  return member.status === "ACTIVE" ? "bg-emerald-500" : "bg-slate-500";
}

function getMarketplaceTeamFit(listing: MarketplaceListing): MarketplaceListingWithFit["teamFit"] {
  if (listing.type === "AI") {
    return {
      key: "AUTOMATION_LAYER",
      label: "Automation layer",
      detail: "Best for orchestration, delegation, and always-on execution."
    };
  }

  if (listing.category === "Governance") {
    return {
      key: "EXISTING_TEAM",
      label: "Existing team",
      detail: "Fits operations-heavy teams that need process and review support."
    };
  }

  if (listing.category === "Growth") {
    return {
      key: "EXISTING_TEAM",
      label: "Existing team",
      detail: "Strong fit for growth pods that need a specialist embedded fast."
    };
  }

  return {
    key: "NEW_TEAM",
    label: "New pod",
    detail: "Good seed for a fresh team that needs a focused individual owner."
  };
}

function earthLevelLabel(level: RecruitmentLevel) {
  return EARTH_RECRUIT_LEVELS.find((item) => item.id === level)?.label ?? level;
}

function earthLevelDetail(level: RecruitmentLevel) {
  return EARTH_RECRUIT_LEVELS.find((item) => item.id === level)?.detail ?? "";
}

function earthModeMeta(mode: EarthProfileMode) {
  return EARTH_PROFILE_MODES.find((item) => item.id === mode) ?? EARTH_PROFILE_MODES[1];
}

function earthProfileModeBadgeClass(mode: EarthProfileMode) {
  if (mode === "OFFLINE") {
    return "border-white/15 bg-white/5 text-slate-400";
  }
  if (mode === "MIXED") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-200";
  }
  return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
}

function earthProfileTypeBadgeClass(type: EarthProfileType) {
  if (type === "MIXED") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-200";
  }
  if (type === "AI") {
    return "border-cyan-500/35 bg-cyan-500/10 text-cyan-200";
  }
  return "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";
}

function earthProfileTypeFromControlLevel(controlLevel: number): EarthProfileType {
  const role = earthProfileRoleFromControlLevel(controlLevel);
  if (role === "AI") {
    return "AI";
  }
  if (role === "Mixed") {
    return "MIXED";
  }
  return "HUMAN";
}

function earthControlLevelFromType(type: EarthProfileType) {
  if (type === "AI") {
    return 100;
  }
  if (type === "MIXED") {
    return 50;
  }
  return 0;
}

function earthControlLevelLabel(controlLevel: number) {
  const normalized = normalizeEarthControlLevel(controlLevel);
  return `${100 - normalized}% human | ${normalized}% AI`;
}

function hydrateEarthProfile(profile: EarthProfile) {
  const aiControlLevel = normalizeEarthControlLevel(
    profile.aiControlLevel ?? earthControlLevelFromRole(
      profile.type === "AI" ? "AI" : profile.type === "MIXED" ? "Mixed" : "Human"
    )
  );
  const type = earthProfileTypeFromControlLevel(aiControlLevel);
  const approvalMode = normalizeEarthApprovalMode(profile.approvalMode, aiControlLevel);

  return {
    ...profile,
    type,
    aiControlLevel,
    approvalMode
  };
}

function canRecruitEarthProfile(profile: EarthProfile, recruitments: EarthRecruitmentRecord[]) {
  if (profile.mode === "OFFLINE") {
    return false;
  }
  if (profile.mode === "MIXED") {
    return true;
  }
  return recruitments.length === 0;
}

function buildPersonalEarthProfile(
  profile: PersonalEarthProfileDescriptor
): EarthProfile {
  const aiControlLevel = normalizeEarthControlLevel(profile.controlLevel);
  const type = earthProfileTypeFromControlLevel(aiControlLevel);
  const displayName = profile.name.trim() || "Earth Profile";
  const emailLabel = profile.email.trim();
  const approvalMode = normalizeEarthApprovalMode(profile.approvalMode, aiControlLevel);

  return {
    id: PERSONAL_EARTH_PROFILE_ID,
    type,
    aiControlLevel,
    approvalMode,
    name: displayName,
    role:
      type === "AI"
        ? "Personal AI Operator"
        : type === "MIXED"
          ? "Personal Hybrid Operator"
          : "Personal Human Operator",
    summary: emailLabel
      ? `Synced Earth fallback profile for ${emailLabel}. ${earthControlLevelLabel(aiControlLevel)}.`
      : "Synced Earth fallback profile for this workspace user.",
    skills: ["Earth profile", "Fallback identity", "Cross-organization recruiting"],
    expertise: "Personal workspace identity",
    autonomyScore: type === "AI" ? 0.82 : type === "MIXED" ? 0.68 : 0.45,
    pricingModel: null,
    salary: null,
    cost: null,
    rentRate: null,
    mode: profile.mode,
    defaultLevel: type === "MIXED" ? "L3" : type === "AI" ? "L2" : "L1",
    brainConfig:
      type === "AI" || type === "MIXED"
        ? {
            source: "earth-personal-profile",
            role: type,
            aiControlLevel,
            approvalMode
          }
        : null,
    fallbackBrainConfig:
      type === "AI" || type === "MIXED"
        ? {
            source: "earth-personal-profile-fallback",
            role: type,
            aiControlLevel,
            approvalMode
          }
        : null,
    createdAt: 0,
    updatedAt: Date.now()
  };
}

function parseEarthProfileList(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as EarthProfile[]).map(hydrateEarthProfile) : null;
  } catch {
    return null;
  }
}

function parseEarthRecruitmentList(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as EarthRecruitmentRecord[]) : null;
  } catch {
    return null;
  }
}

export function SquadConsole({
  orgId,
  personalEarthProfile,
  onPersonalEarthModeChange,
  launchIntent = null,
  onLaunchIntentHandled,
  themeStyle
}: SquadConsoleProps) {
  const notify = useVorldXStore((state) => state.pushNotification);
  const upsertActiveUsers = useVorldXStore((state) => state.upsertActiveUsers);
  const removeActiveUser = useVorldXStore((state) => state.removeActiveUser);
  const orgs = useVorldXStore((state) => state.orgs);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [personnel, setPersonnel] = useState<PersonnelItem[]>([]);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccountItem[]>([]);
  const [capabilityGrants, setCapabilityGrants] = useState<CapabilityGrantItem[]>([]);
  const [capabilityVaultEnabled, setCapabilityVaultEnabled] = useState(false);
  const [canReviewJoinRequests, setCanReviewJoinRequests] = useState(false);
  const [joinRequests, setJoinRequests] = useState<JoinRequestItem[]>([]);
  const [joinRequestsError, setJoinRequestsError] = useState<string | null>(null);
  const [requestRoleDrafts, setRequestRoleDrafts] = useState<
    Record<string, JoinRequestRole>
  >({});
  const [requestNoteDrafts, setRequestNoteDrafts] = useState<Record<string, string>>({});
  const [actingRequestId, setActingRequestId] = useState<string | null>(null);
  const [showRecruitModal, setShowRecruitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedOAuthIds, setSelectedOAuthIds] = useState<string[]>([]);
  const [form, setForm] = useState<RecruitFormState>(INITIAL_FORM);
  const [consoleTab, setConsoleTab] = useState<WorkforceConsoleTab>("ROSTER");
  const [collaborationSurfaceTab, setCollaborationSurfaceTab] =
    useState<CollaborationSurfaceTab>("OVERVIEW");
  const [teams, setTeams] = useState<WorkforceTeam[]>([]);
  const [teamNameDraft, setTeamNameDraft] = useState("");
  const [teamObjectiveDraft, setTeamObjectiveDraft] = useState("");
  const [teamMemberDraftIds, setTeamMemberDraftIds] = useState<string[]>([]);
  const [marketplaceTab, setMarketplaceTab] = useState<WorkforceMarketplaceTab>("EXPLORE");
  const [marketplaceQuery, setMarketplaceQuery] = useState("");
  const [marketplaceTypeFilter, setMarketplaceTypeFilter] = useState<"ALL" | PersonnelType>("ALL");
  const [marketplaceCategoryFilter, setMarketplaceCategoryFilter] = useState("ALL");
  const [marketplaceSkillFilter, setMarketplaceSkillFilter] = useState("ALL");
  const [marketplaceFitFilter, setMarketplaceFitFilter] = useState<MarketplaceFitFilter>("ALL");
  const [marketplaceTeamChoice, setMarketplaceTeamChoice] = useState<Record<string, string>>({});
  const [earthProfiles, setEarthProfiles] = useState<EarthProfile[]>([]);
  const [earthRecruitments, setEarthRecruitments] = useState<EarthRecruitmentRecord[]>([]);
  const [earthQuery, setEarthQuery] = useState("");
  const [earthTypeFilter, setEarthTypeFilter] = useState<"ALL" | EarthProfileType>("ALL");
  const [earthModeFilter, setEarthModeFilter] = useState<"ALL" | EarthProfileMode>("ALL");
  const [showEarthProfileModal, setShowEarthProfileModal] = useState(false);
  const [earthProfileDraft, setEarthProfileDraft] = useState<EarthProfileDraftState>(
    INITIAL_EARTH_PROFILE_FORM
  );
  const [earthTargetOrgDrafts, setEarthTargetOrgDrafts] = useState<Record<string, string>>({});
  const [earthLevelDrafts, setEarthLevelDrafts] = useState<Record<string, RecruitmentLevel>>({});
  const [earthRecruitTypeDrafts, setEarthRecruitTypeDrafts] = useState<
    Record<string, PersonnelType>
  >({});
  const [earthRecruitingId, setEarthRecruitingId] = useState<string | null>(null);
  const [marketplaceSettingsDraft, setMarketplaceSettingsDraft] = useState({
    llmRouting: "Balanced",
    agentMarketMode: "Human-first with AI assist",
    discoveryBias: "Team fit",
    pricingFloor: "0.002"
  });
  const isEarthWorkspace = !orgId;
  const currentOrgContext = useMemo(
    () => (orgId ? orgs.find((item) => item.id === orgId) ?? null : null),
    [orgId, orgs]
  );
  const isAiRecruit = form.type === "AI";
  const earthProfileDraftControlLevel = normalizeEarthControlLevel(earthProfileDraft.aiControlLevel);
  const earthProfileDraftType = earthProfileTypeFromControlLevel(earthProfileDraftControlLevel);
  const earthProfileDraftApprovalMode = normalizeEarthApprovalMode(
    earthProfileDraft.approvalMode,
    earthProfileDraftControlLevel
  );

  useEffect(() => {
    if (!launchIntent || isEarthWorkspace) {
      return;
    }

    if (launchIntent.action === "ADD_MEMBER") {
      setConsoleTab("ROSTER");
      setShowRecruitModal(true);
    } else {
      setConsoleTab("COLLABORATION");
      setShowRecruitModal(false);
    }

    onLaunchIntentHandled?.();
  }, [isEarthWorkspace, launchIntent, onLaunchIntentHandled]);

  const loadSquad = useCallback(
    async (silent?: boolean) => {
      if (!orgId) {
        const existingUsers = useVorldXStore.getState().activeUsers;
        for (const existing of existingUsers) {
          if (existing.source === "squad") {
            removeActiveUser(existing.id);
          }
        }
        setError(null);
        setPersonnel([]);
        setLinkedAccounts([]);
        setCapabilityGrants([]);
        setCapabilityVaultEnabled(false);
        setCanReviewJoinRequests(false);
        setJoinRequests([]);
        setJoinRequestsError(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const [personnelResponse, joinRequestsResponse] = await Promise.all([
          fetch(`/api/squad/personnel?orgId=${encodeURIComponent(orgId)}`, {
            cache: "no-store"
          }),
          fetch(
            `/api/squad/join-requests?orgId=${encodeURIComponent(orgId)}&status=PENDING`,
            { cache: "no-store" }
          )
        ]);

        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          personnel?: PersonnelItem[];
          linkedAccounts?: LinkedAccountItem[];
          capabilityGrants?: CapabilityGrantItem[];
          capabilityVaultEnabled?: boolean;
        }>(personnelResponse);
        const { payload: joinRequestsPayload, rawText: joinRequestsRawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          requests?: JoinRequestItem[];
        }>(joinRequestsResponse);

        if (!personnelResponse.ok || !payload?.ok) {
          setError(
            payload?.message ??
              (rawText
                ? `Failed to load squad (${personnelResponse.status}): ${rawText.slice(0, 180)}`
                : "Failed to load squad.")
          );
          return;
        }

        setError(null);
        const nextPersonnel = payload.personnel ?? [];
        setPersonnel(nextPersonnel);
        setLinkedAccounts(payload.linkedAccounts ?? []);
        setCapabilityGrants(payload.capabilityGrants ?? []);
        setCapabilityVaultEnabled(Boolean(payload.capabilityVaultEnabled));
        const squadUsers = nextPersonnel.map((member) => ({
          id: `squad-${member.id}`,
          name: member.name,
          email: squadEmail(member),
          role: member.role,
          kind: member.type,
          color: squadPresenceColor(member),
          online: member.status === "ACTIVE",
          source: "squad" as const
        }));
        const nextSquadIds = new Set(squadUsers.map((member) => member.id));
        const existingUsers = useVorldXStore.getState().activeUsers;
        for (const existing of existingUsers) {
          if (existing.source === "squad" && !nextSquadIds.has(existing.id)) {
            removeActiveUser(existing.id);
          }
        }
        upsertActiveUsers(squadUsers);

        if (joinRequestsResponse.status === 403) {
          setCanReviewJoinRequests(false);
          setJoinRequests([]);
          setJoinRequestsError(null);
        } else if (!joinRequestsResponse.ok || !joinRequestsPayload?.ok) {
          setCanReviewJoinRequests(false);
          setJoinRequests([]);
          setJoinRequestsError(
            joinRequestsPayload?.message ??
              (joinRequestsRawText
                ? `Failed to load join requests (${joinRequestsResponse.status}): ${joinRequestsRawText.slice(0, 180)}`
                : "Failed to load join requests.")
          );
        } else {
          const items = joinRequestsPayload.requests ?? [];
          setCanReviewJoinRequests(true);
          setJoinRequests(items);
          setJoinRequestsError(null);
          setRequestRoleDrafts(
            Object.fromEntries(items.map((item) => [item.id, item.requestedRole]))
          );
          setRequestNoteDrafts((prev) => {
            const next: Record<string, string> = {};
            for (const item of items) {
              if (typeof prev[item.id] === "string") {
                next[item.id] = prev[item.id];
              }
            }
            return next;
          });
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to load squad.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orgId, removeActiveUser, upsertActiveUsers]
  );

  useEffect(() => {
    void loadSquad();
    const interval = setInterval(() => void loadSquad(true), 10000);
    return () => clearInterval(interval);
  }, [loadSquad]);

  useEffect(() => {
    if (form.type === "HUMAN") {
      setSelectedOAuthIds([]);
    }
  }, [form.type]);

  useEffect(() => {
    if (!isEarthWorkspace && marketplaceTab === "EARTH_REGISTRY") {
      setMarketplaceTab("EXPLORE");
    }
  }, [isEarthWorkspace, marketplaceTab]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedProfiles = parseEarthProfileList(
      window.localStorage.getItem(EARTH_PROFILE_STORAGE_KEY)
    );
    const storedRecruitments = parseEarthRecruitmentList(
      window.localStorage.getItem(EARTH_RECRUITMENT_STORAGE_KEY)
    );
    const now = Date.now();

    setEarthProfiles(
      (storedProfiles ?? SEEDED_EARTH_PROFILES).map((profile, index) => ({
        ...hydrateEarthProfile(profile),
        createdAt:
          typeof profile.createdAt === "number" && Number.isFinite(profile.createdAt)
            ? profile.createdAt
            : now - index * 1000,
        updatedAt:
          typeof profile.updatedAt === "number" && Number.isFinite(profile.updatedAt)
            ? profile.updatedAt
            : now - index * 1000
      }))
    );
    setEarthRecruitments(storedRecruitments ?? []);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || earthProfiles.length === 0) {
      return;
    }
    window.localStorage.setItem(EARTH_PROFILE_STORAGE_KEY, JSON.stringify(earthProfiles));
  }, [earthProfiles]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      EARTH_RECRUITMENT_STORAGE_KEY,
      JSON.stringify(earthRecruitments)
    );
  }, [earthRecruitments]);

  const syncedPersonalEarthProfile = useMemo(
    () => buildPersonalEarthProfile(personalEarthProfile),
    [personalEarthProfile]
  );
  const allEarthProfiles = useMemo(
    () => [
      syncedPersonalEarthProfile,
      ...earthProfiles.filter((profile) => profile.id !== PERSONAL_EARTH_PROFILE_ID)
    ],
    [earthProfiles, syncedPersonalEarthProfile]
  );

  const humans = useMemo(
    () => personnel.filter((member) => member.type === "HUMAN"),
    [personnel]
  );
  const aiAgents = useMemo(() => personnel.filter((member) => member.type === "AI"), [personnel]);

  const grantCountByAgent = useMemo(() => {
    const map = new Map<string, number>();
    capabilityGrants.forEach((grant) => {
      map.set(grant.agentId, (map.get(grant.agentId) ?? 0) + 1);
    });
    return map;
  }, [capabilityGrants]);

  const accountLabelById = useMemo(() => {
    const map = new Map<string, string>();
    linkedAccounts.forEach((account) => {
      map.set(
        account.id,
        `${shortProvider(account.provider)}:${account.user.username || account.user.email}`
      );
    });
    return map;
  }, [linkedAccounts]);

  const memberLabelById = useMemo(() => {
    const map = new Map<string, string>();
    personnel.forEach((member) => {
      map.set(member.id, `${member.name} (${member.type})`);
    });
    allEarthProfiles.forEach((profile) => {
      map.set(`earth:${profile.id}`, `${profile.name} (${profile.type})`);
    });
    MARKETPLACE_LISTINGS.forEach((listing) => {
      map.set(`market:${listing.id}`, `${listing.name} (${listing.type})`);
    });
    return map;
  }, [allEarthProfiles, personnel]);

  const earthRecruitmentsByProfile = useMemo(() => {
    const map = new Map<string, EarthRecruitmentRecord[]>();
    earthRecruitments.forEach((record) => {
      const items = map.get(record.profileId) ?? [];
      items.push(record);
      map.set(record.profileId, items);
    });
    return map;
  }, [earthRecruitments]);

  const filteredEarthProfiles = useMemo(() => {
    const normalizedQuery = earthQuery.trim().toLowerCase();
    return allEarthProfiles.filter((profile) => {
      if (earthTypeFilter !== "ALL" && profile.type !== earthTypeFilter) {
        return false;
      }
      if (earthModeFilter !== "ALL" && profile.mode !== earthModeFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const target = [
        profile.name,
        profile.role,
        profile.type,
        profile.summary,
        profile.expertise ?? "",
        profile.skills.join(" "),
        earthControlLevelLabel(profile.aiControlLevel),
        earthApprovalModeLabel(profile.approvalMode),
        earthModeMeta(profile.mode).label,
        earthLevelLabel(profile.defaultLevel),
        earthLevelDetail(profile.defaultLevel)
      ]
        .join(" ")
        .toLowerCase();
      return target.includes(normalizedQuery);
    });
  }, [allEarthProfiles, earthModeFilter, earthQuery, earthTypeFilter]);

  const earthRecruitableCount = useMemo(
    () =>
      allEarthProfiles.filter((profile) =>
        canRecruitEarthProfile(profile, earthRecruitmentsByProfile.get(profile.id) ?? [])
      ).length,
    [allEarthProfiles, earthRecruitmentsByProfile]
  );

  const earthVisibleRecruitments = useMemo(
    () =>
      (orgId
        ? earthRecruitments.filter((record) => record.targetOrgId === orgId)
        : earthRecruitments
      ).sort((left, right) => right.createdAt - left.createdAt),
    [earthRecruitments, orgId]
  );

  const earthLevelMonitor = useMemo(
    () =>
      EARTH_RECRUIT_LEVELS.map((level) => ({
        ...level,
        count: earthVisibleRecruitments.filter((record) => record.level === level.id).length
      })),
    [earthVisibleRecruitments]
  );

  const earthActiveOrgCount = useMemo(
    () => new Set(earthRecruitments.map((record) => record.targetOrgId)).size,
    [earthRecruitments]
  );

  const marketplaceListingsWithFit = useMemo<MarketplaceListingWithFit[]>(
    () =>
      MARKETPLACE_LISTINGS.map((listing) => ({
        ...listing,
        teamFit: getMarketplaceTeamFit(listing)
      })),
    []
  );

  const marketplaceCategories = useMemo(
    () => ["ALL", ...new Set(marketplaceListingsWithFit.map((listing) => listing.category))],
    [marketplaceListingsWithFit]
  );

  const marketplaceSkills = useMemo(
    () => ["ALL", ...new Set(marketplaceListingsWithFit.flatMap((listing) => listing.skills))],
    [marketplaceListingsWithFit]
  );

  const filteredMarketplaceListings = useMemo(() => {
    const normalizedQuery = marketplaceQuery.trim().toLowerCase();
    return marketplaceListingsWithFit.filter((listing) => {
      if (marketplaceTypeFilter !== "ALL" && listing.type !== marketplaceTypeFilter) {
        return false;
      }
      if (marketplaceCategoryFilter !== "ALL" && listing.category !== marketplaceCategoryFilter) {
        return false;
      }
      if (marketplaceSkillFilter !== "ALL" && !listing.skills.includes(marketplaceSkillFilter)) {
        return false;
      }
      if (marketplaceFitFilter !== "ALL" && listing.teamFit.key !== marketplaceFitFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const target = `${listing.name} ${listing.category} ${listing.summary} ${listing.skills.join(" ")} ${listing.teamFit.label} ${listing.teamFit.detail}`.toLowerCase();
      return target.includes(normalizedQuery);
    });
  }, [
    marketplaceCategoryFilter,
    marketplaceFitFilter,
    marketplaceListingsWithFit,
    marketplaceQuery,
    marketplaceSkillFilter,
    marketplaceTypeFilter
  ]);

  const marketplaceTabs = useMemo(
    () =>
      isEarthWorkspace
        ? ([
            { id: "EXPLORE", label: "Explore", icon: Search },
            { id: "EARTH_REGISTRY", label: "Earth Registry", icon: Users },
            { id: "RECRUIT_PATHS", label: "Recruit Paths", icon: Sparkles },
            { id: "MARKET_SETTINGS", label: "Market Settings", icon: Settings2 }
          ] as Array<{
            id: WorkforceMarketplaceTab;
            label: string;
            icon: ComponentType<{ size?: number | string; className?: string }>;
          }>)
        : ([
            { id: "EXPLORE", label: "Explore", icon: Search },
            { id: "RECRUIT_PATHS", label: "Recruit Paths", icon: Sparkles },
            { id: "MARKET_SETTINGS", label: "Market Settings", icon: Settings2 }
          ] as Array<{
            id: WorkforceMarketplaceTab;
            label: string;
            icon: ComponentType<{ size?: number | string; className?: string }>;
          }>),
    [isEarthWorkspace]
  );

  const marketplaceFilterCount = [
    marketplaceQuery,
    marketplaceTypeFilter !== "ALL",
    marketplaceCategoryFilter !== "ALL",
    marketplaceSkillFilter !== "ALL",
    marketplaceFitFilter !== "ALL"
  ].filter(Boolean).length;

  const clearMarketplaceFilters = useCallback(() => {
    setMarketplaceQuery("");
    setMarketplaceTypeFilter("ALL");
    setMarketplaceCategoryFilter("ALL");
    setMarketplaceSkillFilter("ALL");
    setMarketplaceFitFilter("ALL");
  }, []);

  const resetEarthProfileDraft = useCallback(() => {
    setEarthProfileDraft(INITIAL_EARTH_PROFILE_FORM);
  }, []);

  const openRecruitModalForType = useCallback(
    (type: PersonnelType) => {
      if (isEarthWorkspace) {
        setMarketplaceTab("EARTH_REGISTRY");
        setShowEarthProfileModal(true);
        setEarthProfileDraft({
          ...INITIAL_EARTH_PROFILE_FORM,
          aiControlLevel: String(earthControlLevelFromType(type)),
          approvalMode: type === "AI" ? "AI_REQUESTS_HUMAN" : "HUMAN_ONLY",
          mode: "LIVE"
        });
        notify({
          title: "Earth Profile",
          message: `${type} Earth profile draft opened.`,
          type: "info"
        });
        return;
      }
      setConsoleTab("MARKETPLACE");
      setMarketplaceTab("RECRUIT_PATHS");
      setShowRecruitModal(true);
      setForm({
        ...INITIAL_FORM,
        type,
        status: "IDLE"
      });
      setSelectedOAuthIds([]);
      notify({
        title: "Recruitment Path",
        message: `${type} recruit flow opened.`,
        type: "info"
      });
    },
    [isEarthWorkspace, notify]
  );

  const toggleTeamMemberDraft = useCallback((memberId: string) => {
    setTeamMemberDraftIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  }, []);

  const resetTeamDraft = useCallback(() => {
    setTeamNameDraft("");
    setTeamObjectiveDraft("");
    setTeamMemberDraftIds([]);
  }, []);

  const handleCreateTeam = useCallback(() => {
    const cleanName = teamNameDraft.trim();
    if (!cleanName) {
      notify({
        title: "Team Setup",
        message: "Team name is required.",
        type: "warning"
      });
      return;
    }
    if (teamMemberDraftIds.length === 0) {
      notify({
        title: "Team Setup",
        message: "Select at least one workforce member.",
        type: "warning"
      });
      return;
    }

    setTeams((prev) => [
      {
        id: `team-${crypto.randomUUID()}`,
        name: cleanName,
        objective: teamObjectiveDraft.trim(),
        memberIds: teamMemberDraftIds,
        createdAt: Date.now()
      },
      ...prev
    ]);
    notify({
      title: "Team Created",
      message: `${cleanName} added to workforce collaboration.`,
      type: "success"
    });
    resetTeamDraft();
  }, [notify, resetTeamDraft, teamMemberDraftIds, teamNameDraft, teamObjectiveDraft]);

  const handleRemoveTeam = useCallback((teamId: string) => {
    setTeams((prev) => prev.filter((team) => team.id !== teamId));
  }, []);

  const handlePrefillRecruitFromMarketplace = useCallback(
    (listing: MarketplaceListingWithFit) => {
      if (isEarthWorkspace) {
        setShowEarthProfileModal(true);
        setMarketplaceTab("EARTH_REGISTRY");
        setEarthProfileDraft({
          ...INITIAL_EARTH_PROFILE_FORM,
          aiControlLevel: String(earthControlLevelFromType(listing.type)),
          approvalMode: listing.type === "AI" ? "AI_REQUESTS_HUMAN" : "HUMAN_ONLY",
          name: listing.name,
          role: listing.category,
          summary: listing.summary,
          skills: listing.skills.join(", "),
          expertise: listing.skills.join(", "),
          autonomyScore: listing.type === "AI" ? "0.7" : "0.5",
          mode: listing.type === "AI" ? "LIVE" : "MIXED"
        });
        notify({
          title: "Earth Profile Prefill",
          message: `${listing.name} loaded into Earth profile creation.`,
          type: "info"
        });
        return;
      }
      setShowRecruitModal(true);
      setForm({
        ...INITIAL_FORM,
        type: listing.type,
        name: listing.name,
        role: listing.category,
        expertise: listing.skills.join(", "),
        autonomyScore: listing.type === "AI" ? "0.7" : "0.5",
        status: "IDLE"
      });
      setSelectedOAuthIds([]);
      setConsoleTab("ROSTER");
      setMarketplaceTab("EXPLORE");
      notify({
        title: "Recruitment Prefill",
        message: `${listing.name} loaded into recruitment form with ${listing.teamFit.label.toLowerCase()} guidance.`,
        type: "info"
      });
    },
    [isEarthWorkspace, notify]
  );

  const handleAddMarketplaceListingToTeam = useCallback(
    (listing: MarketplaceListingWithFit) => {
      const selectedTarget = marketplaceTeamChoice[listing.id] ?? "NEW";
      const marketplaceMemberId = `market:${listing.id}`;

      if (selectedTarget === "NEW") {
        const generatedTeamName = `${listing.category} pod`;
        setTeams((prev) => [
          {
            id: `team-${crypto.randomUUID()}`,
            name: generatedTeamName,
            objective: `Team seeded from marketplace listing ${listing.name}`,
            memberIds: [marketplaceMemberId],
            createdAt: Date.now()
          },
          ...prev
        ]);
        notify({
          title: "Team Seeded",
          message: `${listing.name} added to new team ${generatedTeamName}.`,
          type: "success"
        });
        return;
      }

      setTeams((prev) =>
        prev.map((team) => {
          if (team.id !== selectedTarget) return team;
          if (team.memberIds.includes(marketplaceMemberId)) return team;
          return { ...team, memberIds: [...team.memberIds, marketplaceMemberId] };
        })
      );
      notify({
        title: "Team Updated",
        message: `${listing.name} linked to selected team.`,
        type: "success"
      });
    },
    [marketplaceTeamChoice, notify]
  );

  const toggleOAuthSelection = useCallback((id: string) => {
    setSelectedOAuthIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );
  }, []);

  const resetRecruitState = useCallback(() => {
    setForm(INITIAL_FORM);
    setSelectedOAuthIds([]);
  }, []);

  const handleCreateEarthProfile = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const name = earthProfileDraft.name.trim();
      const role = earthProfileDraft.role.trim();
      const summary = earthProfileDraft.summary.trim();
      if (!name || !role || !summary) {
        notify({
          title: "Earth Profile",
          message: "Name, role, and summary are required.",
          type: "warning"
        });
        return;
      }

      const now = Date.now();
      const aiControlLevel = normalizeEarthControlLevel(earthProfileDraft.aiControlLevel);
      const type = earthProfileTypeFromControlLevel(aiControlLevel);
      const approvalMode = normalizeEarthApprovalMode(
        earthProfileDraft.approvalMode,
        aiControlLevel
      );
      const nextProfile: EarthProfile = {
        id: `earth-profile-${crypto.randomUUID()}`,
        type,
        aiControlLevel,
        approvalMode,
        name,
        role,
        summary,
        skills: earthProfileDraft.skills
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        expertise: earthProfileDraft.expertise.trim() || null,
        autonomyScore: Math.max(
          0,
          Math.min(1, Number.parseFloat(earthProfileDraft.autonomyScore) || 0)
        ),
        pricingModel: earthProfileDraft.pricingModel || null,
        salary: earthProfileDraft.salary.trim() || null,
        cost: earthProfileDraft.cost.trim() || null,
        rentRate: earthProfileDraft.rentRate.trim() || null,
        mode: earthProfileDraft.mode,
        defaultLevel: earthProfileDraft.defaultLevel,
        brainConfig:
          type === "AI" || type === "MIXED"
            ? {
                source: "earth-profile",
                profileMode: earthProfileDraft.mode,
                profileRole: role,
                aiControlLevel,
                approvalMode
              }
            : null,
        fallbackBrainConfig:
          type === "AI" || type === "MIXED"
            ? {
                source: "earth-profile-fallback",
                profileRole: role,
                aiControlLevel,
                approvalMode
              }
            : null,
        createdAt: now,
        updatedAt: now
      };

      setEarthProfiles((prev) => [nextProfile, ...prev]);
      setShowEarthProfileModal(false);
      resetEarthProfileDraft();
      notify({
        title: "Earth Profile",
        message: `${name} added to the Earth workforce registry.`,
        type: "success"
      });
    },
    [earthProfileDraft, notify, resetEarthProfileDraft]
  );

  const handleEarthProfileModeChange = useCallback((profileId: string, mode: EarthProfileMode) => {
    if (profileId === PERSONAL_EARTH_PROFILE_ID) {
      onPersonalEarthModeChange(mode);
      notify({
        title: "Earth Profile",
        message: `Personal Earth mode switched to ${earthModeMeta(mode).label}.`,
        type: "success"
      });
      return;
    }
    setEarthProfiles((prev) =>
      prev.map((profile) =>
        profile.id === profileId
          ? {
              ...profile,
              mode,
              updatedAt: Date.now()
            }
          : profile
      )
    );
  }, [notify, onPersonalEarthModeChange]);

  const handleRecruitEarthProfile = useCallback(
    async (profileId: string) => {
      const profile = allEarthProfiles.find((item) => item.id === profileId);
      if (!profile) {
        return;
      }

      const currentRecruitments = earthRecruitmentsByProfile.get(profile.id) ?? [];
      if (profile.mode === "OFFLINE") {
        notify({
          title: "Earth Recruitment",
          message: `${profile.name} is offline and cannot be hired right now.`,
          type: "warning"
        });
        return;
      }

      const targetOrgId = (earthTargetOrgDrafts[profile.id] ?? orgId ?? orgs[0]?.id ?? "").trim();
      if (!targetOrgId) {
        notify({
          title: "Earth Recruitment",
          message: "Choose a destination organization first.",
          type: "warning"
        });
        return;
      }

      const targetOrg = orgs.find((item) => item.id === targetOrgId);
      if (!targetOrg) {
        notify({
          title: "Earth Recruitment",
          message: "Selected organization is not accessible from this workspace.",
          type: "error"
        });
        return;
      }

      if (currentRecruitments.some((item) => item.targetOrgId === targetOrgId)) {
        notify({
          title: "Earth Recruitment",
          message: `${profile.name} is already deployed in ${targetOrg.name}.`,
          type: "warning"
        });
        return;
      }

      if (profile.mode === "LIVE" && currentRecruitments.length > 0) {
        notify({
          title: "Earth Recruitment",
          message: `${profile.name} is in Live mode. Switch to Mixed to hire into more organizations.`,
          type: "warning"
        });
        return;
      }

      const level = earthLevelDrafts[profile.id] ?? profile.defaultLevel;
      const recruitedAs =
        profile.type === "MIXED"
          ? earthRecruitTypeDrafts[profile.id] ?? "AI"
          : profile.type;

      setEarthRecruitingId(profile.id);
      try {
        const response = await fetch("/api/squad/personnel", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orgId: targetOrg.id,
            type: recruitedAs,
            name: profile.name,
            role: `${profile.role} | ${earthLevelLabel(level)}`,
            expertise: [
              profile.expertise,
              `Earth registry`,
              `Mode: ${earthModeMeta(profile.mode).label}`,
              `Level: ${earthLevelLabel(level)} ${earthLevelDetail(level)}`,
              `Control: ${earthControlLevelLabel(profile.aiControlLevel)}`,
              `Approval: ${earthApprovalModeLabel(profile.approvalMode)}`
            ]
              .filter(Boolean)
              .join(" | "),
            autonomyScore: profile.autonomyScore,
            pricingModel: profile.pricingModel ?? undefined,
            salary:
              typeof profile.salary === "string"
                ? Number.parseFloat(profile.salary) || undefined
                : typeof profile.salary === "number"
                  ? profile.salary
                  : undefined,
            cost:
              typeof profile.cost === "string"
                ? Number.parseFloat(profile.cost) || undefined
                : typeof profile.cost === "number"
                  ? profile.cost
                  : undefined,
            rentRate:
              typeof profile.rentRate === "string"
                ? Number.parseFloat(profile.rentRate) || undefined
                : typeof profile.rentRate === "number"
                  ? profile.rentRate
                  : undefined,
            status: "IDLE",
            isRented: false,
            ...(recruitedAs === "AI"
              ? {
                  brainConfig:
                    profile.brainConfig ?? {
                      source: "earth-registry",
                      earthProfileId: profile.id,
                      summary: profile.summary,
                      aiControlLevel: profile.aiControlLevel,
                      approvalMode: profile.approvalMode,
                      profileType: profile.type
                    },
                  fallbackBrainConfig:
                    profile.fallbackBrainConfig ?? {
                      source: "earth-registry-fallback",
                      earthProfileId: profile.id,
                      aiControlLevel: profile.aiControlLevel,
                      approvalMode: profile.approvalMode,
                      profileType: profile.type
                    }
                }
              : {})
          })
        });

        const { payload: result, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          personnel?: { id: string; name: string; role: string };
        }>(response);

        if (!response.ok || !result?.ok) {
          notify({
            title: "Earth Recruitment",
            message:
              result?.message ??
              (rawText
                ? `Unable to deploy Earth profile (${response.status}): ${rawText.slice(0, 180)}`
                : "Unable to deploy Earth profile."),
            type: "error"
          });
          return;
        }

        setEarthRecruitments((prev) => [
          {
            id: `earth-rec-${crypto.randomUUID()}`,
            profileId: profile.id,
            profileName: profile.name,
            profileRole: profile.role,
            targetOrgId: targetOrg.id,
            targetOrgName: targetOrg.name,
            level,
            recruitedAs,
            sourceMode: profile.mode,
            status: "ACTIVE",
            personnelId: result.personnel?.id ?? null,
            createdAt: Date.now()
          },
          ...prev
        ]);
        notify({
          title: "Earth Recruitment",
          message: `${profile.name} deployed to ${targetOrg.name} at ${earthLevelLabel(level)}.`,
          type: "success"
        });
        if (orgId === targetOrg.id) {
          await loadSquad(true);
        }
      } finally {
        setEarthRecruitingId(null);
      }
    },
    [
      allEarthProfiles,
      earthLevelDrafts,
      earthRecruitmentsByProfile,
      earthRecruitTypeDrafts,
      earthTargetOrgDrafts,
      loadSquad,
      notify,
      orgId,
      orgs
    ]
  );

  const handleRecruit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitting(true);

      const emptyParsed = { ok: true as const, value: undefined as Record<string, unknown> | undefined };
      const brainConfigResult =
        form.type === "AI" ? parseJsonObject(form.brainConfig, "Brain config") : emptyParsed;
      if (!brainConfigResult.ok) {
        notify({
          title: "Recruitment Error",
          message: brainConfigResult.message,
          type: "error"
        });
        setSubmitting(false);
        return;
      }

      const fallbackConfigResult = parseJsonObject(
        form.type === "AI" ? form.fallbackBrainConfig : "",
        "Fallback brain config"
      );
      if (!fallbackConfigResult.ok) {
        notify({
          title: "Recruitment Error",
          message: fallbackConfigResult.message,
          type: "error"
        });
        setSubmitting(false);
        return;
      }

      const scopesResult =
        form.type === "AI" ? parseJsonObject(form.capabilityScopes, "Capability scopes") : emptyParsed;
      if (!scopesResult.ok) {
        notify({
          title: "Recruitment Error",
          message: scopesResult.message,
          type: "error"
        });
        setSubmitting(false);
        return;
      }

      const payload: Record<string, unknown> = {
        orgId,
        type: form.type,
        name: form.name.trim(),
        role: form.role.trim(),
        expertise: form.expertise.trim() || undefined,
        autonomyScore: Number.parseFloat(form.autonomyScore),
        pricingModel: form.pricingModel || undefined,
        salary: form.salary ? Number.parseFloat(form.salary) : undefined,
        cost: form.cost ? Number.parseFloat(form.cost) : undefined,
        rentRate: form.rentRate ? Number.parseFloat(form.rentRate) : undefined,
        status: form.status,
        isRented: form.isRented,
        assignedOAuthIds: selectedOAuthIds
      };

      if (form.type === "AI" && brainConfigResult.value) payload.brainConfig = brainConfigResult.value;
      if (form.type === "AI" && fallbackConfigResult.value) payload.fallbackBrainConfig = fallbackConfigResult.value;
      if (form.type === "AI" && form.brainKey.trim()) payload.brainKey = form.brainKey.trim();
      if (form.type === "AI" && form.fallbackBrainKey.trim()) payload.fallbackBrainKey = form.fallbackBrainKey.trim();

      if (form.type === "AI" && capabilityVaultEnabled && scopesResult.value && selectedOAuthIds.length > 0) {
        payload.capabilityGrants = selectedOAuthIds.map((linkedAccountId) => ({
          linkedAccountId,
          scopes: scopesResult.value
        }));
      }

      try {
        const response = await fetch("/api/squad/personnel", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        const { payload: result, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          personnel?: { id: string; name: string; role: string };
        }>(response);

        if (!response.ok || !result?.ok) {
          notify({
            title: "Recruitment Failed",
            message:
              result?.message ??
              (rawText
                ? `Unable to recruit personnel (${response.status}): ${rawText.slice(0, 180)}`
                : "Unable to recruit personnel."),
            type: "error"
          });
          return;
        }

        notify({
          title: "Personnel Recruited",
          message: `${result.personnel?.name ?? "New member"} added to squad.`,
          type: "success"
        });

        setShowRecruitModal(false);
        resetRecruitState();
        await loadSquad(true);
      } finally {
        setSubmitting(false);
      }
    },
    [
      capabilityVaultEnabled,
      form,
      loadSquad,
      notify,
      orgId,
      resetRecruitState,
      selectedOAuthIds
    ]
  );

  const handleJoinRequestDecision = useCallback(
    async (request: JoinRequestItem, decision: "APPROVE" | "REJECT") => {
      setActingRequestId(request.id);
      try {
        const response = await fetch(`/api/squad/join-requests/${request.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orgId,
            decision,
            role: requestRoleDrafts[request.id] ?? request.requestedRole,
            note: requestNoteDrafts[request.id] ?? ""
          })
        });

        const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
          response
        );
        if (!response.ok || !payload?.ok) {
          notify({
            title: "Join Request",
            message:
              payload?.message ??
              (rawText
                ? `Failed to ${decision === "APPROVE" ? "approve" : "reject"} request (${response.status}): ${rawText.slice(0, 180)}`
                : `Failed to ${decision === "APPROVE" ? "approve" : "reject"} request.`),
            type: "error"
          });
          return;
        }

        notify({
          title: "Join Request",
          message: `Request ${decision === "APPROVE" ? "approved" : "rejected"}.`,
          type: "success"
        });
        await loadSquad(true);
      } catch (requestError) {
        notify({
          title: "Join Request",
          message:
            requestError instanceof Error
              ? requestError.message
              : "Failed to process request.",
          type: "error"
        });
      } finally {
        setActingRequestId(null);
      }
    },
    [loadSquad, notify, orgId, requestNoteDrafts, requestRoleDrafts]
  );

  const renderEarthMonitorPanel = (title: string, description: string) => (
    <div className={`vx-panel space-y-4 rounded-3xl p-4 ${themeStyle.border}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">{title}</p>
          <p className="mt-1 text-xs text-slate-400">{description}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.16em] ${themeStyle.accentSoft}`}
        >
          {earthVisibleRecruitments.length} tracked
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {earthLevelMonitor.map((item) => (
          <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{item.count}</p>
            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{item.detail}</p>
          </div>
        ))}
      </div>

      {earthVisibleRecruitments.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-xs text-slate-500">
          No Earth profile deployments have been tracked in this scope yet.
        </p>
      ) : (
        <div className="space-y-2">
          {earthVisibleRecruitments.slice(0, 8).map((record) => (
            <div key={record.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-100">{record.profileName}</p>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    {record.targetOrgName} | {earthLevelLabel(record.level)} | {record.recruitedAs}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${earthProfileModeBadgeClass(record.sourceMode)}`}
                >
                  {earthModeMeta(record.sourceMode).label}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Recruited {new Date(record.createdAt).toLocaleString()}
                {record.personnelId ? ` | Personnel ${record.personnelId.slice(0, 8)}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderEarthRegistry = () => (
    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <div className={`vx-panel space-y-4 rounded-3xl p-4 ${themeStyle.border}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Store size={15} className="text-cyan-300" />
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                Earth Registry
              </p>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Search Earth profiles, switch their mode, and deploy them into organizations from the
              Earth profile.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowEarthProfileModal(true)}
            className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/15 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100 transition hover:bg-cyan-500/25"
          >
            <PlusCircle size={12} />
            Create Earth Profile
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Earth Profiles" value={String(allEarthProfiles.length)} icon={Users} />
          <MetricCard label="Recruitable" value={String(earthRecruitableCount)} icon={Sparkles} />
          <MetricCard label="Organizations" value={String(earthActiveOrgCount)} icon={Store} />
          <MetricCard
            label="Deployments"
            value={String(earthRecruitments.length)}
            icon={ShieldCheck}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2">
            <Search size={14} className="text-slate-500" />
            <input
              value={earthQuery}
              onChange={(event) => setEarthQuery(event.target.value)}
              placeholder="Search Earth profiles, roles, skills..."
              className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
            />
          </label>
          <select
            value={earthTypeFilter}
            onChange={(event) =>
              setEarthTypeFilter(event.target.value as "ALL" | EarthProfileType)
            }
            className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="ALL">All Types</option>
            <option value="HUMAN">Human</option>
            <option value="AI">AI</option>
            <option value="MIXED">Mixed</option>
          </select>
          <select
            value={earthModeFilter}
            onChange={(event) =>
              setEarthModeFilter(event.target.value as "ALL" | EarthProfileMode)
            }
            className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
          >
            <option value="ALL">All Modes</option>
            {EARTH_PROFILE_MODES.map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>

        {filteredEarthProfiles.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-xs text-slate-500">
            No Earth profiles match the current search or mode filters.
          </p>
        ) : (
          <div className="space-y-3">
            {filteredEarthProfiles.map((profile) => {
              const profileRecruitments = earthRecruitmentsByProfile.get(profile.id) ?? [];
              const isRecruitable = canRecruitEarthProfile(profile, profileRecruitments);
              const targetOrgId = earthTargetOrgDrafts[profile.id] ?? orgId ?? orgs[0]?.id ?? "";
              const level = earthLevelDrafts[profile.id] ?? profile.defaultLevel;
              const recruitAs =
                profile.type === "MIXED"
                  ? earthRecruitTypeDrafts[profile.id] ?? "AI"
                  : profile.type;

              return (
                <article
                  key={profile.id}
                  className="rounded-2xl border border-white/10 bg-black/25 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {profile.id === PERSONAL_EARTH_PROFILE_ID ? (
                          <span className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-cyan-200">
                            Personal
                          </span>
                        ) : null}
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${earthProfileTypeBadgeClass(profile.type)}`}
                        >
                          {profile.type}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${earthProfileModeBadgeClass(profile.mode)}`}
                        >
                          {earthModeMeta(profile.mode).label}
                        </span>
                        <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-300">
                          {earthLevelLabel(profile.defaultLevel)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-100">{profile.name}</p>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        {profile.role}
                      </p>
                      <p className="mt-2 text-xs text-slate-300">{profile.summary}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-300">
                          {earthControlLevelLabel(profile.aiControlLevel)}
                        </span>
                        <span className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-300">
                          {earthApprovalModeLabel(profile.approvalMode)}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-right">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        Deployments
                      </p>
                      <p className="mt-1 text-lg font-semibold text-slate-100">
                        {profileRecruitments.length}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1">
                    {profile.skills.map((skill) => (
                      <span
                        key={`${profile.id}-${skill}`}
                        className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-300"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        Earth mode
                      </p>
                      <p className="text-[11px] text-slate-400">{earthModeMeta(profile.mode).detail}</p>
                    </div>
                    <div className="mt-2 inline-flex flex-wrap rounded-full border border-white/10 bg-black/30 p-1">
                      {EARTH_PROFILE_MODES.map((mode) => (
                        <button
                          key={`${profile.id}-${mode.id}`}
                          type="button"
                          onClick={() => handleEarthProfileModeChange(profile.id, mode.id)}
                          className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition ${
                            profile.mode === mode.id
                              ? "bg-emerald-500/15 text-emerald-200"
                              : "text-slate-300 hover:bg-white/10"
                          }`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                    {profile.id === PERSONAL_EARTH_PROFILE_ID ? (
                      <p className="mt-2 text-[11px] text-slate-400">
                        This card is synced with your Earth profile settings in Hub.
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_160px_auto]">
                    <select
                      value={targetOrgId}
                      onChange={(event) =>
                        setEarthTargetOrgDrafts((prev) => ({
                          ...prev,
                          [profile.id]: event.target.value
                        }))
                      }
                      className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    >
                      <option value="">Choose organization</option>
                      {orgs.map((item) => (
                        <option key={`${profile.id}-${item.id}`} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={level}
                      onChange={(event) =>
                        setEarthLevelDrafts((prev) => ({
                          ...prev,
                          [profile.id]: event.target.value as RecruitmentLevel
                        }))
                      }
                      className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    >
                      {EARTH_RECRUIT_LEVELS.map((item) => (
                        <option key={`${profile.id}-${item.id}`} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    {profile.type === "MIXED" ? (
                      <select
                        value={recruitAs}
                        onChange={(event) =>
                          setEarthRecruitTypeDrafts((prev) => ({
                            ...prev,
                            [profile.id]: event.target.value as PersonnelType
                          }))
                        }
                        className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                      >
                        <option value="AI">Recruit As AI</option>
                        <option value="HUMAN">Recruit As Human</option>
                      </select>
                    ) : (
                      <div className="flex items-center rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs uppercase tracking-[0.14em] text-slate-300">
                        Recruit As {recruitAs}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleRecruitEarthProfile(profile.id)}
                      disabled={!isRecruitable || !orgs.length || earthRecruitingId === profile.id}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/12 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {earthRecruitingId === profile.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : null}
                      {profile.mode === "OFFLINE"
                        ? "Offline"
                        : !orgs.length
                          ? "No org access"
                          : "Deploy To Org"}
                    </button>
                  </div>
                  {profile.type === "MIXED" ? (
                    <p className="mt-2 text-[11px] text-slate-400">
                      Mixed stays a balanced profile. A human still chooses the deployment side for
                      runtime.
                    </p>
                  ) : null}

                  {!isRecruitable ? (
                    <p className="mt-2 text-[11px] text-amber-200">
                      {profile.mode === "OFFLINE"
                        ? "Offline mode blocks all external hiring."
                        : "Live mode already has one active deployment. Switch this profile to Mixed for multi-org hiring."}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {renderEarthMonitorPanel(
        "Level Monitor",
        "Track which Earth profiles are live, at which levels, and in which organizations."
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <h2 className="font-display text-3xl font-black uppercase tracking-tight md:text-4xl">Workforce</h2>
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
            {isEarthWorkspace ? "Earth Talent Registry" : "Human / AI Personnel Grid"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadSquad(true)}
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200"
          >
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Refresh
          </button>
          <button
            onClick={() => {
              if (isEarthWorkspace) {
                setShowEarthProfileModal(true);
                return;
              }
              setShowRecruitModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-500 hover:text-white"
          >
            <PlusCircle size={13} />
            {isEarthWorkspace ? "Create Earth Profile" : "Recruit"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-2">
        {([
          { id: "ROSTER", label: "Roster", icon: ShieldCheck },
          { id: "COLLABORATION", label: "Collaboration", icon: Users },
          { id: "MARKETPLACE", label: "Marketplace", icon: Store }
        ] as Array<{ id: WorkforceConsoleTab; label: string; icon: ComponentType<{ size?: number | string; className?: string }> }>).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setConsoleTab(tab.id)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
              consoleTab === tab.id
                ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            <tab.icon size={13} />
            {tab.label}
          </button>
        ))}
      </div>

      {consoleTab === "ROSTER" ? (
        isEarthWorkspace ? (
          renderEarthRegistry()
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <MetricCard label="Humans" value={String(humans.length)} icon={UserCircle2} />
              <MetricCard label="AI Nodes" value={String(aiAgents.length)} icon={Bot} />
              <MetricCard
                label="Capability Grants"
                value={String(capabilityGrants.length)}
                icon={ShieldCheck}
              />
            </div>

            <div className="grid gap-4 2xl:grid-cols-2">
              <PersonnelPanel
                title="Human Personnel"
                items={humans}
                accountLabelById={accountLabelById}
                grantCountByAgent={grantCountByAgent}
                themeStyle={themeStyle}
                loading={loading}
              />
              <PersonnelPanel
                title="AI Personnel"
                items={aiAgents}
                accountLabelById={accountLabelById}
                grantCountByAgent={grantCountByAgent}
                themeStyle={themeStyle}
                loading={loading}
              />
            </div>
          </>
        )
      ) : null}

      {consoleTab === "COLLABORATION" ? (
        isEarthWorkspace ? (
          renderEarthMonitorPanel(
            "Earth Deployment Monitor",
            "Monitor which Earth profiles are live, what levels they were hired into, and where they are currently deployed."
          )
        ) : (
          <div className="space-y-4">
            <ControlCollaborationPanel
              orgId={orgId}
              orgName={currentOrgContext?.name ?? "Organization"}
              orgRoleLabel={currentOrgContext?.role ?? "Member"}
              showStringSections={false}
              onActiveTabChange={setCollaborationSurfaceTab}
            />

            {collaborationSurfaceTab === "TEAMS" ? (
              <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
                <div
                  className={`vx-panel flex h-full min-h-0 flex-col rounded-3xl p-4 sm:p-5 ${themeStyle.border}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                        Team Builder
                      </p>
                      <p className="max-w-2xl text-sm text-slate-400">
                        Group human and AI members into a shared team that can be reused across
                        strings, discussions, and direction.
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${themeStyle.accentSoft}`}
                    >
                      Workforce + AI
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 xl:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        Team Name
                      </span>
                      <input
                        value={teamNameDraft}
                        onChange={(event) => setTeamNameDraft(event.target.value)}
                        placeholder="Execution pod alpha"
                        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                        Objective
                      </span>
                      <input
                        value={teamObjectiveDraft}
                        onChange={(event) => setTeamObjectiveDraft(event.target.value)}
                        placeholder="Ship onboarding automation"
                        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-black/25 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      Select Members
                    </p>
                    {personnel.length === 0 ? (
                      <div className="mt-3 flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 text-center">
                        <p className="text-xs text-slate-500">No workforce members available yet.</p>
                      </div>
                    ) : (
                      <div className="mt-3 grid content-start gap-2 sm:grid-cols-2">
                        {personnel.map((member) => {
                          const selected = teamMemberDraftIds.includes(member.id);
                          return (
                            <button
                              key={member.id}
                              type="button"
                              onClick={() => toggleTeamMemberDraft(member.id)}
                              className={`flex h-full flex-col justify-start rounded-xl border px-3 py-2 text-left transition ${
                                selected
                                  ? "border-emerald-500/40 bg-emerald-500/12"
                                  : "border-white/10 bg-black/35 hover:bg-white/5"
                              }`}
                            >
                              <p className="text-xs font-semibold text-slate-100">{member.name}</p>
                              <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                                {member.type} | {member.role}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-slate-400">
                      {teamMemberDraftIds.length} member
                      {teamMemberDraftIds.length === 1 ? "" : "s"} selected
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={resetTeamDraft}
                        className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-200"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={handleCreateTeam}
                        className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200 transition hover:bg-emerald-500/25"
                      >
                        <PlusCircle size={12} />
                        Create Team
                      </button>
                    </div>
                  </div>
                </div>

                <div
                  className={`vx-panel flex h-full min-h-0 flex-col rounded-3xl p-4 sm:p-5 ${themeStyle.border}`}
                >
                  <div className="space-y-1">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                      Active Teams
                    </p>
                    <p className="text-sm text-slate-400">
                      Teams created here stay available to collaboration routing throughout the
                      organization.
                    </p>
                  </div>
                  {teams.length === 0 ? (
                    <div className="mt-4 flex min-h-[220px] flex-1 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 text-center">
                      <p className="text-xs text-slate-500">
                        No teams created yet. Start with Team Builder.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 grid content-start gap-3">
                      {teams.map((team) => (
                        <div
                          key={team.id}
                          className="rounded-2xl border border-white/10 bg-black/25 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="break-words text-sm font-semibold text-slate-100">
                                {team.name}
                              </p>
                              <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                                {new Date(team.createdAt).toLocaleString()}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveTeam(team.id)}
                              className="shrink-0 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-red-300"
                            >
                              Remove
                            </button>
                          </div>
                          {team.objective ? (
                            <p className="mt-2 text-xs text-slate-300">{team.objective}</p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-1">
                            {team.memberIds.map((memberId) => (
                              <span
                                key={`${team.id}-${memberId}`}
                                className="rounded-full border border-white/20 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-200"
                              >
                                {memberLabelById.get(memberId) ?? memberId}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )
      ) : null}

      {consoleTab === "MARKETPLACE" ? (
        <div className={`vx-panel space-y-4 rounded-3xl p-4 ${themeStyle.border}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Store size={16} className="text-cyan-300" />
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                  Workforce Marketplace
                </p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${themeStyle.accentSoft}`}>
                  {isEarthWorkspace
                    ? "Explore / Earth Registry / Recruit / Settings"
                    : "Explore / Recruit / Settings"}
                </span>
              </div>
              <p className="max-w-3xl text-sm text-slate-400">
                {isEarthWorkspace
                  ? "Manage Earth-only profiles here, then deploy them into the organizations you already have access to."
                  : "Find a required team member quickly, understand how HUMAN and AI recruitment diverge, and keep future market settings visible without changing live behavior."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {marketplaceTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMarketplaceTab(tab.id)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                    marketplaceTab === tab.id
                      ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-100"
                      : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  <tab.icon size={13} />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {isEarthWorkspace && marketplaceTab === "EARTH_REGISTRY" ? renderEarthRegistry() : null}

          {marketplaceTab === "EXPLORE" ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <MetricCard
                  label="Listings"
                  value={String(marketplaceListingsWithFit.length)}
                  icon={Store}
                />
                <MetricCard
                  label="Visible"
                  value={String(filteredMarketplaceListings.length)}
                  icon={Search}
                />
                <MetricCard
                  label="Human"
                  value={String(marketplaceListingsWithFit.filter((listing) => listing.type === "HUMAN").length)}
                  icon={UserCircle2}
                />
                <MetricCard
                  label="AI"
                  value={String(marketplaceListingsWithFit.filter((listing) => listing.type === "AI").length)}
                  icon={Bot}
                />
              </div>

              <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">
                      Explore Surface
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-400">
                        {marketplaceFilterCount} active filters
                      </span>
                      <button
                        type="button"
                        onClick={clearMarketplaceFilters}
                        className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-200 transition hover:bg-white/10"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2">
                      <Search size={14} className="text-slate-500" />
                      <input
                        value={marketplaceQuery}
                        onChange={(event) => setMarketplaceQuery(event.target.value)}
                        placeholder="Search people, skills, team fit..."
                        className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
                      />
                    </label>
                    <select
                      value={marketplaceTypeFilter}
                      onChange={(event) => setMarketplaceTypeFilter(event.target.value as "ALL" | PersonnelType)}
                      className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    >
                      <option value="ALL">All Types</option>
                      <option value="HUMAN">Human</option>
                      <option value="AI">AI</option>
                    </select>
                    <select
                      value={marketplaceCategoryFilter}
                      onChange={(event) => setMarketplaceCategoryFilter(event.target.value)}
                      className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    >
                      {marketplaceCategories.map((category) => (
                        <option key={category} value={category}>
                          {category === "ALL" ? "All Categories" : category}
                        </option>
                      ))}
                    </select>
                    <select
                      value={marketplaceSkillFilter}
                      onChange={(event) => setMarketplaceSkillFilter(event.target.value)}
                      className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    >
                      {marketplaceSkills.map((skill) => (
                        <option key={skill} value={skill}>
                          {skill === "ALL" ? "All Skills" : skill}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {([
                      { id: "ALL", label: "Any Fit" },
                      { id: "NEW_TEAM", label: "New Pod" },
                      { id: "EXISTING_TEAM", label: "Existing Team" },
                      { id: "AUTOMATION_LAYER", label: "Automation Layer" }
                    ] as Array<{ id: MarketplaceFitFilter; label: string }>).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setMarketplaceFitFilter(item.id)}
                        className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] transition ${
                          marketplaceFitFilter === item.id
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                            : "border-white/15 bg-white/5 text-slate-300 hover:bg-white/10"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">
                    Quick Guidance
                  </p>
                  <div className="space-y-2 rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="flex items-center gap-2">
                      <BadgeInfo size={14} className="text-cyan-300" />
                      <p className="text-sm font-semibold text-slate-100">Human recruitment</p>
                    </div>
                    <p className="text-xs text-slate-400">
                      Use role, compensation, and team placement. This path stays focused on staffing and operational fit.
                    </p>
                  </div>
                  <div className="space-y-2 rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="flex items-center gap-2">
                      <BadgeInfo size={14} className="text-cyan-300" />
                      <p className="text-sm font-semibold text-slate-100">AI recruitment</p>
                    </div>
                    <p className="text-xs text-slate-400">
                      Add brain config, fallback config, OAuth delegation, and capability scopes before confirming the recruit.
                    </p>
                  </div>
                  <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-500">
                    Explore cards below feed directly into the existing recruit modal.
                  </p>
                </div>
              </div>

              {filteredMarketplaceListings.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs text-slate-500">
                  No marketplace entries match your filters.
                </p>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {filteredMarketplaceListings.map((listing) => (
                    <article key={listing.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-slate-100">{listing.name}</p>
                          <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                            {listing.type} | {listing.category} | {listing.availability}
                          </p>
                        </div>
                        <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan-300">
                          {listing.rateLabel}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-300">{listing.summary}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {listing.skills.map((skill) => (
                          <span
                            key={`${listing.id}-${skill}`}
                            className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-300"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-300">
                          Fit: {listing.teamFit.label}
                        </span>
                        <span className="text-[11px] text-slate-500">{listing.teamFit.detail}</span>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
                        <select
                          value={marketplaceTeamChoice[listing.id] ?? "NEW"}
                          onChange={(event) =>
                            setMarketplaceTeamChoice((prev) => ({
                              ...prev,
                              [listing.id]: event.target.value
                            }))
                          }
                          className="rounded-xl border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-slate-100 outline-none"
                        >
                          <option value="NEW">Create New Team</option>
                          {teams.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleAddMarketplaceListingToTeam(listing)}
                          className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-300 transition hover:bg-emerald-500/20"
                        >
                          Add To Team
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePrefillRecruitFromMarketplace(listing)}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-100 transition hover:bg-white/20"
                        >
                          Recruit {listing.type}
                          <ArrowRight size={12} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {marketplaceTab === "RECRUIT_PATHS" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <UserCircle2 size={15} className="text-emerald-300" />
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                      Human Recruitment
                    </p>
                  </div>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-emerald-200">
                    Staffing
                  </span>
                </div>
                <p className="text-sm text-slate-300">
                  Best when you need a person to own coordination, judgment, compensation, and team presence.
                </p>
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">What matters here</p>
                  <div className="flex flex-wrap gap-2">
                    {["Role clarity", "Salary / cost", "Status", "Team placement"].map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-300"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openRecruitModalForType("HUMAN")}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200 transition hover:bg-emerald-500/25"
                >
                  Start Human Recruit
                  <ArrowRight size={12} />
                </button>
              </div>

              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bot size={15} className="text-cyan-300" />
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                      AI Recruitment
                    </p>
                  </div>
                  <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan-200">
                    Brain + Delegation
                  </span>
                </div>
                <p className="text-sm text-slate-300">
                  Best when you need a non-human operator with explicit brain config, fallback config, and OAuth capability scope wiring.
                </p>
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">What matters here</p>
                  <div className="flex flex-wrap gap-2">
                    {["Autonomy", "Brain config", "Fallback config", "Capability vault"].map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-300"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openRecruitModalForType("AI")}
                  className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/15 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200 transition hover:bg-cyan-500/25"
                >
                  Start AI Recruit
                  <ArrowRight size={12} />
                </button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 lg:col-span-2">
                <div className="flex items-center gap-2">
                  <BadgeInfo size={15} className="text-cyan-300" />
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                    Routing note
                  </p>
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  Explore cards can prefill the recruit modal with role and expertise. Human recruits stay lightweight; AI recruits unlock brain config, fallback brain config, and delegated capability setup.
                </p>
              </div>
            </div>
          ) : null}

          {marketplaceTab === "MARKET_SETTINGS" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Settings2 size={15} className="text-cyan-300" />
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                      LLM Settings
                    </p>
                  </div>
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-amber-200">
                    Upcoming
                  </span>
                </div>
                <p className="text-sm text-slate-400">
                  Placeholder controls for future LLM routing, prompt policy, and selection preferences. These are local drafts only.
                </p>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Routing mode</span>
                  <select
                    value={marketplaceSettingsDraft.llmRouting}
                    onChange={(event) =>
                      setMarketplaceSettingsDraft((prev) => ({
                        ...prev,
                        llmRouting: event.target.value
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    <option>Balanced</option>
                    <option>Cost-aware</option>
                    <option>Latency-aware</option>
                    <option>Quality-first</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Preference bias</span>
                  <select
                    value={marketplaceSettingsDraft.discoveryBias}
                    onChange={(event) =>
                      setMarketplaceSettingsDraft((prev) => ({
                        ...prev,
                        discoveryBias: event.target.value
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    <option>Team fit</option>
                    <option>Skill match</option>
                    <option>Category match</option>
                  </select>
                </label>
              </div>

              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal size={15} className="text-cyan-300" />
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                      Agent Market Settings
                    </p>
                  </div>
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-amber-200">
                    Upcoming
                  </span>
                </div>
                <p className="text-sm text-slate-400">
                  Placeholder controls for future agent-market pricing and policy rules. Nothing here changes persisted behavior yet.
                </p>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Market mode</span>
                  <select
                    value={marketplaceSettingsDraft.agentMarketMode}
                    onChange={(event) =>
                      setMarketplaceSettingsDraft((prev) => ({
                        ...prev,
                        agentMarketMode: event.target.value
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    <option>Human-first with AI assist</option>
                    <option>AI-augmented team</option>
                    <option>Automation-first</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Pricing floor</span>
                  <input
                    value={marketplaceSettingsDraft.pricingFloor}
                    onChange={(event) =>
                      setMarketplaceSettingsDraft((prev) => ({
                        ...prev,
                        pricingFloor: event.target.value
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-100">Draft only</p>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      Connected in UI, not wired to backend
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 opacity-70"
                  >
                    Save upcoming
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {showRecruitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="vx-panel vx-scrollbar h-[90dvh] w-full max-w-4xl overflow-y-auto rounded-[34px] border border-white/15 p-6">
            <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="font-display text-2xl font-black uppercase tracking-tight">
                  Recruitment Console
                </h3>
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">
                  Assign OAuth + fallback brain
                </p>
              </div>
              <button
                onClick={() => {
                  setShowRecruitModal(false);
                  resetRecruitState();
                }}
                className="rounded-full border border-white/20 p-2 text-slate-300 transition hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleRecruit} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Type</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(["HUMAN", "AI"] as PersonnelType[]).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, type: item }))}
                        className={`rounded-xl border px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] transition ${
                          form.type === item
                            ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                            : "border-white/10 bg-black/40 text-slate-300 hover:bg-white/5"
                        }`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Status</span>
                  <select
                    value={form.status}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, status: event.target.value as PersonnelStatus }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    <option value="IDLE">IDLE</option>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="PAUSED">PAUSED</option>
                    <option value="DISABLED">DISABLED</option>
                    <option value="RENTED">RENTED</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Name</span>
                  <input
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    placeholder="Node display name"
                    required
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Role</span>
                  <input
                    value={form.role}
                    onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    placeholder="Closer / Research / Main Agent"
                    required
                  />
                </label>
              </div>

              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Expertise</span>
                <input
                  value={form.expertise}
                  onChange={(event) => setForm((prev) => ({ ...prev, expertise: event.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  placeholder="Growth, Compliance, Sales Ops..."
                />
              </label>

              <div className="grid gap-3 md:grid-cols-4">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Autonomy</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={form.autonomyScore}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, autonomyScore: event.target.value }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Pricing</span>
                  <select
                    value={form.pricingModel}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        pricingModel: event.target.value as "" | PricingModel
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    <option value="">None</option>
                    <option value="TOKEN">TOKEN</option>
                    <option value="SUBSCRIPTION">SUBSCRIPTION</option>
                    <option value="OUTCOME">OUTCOME</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Cost</span>
                  <input
                    type="number"
                    step={0.0001}
                    min={0}
                    value={form.cost}
                    onChange={(event) => setForm((prev) => ({ ...prev, cost: event.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Rent Rate</span>
                  <input
                    type="number"
                    step={0.0001}
                    min={0}
                    value={form.rentRate}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, rentRate: event.target.value }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
              </div>

              <label className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-slate-400">
                <input
                  type="checkbox"
                  checked={form.isRented}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, isRented: event.target.checked }))
                  }
                />
                Mark as rented asset
              </label>

              {isAiRecruit ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Brain Config JSON</span>
                    <textarea
                      value={form.brainConfig}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, brainConfig: event.target.value }))
                      }
                      className="h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      Fallback Brain Config JSON
                    </span>
                    <textarea
                      value={form.fallbackBrainConfig}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, fallbackBrainConfig: event.target.value }))
                      }
                      className="h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none"
                    />
                  </label>
                </div>
              ) : (
                <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">
                  Human recruit uses role, cost, and operational metadata. AI brain config fields are hidden in this mode.
                </p>
              )}

              {isAiRecruit && (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Primary Brain Key</span>
                    <input
                      type="password"
                      value={form.brainKey}
                      onChange={(event) => setForm((prev) => ({ ...prev, brainKey: event.target.value }))}
                      placeholder="Optional encrypted secret"
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      Fallback Brain Key
                    </span>
                    <input
                      type="password"
                      value={form.fallbackBrainKey}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, fallbackBrainKey: event.target.value }))
                      }
                      placeholder="Optional encrypted secret"
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                </div>
              )}

              {isAiRecruit && (
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Delegated OAuth Accounts</p>
                  {linkedAccounts.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">No linked accounts available in this org.</p>
                  ) : (
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {linkedAccounts.map((account) => {
                        const checked = selectedOAuthIds.includes(account.id);
                        return (
                          <label
                            key={account.id}
                            className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-200"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleOAuthSelection(account.id)}
                            />
                            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]">
                              {shortProvider(account.provider)}
                            </span>
                            <span>{account.user.username || account.user.email}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {isAiRecruit && (
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    Capability Vault ({capabilityVaultEnabled ? "enabled" : "disabled"})
                  </p>
                  <textarea
                    value={form.capabilityScopes}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, capabilityScopes: event.target.value }))
                    }
                    disabled={!capabilityVaultEnabled}
                    className="mt-2 h-20 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-100 outline-none disabled:opacity-40"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRecruitModal(false);
                    resetRecruitState();
                  }}
                  className="rounded-full border border-white/20 bg-white/5 px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-500 hover:text-white disabled:opacity-60"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
                  Confirm Recruit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEarthProfileModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="vx-panel vx-scrollbar h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-[34px] border border-white/15 p-6">
            <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="font-display text-2xl font-black uppercase tracking-tight">
                  Earth Profile Console
                </h3>
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">
                  Create or update Earth talent availability
                </p>
              </div>
              <button
                onClick={() => {
                  setShowEarthProfileModal(false);
                  resetEarthProfileDraft();
                }}
                className="rounded-full border border-white/20 p-2 text-slate-300 transition hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateEarthProfile} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                        Control Mix
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {earthControlLevelLabel(earthProfileDraftControlLevel)}
                      </p>
                    </div>
                    <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-100">
                      {earthProfileDraftType}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={earthProfileDraftControlLevel}
                    onChange={(event) =>
                      setEarthProfileDraft((prev) => {
                        const nextControlLevel = Number(event.target.value);
                        return {
                          ...prev,
                          aiControlLevel: String(nextControlLevel),
                          approvalMode: normalizeEarthApprovalMode(
                            prev.approvalMode,
                            nextControlLevel
                          )
                        };
                      })
                    }
                    className="mt-4 w-full accent-cyan-400"
                  />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span>Human-led</span>
                    <span>Balanced</span>
                    <span>AI-led</span>
                  </div>
                  <div className="mt-3 inline-flex flex-wrap rounded-full border border-white/10 bg-black/30 p-1">
                    {([
                      { value: 0, label: "Human-led" },
                      { value: 50, label: "Balanced" },
                      { value: 100, label: "AI-led" }
                    ] as const).map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          setEarthProfileDraft((prev) => ({
                            ...prev,
                            aiControlLevel: String(preset.value),
                            approvalMode: normalizeEarthApprovalMode(
                              prev.approvalMode,
                              preset.value
                            )
                          }))
                        }
                        className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition ${
                          earthProfileDraftControlLevel === preset.value
                            ? "bg-emerald-500/15 text-emerald-200"
                            : "text-slate-300 hover:bg-white/10"
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      Default Level
                    </span>
                    <select
                      value={earthProfileDraft.defaultLevel}
                      onChange={(event) =>
                        setEarthProfileDraft((prev) => ({
                          ...prev,
                          defaultLevel: event.target.value as RecruitmentLevel
                        }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    >
                      {EARTH_RECRUIT_LEVELS.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label} | {item.detail}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      Approval Model
                    </span>
                    <select
                      value={earthProfileDraftApprovalMode}
                      onChange={(event) =>
                        setEarthProfileDraft((prev) => ({
                          ...prev,
                          approvalMode: event.target.value as EarthApprovalMode
                        }))
                      }
                      disabled={earthProfileDraftControlLevel < 100}
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="HUMAN_ONLY">Human approval only</option>
                      <option value="AI_REQUESTS_HUMAN">AI requests human approval</option>
                      <option value="AI_SELF_APPROVE">AI self approval</option>
                    </select>
                  </label>
                  <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">
                    {earthProfileDraftControlLevel === 100
                      ? "A human chooses the AI approval model here. AI cannot switch its own profile type."
                      : "Human-led and balanced profiles stay on human approval only."}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Name</span>
                  <input
                    value={earthProfileDraft.name}
                    onChange={(event) =>
                      setEarthProfileDraft((prev) => ({ ...prev, name: event.target.value }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    placeholder="Earth profile name"
                    required
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Role</span>
                  <input
                    value={earthProfileDraft.role}
                    onChange={(event) =>
                      setEarthProfileDraft((prev) => ({ ...prev, role: event.target.value }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    placeholder="Growth operator / Workflow agent"
                    required
                  />
                </label>
              </div>

              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Summary</span>
                <textarea
                  value={earthProfileDraft.summary}
                  onChange={(event) =>
                    setEarthProfileDraft((prev) => ({ ...prev, summary: event.target.value }))
                  }
                  className="h-24 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  placeholder="What this Earth profile is best at"
                  required
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Skills</span>
                  <input
                    value={earthProfileDraft.skills}
                    onChange={(event) =>
                      setEarthProfileDraft((prev) => ({ ...prev, skills: event.target.value }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    placeholder="Comma-separated skills"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Expertise</span>
                  <input
                    value={earthProfileDraft.expertise}
                    onChange={(event) =>
                      setEarthProfileDraft((prev) => ({ ...prev, expertise: event.target.value }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    placeholder="Primary domain"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Autonomy</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={earthProfileDraft.autonomyScore}
                    onChange={(event) =>
                      setEarthProfileDraft((prev) => ({
                        ...prev,
                        autonomyScore: event.target.value
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Pricing</span>
                  <select
                    value={earthProfileDraft.pricingModel}
                    onChange={(event) =>
                      setEarthProfileDraft((prev) => ({
                        ...prev,
                        pricingModel: event.target.value as "" | PricingModel
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  >
                    <option value="">None</option>
                    <option value="TOKEN">TOKEN</option>
                    <option value="SUBSCRIPTION">SUBSCRIPTION</option>
                    <option value="OUTCOME">OUTCOME</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Cost</span>
                  <input
                    value={earthProfileDraft.cost}
                    onChange={(event) =>
                      setEarthProfileDraft((prev) => ({ ...prev, cost: event.target.value }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Rent Rate</span>
                  <input
                    value={earthProfileDraft.rentRate}
                    onChange={(event) =>
                      setEarthProfileDraft((prev) => ({ ...prev, rentRate: event.target.value }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-center gap-2">
                  <BadgeInfo size={14} className="text-cyan-300" />
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Earth Mode</p>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {EARTH_PROFILE_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() =>
                        setEarthProfileDraft((prev) => ({ ...prev, mode: mode.id }))
                      }
                      className={`rounded-2xl border px-3 py-3 text-left transition ${
                        earthProfileDraft.mode === mode.id
                          ? "border-cyan-500/40 bg-cyan-500/12"
                          : "border-white/10 bg-black/35 hover:bg-white/5"
                      }`}
                    >
                      <p className="text-xs font-semibold text-slate-100">{mode.label}</p>
                      <p className="mt-1 text-[11px] text-slate-400">{mode.detail}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEarthProfileModal(false);
                    resetEarthProfileDraft();
                  }}
                  className="rounded-full border border-white/20 bg-white/5 px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-500 hover:text-white"
                >
                  <PlusCircle size={14} />
                  Save Earth Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon: ComponentType<{ size?: string | number; className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
      <div className="flex items-center gap-2">
        <Icon size={15} className="text-slate-400" />
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-100">{value}</p>
    </div>
  );
}

function PersonnelPanel({
  title,
  items,
  loading,
  accountLabelById,
  grantCountByAgent,
  themeStyle
}: {
  title: string;
  items: PersonnelItem[];
  loading: boolean;
  accountLabelById: Map<string, string>;
  grantCountByAgent: Map<string, number>;
  themeStyle: { accent: string; accentSoft: string; border: string };
}) {
  return (
    <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">{title}</p>
        <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${themeStyle.accentSoft}`}>
          {items.length}
        </span>
      </div>

      {loading ? (
        <div className="inline-flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={14} className="animate-spin" />
          Loading roster...
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs uppercase tracking-[0.16em] text-slate-500">
          No members in this lane.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((member) => (
            <div key={member.id} className="rounded-2xl border border-white/10 bg-black/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-100">{member.name}</p>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    {member.role} | {member.status}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-300">
                    Autonomy {member.autonomyScore.toFixed(2)}
                  </span>
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-emerald-300">
                    {member.pricingModel ?? "NONE"}
                  </span>
                </div>
              </div>

              {member.expertise ? (
                <p className="mt-2 text-xs text-slate-400">{member.expertise}</p>
              ) : null}

              <div className="mt-2 grid gap-2 text-[10px] uppercase tracking-[0.14em] text-slate-500 md:grid-cols-4">
                <span>Cost {toNumber(member.cost).toFixed(2)}</span>
                <span>Rent {toNumber(member.rentRate).toFixed(2)}</span>
                <span>Salary {toNumber(member.salary).toFixed(2)}</span>
                <span>Cap Grants {grantCountByAgent.get(member.id) ?? 0}</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {member.assignedOAuthIds.length === 0 ? (
                  <span className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    No OAuth delegation
                  </span>
                ) : (
                  member.assignedOAuthIds.map((id) => (
                    <span
                      key={id}
                      className="rounded-full border border-white/20 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300"
                    >
                      {accountLabelById.get(id) ?? id.slice(0, 8)}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
