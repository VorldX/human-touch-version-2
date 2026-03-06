"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  UploadCloud
} from "lucide-react";

import { DnaMemoryPanel } from "@/components/hub/dna-memory-panel";
import { DirectionalHub } from "@/components/hub/directional-hub";
import { StorageHub } from "@/components/hub/storage-hub";
import { ToolsHub } from "@/components/hub/tools-hub";
import { parseJsonResponse } from "@/lib/http/json-response";
import { useVorldXStore } from "@/lib/store/vorldx-store";

type HubScope = "ORGANIZATIONAL" | "DIRECTIONAL" | "WORKFLOW" | "DNA" | "STORAGE" | "TOOLS";
type WorkflowLane = "QUEUED" | "INPUT" | "INPROCESS" | "OUTPUT";

interface HubConsoleProps {
  orgId: string;
  themeStyle: {
    accent: string;
    accentSoft: string;
    border: string;
  };
  initialScope?: HubScope;
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

type ExecutionModeValue = "ECO" | "BALANCED" | "TURBO";

interface CompanyDataEditorState {
  name: string;
  description: string;
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

function emptyCompanyDataEditorState(): CompanyDataEditorState {
  return {
    name: "",
    description: "",
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

interface WorkflowHubItem {
  id: string;
  lane: WorkflowLane;
  status: string;
  subtaskLabel: string;
  assignment: string;
  agentPlan: string;
  specificPrompt: string;
  requiredFiles: Array<{ id: string; name: string }>;
  blockedByLocks: Array<{
    lockId: string;
    fileName: string;
    lockOwnerTaskId: string | null;
    lockOwnerAgent: string | null;
  }>;
  independentTag: string;
  readyForIndependentWork: boolean;
  done: boolean;
  remainingInFlow: number;
  flowId: string;
  output: { fileName: string; preview: string | null } | null;
}

interface DnaFileItem {
  id: string;
  name: string;
  size: string;
  url: string;
  health: number;
  isAmnesiaProtected: boolean;
  metadata: Record<string, unknown> | null;
}

function formatFileSize(raw: string) {
  const bytes = Number(raw);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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
    .filter((item) => item.length > 0);
}

function linesFromList(value: unknown) {
  return asStringList(value).join("\n");
}

function listFromLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseCompanyDataEditor(content: string): CompanyDataEditorState {
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
    ? parsed?.companyDocuments
        .map((item) => {
          const doc = asRecord(item);
          const id = asString(doc.id).trim();
          const name = asString(doc.name).trim();
          const url = asString(doc.url).trim();
          if (!name || !url) return null;
          return {
            id,
            name,
            url,
            size: asString(doc.size).trim() || "0",
            updatedAt: asString(doc.updatedAt).trim() || new Date().toISOString(),
            contentType: asString(doc.contentType).trim() || null
          } satisfies OrganizationalDocument;
        })
        .filter((item): item is OrganizationalDocument => Boolean(item))
    : [];

  const executionModeRaw = asString(company.executionMode).trim().toUpperCase();
  const executionMode: ExecutionModeValue =
    executionModeRaw === "ECO" || executionModeRaw === "TURBO" ? executionModeRaw : "BALANCED";

  return {
    name: asString(company.name).trim(),
    description: asString(company.description).trim() || content,
    productsAndServices: asString(businessContext.productsAndServices).trim(),
    goalsText: linesFromList(businessContext.goals),
    prioritiesText: linesFromList(businessContext.currentPriorities),
    operatingRulesText: linesFromList(businessContext.operatingRules),
    toolsAndSystemsText: linesFromList(businessContext.toolsAndSystems),
    notes: asString(businessContext.notes).trim(),
    founderName: asString(founder.username).trim(),
    founderEmail: asString(founder.email).trim(),
    executionMode,
    monthlyBudgetUsd: asString(financials.monthlyBudgetUsd).trim(),
    monthlyBtuCap: asString(financials.monthlyBtuCap).trim(),
    documents,
    baseData: parsed
  };
}

function mergeCompanyDocuments(
  editorDocuments: OrganizationalDocument[],
  storedDocuments: OrganizationalDocument[]
) {
  const byUrl = new Map<string, OrganizationalDocument>();
  for (const doc of [...storedDocuments, ...editorDocuments]) {
    if (!doc.url) continue;
    byUrl.set(doc.url, doc);
  }
  return [...byUrl.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function buildCompanyDataJsonText(
  editor: CompanyDataEditorState,
  orgId: string,
  previousContent: string
) {
  const base = asRecord(editor.baseData ?? {});
  const existingCompany = asRecord(base.company);
  const existingFinancials = asRecord(base.financials);
  const existingFounder = asRecord(base.founder);
  const existingBusiness = asRecord(base.businessContext);

  const next = {
    ...base,
    company: {
      ...existingCompany,
      orgId,
      name: editor.name || asString(existingCompany.name) || "Organization",
      description: editor.description || previousContent,
      executionMode: editor.executionMode
    },
    financials: {
      ...existingFinancials,
      monthlyBudgetUsd:
        editor.monthlyBudgetUsd || asString(existingFinancials.monthlyBudgetUsd) || "0",
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
    companyDocuments: editor.documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      size: doc.size,
      url: doc.url,
      updatedAt: doc.updatedAt,
      contentType: doc.contentType
    })),
    lastUpdatedAt: new Date().toISOString()
  };

  return JSON.stringify(next, null, 2);
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 px-2 py-2 text-center">
      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="text-sm font-bold text-slate-200">{value}</p>
    </div>
  );
}

export function HubConsole({ orgId, themeStyle, initialScope }: HubConsoleProps) {
  const notify = useVorldXStore((state) => state.pushNotification);

  const [scope, setScope] = useState<HubScope>(initialScope ?? "ORGANIZATIONAL");
  const [refreshing, setRefreshing] = useState(false);

  const [orgInput, setOrgInput] = useState<OrganizationalInput | null>(null);
  const [orgOutput, setOrgOutput] = useState<OrganizationalOutput[]>([]);
  const [orgDraft, setOrgDraft] = useState("");
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [showRawCompanyJson, setShowRawCompanyJson] = useState(false);
  const [companyEditor, setCompanyEditor] = useState<CompanyDataEditorState>(
    () => emptyCompanyDataEditorState()
  );
  const [companyDocUploading, setCompanyDocUploading] = useState(false);
  const [companyDocFile, setCompanyDocFile] = useState<File | null>(null);
  const [companyDocSourceUrl, setCompanyDocSourceUrl] = useState("");
  const [companyDocName, setCompanyDocName] = useState("");
  const [orgEditorDirty, setOrgEditorDirty] = useState(false);

  const [workflowLane, setWorkflowLane] = useState<WorkflowLane>("QUEUED");
  const [workflowItems, setWorkflowItems] = useState<WorkflowHubItem[]>([]);
  const [workflowCounts, setWorkflowCounts] = useState<Record<WorkflowLane, number>>({
    QUEUED: 0,
    INPUT: 0,
    INPROCESS: 0,
    OUTPUT: 0
  });
  const [workflowLoading, setWorkflowLoading] = useState(true);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  const [dnaFiles, setDnaFiles] = useState<DnaFileItem[]>([]);
  const [dnaLoading, setDnaLoading] = useState(true);
  const [dnaError, setDnaError] = useState<string | null>(null);
  const [dnaUploading, setDnaUploading] = useState(false);
  const [dnaSelectedFile, setDnaSelectedFile] = useState<File | null>(null);
  const [dnaSourceUrl, setDnaSourceUrl] = useState("");
  const [dnaName, setDnaName] = useState("");
  const [dnaAmnesia, setDnaAmnesia] = useState(false);
  const [readingFileId, setReadingFileId] = useState<string | null>(null);
  const [ingestingFileId, setIngestingFileId] = useState<string | null>(null);
  const [dnaPreview, setDnaPreview] = useState<{
    fileName: string;
    contentPreview: string | null;
    amnesiaWiped: boolean;
    proof?: string;
  } | null>(null);
  const orgEditorDirtyRef = useRef(false);
  const orgEditorHydratedRef = useRef(false);

  const updateCompanyEditor = useCallback(
    (updater: (current: CompanyDataEditorState) => CompanyDataEditorState) => {
      setCompanyEditor((current) => updater(current));
      setOrgEditorDirty(true);
      orgEditorDirtyRef.current = true;
    },
    []
  );

  const loadOrganizational = useCallback(
    async (silent?: boolean) => {
      if (!silent) setOrgLoading(true);
      try {
        const response = await fetch(`/api/hub/organization?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store"
        });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          input?: OrganizationalInput;
          documents?: OrganizationalDocument[];
          output?: OrganizationalOutput[];
        }>(response);

        if (!response.ok || !payload?.ok || !payload?.input) {
          setOrgError(
            payload?.message ??
              (rawText
                ? `Failed to load Organizational Hub (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed to load Organizational Hub.")
          );
          return;
        }

        const input = payload?.input;
        if (!input) {
          setOrgError("Failed to load Organizational Hub.");
          return;
        }
        setOrgError(null);
        setOrgInput(input);
        setOrgOutput(payload?.output ?? []);
        const parsedEditor = parseCompanyDataEditor(input.content);
        const mergedDocuments = mergeCompanyDocuments(
          parsedEditor.documents,
          payload?.documents ?? []
        );

        if (!orgEditorDirtyRef.current || !orgEditorHydratedRef.current) {
          setOrgDraft(input.content);
          setCompanyEditor({
            ...parsedEditor,
            documents: mergedDocuments
          });
          setOrgEditorDirty(false);
          orgEditorDirtyRef.current = false;
          orgEditorHydratedRef.current = true;
        } else {
          setCompanyEditor((current) => ({
            ...current,
            documents: mergeCompanyDocuments(current.documents, mergedDocuments)
          }));
        }
      } catch (error) {
        setOrgError(error instanceof Error ? error.message : "Failed to load Organizational Hub.");
      } finally {
        if (!silent) setOrgLoading(false);
      }
    },
    [orgId]
  );

  const loadWorkflowHub = useCallback(
    async (silent?: boolean) => {
      if (!silent) setWorkflowLoading(true);
      try {
        const response = await fetch(`/api/hub/workflow?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store"
        });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          lanes?: Record<WorkflowLane, number>;
          items?: WorkflowHubItem[];
        }>(response);

        if (!response.ok || !payload?.ok || !payload?.items || !payload?.lanes) {
          setWorkflowError(
            payload?.message ??
              (rawText
                ? `Failed to load Workflow Hub (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed to load Workflow Hub.")
          );
          return;
        }

        setWorkflowError(null);
        setWorkflowItems(payload?.items ?? []);
        setWorkflowCounts(payload?.lanes ?? { QUEUED: 0, INPUT: 0, INPROCESS: 0, OUTPUT: 0 });
      } catch (error) {
        setWorkflowError(error instanceof Error ? error.message : "Failed to load Workflow Hub.");
      } finally {
        if (!silent) setWorkflowLoading(false);
      }
    },
    [orgId]
  );

  const loadDna = useCallback(
    async (silent?: boolean) => {
      if (!silent) setDnaLoading(true);
      try {
        const response = await fetch(`/api/hub/files?orgId=${encodeURIComponent(orgId)}&tab=DNA`, {
          cache: "no-store"
        });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          files?: DnaFileItem[];
        }>(response);

        if (!response.ok || !payload?.ok || !payload?.files) {
          setDnaError(
            payload?.message ??
              (rawText
                ? `Failed to load DNA files (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed to load DNA files.")
          );
          return;
        }

        setDnaError(null);
        setDnaFiles(payload?.files ?? []);
      } catch (error) {
        setDnaError(error instanceof Error ? error.message : "Failed to load DNA files.");
      } finally {
        if (!silent) setDnaLoading(false);
      }
    },
    [orgId]
  );

  const refreshCurrent = useCallback(async () => {
    setRefreshing(true);
    try {
      if (scope === "ORGANIZATIONAL") await loadOrganizational();
      else if (scope === "WORKFLOW") await loadWorkflowHub();
      else if (scope === "DNA") await loadDna();
    } finally {
      setRefreshing(false);
    }
  }, [loadDna, loadOrganizational, loadWorkflowHub, scope]);

  useEffect(() => {
    if (!initialScope) {
      return;
    }
    setScope(initialScope);
  }, [initialScope]);

  useEffect(() => {
    setOrgEditorDirty(false);
    orgEditorDirtyRef.current = false;
    orgEditorHydratedRef.current = false;
    setShowRawCompanyJson(false);
    setOrgInput(null);
    setOrgOutput([]);
    setOrgDraft("");
    setCompanyEditor(emptyCompanyDataEditorState());
    setCompanyDocFile(null);
    setCompanyDocSourceUrl("");
    setCompanyDocName("");
  }, [orgId]);

  useEffect(() => {
    if (scope === "ORGANIZATIONAL") {
      void loadOrganizational();
      const timer = setInterval(() => void loadOrganizational(true), 8000);
      return () => clearInterval(timer);
    }

    if (scope === "WORKFLOW") {
      void loadWorkflowHub();
      const timer = setInterval(() => void loadWorkflowHub(true), 5000);
      return () => clearInterval(timer);
    }

    if (scope === "DNA") {
      void loadDna();
      const timer = setInterval(() => void loadDna(true), 7000);
      return () => clearInterval(timer);
    }

    return undefined;
  }, [loadDna, loadOrganizational, loadWorkflowHub, scope]);

  const saveCompanyData = useCallback(
    async (contentOverride?: string, options?: { silentSuccess?: boolean }) => {
      const content = contentOverride ?? orgDraft;
      if (!content.trim()) {
        notify({
          title: "Company Data",
          message: "Company data content is empty.",
          type: "warning"
        });
        return;
      }

      setOrgSaving(true);
      try {
        const response = await fetch("/api/hub/organization", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, content })
        });
        const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(response);

        if (!response.ok || !payload?.ok) {
          notify({
            title: "Company Data",
            message:
              payload?.message ??
              (rawText
                ? `Failed to save Company Data (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed to save Company Data."),
            type: "error"
          });
          return;
        }

        if (!options?.silentSuccess) {
          notify({ title: "Company Data", message: "Company Data updated.", type: "success" });
        }
        setOrgDraft(content);
        setOrgEditorDirty(false);
        orgEditorDirtyRef.current = false;
        orgEditorHydratedRef.current = true;
        await loadOrganizational(true);
      } finally {
        setOrgSaving(false);
      }
    },
    [loadOrganizational, notify, orgDraft, orgId]
  );

  const handleSaveCompanyEditor = useCallback(async () => {
    const nextContent = buildCompanyDataJsonText(companyEditor, orgId, orgDraft);
    setOrgDraft(nextContent);
    await saveCompanyData(nextContent);
  }, [companyEditor, orgDraft, orgId, saveCompanyData]);

  const handleSaveCompanyData = useCallback(async () => {
    if (showRawCompanyJson) {
      await saveCompanyData(orgDraft);
      const parsedEditor = parseCompanyDataEditor(orgDraft);
      setCompanyEditor((current) => ({
        ...parsedEditor,
        documents: mergeCompanyDocuments(parsedEditor.documents, current.documents)
      }));
      return;
    }
    await handleSaveCompanyEditor();
  }, [handleSaveCompanyEditor, orgDraft, saveCompanyData, showRawCompanyJson]);

  const handleCompanyDocumentUpload = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!companyDocFile && !companyDocSourceUrl.trim()) {
        notify({
          title: "Company Document",
          message: "Choose a file or source URL first.",
          type: "warning"
        });
        return;
      }

      setCompanyDocUploading(true);
      try {
        const formData = new FormData();
        formData.set("orgId", orgId);
        formData.set("type", "INPUT");
        if (companyDocName.trim()) {
          formData.set("name", companyDocName.trim());
        }
        if (companyDocFile) {
          formData.set("file", companyDocFile);
          if (!companyDocName.trim()) {
            formData.set("name", companyDocFile.name);
          }
        }
        if (companyDocSourceUrl.trim()) {
          formData.set("sourceUrl", companyDocSourceUrl.trim());
          if (!companyDocName.trim()) {
            formData.set("name", "company-reference");
          }
        }

        const response = await fetch("/api/hub/files", {
          method: "POST",
          body: formData
        });
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

        if (!response.ok || !payload?.ok || !payload?.file?.url || !payload?.file?.name) {
          notify({
            title: "Company Document",
            message:
              payload?.message ??
              (rawText
                ? `Failed to upload company document (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed to upload company document."),
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
          ...companyEditor,
          documents: mergeCompanyDocuments(companyEditor.documents, [uploadedDoc])
        };
        setCompanyEditor(nextEditor);

        const nextContent = buildCompanyDataJsonText(nextEditor, orgId, orgDraft);
        setOrgDraft(nextContent);
        await saveCompanyData(nextContent, { silentSuccess: true });

        notify({
          title: "Company Document",
          message: "Document uploaded and linked to company data.",
          type: "success"
        });
        setCompanyDocName("");
        setCompanyDocFile(null);
        setCompanyDocSourceUrl("");
      } finally {
        setCompanyDocUploading(false);
      }
    },
    [
      companyDocFile,
      companyDocName,
      companyDocSourceUrl,
      companyEditor,
      notify,
      orgDraft,
      orgId,
      saveCompanyData
    ]
  );

  const handleRemoveCompanyDocument = useCallback(
    (url: string) => {
      updateCompanyEditor((current) => ({
        ...current,
        documents: current.documents.filter((doc) => doc.url !== url)
      }));
    },
    [updateCompanyEditor]
  );

  const handleDnaUpload = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setDnaUploading(true);
      try {
        const formData = new FormData();
        formData.set("orgId", orgId);
        formData.set("type", "DNA");
        formData.set("name", dnaName.trim());
        formData.set("isAmnesiaProtected", String(dnaAmnesia));
        if (dnaSelectedFile) formData.set("file", dnaSelectedFile);
        if (dnaSourceUrl.trim()) formData.set("sourceUrl", dnaSourceUrl.trim());

        const response = await fetch("/api/hub/files", { method: "POST", body: formData });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          warning?: string;
        }>(response);

        if (!response.ok || !payload?.ok) {
          notify({
            title: "DNA Upload Failed",
            message:
              payload?.message ??
              (rawText
                ? `Unable to upload DNA file (${response.status}): ${rawText.slice(0, 180)}`
                : "Unable to upload DNA file."),
            type: "error"
          });
          return;
        }

        notify({
          title: "DNA Upload",
          message: payload?.warning ?? "DNA file uploaded.",
          type: payload?.warning ? "warning" : "success"
        });
        setDnaName("");
        setDnaSourceUrl("");
        setDnaSelectedFile(null);
        setDnaAmnesia(false);
        await loadDna(true);
      } finally {
        setDnaUploading(false);
      }
    },
    [dnaAmnesia, dnaName, dnaSelectedFile, dnaSourceUrl, loadDna, notify, orgId]
  );

  const handleDnaRead = useCallback(
    async (file: DnaFileItem) => {
      setReadingFileId(file.id);
      try {
        const response = await fetch(
          `/api/hub/files/${file.id}/read?orgId=${encodeURIComponent(orgId)}`,
          { cache: "no-store" }
        );
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          contentPreview?: string | null;
          amnesiaWiped?: boolean;
          proof?: string;
        }>(response);

        if (!response.ok || !payload?.ok) {
          notify({
            title: "DNA Read Failed",
            message:
              payload?.message ??
              (rawText
                ? `Unable to read DNA file (${response.status}): ${rawText.slice(0, 180)}`
                : "Unable to read DNA file."),
            type: "error"
          });
          return;
        }

        setDnaPreview({
          fileName: file.name,
          contentPreview: payload?.contentPreview ?? null,
          amnesiaWiped: Boolean(payload?.amnesiaWiped),
          proof: payload?.proof
        });
      } finally {
        setReadingFileId(null);
      }
    },
    [notify, orgId]
  );

  const handleDnaIngest = useCallback(
    async (file: DnaFileItem) => {
      setIngestingFileId(file.id);
      try {
        const response = await fetch(`/api/hub/files/${file.id}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId })
        });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          warning?: string;
        }>(response);

        if (!response.ok || !payload?.ok) {
          notify({
            title: "DNA Ingest Failed",
            message:
              payload?.message ??
              (rawText
                ? `Unable to queue DNA ingest (${response.status}): ${rawText.slice(0, 180)}`
                : "Unable to queue DNA ingest."),
            type: "error"
          });
          return;
        }

        notify({
          title: "DNA Ingest",
          message: payload?.warning ?? payload?.message ?? "DNA ingest queued.",
          type: payload?.warning ? "warning" : "success"
        });
        await loadDna(true);
      } finally {
        setIngestingFileId(null);
      }
    },
    [loadDna, notify, orgId]
  );

  const dnaStats = useMemo(() => {
    const queued = dnaFiles.filter((file) => (file.metadata?.ingestStatus as string) === "queued").length;
    const processing = dnaFiles.filter((file) => (file.metadata?.ingestStatus as string) === "processing").length;
    const completed = dnaFiles.filter((file) => (file.metadata?.ingestStatus as string) === "completed").length;
    return { queued, processing, completed };
  }, [dnaFiles]);

  const filteredWorkflowItems = useMemo(
    () => workflowItems.filter((item) => item.lane === workflowLane),
    [workflowItems, workflowLane]
  );

  return (
    <div className="mx-auto max-w-[1380px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h2 className="font-display text-3xl font-black uppercase tracking-tight md:text-4xl">Hub</h2>
          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
            Organizational / Directional / Workflow / DNA / Storage / Tools
          </p>
        </div>
        <button
          onClick={() => void refreshCurrent()}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-200"
        >
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { key: "ORGANIZATIONAL" as const, label: "Organizational Hub" },
          { key: "DIRECTIONAL" as const, label: "Directional Hub" },
          { key: "WORKFLOW" as const, label: "Workflow Hub" },
          { key: "DNA" as const, label: "DNA Hub" },
          { key: "STORAGE" as const, label: "Storage Hub" },
          { key: "TOOLS" as const, label: "Organizational Tools" }
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setScope(item.key)}
            className={`rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] ${
              scope === item.key
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : "border-white/20 bg-white/5 text-slate-300"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {scope === "ORGANIZATIONAL" && (
        <div className="grid gap-4 2xl:grid-cols-[1.1fr_0.9fr]">
          <div className={`vx-panel min-w-0 space-y-3 rounded-3xl p-4 ${themeStyle.border}`}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                Organizational Input
              </p>
              <span className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${themeStyle.accentSoft}`}>
                File: Company Data
              </span>
            </div>

            {orgError && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {orgError}
              </div>
            )}

            {orgLoading ? (
              <div className="inline-flex items-center gap-2 text-sm text-slate-400">
                <Loader2 size={14} className="animate-spin" />
                Loading organizational input...
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Organization Name</span>
                    <input
                      value={companyEditor.name}
                      onChange={(event) =>
                        updateCompanyEditor((current) => ({ ...current, name: event.target.value }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Execution Mode</span>
                    <select
                      value={companyEditor.executionMode}
                      onChange={(event) =>
                        updateCompanyEditor((current) => ({
                          ...current,
                          executionMode: event.target.value as ExecutionModeValue
                        }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    >
                      <option value="ECO">ECO</option>
                      <option value="BALANCED">BALANCED</option>
                      <option value="TURBO">TURBO</option>
                    </select>
                  </label>
                </div>

                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Company Description</span>
                  <textarea
                    value={companyEditor.description}
                    onChange={(event) =>
                      updateCompanyEditor((current) => ({
                        ...current,
                        description: event.target.value
                      }))
                    }
                    className="min-h-[120px] w-full resize-y rounded-2xl border border-white/10 bg-black/40 p-3 text-sm text-slate-200 outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Products and Services</span>
                  <textarea
                    value={companyEditor.productsAndServices}
                    onChange={(event) =>
                      updateCompanyEditor((current) => ({
                        ...current,
                        productsAndServices: event.target.value
                      }))
                    }
                    className="min-h-[90px] w-full resize-y rounded-2xl border border-white/10 bg-black/40 p-3 text-sm text-slate-200 outline-none"
                  />
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Business Goals (one per line)</span>
                    <textarea
                      value={companyEditor.goalsText}
                      onChange={(event) =>
                        updateCompanyEditor((current) => ({ ...current, goalsText: event.target.value }))
                      }
                      className="min-h-[110px] w-full resize-y rounded-2xl border border-white/10 bg-black/40 p-3 text-sm text-slate-200 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Current Priorities (one per line)</span>
                    <textarea
                      value={companyEditor.prioritiesText}
                      onChange={(event) =>
                        updateCompanyEditor((current) => ({ ...current, prioritiesText: event.target.value }))
                      }
                      className="min-h-[110px] w-full resize-y rounded-2xl border border-white/10 bg-black/40 p-3 text-sm text-slate-200 outline-none"
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Operating Rules (one per line)</span>
                    <textarea
                      value={companyEditor.operatingRulesText}
                      onChange={(event) =>
                        updateCompanyEditor((current) => ({ ...current, operatingRulesText: event.target.value }))
                      }
                      className="min-h-[110px] w-full resize-y rounded-2xl border border-white/10 bg-black/40 p-3 text-sm text-slate-200 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Tools and Systems (one per line)</span>
                    <textarea
                      value={companyEditor.toolsAndSystemsText}
                      onChange={(event) =>
                        updateCompanyEditor((current) => ({ ...current, toolsAndSystemsText: event.target.value }))
                      }
                      className="min-h-[110px] w-full resize-y rounded-2xl border border-white/10 bg-black/40 p-3 text-sm text-slate-200 outline-none"
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Founder Name</span>
                    <input
                      value={companyEditor.founderName}
                      onChange={(event) =>
                        updateCompanyEditor((current) => ({ ...current, founderName: event.target.value }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Founder Email</span>
                    <input
                      value={companyEditor.founderEmail}
                      onChange={(event) =>
                        updateCompanyEditor((current) => ({ ...current, founderEmail: event.target.value }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Monthly Budget (USD)</span>
                    <input
                      value={companyEditor.monthlyBudgetUsd}
                      onChange={(event) =>
                        updateCompanyEditor((current) => ({ ...current, monthlyBudgetUsd: event.target.value }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Monthly BTU Cap</span>
                    <input
                      value={companyEditor.monthlyBtuCap}
                      onChange={(event) =>
                        updateCompanyEditor((current) => ({ ...current, monthlyBtuCap: event.target.value }))
                      }
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                    />
                  </label>
                </div>

                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Additional Notes</span>
                  <textarea
                    value={companyEditor.notes}
                    onChange={(event) =>
                      updateCompanyEditor((current) => ({ ...current, notes: event.target.value }))
                    }
                    className="min-h-[90px] w-full resize-y rounded-2xl border border-white/10 bg-black/40 p-3 text-sm text-slate-200 outline-none"
                  />
                </label>

                <form onSubmit={handleCompanyDocumentUpload} className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
                    Company Documents (linked to company data)
                  </p>
                  <input
                    value={companyDocName}
                    onChange={(event) => setCompanyDocName(event.target.value)}
                    placeholder="Document name (optional)"
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                  <input
                    type="file"
                    onChange={(event) => setCompanyDocFile(event.target.files?.[0] ?? null)}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs"
                  />
                  <input
                    value={companyDocSourceUrl}
                    onChange={(event) => setCompanyDocSourceUrl(event.target.value)}
                    placeholder="Or source URL"
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                  <button
                    type="submit"
                    disabled={companyDocUploading}
                    className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300 disabled:opacity-60"
                  >
                    {companyDocUploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                    Upload Document
                  </button>
                  {companyEditor.documents.length > 0 ? (
                    <div className="space-y-2 pt-1">
                      {companyEditor.documents.map((doc) => (
                        <div key={doc.url} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs text-slate-200">{doc.name}</p>
                            <p className="truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">
                              {formatFileSize(doc.size)} | {new Date(doc.updatedAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <a
                              href={doc.url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-200"
                            >
                              Open
                            </a>
                            <button
                              type="button"
                              onClick={() => handleRemoveCompanyDocument(doc.url)}
                              className="rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-red-300"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">No company documents linked yet.</p>
                  )}
                </form>

                <button
                  type="button"
                  onClick={() => setShowRawCompanyJson((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300"
                >
                  {showRawCompanyJson ? "Hide Raw JSON" : "Show Raw JSON"}
                </button>

                {showRawCompanyJson ? (
                  <textarea
                    value={orgDraft}
                    onChange={(event) => {
                      setOrgDraft(event.target.value);
                      setOrgEditorDirty(true);
                      orgEditorDirtyRef.current = true;
                    }}
                    className="min-h-[220px] w-full resize-y rounded-2xl border border-white/10 bg-black/40 p-3 font-mono text-xs text-slate-200 outline-none"
                  />
                ) : null}

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      {orgInput ? `Updated: ${new Date(orgInput.updatedAt).toLocaleString()}` : "No file loaded"}
                    </p>
                    {orgEditorDirty ? (
                      <p className="text-[10px] uppercase tracking-[0.16em] text-amber-300">
                        Unsaved local changes
                      </p>
                    ) : null}
                  </div>
                  <button
                    onClick={() => void handleSaveCompanyData()}
                    disabled={
                      orgSaving ||
                      (showRawCompanyJson
                        ? orgDraft.trim().length === 0
                        : companyEditor.description.trim().length === 0)
                    }
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300 disabled:opacity-60"
                  >
                    {orgSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    Save Company Data
                  </button>
                </div>
              </>
            )}
          </div>

          <div className={`vx-panel min-w-0 space-y-3 rounded-3xl p-4 ${themeStyle.border}`}>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
              Organizational Output
            </p>
            {orgLoading ? (
              <div className="inline-flex items-center gap-2 text-sm text-slate-400">
                <Loader2 size={14} className="animate-spin" />
                Loading output...
              </div>
            ) : orgOutput.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs uppercase tracking-[0.16em] text-slate-500">
                No workflow outputs yet.
              </p>
            ) : (
              <div className="min-w-0 space-y-3">
                {orgOutput.map((file) => (
                  <div key={file.id} className="min-w-0 rounded-2xl border border-white/10 bg-black/25 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">{file.name}</p>
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-200"
                      >
                        Open
                      </a>
                    </div>
                    <p className="mt-1 break-all text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      {formatFileSize(file.size)} | Flow {file.sourceFlowId ?? "N/A"} | Task {file.sourceTaskId ?? "N/A"}
                    </p>
                    <pre className="mt-2 max-h-28 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-xl border border-white/10 bg-black/40 p-2 text-xs text-slate-300">
                      {file.outputPreview ?? "No preview available."}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {scope === "WORKFLOW" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(["QUEUED", "INPUT", "INPROCESS", "OUTPUT"] as WorkflowLane[]).map((lane) => (
              <button
                key={lane}
                onClick={() => setWorkflowLane(lane)}
                className={`rounded-full border px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] ${
                  workflowLane === lane
                    ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300"
                    : "border-white/20 bg-white/5 text-slate-300"
                }`}
              >
                {lane} ({workflowCounts[lane]})
              </button>
            ))}
          </div>

          <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
            {workflowError && (
              <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {workflowError}
              </div>
            )}

            {workflowLoading ? (
              <div className="inline-flex items-center gap-2 text-sm text-slate-400">
                <Loader2 size={14} className="animate-spin" />
                Loading workflow hub...
              </div>
            ) : filteredWorkflowItems.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs uppercase tracking-[0.16em] text-slate-500">
                No tasks in this lane.
              </p>
            ) : (
              <div className="space-y-3">
                {filteredWorkflowItems.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/20 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-200">
                        {item.subtaskLabel}
                      </span>
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-amber-300">
                        {item.status}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${
                          item.readyForIndependentWork
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                            : "border-red-500/40 bg-red-500/10 text-red-300"
                        }`}
                      >
                        {item.independentTag}
                      </span>
                      {item.done && <CheckCircle2 size={14} className="text-emerald-400" />}
                    </div>

                    <p className="mt-2 text-xs text-slate-300">{item.assignment}</p>
                    <p className="mt-1 text-xs text-slate-400">{item.agentPlan}</p>
                    <p className="mt-1 text-xs text-slate-500">Prompt: {item.specificPrompt}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      Flow {item.flowId} | Remaining: {item.remainingInFlow}
                    </p>

                    {item.requiredFiles.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.requiredFiles.map((file) => (
                          <span
                            key={file.id}
                            className="rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-300"
                          >
                            {file.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {item.blockedByLocks.length > 0 && (
                      <div className="mt-2 rounded-xl border border-red-500/40 bg-red-500/10 p-2">
                        <p className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-red-300">
                          <Lock size={11} />
                          File lock active
                        </p>
                        {item.blockedByLocks.map((lockInfo) => (
                          <p key={lockInfo.lockId} className="mt-1 text-xs text-red-200">
                            {lockInfo.fileName} locked by {lockInfo.lockOwnerAgent ?? "Unknown Agent"} (task {lockInfo.lockOwnerTaskId ?? "N/A"})
                          </p>
                        ))}
                      </div>
                    )}

                    {item.output?.preview && (
                      <pre className="mt-2 max-h-24 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-2 text-xs text-slate-100">
                        {item.output.fileName}: {item.output.preview}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {scope === "DNA" && (
        <div className="grid gap-4 2xl:grid-cols-[1.2fr_0.8fr]">
          <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
            {dnaError && (
              <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {dnaError}
              </div>
            )}

            {dnaLoading ? (
              <div className="inline-flex items-center gap-2 text-sm text-slate-400">
                <Loader2 size={14} className="animate-spin" />
                Loading DNA files...
              </div>
            ) : dnaFiles.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-xs uppercase tracking-[0.16em] text-slate-500">
                No DNA files available.
              </p>
            ) : (
              <div className="space-y-3">
                {dnaFiles.map((file) => (
                  <div key={file.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">{file.name}</p>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                          {formatFileSize(file.size)} | Health {file.health}
                        </p>
                      </div>
                      {file.isAmnesiaProtected && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-amber-300">
                          <Lock size={12} />
                          Amnesia
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => void handleDnaRead(file)}
                        className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-200"
                      >
                        {readingFileId === file.id ? "Reading..." : "Read"}
                      </button>
                      <button
                        onClick={() => void handleDnaIngest(file)}
                        className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-300"
                      >
                        {ingestingFileId === file.id ? "Queueing..." : "Run Ingest"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={`vx-panel space-y-4 rounded-3xl p-4 ${themeStyle.border}`}>
            <form onSubmit={handleDnaUpload} className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                Upload to DNA Sector
              </p>
              <input
                value={dnaName}
                onChange={(event) => setDnaName(event.target.value)}
                placeholder="Display name"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              />
              <input
                type="file"
                onChange={(event) => setDnaSelectedFile(event.target.files?.[0] ?? null)}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs"
              />
              <input
                value={dnaSourceUrl}
                onChange={(event) => setDnaSourceUrl(event.target.value)}
                placeholder="Or remote source URL"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none"
              />
              <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-400">
                <input type="checkbox" checked={dnaAmnesia} onChange={(event) => setDnaAmnesia(event.target.checked)} />
                Enable Amnesia Protection
              </label>
              <button
                type="submit"
                disabled={dnaUploading}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-500 hover:text-white disabled:opacity-60"
              >
                {dnaUploading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
                Upload DNA
              </button>
            </form>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">DNA Ingestion Runtime</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <StatChip label="Queued" value={String(dnaStats.queued)} />
                <StatChip label="Running" value={String(dnaStats.processing)} />
                <StatChip label="Done" value={String(dnaStats.completed)} />
              </div>
            </div>

            {dnaPreview && (
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{dnaPreview.fileName}</p>
                {dnaPreview.amnesiaWiped ? (
                  <div className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    Raw content wiped by Amnesia protocol.
                    {dnaPreview.proof ? <span className="block pt-1">Proof: {dnaPreview.proof}</span> : null}
                  </div>
                ) : (
                  <pre className="mt-2 max-h-44 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-xl border border-white/10 bg-black/40 p-2 text-xs text-slate-300">
                    {dnaPreview.contentPreview || "No preview available."}
                  </pre>
                )}
              </div>
            )}

            <DnaMemoryPanel orgId={orgId} />
          </div>
        </div>
      )}

      {scope === "DIRECTIONAL" && <DirectionalHub orgId={orgId} themeStyle={themeStyle} />}
      {scope === "STORAGE" && <StorageHub orgId={orgId} themeStyle={themeStyle} />}
      {scope === "TOOLS" && <ToolsHub orgId={orgId} themeStyle={themeStyle} />}
    </div>
  );
}
