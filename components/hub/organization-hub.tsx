"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  FileText,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UploadCloud,
  Users
} from "lucide-react";

import { parseJsonResponse } from "@/lib/http/json-response";
import { useVorldXStore } from "@/lib/store/vorldx-store";
import type { OrgContext } from "@/lib/store/vorldx-store";

type ExecutionModeValue = "ECO" | "BALANCED" | "TURBO";
type ThemeValue = "APEX" | "VEDA" | "NEXUS";
type Surface = "DETAILS" | "MANAGE";
type ManageTab = "DETAILS" | "ACCESS";
type MembershipRole = "FOUNDER" | "ADMIN" | "EMPLOYEE";
type AccessTargetKind = "MEMBER" | "PERSONNEL" | "TEAM";
type AccessTeamKey = "HUMAN_WORKFORCE" | "AI_WORKFORCE";

interface OrganizationHubProps {
  orgId: string;
  orgs: OrgContext[];
  activeOrgId: string | null;
  onSelectOrg: (orgId: string) => void;
  themeStyle: {
    accentSoft: string;
    border: string;
  };
}

interface OrganizationalInput {
  id: string;
  name: string;
  size: string;
  updatedAt: string;
  content: string;
}

interface OrganizationalOutput {
  id: string;
  name: string;
  size: string;
  url: string;
  outputPreview: string | null;
  sourceFlowId: string | null;
  sourceTaskId: string | null;
}

interface OrganizationalDocument {
  id: string;
  name: string;
  size: string;
  url: string;
  updatedAt: string;
  contentType: string | null;
}

interface OrganizationRecord {
  id: string;
  name: string;
  description: string | null;
  theme: ThemeValue;
  executionMode: ExecutionModeValue;
  monthlyBudgetUsd: string;
  currentSpendUsd: string;
  monthlyBtuCap: number;
  currentBtuBurn: number;
  createdAt: string;
  updatedAt: string;
  memberCounts: {
    founders: number;
    admins: number;
    employees: number;
  };
  workforce: {
    humans: number;
    agents: number;
    activeHumans: number;
    activeAgents: number;
  };
}

interface OrganizationAccessEntry {
  kind: AccessTargetKind;
  targetId: string;
  badgeLabel: string;
  label: string;
  secondaryLabel: string | null;
  resolved: boolean;
}

interface OrganizationAccessCandidate {
  kind: AccessTargetKind;
  targetId: string;
  badgeLabel: string;
  label: string;
  secondaryLabel: string | null;
  disabled: boolean;
}

interface OrganizationAccessCandidates {
  members: OrganizationAccessCandidate[];
  personnel: OrganizationAccessCandidate[];
  teams: OrganizationAccessCandidate[];
}

type OrganizationAccessTarget = Pick<OrganizationAccessEntry, "kind" | "targetId" | "label">;

interface OrganizationActor {
  userId: string;
  email: string;
  role: MembershipRole;
  roleLabel: string;
  isAdmin: boolean;
}

interface OrganizationMember {
  userId: string;
  username: string;
  email: string;
  role: MembershipRole;
  roleLabel: string;
  joinedAt: string;
  isActiveOrganization: boolean;
}

interface CompanyDataEditorState {
  name: string;
  description: string;
  theme: ThemeValue;
  productsAndServices: string;
  goalsText: string;
  prioritiesText: string;
  operatingRulesText: string;
  toolsAndSystemsText: string;
  notes: string;
  founderName: string;
  founderEmail: string;
  executionMode: ExecutionModeValue;
  monthlyBudgetUsd: string;
  monthlyBtuCap: string;
  documents: OrganizationalDocument[];
  baseData: Record<string, unknown> | null;
}

function emptyEditor(): CompanyDataEditorState {
  return {
    name: "",
    description: "",
    theme: "APEX",
    productsAndServices: "",
    goalsText: "",
    prioritiesText: "",
    operatingRulesText: "",
    toolsAndSystemsText: "",
    notes: "",
    founderName: "",
    founderEmail: "",
    executionMode: "BALANCED",
    monthlyBudgetUsd: "",
    monthlyBtuCap: "",
    documents: [],
    baseData: null
  };
}

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asStringList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function linesFromList(value: unknown) {
  return asStringList(value).join("\n");
}

function listFromLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTheme(value: unknown, fallback: ThemeValue = "APEX"): ThemeValue {
  if (value === "VEDA") return "VEDA";
  if (value === "NEXUS") return "NEXUS";
  if (value === "APEX") return "APEX";
  return fallback;
}

function normalizeExecutionMode(
  value: unknown,
  fallback: ExecutionModeValue = "BALANCED"
): ExecutionModeValue {
  if (value === "ECO") return "ECO";
  if (value === "TURBO") return "TURBO";
  if (value === "BALANCED") return "BALANCED";
  return fallback;
}

function formatFileSize(raw: string) {
  const bytes = Number(raw);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatCurrency(raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw || "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2
  }).format(value);
}

function formatNumber(raw: number) {
  if (!Number.isFinite(raw)) return "0";
  return new Intl.NumberFormat("en-US").format(raw);
}

function accessKey(kind: AccessTargetKind, targetId: string) {
  return `${kind}:${targetId}`;
}

function accessKindLabel(kind: AccessTargetKind) {
  if (kind === "MEMBER") return "Member";
  if (kind === "PERSONNEL") return "Workforce";
  return "Team";
}

function accessBadgeClass(kind: AccessTargetKind) {
  if (kind === "MEMBER") return "border-cyan-500/40 bg-cyan-500/10 text-cyan-200";
  if (kind === "PERSONNEL") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  return "border-slate-500/40 bg-slate-500/10 text-slate-200";
}

function emptyAccessCandidates(): OrganizationAccessCandidates {
  return { members: [], personnel: [], teams: [] };
}

function parseCompanyEditor(content: string, organization?: OrganizationRecord | null) {
  let parsed: Record<string, unknown> | null = null;
  try {
    const candidate = JSON.parse(content);
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      parsed = candidate as Record<string, unknown>;
    }
  } catch {
    parsed = null;
  }

  const company = asRecord(parsed?.company);
  const financials = asRecord(parsed?.financials);
  const founder = asRecord(parsed?.founder);
  const businessContext = asRecord(parsed?.businessContext);
  const documents = Array.isArray(parsed?.companyDocuments)
    ? parsed.companyDocuments
        .map((item) => {
          const doc = asRecord(item);
          const name = asString(doc.name).trim();
          const url = asString(doc.url).trim();
          if (!name || !url) return null;
          return {
            id: asString(doc.id).trim(),
            name,
            size: asString(doc.size).trim() || "0",
            url,
            updatedAt: asString(doc.updatedAt).trim() || new Date().toISOString(),
            contentType: asString(doc.contentType).trim() || null
          } satisfies OrganizationalDocument;
        })
        .filter((item): item is OrganizationalDocument => Boolean(item))
    : [];

  return {
    name: asString(company.name).trim() || organization?.name || "",
    description: asString(company.description).trim() || organization?.description || content || "",
    theme: normalizeTheme(company.theme, organization?.theme ?? "APEX"),
    productsAndServices: asString(businessContext.productsAndServices).trim(),
    goalsText: linesFromList(businessContext.goals),
    prioritiesText: linesFromList(businessContext.currentPriorities),
    operatingRulesText: linesFromList(businessContext.operatingRules),
    toolsAndSystemsText: linesFromList(businessContext.toolsAndSystems),
    notes: asString(businessContext.notes).trim(),
    founderName: asString(founder.username).trim(),
    founderEmail: asString(founder.email).trim(),
    executionMode: normalizeExecutionMode(
      company.executionMode,
      organization?.executionMode ?? "BALANCED"
    ),
    monthlyBudgetUsd:
      asString(financials.monthlyBudgetUsd).trim() || organization?.monthlyBudgetUsd || "",
    monthlyBtuCap:
      asString(financials.monthlyBtuCap).trim() || String(organization?.monthlyBtuCap ?? ""),
    documents,
    baseData: parsed
  } satisfies CompanyDataEditorState;
}

function mergeDocuments(left: OrganizationalDocument[], right: OrganizationalDocument[]) {
  const byUrl = new Map<string, OrganizationalDocument>();
  for (const doc of [...right, ...left]) {
    if (doc.url) byUrl.set(doc.url, doc);
  }
  return [...byUrl.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function buildCompanyJson(editor: CompanyDataEditorState, orgId: string, fallback: string) {
  const base = asRecord(editor.baseData ?? {});
  const existingCompany = asRecord(base.company);
  const existingFinancials = asRecord(base.financials);
  const existingFounder = asRecord(base.founder);
  const existingBusiness = asRecord(base.businessContext);

  return JSON.stringify(
    {
      ...base,
      company: {
        ...existingCompany,
        orgId,
        name: editor.name || asString(existingCompany.name) || "Organization",
        description: editor.description || fallback,
        theme: editor.theme,
        executionMode: editor.executionMode
      },
      financials: {
        ...existingFinancials,
        monthlyBudgetUsd: editor.monthlyBudgetUsd || asString(existingFinancials.monthlyBudgetUsd) || "0",
        monthlyBtuCap: editor.monthlyBtuCap || asString(existingFinancials.monthlyBtuCap) || "0"
      },
      founder: editor.founderEmail
        ? {
            ...existingFounder,
            username: editor.founderName || asString(existingFounder.username) || "Founder",
            email: editor.founderEmail
          }
        : Object.keys(existingFounder).length > 0
          ? existingFounder
          : null,
      businessContext: {
        ...existingBusiness,
        productsAndServices: editor.productsAndServices,
        goals: listFromLines(editor.goalsText),
        currentPriorities: listFromLines(editor.prioritiesText),
        operatingRules: listFromLines(editor.operatingRulesText),
        toolsAndSystems: listFromLines(editor.toolsAndSystemsText),
        notes: editor.notes
      },
      companyDocuments: editor.documents,
      lastUpdatedAt: new Date().toISOString()
    },
    null,
    2
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function TextBlock({ label, value }: { label: string; value: string }) {
  const items = value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No entries yet.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((item) => (
            <p key={`${label}-${item}`} className="text-sm text-slate-300">
              {item}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function OrganizationHub({
  orgId,
  orgs,
  activeOrgId,
  onSelectOrg,
  themeStyle
}: OrganizationHubProps) {
  const notify = useVorldXStore((state) => state.pushNotification);
  const [surface, setSurface] = useState<Surface>("DETAILS");
  const [manageTab, setManageTab] = useState<ManageTab>("DETAILS");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [organization, setOrganization] = useState<OrganizationRecord | null>(null);
  const [actor, setActor] = useState<OrganizationActor | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [delegatedAccess, setDelegatedAccess] = useState<OrganizationAccessEntry[]>([]);
  const [accessCandidates, setAccessCandidates] = useState<OrganizationAccessCandidates>(
    () => emptyAccessCandidates()
  );
  const [orgInput, setOrgInput] = useState<OrganizationalInput | null>(null);
  const [orgOutput, setOrgOutput] = useState<OrganizationalOutput[]>([]);
  const [editor, setEditor] = useState<CompanyDataEditorState>(() => emptyEditor());
  const [orgDraft, setOrgDraft] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docSourceUrl, setDocSourceUrl] = useState("");
  const [docName, setDocName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, MembershipRole>>({});
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [savingAccessKey, setSavingAccessKey] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const hydratedRef = useRef(false);

  const updateEditor = useCallback((updater: (current: CompanyDataEditorState) => CompanyDataEditorState) => {
    setEditor((current) => updater(current));
    setDirty(true);
    dirtyRef.current = true;
  }, []);

  const loadHub = useCallback(async (silent?: boolean) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch(`/api/hub/organization?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store"
      });
      const { payload, rawText } = await parseJsonResponse<{
        ok?: boolean;
        message?: string;
        actor?: OrganizationActor;
        organization?: OrganizationRecord;
        members?: OrganizationMember[];
        delegatedAccess?: OrganizationAccessEntry[];
        accessCandidates?: OrganizationAccessCandidates;
        input?: OrganizationalInput;
        documents?: OrganizationalDocument[];
        output?: OrganizationalOutput[];
      }>(response);
      if (!response.ok || !payload?.ok || !payload.organization || !payload.input) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed to load organization hub (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed to load organization hub.")
        );
      }

      const parsed = parseCompanyEditor(payload.input.content, payload.organization);
      const mergedDocuments = mergeDocuments(parsed.documents, payload.documents ?? []);

      setError(null);
      setActor(payload.actor ?? null);
      setOrganization(payload.organization);
      setMembers(payload.members ?? []);
      setDelegatedAccess(payload.delegatedAccess ?? []);
      setAccessCandidates(payload.accessCandidates ?? emptyAccessCandidates());
      setOrgInput(payload.input);
      setOrgOutput(payload.output ?? []);
      setRoleDrafts(
        (payload.members ?? []).reduce<Record<string, MembershipRole>>((map, member) => {
          map[member.userId] = member.role;
          return map;
        }, {})
      );

      if (!dirtyRef.current || !hydratedRef.current) {
        setOrgDraft(payload.input.content);
        setEditor({ ...parsed, documents: mergedDocuments });
        setDirty(false);
        dirtyRef.current = false;
        hydratedRef.current = true;
      } else {
        setEditor((current) => ({
          ...current,
          documents: mergeDocuments(current.documents, mergedDocuments)
        }));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load organization hub.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadHub();
    const timer = setInterval(() => void loadHub(true), 12000);
    return () => clearInterval(timer);
  }, [loadHub]);

  useEffect(() => {
    setSurface("DETAILS");
    setManageTab("DETAILS");
    setOrganization(null);
    setActor(null);
    setMembers([]);
    setOrgInput(null);
    setOrgOutput([]);
    setEditor(emptyEditor());
      setOrgDraft("");
      setDocFile(null);
      setDocName("");
      setDocSourceUrl("");
      setDirty(false);
      setShowJson(false);
      setRoleDrafts({});
      setDelegatedAccess([]);
      setAccessCandidates(emptyAccessCandidates());
      setSavingAccessKey(null);
      dirtyRef.current = false;
      hydratedRef.current = false;
  }, [orgId]);

  const savedSnapshot = useMemo(
    () => parseCompanyEditor(orgInput?.content ?? "", organization),
    [orgInput?.content, organization]
  );

  const saveDetails = useCallback(
    async (content: string, silent?: boolean) => {
      if (!content.trim()) {
        notify({ title: "Organization", message: "Organization details are empty.", type: "warning" });
        return false;
      }

      setSaving(true);
      try {
        const response = await fetch("/api/hub/organization", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, content })
        });
        const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
          response
        );
        if (!response.ok || !payload?.ok) {
          notify({
            title: "Organization",
            message:
              payload?.message ??
              (rawText
                ? `Failed to save organization details (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed to save organization details."),
            type: "error"
          });
          return false;
        }

        setOrgDraft(content);
        setDirty(false);
        dirtyRef.current = false;
        hydratedRef.current = true;
        await loadHub(true);
        if (!silent) {
          notify({ title: "Organization", message: "Organization details updated.", type: "success" });
        }
        return true;
      } finally {
        setSaving(false);
      }
    },
    [loadHub, notify, orgId]
  );

  const handleSave = useCallback(async () => {
    if (showJson) {
      try {
        JSON.parse(orgDraft);
      } catch {
        notify({
          title: "Organization",
          message: "Advanced JSON must be valid before saving.",
          type: "warning"
        });
        return;
      }
      const ok = await saveDetails(orgDraft);
      if (ok) {
        const parsed = parseCompanyEditor(orgDraft, organization);
        setEditor((current) => ({ ...parsed, documents: mergeDocuments(current.documents, parsed.documents) }));
      }
      return;
    }

    const nextContent = buildCompanyJson(editor, orgId, orgDraft);
    setOrgDraft(nextContent);
    await saveDetails(nextContent);
  }, [editor, notify, orgDraft, orgId, organization, saveDetails, showJson]);

  const handleDocUpload = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!docFile && !docSourceUrl.trim()) {
        notify({
          title: "Organization Document",
          message: "Choose a file or source URL first.",
          type: "warning"
        });
        return;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.set("orgId", orgId);
        formData.set("type", "INPUT");
        if (docName.trim()) formData.set("name", docName.trim());
        if (docFile) {
          formData.set("file", docFile);
          if (!docName.trim()) formData.set("name", docFile.name);
        }
        if (docSourceUrl.trim()) {
          formData.set("sourceUrl", docSourceUrl.trim());
          if (!docName.trim()) formData.set("name", "organization-reference");
        }

        const response = await fetch("/api/hub/files", { method: "POST", body: formData });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          file?: {
            id?: string;
            name?: string;
            size?: string;
            url?: string;
            updatedAt?: string;
            metadata?: Record<string, unknown> | null;
          };
        }>(response);

        if (!response.ok || !payload?.ok || !payload.file?.url || !payload.file?.name) {
          notify({
            title: "Organization Document",
            message:
              payload?.message ??
              (rawText
                ? `Failed to upload organization document (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed to upload organization document."),
            type: "error"
          });
          return;
        }

        const uploadedDoc: OrganizationalDocument = {
          id: payload.file.id ?? "",
          name: payload.file.name,
          size: payload.file.size ?? "0",
          url: payload.file.url,
          updatedAt: payload.file.updatedAt ?? new Date().toISOString(),
          contentType:
            payload.file.metadata && typeof payload.file.metadata.contentType === "string"
              ? payload.file.metadata.contentType
              : null
        };

        const nextEditor = {
          ...editor,
          documents: mergeDocuments(editor.documents, [uploadedDoc])
        };
        setEditor(nextEditor);
        const saved = await saveDetails(buildCompanyJson(nextEditor, orgId, orgDraft), true);
        if (!saved) return;

        setDocFile(null);
        setDocName("");
        setDocSourceUrl("");
        notify({
          title: "Organization Document",
          message: "Document uploaded and linked to organization details.",
          type: "success"
        });
      } finally {
        setUploading(false);
      }
    },
    [docFile, docName, docSourceUrl, editor, notify, orgDraft, orgId, saveDetails]
  );

  const handleRoleSave = useCallback(
    async (member: OrganizationMember) => {
      const nextRole = roleDrafts[member.userId];
      if (!nextRole || nextRole === member.role) return;

      setSavingMemberId(member.userId);
      try {
        const response = await fetch("/api/hub/organization", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, memberUserId: member.userId, role: nextRole })
        });
        const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
          response
        );
        if (!response.ok || !payload?.ok) {
          notify({
            title: "Organization Access",
            message:
              payload?.message ??
              (rawText
                ? `Failed to update access (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed to update access."),
            type: "error"
          });
          return;
        }

        notify({
          title: "Organization Access",
          message: `${member.username} now has ${nextRole.toLowerCase()} access.`,
          type: "success"
        });
        await loadHub(true);
      } finally {
        setSavingMemberId(null);
      }
    },
    [loadHub, notify, orgId, roleDrafts]
  );

  const handleAccessMutation = useCallback(
    async (entry: OrganizationAccessTarget, action: "ADD" | "REMOVE") => {
      const key = accessKey(entry.kind, entry.targetId);
      setSavingAccessKey(key);
      try {
        const response = await fetch("/api/hub/organization", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            action,
            targetKind: entry.kind,
            targetId: entry.targetId
          })
        });
        const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
          response
        );
        if (!response.ok || !payload?.ok) {
          notify({
            title: "Organization Access",
            message:
              payload?.message ??
              (rawText
                ? `Failed to update delegated access (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed to update delegated access."),
            type: "error"
          });
          return;
        }

        notify({
          title: "Organization Access",
          message:
            action === "ADD"
              ? `Added ${entry.label} to delegated access.`
              : `Removed ${entry.label} from delegated access.`,
          type: "success"
        });
        await loadHub(true);
      } finally {
        setSavingAccessKey(null);
      }
    },
    [loadHub, notify, orgId]
  );

  const detailStats = organization
    ? [
        { label: "Theme", value: organization.theme },
        { label: "Execution Mode", value: organization.executionMode },
        { label: "Monthly Budget", value: formatCurrency(organization.monthlyBudgetUsd) },
        { label: "Current Spend", value: formatCurrency(organization.currentSpendUsd) },
        { label: "Monthly BTU Cap", value: formatNumber(organization.monthlyBtuCap) },
        { label: "Current BTU Burn", value: formatNumber(organization.currentBtuBurn) },
        { label: "Members", value: String(organization.memberCounts.founders + organization.memberCounts.admins + organization.memberCounts.employees) },
        { label: "Agent Profiles", value: String(organization.workforce.agents) }
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">Organization Hub</p>
          <p className="text-xs text-slate-500">
            Active organization details, management access, and linked source files.
          </p>
        </div>
        <button
          onClick={() => void loadHub(true)}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300"
        >
          {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            Workspace Organization
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Pick the organization you want to work inside. The shell card updates with the same selection.
          </p>
        </div>
        <div className="vx-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
          {orgs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectOrg(item.id)}
              className={`min-w-[220px] rounded-3xl border px-4 py-3 text-left transition ${
                activeOrgId === item.id
                  ? `vx-panel ${themeStyle.border}`
                  : "border-white/10 bg-black/20 hover:bg-white/5"
              }`}
            >
              <p className="truncate text-sm font-semibold text-slate-100">{item.name}</p>
              <p className="mt-1 text-xs text-slate-400">{item.role}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="inline-flex rounded-full border border-white/10 bg-black/25 p-1">
        {(["DETAILS", "MANAGE"] as Surface[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setSurface(item)}
            className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
              surface === item ? "bg-emerald-500/15 text-emerald-300" : "text-slate-300"
            }`}
          >
            {item === "DETAILS" ? "Details" : "Manage"}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="inline-flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={14} className="animate-spin" />
          Loading organization details...
        </div>
      ) : surface === "DETAILS" ? (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className={`vx-panel space-y-4 rounded-3xl p-5 ${themeStyle.border}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    <Building2 size={12} />
                    Active Organization
                  </p>
                  <h3 className="text-2xl font-semibold text-slate-100">{organization?.name ?? "Organization"}</h3>
                  <p className="max-w-3xl text-sm text-slate-400">
                    {savedSnapshot.description || "No organization description added yet."}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-right">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Your role</p>
                  <p className="text-sm font-semibold text-slate-100">{actor?.roleLabel ?? "Member"}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{actor?.email ?? ""}</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {detailStats.map((item) => (
                  <Stat key={item.label} label={item.label} value={item.value} />
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Founder</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">
                    {savedSnapshot.founderName || "Not configured"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {savedSnapshot.founderEmail || "No founder email saved"}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    Record Timeline
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    Created {organization ? new Date(organization.createdAt).toLocaleString() : "N/A"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Updated {organization ? new Date(organization.updatedAt).toLocaleString() : "N/A"}
                  </p>
                </div>
              </div>
            </div>

            <div className={`vx-panel space-y-4 rounded-3xl p-5 ${themeStyle.border}`}>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  <Users size={12} />
                  Access Snapshot
                </p>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <Stat label="Founders" value={String(organization?.memberCounts.founders ?? 0)} />
                  <Stat label="Admins" value={String(organization?.memberCounts.admins ?? 0)} />
                  <Stat label="Employees" value={String(organization?.memberCounts.employees ?? 0)} />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Workforce Runtime</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Stat label="Human Profiles" value={String(organization?.workforce.humans ?? 0)} />
                  <Stat label="Agent Profiles" value={String(organization?.workforce.agents ?? 0)} />
                  <Stat label="Active Humans" value={String(organization?.workforce.activeHumans ?? 0)} />
                  <Stat label="Active Agents" value={String(organization?.workforce.activeAgents ?? 0)} />
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <TextBlock label="Products And Services" value={savedSnapshot.productsAndServices} />
            <TextBlock label="Goals" value={savedSnapshot.goalsText} />
            <TextBlock label="Current Priorities" value={savedSnapshot.prioritiesText} />
            <TextBlock label="Operating Rules" value={savedSnapshot.operatingRulesText} />
            <TextBlock label="Tools And Systems" value={savedSnapshot.toolsAndSystemsText} />
            <TextBlock label="Notes" value={savedSnapshot.notes} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className={`vx-panel space-y-3 rounded-3xl p-4 ${themeStyle.border}`}>
              <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                <FileText size={14} />
                Linked Documents
              </p>
              {savedSnapshot.documents.length === 0 ? (
                <p className="rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-sm text-slate-500">
                  No organization reference documents linked yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {savedSnapshot.documents.map((doc) => (
                    <div key={doc.url} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-100">{doc.name}</p>
                        <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                          {formatFileSize(doc.size)} | {new Date(doc.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <a href={doc.url} target="_blank" rel="noreferrer" className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-200">
                        Open
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`vx-panel space-y-3 rounded-3xl p-4 ${themeStyle.border}`}>
              <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                <FileText size={14} />
                Workflow Output
              </p>
              {orgOutput.length === 0 ? (
                <p className="rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-sm text-slate-500">
                  No workflow outputs have landed in the organization hub yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {orgOutput.map((file) => (
                    <div key={file.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-100">{file.name}</p>
                          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            {formatFileSize(file.size)} | Flow {file.sourceFlowId ?? "N/A"} | Task {file.sourceTaskId ?? "N/A"}
                          </p>
                        </div>
                        <a href={file.url} target="_blank" rel="noreferrer" className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-200">
                          Open
                        </a>
                      </div>
                      <pre className="mt-3 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/35 p-3 text-xs text-slate-300">
                        {file.outputPreview ?? "No preview available."}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="inline-flex rounded-full border border-white/10 bg-black/25 p-1">
            {(["DETAILS", "ACCESS"] as ManageTab[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setManageTab(item)}
                className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
                  manageTab === item ? "bg-cyan-500/15 text-cyan-300" : "text-slate-300"
                }`}
              >
                {item === "DETAILS" ? "Manage Details" : "Manage Access"}
              </button>
            ))}
          </div>

          {!actor?.isAdmin ? (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <span className="inline-flex items-center gap-2">
                <Lock size={14} />
                Founder or admin access is required to save changes. The controls below stay read-only for the wider workforce.
              </span>
            </div>
          ) : null}

          {manageTab === "DETAILS" ? (
            <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <div className={`vx-panel space-y-4 rounded-3xl p-5 ${themeStyle.border}`}>
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={editor.name} onChange={(event) => updateEditor((current) => ({ ...current, name: event.target.value }))} disabled={!actor?.isAdmin} placeholder="Organization name" className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none disabled:opacity-60" />
                  <select value={editor.theme} onChange={(event) => updateEditor((current) => ({ ...current, theme: normalizeTheme(event.target.value) }))} disabled={!actor?.isAdmin} className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none disabled:opacity-60">
                    <option value="APEX">APEX</option>
                    <option value="VEDA">VEDA</option>
                    <option value="NEXUS">NEXUS</option>
                  </select>
                  <select value={editor.executionMode} onChange={(event) => updateEditor((current) => ({ ...current, executionMode: normalizeExecutionMode(event.target.value) }))} disabled={!actor?.isAdmin} className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none disabled:opacity-60">
                    <option value="ECO">ECO</option>
                    <option value="BALANCED">BALANCED</option>
                    <option value="TURBO">TURBO</option>
                  </select>
                  <input value={editor.monthlyBudgetUsd} onChange={(event) => updateEditor((current) => ({ ...current, monthlyBudgetUsd: event.target.value }))} disabled={!actor?.isAdmin} placeholder="Monthly budget in USD" className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none disabled:opacity-60" />
                  <input value={editor.monthlyBtuCap} onChange={(event) => updateEditor((current) => ({ ...current, monthlyBtuCap: event.target.value }))} disabled={!actor?.isAdmin} placeholder="Monthly BTU cap" className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none disabled:opacity-60" />
                  <input value={editor.productsAndServices} onChange={(event) => updateEditor((current) => ({ ...current, productsAndServices: event.target.value }))} disabled={!actor?.isAdmin} placeholder="Products and services" className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none disabled:opacity-60" />
                </div>

                <textarea value={editor.description} onChange={(event) => updateEditor((current) => ({ ...current, description: event.target.value }))} disabled={!actor?.isAdmin} placeholder="Organization description" className="min-h-[120px] w-full rounded-3xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-100 outline-none disabled:opacity-60" />

                <div className="grid gap-3 md:grid-cols-2">
                  <textarea value={editor.goalsText} onChange={(event) => updateEditor((current) => ({ ...current, goalsText: event.target.value }))} disabled={!actor?.isAdmin} placeholder="Goals (one per line)" className="min-h-[140px] rounded-3xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-100 outline-none disabled:opacity-60" />
                  <textarea value={editor.prioritiesText} onChange={(event) => updateEditor((current) => ({ ...current, prioritiesText: event.target.value }))} disabled={!actor?.isAdmin} placeholder="Current priorities (one per line)" className="min-h-[140px] rounded-3xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-100 outline-none disabled:opacity-60" />
                  <textarea value={editor.operatingRulesText} onChange={(event) => updateEditor((current) => ({ ...current, operatingRulesText: event.target.value }))} disabled={!actor?.isAdmin} placeholder="Operating rules (one per line)" className="min-h-[140px] rounded-3xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-100 outline-none disabled:opacity-60" />
                  <textarea value={editor.toolsAndSystemsText} onChange={(event) => updateEditor((current) => ({ ...current, toolsAndSystemsText: event.target.value }))} disabled={!actor?.isAdmin} placeholder="Tools and systems (one per line)" className="min-h-[140px] rounded-3xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-100 outline-none disabled:opacity-60" />
                </div>

                <textarea value={editor.notes} onChange={(event) => updateEditor((current) => ({ ...current, notes: event.target.value }))} disabled={!actor?.isAdmin} placeholder="Operating notes" className="min-h-[120px] w-full rounded-3xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-slate-100 outline-none disabled:opacity-60" />

                <div className="grid gap-3 md:grid-cols-2">
                  <input value={editor.founderName} onChange={(event) => updateEditor((current) => ({ ...current, founderName: event.target.value }))} disabled={!actor?.isAdmin} placeholder="Founder name" className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none disabled:opacity-60" />
                  <input value={editor.founderEmail} onChange={(event) => updateEditor((current) => ({ ...current, founderEmail: event.target.value }))} disabled={!actor?.isAdmin} placeholder="Founder email" className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none disabled:opacity-60" />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" onClick={() => setShowJson((current) => !current)} className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300">
                    {showJson ? "Hide Advanced JSON" : "Show Advanced JSON"}
                  </button>
                  <div className="flex items-center gap-3">
                    <p className={`text-[10px] uppercase tracking-[0.16em] ${dirty ? "text-amber-300" : "text-slate-500"}`}>
                      {dirty ? "Unsaved changes" : "Synced"}
                    </p>
                    <button type="button" onClick={() => void handleSave()} disabled={saving || !actor?.isAdmin} className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300 disabled:opacity-60">
                      {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      Save Details
                    </button>
                  </div>
                </div>

                {showJson ? (
                  <textarea value={orgDraft} onChange={(event) => { setOrgDraft(event.target.value); setDirty(true); dirtyRef.current = true; }} disabled={!actor?.isAdmin} className="min-h-[220px] w-full rounded-3xl border border-white/10 bg-black/40 p-4 font-mono text-xs text-slate-200 outline-none disabled:opacity-60" />
                ) : null}
              </div>

              <div className={`vx-panel space-y-4 rounded-3xl p-5 ${themeStyle.border}`}>
                <div>
                  <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                    <UploadCloud size={14} />
                    Organization Documents
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Upload references that should stay attached to the organization record.
                  </p>
                </div>

                <form onSubmit={handleDocUpload} className="space-y-3">
                  <input value={docName} onChange={(event) => setDocName(event.target.value)} disabled={!actor?.isAdmin} placeholder="Document label" className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none disabled:opacity-60" />
                  <input type="file" onChange={(event) => setDocFile(event.target.files?.[0] ?? null)} disabled={!actor?.isAdmin} className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs disabled:opacity-60" />
                  <input value={docSourceUrl} onChange={(event) => setDocSourceUrl(event.target.value)} disabled={!actor?.isAdmin} placeholder="Or source URL" className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none disabled:opacity-60" />
                  <button type="submit" disabled={uploading || !actor?.isAdmin} className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300 disabled:opacity-60">
                    {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                    Upload Document
                  </button>
                </form>

                {editor.documents.length === 0 ? (
                  <p className="rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-sm text-slate-500">
                    No organization documents linked yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {editor.documents.map((doc) => (
                      <div key={doc.url} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-100">{doc.name}</p>
                          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            {formatFileSize(doc.size)} | {new Date(doc.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <a href={doc.url} target="_blank" rel="noreferrer" className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-200">
                            Open
                          </a>
                          <button type="button" onClick={() => updateEditor((current) => ({ ...current, documents: current.documents.filter((item) => item.url !== doc.url) }))} disabled={!actor?.isAdmin} className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-red-300 disabled:opacity-60">
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className={`vx-panel space-y-4 rounded-3xl p-5 ${themeStyle.border}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                    <KeyRound size={14} />
                    Organization Access Control
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Only founders and admins can change who manages organization details.
                  </p>
                </div>
                <div className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.16em] ${themeStyle.accentSoft}`}>
                  {actor?.isAdmin ? "Editable" : "Read only"}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <Stat label="Founders" value={String(organization?.memberCounts.founders ?? 0)} />
                <Stat label="Admins" value={String(organization?.memberCounts.admins ?? 0)} />
                <Stat label="Employees" value={String(organization?.memberCounts.employees ?? 0)} />
                <Stat label="Delegated" value={String(delegatedAccess.length)} />
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-200">
                      Organization Members
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Founder access stays fixed. Admins can still adjust member roles here.
                    </p>
                  </div>
                  <div className="space-y-3">
                    {members.map((member) => {
                      const draft = roleDrafts[member.userId] ?? member.role;
                      const founder = member.role === "FOUNDER";
                      return (
                        <article
                          key={member.userId}
                          className="rounded-2xl border border-white/10 bg-black/25 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-100">
                                {member.username}
                                {member.isActiveOrganization ? (
                                  <span className="ml-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-emerald-300">
                                    Active Org
                                  </span>
                                ) : null}
                              </p>
                              <p className="truncate text-xs text-slate-400">{member.email}</p>
                              <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                                Joined {new Date(member.joinedAt).toLocaleDateString()} | Current{" "}
                                {member.roleLabel}
                              </p>
                            </div>

                            {founder ? (
                              <div className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-amber-300">
                                Founder access is fixed
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  value={draft}
                                  onChange={(event) =>
                                    setRoleDrafts((current) => ({
                                      ...current,
                                      [member.userId]: event.target.value as MembershipRole
                                    }))
                                  }
                                  disabled={!actor?.isAdmin}
                                  className="rounded-full border border-white/10 bg-black/40 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-100 outline-none disabled:opacity-60"
                                >
                                  <option value="ADMIN">ADMIN</option>
                                  <option value="EMPLOYEE">EMPLOYEE</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => void handleRoleSave(member)}
                                  disabled={
                                    !actor?.isAdmin ||
                                    draft === member.role ||
                                    savingMemberId === member.userId
                                  }
                                  className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300 disabled:opacity-60"
                                >
                                  {savingMemberId === member.userId ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <Save size={12} />
                                  )}
                                  Save access
                                </button>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <section className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-200">
                      Delegated Access
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Add or remove direct member, workforce, and team-level managers.
                    </p>
                  </div>

                  {delegatedAccess.length === 0 ? (
                    <p className="rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-sm text-slate-500">
                      No delegated access entries are configured yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {delegatedAccess.map((entry) => {
                        const key = accessKey(entry.kind, entry.targetId);
                        return (
                          <article
                            key={key}
                            className="rounded-2xl border border-white/10 bg-black/25 p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${accessBadgeClass(entry.kind)}`}
                                  >
                                    {accessKindLabel(entry.kind)}
                                  </span>
                                  <p className="text-sm font-semibold text-slate-100">
                                    {entry.label}
                                  </p>
                                </div>
                                <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                                  {entry.secondaryLabel ?? "Delegated access entry"} |{" "}
                                  {entry.resolved ? "Resolved" : "Missing target"}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                                  {entry.badgeLabel}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleAccessMutation(entry, "REMOVE")}
                                  disabled={!actor?.isAdmin || savingAccessKey === key}
                                  className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-red-300 disabled:opacity-60"
                                >
                                  {savingAccessKey === key ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <Trash2 size={12} />
                                  )}
                                  Remove
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}

                  <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-200">
                      Add Delegated Access
                    </p>

                    <div className="space-y-2">
                      {accessCandidates.members.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                            Organization Members
                          </p>
                          {accessCandidates.members.map((candidate) => {
                            const key = accessKey(candidate.kind, candidate.targetId);
                            return (
                              <article
                                key={key}
                                className="rounded-2xl border border-white/10 bg-black/25 p-4"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span
                                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${accessBadgeClass(candidate.kind)}`}
                                      >
                                        {accessKindLabel(candidate.kind)}
                                      </span>
                                      <p className="text-sm font-semibold text-slate-100">
                                        {candidate.label}
                                      </p>
                                    </div>
                                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                                      {candidate.secondaryLabel}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void handleAccessMutation(candidate, "ADD")}
                                    disabled={
                                      !actor?.isAdmin || candidate.disabled || savingAccessKey === key
                                    }
                                    className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300 disabled:opacity-60"
                                  >
                                    {candidate.disabled ? (
                                      "Added"
                                    ) : savingAccessKey === key ? (
                                      <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                      <Plus size={12} />
                                    )}
                                    {candidate.disabled ? null : "Add"}
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      ) : null}

                      {accessCandidates.personnel.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                            Workforce Personnel
                          </p>
                          {accessCandidates.personnel.map((candidate) => {
                            const key = accessKey(candidate.kind, candidate.targetId);
                            return (
                              <article
                                key={key}
                                className="rounded-2xl border border-white/10 bg-black/25 p-4"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span
                                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${accessBadgeClass(candidate.kind)}`}
                                      >
                                        {accessKindLabel(candidate.kind)}
                                      </span>
                                      <p className="text-sm font-semibold text-slate-100">
                                        {candidate.label}
                                      </p>
                                    </div>
                                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                                      {candidate.secondaryLabel}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void handleAccessMutation(candidate, "ADD")}
                                    disabled={
                                      !actor?.isAdmin || candidate.disabled || savingAccessKey === key
                                    }
                                    className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300 disabled:opacity-60"
                                  >
                                    {candidate.disabled ? (
                                      "Added"
                                    ) : savingAccessKey === key ? (
                                      <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                      <Plus size={12} />
                                    )}
                                    {candidate.disabled ? null : "Add"}
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      ) : null}

                      {accessCandidates.teams.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                            Virtual Teams
                          </p>
                          {accessCandidates.teams.map((candidate) => {
                            const key = accessKey(candidate.kind, candidate.targetId);
                            return (
                              <article
                                key={key}
                                className="rounded-2xl border border-white/10 bg-black/25 p-4"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span
                                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${accessBadgeClass(candidate.kind)}`}
                                      >
                                        {accessKindLabel(candidate.kind)}
                                      </span>
                                      <p className="text-sm font-semibold text-slate-100">
                                        {candidate.label}
                                      </p>
                                    </div>
                                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                                      {candidate.secondaryLabel}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void handleAccessMutation(candidate, "ADD")}
                                    disabled={
                                      !actor?.isAdmin || candidate.disabled || savingAccessKey === key
                                    }
                                    className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300 disabled:opacity-60"
                                  >
                                    {candidate.disabled ? (
                                      "Added"
                                    ) : savingAccessKey === key ? (
                                      <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                      <Plus size={12} />
                                    )}
                                    {candidate.disabled ? null : "Add"}
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
