"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FolderOpen,
  Loader2,
  Lock,
  Network,
  RefreshCw,
  RotateCcw,
  Rows3,
  Save,
  UploadCloud
} from "lucide-react";

import { DnaKnowledgeCanvas } from "@/components/hub/dna-knowledge-canvas";
import { parseJsonResponse } from "@/lib/http/json-response";
import { useVorldXStore } from "@/lib/store/vorldx-store";

type DnaTab = "ARCHIVE" | "LONG_TERM" | "SHORT_TERM" | "QUARANTINE" | "CACHE";
type FolderTimelineView = "LIST" | "KNOWLEDGE_GRAPH";
type TimelineItemState = "PENDING" | "RECONCILED";

interface DnaMemoryHubProps {
  orgId: string;
  themeStyle: {
    border: string;
  };
}

interface DnaFileItem {
  id: string;
  orgId?: string;
  name: string;
  type?: string;
  size: string;
  url: string;
  health: number;
  isAmnesiaProtected: boolean;
  folderId?: string | null;
  folderRecordId?: string | null;
  folderName?: string | null;
  functionalityGroup?: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface ExplorerEntry {
  id: number;
  tier: "LONG_TERM" | "ARCHIVE" | "STAGING";
  memoryDomain: "CONTEXTUAL" | "WORKING";
  memoryKind: string;
  documentId: string;
  chunkIndex: number;
  tokenCount: number;
  content: string;
  updatedAt: string;
}

interface Phase1Summary {
  installed: boolean;
  message?: string;
  storage?: {
    tierCounts: {
      longTerm: number;
      archive: number;
      staging: number;
    };
    strandCounts: {
      contextual: number;
      working: number;
    };
    graph: {
      nodes: number;
      edges: number;
    };
  };
}

interface QueueBacklog {
  tenantId: string;
  userId: string;
  status: string;
  queuedItems: number;
  oldestCreatedAt: string | null;
  newestCreatedAt: string | null;
}

interface QueueTask {
  taskId: string;
  sessionId: string;
  status: string;
  streamId: string | null;
  attemptCount: number;
  createdAt: string;
  processedAt: string | null;
}

interface KanbanBoard {
  boardId: string;
  pathwayId: string | null;
  sessionId: string;
  boardStatus: string;
  totalSteps: number;
  pendingSteps: number;
  claimedSteps: number;
  completedSteps: number;
  createdAt: string;
}

interface KanbanStep {
  id: number;
  stepKey: string;
  stepOrder: number;
  status: string;
  claimedByAgentId: string | null;
  updatedAt: string;
}

interface QuarantineItem {
  memoryId: number;
  documentId: string;
  chunkIndex: number;
  tokenCount: number;
  content: string;
  version: number;
  updatedAt: string;
  diffPatch: string | null;
  originalOutput: string | null;
  editedOutput: string | null;
  ruleScope: string | null;
}

interface DnaProfile {
  id: string;
  scope: "ORGANIZATION" | "EMPLOYEE" | "AGENT";
  targetId: string | null;
  title: string;
  summary: string;
  coreTraits: string[];
  sourceAssetIds: string[];
  updatedAt: string;
}

interface FolderMetric {
  label: string;
  value: string;
}

interface FolderTimelineItem {
  id: string;
  title: string;
  description: string;
  meta: string;
  timestamp: string;
  state: TimelineItemState;
  quarantineItem?: QuarantineItem;
  fileId?: string;
  fileUrl?: string;
  isAmnesiaProtected?: boolean;
}

interface MemoryFolder {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
  metrics: FolderMetric[];
  items: FolderTimelineItem[];
  functionalityHint?: string;
}

interface FolderSeed {
  id: string;
  title: string;
  summaryParts: string[];
  fallbackSummary: string;
  updatedAt: string;
  items: FolderTimelineItem[];
  metrics?: FolderMetric[];
  functionalityHint?: string;
}

interface FunctionalityFolderGroup {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
  metrics: FolderMetric[];
  folders: MemoryFolder[];
}

type FolderGroupOverrideMap = Record<string, string>;

interface FilePreviewState {
  loading?: boolean;
  contentPreview?: string | null;
  amnesiaWiped?: boolean;
  proof?: string | null;
  error?: string | null;
}

const TAB_ORDER: Array<{ value: DnaTab; label: string }> = [
  { value: "ARCHIVE", label: "Archive" },
  { value: "LONG_TERM", label: "Long-term memory" },
  { value: "SHORT_TERM", label: "Short-term memory" },
  { value: "QUARANTINE", label: "Quarantine" },
  { value: "CACHE", label: "Cache" }
];

const LANE_META: Record<
  DnaTab,
  {
    title: string;
    hint: string;
    empty: string;
  }
> = {
  ARCHIVE: {
    title: "Archive folders",
    hint: "Time-sorted archive folders holding already-reconciled memory slices.",
    empty: "No archive folders are available yet."
  },
  LONG_TERM: {
    title: "Long-term folders",
    hint: "Stable memory folders built from DNA source files and their surfaced entries.",
    empty: "No long-term folders are available yet."
  },
  SHORT_TERM: {
    title: "Short-term folders",
    hint: "Live working folders for active sessions, queues, boards, and steps.",
    empty: "No short-term folders are active right now."
  },
  QUARANTINE: {
    title: "Quarantine folders",
    hint: "Pending reconciliation folders for memory items still under review.",
    empty: "No quarantine folders are pending review."
  },
  CACHE: {
    title: "Cache folders",
    hint: "Curated identity folders holding stable DNA profile summaries.",
    empty: "No cache folders are available yet."
  }
};

const VIEW_OPTIONS: Array<{ value: FolderTimelineView; label: string; icon: typeof Rows3 }> = [
  { value: "LIST", label: "List view", icon: Rows3 },
  { value: "KNOWLEDGE_GRAPH", label: "Knowledge graph", icon: Network }
];

const FUNCTIONALITY_GROUP_STORAGE_KEY_PREFIX = "dna-memory-functionality-groups";

function formatFileSize(raw: string) {
  const bytes = Number(raw);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const date = new Date(value);
  const numeric = date.getTime();
  return Number.isFinite(numeric) ? numeric : 0;
}

function pickLatestTimestamp(...values: Array<string | null | undefined>) {
  let latest = "";
  let latestValue = 0;
  values.forEach((value) => {
    const numeric = toTimestamp(value);
    if (numeric >= latestValue) {
      latest = value ?? latest;
      latestValue = numeric;
    }
  });
  return latest;
}

function normalizeLookup(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function clipText(value: string, max = 260) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function friendlyLabel(value: string) {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFunctionalityLabel(value: string) {
  const clean = value
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  return clean
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function toFunctionalityGroupId(label: string) {
  return `function:${normalizeLookup(label) || "general"}`;
}

function toFolderOverrideKey(tab: DnaTab, folderId: string) {
  return `${tab}::${folderId}`;
}

function readFileMemoryLane(file: DnaFileItem): DnaTab | null {
  const value = readText(asRecord(file.metadata).memoryLane).toUpperCase();
  if (
    value === "ARCHIVE" ||
    value === "LONG_TERM" ||
    value === "SHORT_TERM" ||
    value === "QUARANTINE" ||
    value === "CACHE"
  ) {
    return value;
  }
  return null;
}

function readFileTargetFolderId(file: DnaFileItem) {
  return readText(file.folderId) || readText(asRecord(file.metadata).targetFolderId);
}

function readFileTargetFolderTitle(file: DnaFileItem) {
  return readText(file.folderName) || readText(asRecord(file.metadata).targetFolderTitle);
}

function readFileFunctionalityLabel(file: DnaFileItem) {
  return (
    normalizeFunctionalityLabel(readText(file.functionalityGroup)) ||
    normalizeFunctionalityLabel(readText(asRecord(file.metadata).functionalityGroupLabel))
  );
}

function readFileIngestStatus(file: DnaFileItem) {
  return readText(asRecord(file.metadata).ingestStatus);
}

function isDnaMemoryFolderUpload(file: DnaFileItem) {
  const metadata = asRecord(file.metadata);
  return (
    readText(metadata.hubScope) === "DNA_MEMORY" ||
    Boolean(readFileTargetFolderId(file)) ||
    Boolean(readText(file.folderRecordId))
  );
}

function buildUploadedFileTimelineItem(file: DnaFileItem): FolderTimelineItem {
  const metadata = asRecord(file.metadata);
  const ingestStatus = readFileIngestStatus(file);
  const state =
    /completed|reconciled|absorbed|ready|success/i.test(ingestStatus) &&
    !/queued|processing|publish/i.test(ingestStatus)
      ? ("RECONCILED" satisfies TimelineItemState)
      : ("PENDING" satisfies TimelineItemState);
  const preview = clipText(readText(metadata.uploadPreview) || readText(metadata.rawText), 320);
  const contentType = readText(metadata.contentType);
  return {
    id: `upload:file:${file.id}`,
    title: file.name,
    description:
      preview ||
      "Uploaded into this folder and queued for DNA reconciliation, summary extraction, and timeline attachment.",
    meta: `${formatFileSize(file.size)}${contentType ? ` | ${contentType}` : ""}${ingestStatus ? ` | ${friendlyLabel(ingestStatus)}` : ""}`,
    timestamp: file.updatedAt || file.createdAt,
    state,
    fileId: file.id,
    fileUrl: file.url,
    isAmnesiaProtected: file.isAmnesiaProtected
  };
}

function shortenId(value: string, max = 12) {
  const trimmed = value.trim();
  if (!trimmed) return "Unknown";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}...`;
}

function inferProgressState(status: string) {
  return /approved|archived|complete|completed|done|reconciled|success/i.test(status)
    ? "RECONCILED"
    : ("PENDING" satisfies TimelineItemState);
}

function buildSummary(summaryParts: string[], fallback: string) {
  const merged = summaryParts
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  return clipText(merged, 340) || fallback;
}

function finalizeFolder(seed: FolderSeed) {
  const items = [...seed.items].sort((left, right) => toTimestamp(right.timestamp) - toTimestamp(left.timestamp));
  const pendingCount = items.filter((item) => item.state === "PENDING").length;
  const reconciledCount = items.length - pendingCount;
  return {
    id: seed.id,
    title: seed.title,
    summary: buildSummary(seed.summaryParts, seed.fallbackSummary),
    updatedAt: seed.updatedAt,
    metrics:
      seed.metrics ??
      [
        { label: "Files", value: String(items.length) },
        { label: "Pending", value: String(pendingCount) },
        { label: "Reconciled", value: String(reconciledCount) }
      ],
    items,
    functionalityHint: seed.functionalityHint
  } satisfies MemoryFolder;
}

function sortFolders(folders: MemoryFolder[]) {
  return [...folders].sort((left, right) => {
    const delta = toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt);
    if (delta !== 0) return delta;
    return left.title.localeCompare(right.title);
  });
}

function refreshFolder(folder: MemoryFolder) {
  const items = [...folder.items].sort((left, right) => toTimestamp(right.timestamp) - toTimestamp(left.timestamp));
  const pendingCount = items.filter((item) => item.state === "PENDING").length;
  const reconciledCount = items.length - pendingCount;
  const latestItemTimestamp = items.reduce(
    (latest, item) => pickLatestTimestamp(latest, item.timestamp),
    folder.updatedAt
  );
  const metricMap = new Map(folder.metrics.map((metric) => [metric.label, metric.value]));
  metricMap.set("Files", String(items.length));
  metricMap.set("Pending", String(pendingCount));
  metricMap.set("Reconciled", String(reconciledCount));
  const labels = [
    ...folder.metrics.map((metric) => metric.label),
    ...["Files", "Pending", "Reconciled"].filter(
      (label) => !folder.metrics.some((metric) => metric.label === label)
    )
  ];
  return {
    ...folder,
    updatedAt: latestItemTimestamp,
    items,
    metrics: labels.map((label) => ({
      label,
      value: metricMap.get(label) ?? "0"
    }))
  } satisfies MemoryFolder;
}

function inferFunctionalityLabel(tab: DnaTab, folder: MemoryFolder) {
  const hinted = normalizeFunctionalityLabel(folder.functionalityHint ?? "");
  if (hinted) return hinted;

  const signal = `${folder.title} ${folder.summary} ${folder.items
    .slice(0, 4)
    .map((item) => `${item.title} ${item.description} ${item.meta}`)
    .join(" ")}`.toLowerCase();

  if (/\bstring\b|conversation|chat|direction\b/.test(signal)) return "Strings";
  if (/\borganization\b|\borg\b|company|founder|brand|mission|governance/.test(signal)) {
    return "Organization";
  }
  if (/\bemployee\b|personnel|staff|human|coordinator|manager|team/.test(signal)) {
    return "Employee";
  }
  if (/\bstorage\b|asset|document|file|drive|vault|upload/.test(signal)) return "Storage";
  if (/\bagent\b|planner|executor|assistant|\bai\b|bot/.test(signal)) return "Agents";
  if (/\bworkflow\b|queue|session|board|task|step|pathway|run/.test(signal)) return "Workflow";
  if (/\bcompliance\b|quarantine|policy|review|approval|security|risk/.test(signal)) {
    return "Compliance";
  }
  if (/\bcare\b|patient|medical|clinic|health/.test(signal)) return "Care";
  if (tab === "SHORT_TERM") return "Workflow";
  if (tab === "QUARANTINE") return "Compliance";
  if (tab === "CACHE") return "Identity";
  return "General";
}

function resolveFunctionalityLabel(
  tab: DnaTab,
  folder: MemoryFolder,
  overrides: FolderGroupOverrideMap
) {
  const override = normalizeFunctionalityLabel(overrides[toFolderOverrideKey(tab, folder.id)] ?? "");
  return override || inferFunctionalityLabel(tab, folder);
}

function buildFunctionalityGroups(
  tab: DnaTab,
  folders: MemoryFolder[],
  overrides: FolderGroupOverrideMap
) {
  const groups = new Map<
    string,
    {
      id: string;
      title: string;
      summaryParts: string[];
      updatedAt: string;
      folders: MemoryFolder[];
    }
  >();

  folders.forEach((folder) => {
    const title = resolveFunctionalityLabel(tab, folder, overrides);
    const id = toFunctionalityGroupId(title);
    const current = groups.get(id) ?? {
      id,
      title,
      summaryParts: [],
      updatedAt: "",
      folders: []
    };
    current.summaryParts.push(folder.title, folder.summary);
    current.updatedAt = pickLatestTimestamp(current.updatedAt, folder.updatedAt);
    current.folders.push(folder);
    groups.set(id, current);
  });

  return [...groups.values()]
    .map((group) => {
      const sortedFolders = sortFolders(group.folders);
      const totalFiles = sortedFolders.reduce((sum, folder) => sum + folder.items.length, 0);
      const pendingFiles = sortedFolders.reduce(
        (sum, folder) => sum + folder.items.filter((item) => item.state === "PENDING").length,
        0
      );
      return {
        id: group.id,
        title: group.title,
        summary:
          buildSummary(
            group.summaryParts,
            `${group.title} gathers related memory folders under one functionality layer.`
          ) || `${group.title} gathers related memory folders under one functionality layer.`,
        updatedAt: group.updatedAt,
        metrics: [
          { label: "Folders", value: String(sortedFolders.length) },
          { label: "Files", value: String(totalFiles) },
          { label: "Pending", value: String(pendingFiles) }
        ],
        folders: sortedFolders
      } satisfies FunctionalityFolderGroup;
    })
    .sort((left, right) => {
      const delta = toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt);
      if (delta !== 0) return delta;
      return left.title.localeCompare(right.title);
    });
}

function mergeUploadedFilesIntoFolders(tab: DnaTab, folders: MemoryFolder[], files: DnaFileItem[]) {
  if (tab === "LONG_TERM") {
    return folders;
  }

  const folderMap = new Map(
    folders.map((folder) => [
      folder.id,
      {
        ...folder,
        items: [...folder.items],
        metrics: [...folder.metrics]
      } satisfies MemoryFolder
    ])
  );

  files
    .filter((file) => readFileMemoryLane(file) === tab && readFileTargetFolderId(file))
    .forEach((file) => {
      const targetFolderId = readFileTargetFolderId(file);
      if (!targetFolderId) return;
      const targetTitle = readFileTargetFolderTitle(file) || file.name;
      const current =
        folderMap.get(targetFolderId) ??
        ({
          id: targetFolderId,
          title: targetTitle,
          summary: `Uploads attached to ${targetTitle} will appear here until they are reconciled into the folder summary.`,
          updatedAt: file.updatedAt || file.createdAt,
          metrics: [],
          items: [],
          functionalityHint: readFileFunctionalityLabel(file)
        } satisfies MemoryFolder);

      if (!current.items.some((item) => item.id === `upload:file:${file.id}`)) {
        current.items.push(buildUploadedFileTimelineItem(file));
      }
      current.updatedAt = pickLatestTimestamp(current.updatedAt, file.updatedAt, file.createdAt);
      if (!current.functionalityHint) {
        current.functionalityHint = readFileFunctionalityLabel(file);
      }
      folderMap.set(targetFolderId, current);
    });

  return sortFolders([...folderMap.values()].map((folder) => refreshFolder(folder)));
}

function resolveLongTermFolderKey(
  documentId: string,
  fileLookups: Array<{ lookup: string; key: string }>
) {
  const lookup = normalizeLookup(documentId);
  if (!lookup) return null;
  const direct = fileLookups.find((item) => item.lookup === lookup);
  if (direct) return direct.key;
  const fuzzy = fileLookups.find(
    (item) => lookup.includes(item.lookup) || item.lookup.includes(lookup)
  );
  return fuzzy?.key ?? null;
}

function buildLongTermFolders(files: DnaFileItem[], entries: ExplorerEntry[]) {
  const folders = new Map<string, FolderSeed>();
  const longTermFiles = files.filter((file) => {
    const lane = readFileMemoryLane(file);
    return lane === null || lane === "LONG_TERM";
  });
  const fileLookups = longTermFiles.map((file) => ({
    lookup: normalizeLookup(file.name),
    key: readFileTargetFolderId(file) || `long:file:${file.id}`
  }));

  longTermFiles.forEach((file) => {
    const fileKey = readFileTargetFolderId(file) || `long:file:${file.id}`;
    const isFolderUpload = isDnaMemoryFolderUpload(file);
    const folder =
      folders.get(fileKey) ??
      ({
        id: fileKey,
        title: readFileTargetFolderTitle(file) || file.name,
        summaryParts: [],
        fallbackSummary: `Source file ${file.name} is available in long-term memory.`,
        updatedAt: "",
        items: [],
        functionalityHint: readFileFunctionalityLabel(file) || undefined
      } satisfies FolderSeed);

    folder.updatedAt = pickLatestTimestamp(folder.updatedAt, file.updatedAt, file.createdAt);
    folder.summaryParts.push(
      readText(asRecord(file.metadata).uploadPreview) ||
        `${file.name} is available for long-term memory summarization.`
    );
    folder.items.push(
      isFolderUpload
        ? buildUploadedFileTimelineItem(file)
        : {
            id: `long:file-item:${file.id}`,
            title: "Source file",
            description: `${file.name} is available for long-term memory summarization.`,
            meta: `${formatFileSize(file.size)} | Health ${file.health}${file.isAmnesiaProtected ? " | Amnesia protected" : ""}`,
            timestamp: file.updatedAt || file.createdAt,
            state: inferProgressState(readFileIngestStatus(file) || "PENDING")
          }
    );
    if (!folder.functionalityHint) {
      folder.functionalityHint = readFileFunctionalityLabel(file) || undefined;
    }
    folders.set(fileKey, folder);
  });

  entries.forEach((entry) => {
    const matchedKey =
      resolveLongTermFolderKey(entry.documentId, fileLookups) ??
      `long:document:${normalizeLookup(entry.documentId) || entry.id}`;
    const folder =
      folders.get(matchedKey) ??
      ({
        id: matchedKey,
        title: entry.documentId || `Document ${entry.id}`,
        summaryParts: [],
        fallbackSummary: `Long-term folder for ${entry.documentId || `document ${entry.id}`}.`,
        updatedAt: "",
        items: []
      } satisfies FolderSeed);

    folder.summaryParts.push(entry.content);
    folder.updatedAt = pickLatestTimestamp(folder.updatedAt, entry.updatedAt);
    folder.items.push({
      id: `long:entry:${entry.id}`,
      title: `${friendlyLabel(entry.memoryKind)} chunk ${entry.chunkIndex}`,
      description: entry.content,
      meta: `${friendlyLabel(entry.memoryDomain)} | ${entry.tokenCount} tokens`,
      timestamp: entry.updatedAt,
      state: entry.memoryDomain === "WORKING" ? "PENDING" : "RECONCILED"
    });
    folders.set(matchedKey, folder);
  });

  return sortFolders(
    [...folders.values()].map((folder) =>
      finalizeFolder({
        ...folder,
        metrics: [
          { label: "Files", value: String(folder.items.length) },
          {
            label: "Pending",
            value: String(folder.items.filter((item) => item.state === "PENDING").length)
          },
          {
            label: "Reconciled",
            value: String(folder.items.filter((item) => item.state === "RECONCILED").length)
          }
        ]
      })
    )
  );
}

function buildArchiveFolders(entries: ExplorerEntry[]) {
  const folders = new Map<string, FolderSeed>();
  entries.forEach((entry) => {
    const key = `archive:${normalizeLookup(entry.documentId) || entry.id}`;
    const folder =
      folders.get(key) ??
      ({
        id: key,
        title: entry.documentId || `Archive ${entry.id}`,
        summaryParts: [],
        fallbackSummary: "Archived memory already reconciled into stable history.",
        updatedAt: "",
        items: []
      } satisfies FolderSeed);

    folder.summaryParts.push(entry.content);
    folder.updatedAt = pickLatestTimestamp(folder.updatedAt, entry.updatedAt);
    folder.items.push({
      id: `archive:entry:${entry.id}`,
      title: `${friendlyLabel(entry.memoryKind)} chunk ${entry.chunkIndex}`,
      description: entry.content,
      meta: `${entry.tokenCount} tokens`,
      timestamp: entry.updatedAt,
      state: "RECONCILED"
    });
    folders.set(key, folder);
  });

  return sortFolders(
    [...folders.values()].map((folder) =>
      finalizeFolder({
        ...folder,
        metrics: [
          { label: "Files", value: String(folder.items.length) },
          { label: "Pending", value: "0" },
          { label: "Reconciled", value: String(folder.items.length) }
        ]
      })
    )
  );
}

function buildShortTermFolders(
  backlog: QueueBacklog[],
  tasks: QueueTask[],
  boards: KanbanBoard[],
  steps: KanbanStep[]
) {
  const folders = new Map<string, FolderSeed>();

  backlog.forEach((item) => {
    const key = `short:backlog:${normalizeLookup(item.status) || "queue"}`;
    const folder =
      folders.get(key) ??
      ({
        id: key,
        title: `${friendlyLabel(item.status)} backlog`,
        summaryParts: [],
        fallbackSummary: "Working queue items still waiting to be reconciled.",
        updatedAt: "",
        items: []
      } satisfies FolderSeed);

    const activityTimestamp = item.newestCreatedAt ?? item.oldestCreatedAt ?? "";
    folder.summaryParts.push(`${item.status} has ${item.queuedItems} queued items.`);
    folder.updatedAt = pickLatestTimestamp(folder.updatedAt, activityTimestamp);
    folder.items.push({
      id: `short:backlog-item:${item.status}:${item.userId}`,
      title: `${item.queuedItems} queued items`,
      description: `Tenant ${item.tenantId} currently has ${item.queuedItems} short-term items in ${friendlyLabel(item.status)} status.`,
      meta: `User ${shortenId(item.userId)} | Latest ${formatTimestamp(activityTimestamp)}`,
      timestamp: activityTimestamp,
      state: item.queuedItems > 0 ? "PENDING" : "RECONCILED"
    });
    folders.set(key, folder);
  });

  tasks.forEach((task) => {
    const key = `short:session:${task.sessionId}`;
    const folder =
      folders.get(key) ??
      ({
        id: key,
        title: `Session ${shortenId(task.sessionId)}`,
        summaryParts: [],
        fallbackSummary: `Short-term session folder for ${shortenId(task.sessionId)}.`,
        updatedAt: "",
        items: []
      } satisfies FolderSeed);

    const activityTimestamp = task.processedAt ?? task.createdAt;
    folder.summaryParts.push(`Task ${task.taskId} is ${task.status}.`);
    folder.updatedAt = pickLatestTimestamp(folder.updatedAt, activityTimestamp);
    folder.items.push({
      id: `short:task:${task.taskId}`,
      title: `Task ${shortenId(task.taskId)}`,
      description: task.streamId
        ? `Attached to stream ${task.streamId}.`
        : "No stream has been attached to this task yet.",
      meta: `${friendlyLabel(task.status)} | Attempts ${task.attemptCount}`,
      timestamp: activityTimestamp,
      state: inferProgressState(task.status)
    });
    folders.set(key, folder);
  });

  boards.forEach((board) => {
    const key = `short:session:${board.sessionId}`;
    const folder =
      folders.get(key) ??
      ({
        id: key,
        title: `Session ${shortenId(board.sessionId)}`,
        summaryParts: [],
        fallbackSummary: `Short-term board folder for ${shortenId(board.sessionId)}.`,
        updatedAt: "",
        items: []
      } satisfies FolderSeed);

    folder.summaryParts.push(
      `Board ${board.boardId} is ${board.boardStatus} with ${board.pendingSteps} pending steps.`
    );
    folder.updatedAt = pickLatestTimestamp(folder.updatedAt, board.createdAt);
    folder.items.push({
      id: `short:board:${board.boardId}`,
      title: `Board ${shortenId(board.boardId)}`,
      description: `${board.completedSteps}/${board.totalSteps} steps are complete and ${board.pendingSteps} remain pending.`,
      meta: `${friendlyLabel(board.boardStatus)} | Pathway ${board.pathwayId ?? "General"}`,
      timestamp: board.createdAt,
      state: board.pendingSteps > 0 || board.claimedSteps > 0 ? "PENDING" : "RECONCILED"
    });
    folders.set(key, folder);
  });

  if (steps.length > 0) {
    const key = "short:steps";
    const folder: FolderSeed = {
      id: key,
      title: "Live step activity",
      summaryParts: [],
      fallbackSummary: "Recent short-term steps still moving through the working lane.",
      updatedAt: "",
      items: []
    };

    steps.forEach((step) => {
      folder.summaryParts.push(`${step.stepKey} is ${step.status}.`);
      folder.updatedAt = pickLatestTimestamp(folder.updatedAt, step.updatedAt);
      folder.items.push({
        id: `short:step:${step.id}`,
        title: `${step.stepOrder}. ${step.stepKey}`,
        description: step.claimedByAgentId
          ? `Claimed by ${step.claimedByAgentId}.`
          : "Still waiting to be claimed.",
        meta: friendlyLabel(step.status),
        timestamp: step.updatedAt,
        state: inferProgressState(step.status)
      });
    });

    folders.set(key, folder);
  }

  return sortFolders(
    [...folders.values()].map((folder) =>
      finalizeFolder({
        ...folder,
        metrics: [
          { label: "Files", value: String(folder.items.length) },
          {
            label: "Pending",
            value: String(folder.items.filter((item) => item.state === "PENDING").length)
          },
          {
            label: "Reconciled",
            value: String(folder.items.filter((item) => item.state === "RECONCILED").length)
          }
        ]
      })
    )
  );
}

function buildQuarantineFolders(items: QuarantineItem[]) {
  const folders = new Map<string, FolderSeed>();
  items.forEach((item) => {
    const label = item.documentId || item.ruleScope || `Memory ${item.memoryId}`;
    const key = `quarantine:${normalizeLookup(label) || item.memoryId}`;
    const folder =
      folders.get(key) ??
      ({
        id: key,
        title: label,
        summaryParts: [],
        fallbackSummary: `Pending quarantine review for ${label}.`,
        updatedAt: "",
        items: []
      } satisfies FolderSeed);

    folder.summaryParts.push(item.editedOutput || item.originalOutput || item.content);
    folder.updatedAt = pickLatestTimestamp(folder.updatedAt, item.updatedAt);
    folder.items.push({
      id: `quarantine:item:${item.memoryId}`,
      title: `Chunk ${item.chunkIndex}`,
      description: item.content,
      meta: `${item.tokenCount} tokens${item.ruleScope ? ` | ${item.ruleScope}` : ""}`,
      timestamp: item.updatedAt,
      state: "PENDING",
      quarantineItem: item
    });
    folders.set(key, folder);
  });

  return sortFolders(
    [...folders.values()].map((folder) =>
      finalizeFolder({
        ...folder,
        metrics: [
          { label: "Files", value: String(folder.items.length) },
          { label: "Pending", value: String(folder.items.length) },
          { label: "Reconciled", value: "0" }
        ]
      })
    )
  );
}

function buildCacheFolders(profiles: DnaProfile[]) {
  const groups = new Map<
    DnaProfile["scope"],
    {
      id: string;
      title: string;
      fallbackSummary: string;
      profiles: DnaProfile[];
    }
  >([
    [
      "ORGANIZATION",
      {
        id: "cache:organization",
        title: "Organization cache",
        fallbackSummary: "Stable organization identity summaries live here.",
        profiles: []
      }
    ],
    [
      "EMPLOYEE",
      {
        id: "cache:employee",
        title: "Employee cache",
        fallbackSummary: "Stable employee DNA summaries live here.",
        profiles: []
      }
    ],
    [
      "AGENT",
      {
        id: "cache:agent",
        title: "Agent cache",
        fallbackSummary: "Stable agent DNA summaries live here.",
        profiles: []
      }
    ]
  ]);

  profiles.forEach((profile) => {
    groups.get(profile.scope)?.profiles.push(profile);
  });

  return sortFolders(
    [...groups.values()]
      .filter((group) => group.profiles.length > 0)
      .map((group) => {
        const items = group.profiles.map(
          (profile) =>
            ({
              id: `cache:profile:${profile.id}`,
              title: profile.title,
              description: profile.summary,
              meta: `${profile.coreTraits.slice(0, 4).join(", ") || "No core traits"} | ${profile.sourceAssetIds.length} sources`,
              timestamp: profile.updatedAt,
              state: "RECONCILED"
            }) satisfies FolderTimelineItem
        );
        const traitCount = group.profiles.reduce((sum, profile) => sum + profile.coreTraits.length, 0);
        return finalizeFolder({
          id: group.id,
          title: group.title,
          summaryParts: group.profiles.flatMap((profile) => [
            profile.summary,
            profile.coreTraits.join(", ")
          ]),
          fallbackSummary: group.fallbackSummary,
          updatedAt: group.profiles.reduce(
            (latest, profile) => pickLatestTimestamp(latest, profile.updatedAt),
            ""
          ),
          items,
          metrics: [
            { label: "Files", value: String(items.length) },
            { label: "Pending", value: "0" },
            { label: "Reconciled", value: String(items.length) },
            { label: "Traits", value: String(traitCount) }
          ]
        });
      })
  );
}

function buildDummyFolders() {
  return {
    ARCHIVE: sortFolders([
      finalizeFolder({
        id: "dummy:archive:founder-vault",
        title: "Founder vault archive",
        summaryParts: [
          "Legacy founder notes were merged into a stable archive summary.",
          "Decision logic, financial posture, and escalation boundaries were already reconciled."
        ],
        fallbackSummary: "Founder vault archive summary.",
        updatedAt: "2026-03-25T16:20:00.000Z",
        items: [
          {
            id: "dummy:archive:founder-1",
            title: "Board memo digest",
            description: "Quarterly board observations were compressed into the long-lived archive summary for later retrieval.",
            meta: "Strategic memo | 188 tokens",
            timestamp: "2026-03-25T16:20:00.000Z",
            state: "RECONCILED"
          },
          {
            id: "dummy:archive:founder-2",
            title: "Capital runway brief",
            description: "Runway guidance, burn thresholds, and trigger points were reconciled and moved into archived memory.",
            meta: "Finance brief | 164 tokens",
            timestamp: "2026-03-24T11:40:00.000Z",
            state: "RECONCILED"
          }
        ]
      }),
      finalizeFolder({
        id: "dummy:archive:patient-ops",
        title: "Patient ops archive",
        summaryParts: [
          "Archived patient operations notes capture prior care delivery experiments.",
          "Older workflow observations remain detached because they are already absorbed into the center summary."
        ],
        fallbackSummary: "Patient operations archive summary.",
        updatedAt: "2026-03-22T09:35:00.000Z",
        items: [
          {
            id: "dummy:archive:ops-1",
            title: "Care cadence snapshot",
            description: "Older service cadence findings were reconciled after weekly scheduling patterns stabilized.",
            meta: "Operations | 146 tokens",
            timestamp: "2026-03-22T09:35:00.000Z",
            state: "RECONCILED"
          },
          {
            id: "dummy:archive:ops-2",
            title: "Escalation ladder archive",
            description: "The first escalation ladder draft was archived after the newer triage flow replaced it.",
            meta: "SOP archive | 132 tokens",
            timestamp: "2026-03-20T13:10:00.000Z",
            state: "RECONCILED"
          }
        ]
      })
    ]),
    LONG_TERM: sortFolders([
      finalizeFolder({
        id: "dummy:long:brand",
        title: "Human touch brand memory",
        summaryParts: [
          "The brand voice should stay calm, intimate, and high-trust.",
          "Summaries should preserve empathy, medical sensitivity, and premium clarity."
        ],
        fallbackSummary: "Brand memory summary.",
        updatedAt: "2026-03-27T08:15:00.000Z",
        items: [
          {
            id: "dummy:long:brand-1",
            title: "Brand source file",
            description: "Core brand guidance file waiting to be fully absorbed into the stable summary center.",
            meta: "Source file | 312 KB",
            timestamp: "2026-03-27T08:15:00.000Z",
            state: "PENDING"
          },
          {
            id: "dummy:long:brand-2",
            title: "Tone principles",
            description: "Warmth, clarity, and calm reassurance were already reconciled into the long-term summary.",
            meta: "Contextual | 178 tokens",
            timestamp: "2026-03-26T17:05:00.000Z",
            state: "RECONCILED"
          },
          {
            id: "dummy:long:brand-3",
            title: "Premium language guardrail",
            description: "Premium but plainspoken phrasing remains attached until its edge cases are merged into the center summary.",
            meta: "Working | 154 tokens",
            timestamp: "2026-03-26T11:20:00.000Z",
            state: "PENDING"
          }
        ]
      }),
      finalizeFolder({
        id: "dummy:long:medical",
        title: "Medical knowledge baseline",
        summaryParts: [
          "Clinical communication should remain careful, non-diagnostic, and action-oriented.",
          "Medication reminders, symptom journaling, and care escalation rules are stable."
        ],
        fallbackSummary: "Medical knowledge baseline.",
        updatedAt: "2026-03-26T10:10:00.000Z",
        items: [
          {
            id: "dummy:long:medical-1",
            title: "Medication adherence map",
            description: "Dose reminders and adherence follow-up patterns have already been reconciled.",
            meta: "Contextual | 221 tokens",
            timestamp: "2026-03-26T10:10:00.000Z",
            state: "RECONCILED"
          },
          {
            id: "dummy:long:medical-2",
            title: "Symptom escalation draft",
            description: "Threshold language is still pending because it needs one more reconciliation pass with the care policy.",
            meta: "Working | 167 tokens",
            timestamp: "2026-03-25T15:55:00.000Z",
            state: "PENDING"
          }
        ]
      })
    ]),
    SHORT_TERM: sortFolders([
      finalizeFolder({
        id: "dummy:short:care-session",
        title: "Care session alpha",
        summaryParts: [
          "This active short-term folder tracks a live care session with pending follow-ups.",
          "Some steps are already reconciled while active tasks still sit on the spoke ring."
        ],
        fallbackSummary: "Care session alpha summary.",
        updatedAt: "2026-03-27T09:40:00.000Z",
        items: [
          {
            id: "dummy:short:care-1",
            title: "Board active_followups",
            description: "Three follow-up actions remain open across medication check-in, caregiver callback, and notes sync.",
            meta: "In Progress | Pathway follow_up",
            timestamp: "2026-03-27T09:40:00.000Z",
            state: "PENDING"
          },
          {
            id: "dummy:short:care-2",
            title: "Task queue sync",
            description: "The queue task attached to the care session already completed and its summary was absorbed.",
            meta: "Completed | Attempts 1",
            timestamp: "2026-03-27T08:55:00.000Z",
            state: "RECONCILED"
          },
          {
            id: "dummy:short:care-3",
            title: "Step 4. confirm caregiver",
            description: "Caregiver confirmation is still waiting to be claimed.",
            meta: "Pending",
            timestamp: "2026-03-27T08:20:00.000Z",
            state: "PENDING"
          }
        ]
      }),
      finalizeFolder({
        id: "dummy:short:intake",
        title: "Intake session beta",
        summaryParts: [
          "An intake session is consolidating notes from triage, preferences, and operational routing.",
          "Only the unresolved routing step remains pending."
        ],
        fallbackSummary: "Intake session beta summary.",
        updatedAt: "2026-03-26T18:05:00.000Z",
        items: [
          {
            id: "dummy:short:intake-1",
            title: "Task intake_parse",
            description: "Initial intake parsing and patient preference extraction were completed successfully.",
            meta: "Completed | Attempts 2",
            timestamp: "2026-03-26T18:05:00.000Z",
            state: "RECONCILED"
          },
          {
            id: "dummy:short:intake-2",
            title: "Board route_to_team",
            description: "Routing to the final care team is still pending because one policy check remains unresolved.",
            meta: "Pending | Pathway triage",
            timestamp: "2026-03-26T17:30:00.000Z",
            state: "PENDING"
          }
        ]
      })
    ]),
    QUARANTINE: sortFolders([
      finalizeFolder({
        id: "dummy:quarantine:medication",
        title: "Medication conflict review",
        summaryParts: [
          "These memory chunks are pending reconciliation because medication language needs a human review pass.",
          "Nothing here should detach from the spoke ring until it is approved."
        ],
        fallbackSummary: "Medication conflict review summary.",
        updatedAt: "2026-03-27T07:50:00.000Z",
        items: [
          {
            id: "dummy:quarantine:med-1",
            title: "Chunk 12",
            description: "Potential contradiction found between dose reminder wording and the current escalation note.",
            meta: "124 tokens | medication.safety",
            timestamp: "2026-03-27T07:50:00.000Z",
            state: "PENDING"
          },
          {
            id: "dummy:quarantine:med-2",
            title: "Chunk 13",
            description: "Pending review because one sentence sounds diagnostic instead of advisory.",
            meta: "118 tokens | medical.style",
            timestamp: "2026-03-27T07:35:00.000Z",
            state: "PENDING"
          }
        ]
      })
    ]),
    CACHE: sortFolders([
      finalizeFolder({
        id: "dummy:cache:organization",
        title: "Organization cache",
        summaryParts: [
          "The organization cache holds stable identity, mission, and trust posture for the hub.",
          "Its content is already reconciled and detached from the pending spoke layer."
        ],
        fallbackSummary: "Organization cache summary.",
        updatedAt: "2026-03-26T19:30:00.000Z",
        items: [
          {
            id: "dummy:cache:org-1",
            title: "Main organization DNA",
            description: "Mission, service posture, and brand constraints are all stored here as stable cache memory.",
            meta: "trust, empathy, compliance | 4 sources",
            timestamp: "2026-03-26T19:30:00.000Z",
            state: "RECONCILED"
          }
        ],
        metrics: [
          { label: "Files", value: "1" },
          { label: "Pending", value: "0" },
          { label: "Reconciled", value: "1" },
          { label: "Traits", value: "3" }
        ]
      }),
      finalizeFolder({
        id: "dummy:cache:employee",
        title: "Employee cache",
        summaryParts: [
          "Employee cache stores stable role preferences and operating style snapshots.",
          "These memory items are ready for reuse in future sessions."
        ],
        fallbackSummary: "Employee cache summary.",
        updatedAt: "2026-03-26T14:25:00.000Z",
        items: [
          {
            id: "dummy:cache:employee-1",
            title: "Care coordinator DNA",
            description: "Calm tone, escalation discipline, and follow-through expectations are cached here.",
            meta: "calm, follow-through, precision | 3 sources",
            timestamp: "2026-03-26T14:25:00.000Z",
            state: "RECONCILED"
          }
        ],
        metrics: [
          { label: "Files", value: "1" },
          { label: "Pending", value: "0" },
          { label: "Reconciled", value: "1" },
          { label: "Traits", value: "3" }
        ]
      }),
      finalizeFolder({
        id: "dummy:cache:agent",
        title: "Agent cache",
        summaryParts: [
          "Agent cache stores reusable behavioral summaries for AI teammates.",
          "The center summary is stable, so the nodes stay detached."
        ],
        fallbackSummary: "Agent cache summary.",
        updatedAt: "2026-03-25T21:05:00.000Z",
        items: [
          {
            id: "dummy:cache:agent-1",
            title: "Main agent DNA",
            description: "High-trust response style, concise summaries, and stable collaboration posture are cached here.",
            meta: "concise, reliable, empathetic | 5 sources",
            timestamp: "2026-03-25T21:05:00.000Z",
            state: "RECONCILED"
          }
        ],
        metrics: [
          { label: "Files", value: "1" },
          { label: "Pending", value: "0" },
          { label: "Reconciled", value: "1" },
          { label: "Traits", value: "3" }
        ]
      })
    ])
  } satisfies Record<DnaTab, MemoryFolder[]>;
}

const DUMMY_FOLDERS = buildDummyFolders();

function withFallbackFolders(folders: MemoryFolder[], fallback: MemoryFolder[]) {
  return folders.length > 0 ? folders : fallback;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function StateBadge({ state }: { state: TimelineItemState }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] ${
        state === "PENDING"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      }`}
    >
      {state === "PENDING" ? "Pending" : "Reconciled"}
    </span>
  );
}

export function DnaMemoryHub({ orgId, themeStyle }: DnaMemoryHubProps) {
  const notify = useVorldXStore((state) => state.pushNotification);

  const [tab, setTab] = useState<DnaTab>("ARCHIVE");
  const [folderViews, setFolderViews] = useState<Record<DnaTab, FolderTimelineView>>({
    ARCHIVE: "LIST",
    LONG_TERM: "LIST",
    SHORT_TERM: "LIST",
    QUARANTINE: "LIST",
    CACHE: "LIST"
  });
  const [openFolderByTab, setOpenFolderByTab] = useState<Record<DnaTab, string | null>>({
    ARCHIVE: null,
    LONG_TERM: null,
    SHORT_TERM: null,
    QUARANTINE: null,
    CACHE: null
  });
  const [openFunctionalityByTab, setOpenFunctionalityByTab] = useState<Record<DnaTab, string | null>>({
    ARCHIVE: null,
    LONG_TERM: null,
    SHORT_TERM: null,
    QUARANTINE: null,
    CACHE: null
  });
  const [folderGroupOverrides, setFolderGroupOverrides] = useState<FolderGroupOverrideMap>({});
  const [functionalityDraft, setFunctionalityDraft] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [filePreviews, setFilePreviews] = useState<Record<string, FilePreviewState>>({});

  const [refreshing, setRefreshing] = useState(false);
  const [phase1, setPhase1] = useState<Phase1Summary | null>(null);
  const [phase1Loading, setPhase1Loading] = useState(true);

  const [longTermLoading, setLongTermLoading] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [shortTermLoading, setShortTermLoading] = useState(false);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [quarantineLoading, setQuarantineLoading] = useState(false);

  const [dnaFiles, setDnaFiles] = useState<DnaFileItem[]>([]);
  const [longTermEntries, setLongTermEntries] = useState<ExplorerEntry[]>([]);
  const [archiveEntries, setArchiveEntries] = useState<ExplorerEntry[]>([]);
  const [queueBacklog, setQueueBacklog] = useState<QueueBacklog[]>([]);
  const [queueTasks, setQueueTasks] = useState<QueueTask[]>([]);
  const [kanbanBoards, setKanbanBoards] = useState<KanbanBoard[]>([]);
  const [kanbanSteps, setKanbanSteps] = useState<KanbanStep[]>([]);
  const [profiles, setProfiles] = useState<DnaProfile[]>([]);
  const [quarantineItems, setQuarantineItems] = useState<QuarantineItem[]>([]);
  const [quarantineDenied, setQuarantineDenied] = useState(false);
  const [reviewingMemoryId, setReviewingMemoryId] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(`${FUNCTIONALITY_GROUP_STORAGE_KEY_PREFIX}:${orgId}`);
      if (!raw) {
        setFolderGroupOverrides({});
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next: FolderGroupOverrideMap = {};
      Object.entries(parsed).forEach(([key, value]) => {
        if (typeof value === "string" && value.trim()) {
          next[key] = value;
        }
      });
      setFolderGroupOverrides(next);
    } catch {
      setFolderGroupOverrides({});
    }
  }, [orgId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      `${FUNCTIONALITY_GROUP_STORAGE_KEY_PREFIX}:${orgId}`,
      JSON.stringify(folderGroupOverrides)
    );
  }, [folderGroupOverrides, orgId]);

  const fetchDnaFiles = useCallback(async () => {
    const response = await fetch(`/api/hub/files?orgId=${encodeURIComponent(orgId)}&tab=DNA`, {
      cache: "no-store"
    });
    const { payload, rawText } = await parseJsonResponse<{
      ok?: boolean;
      files?: DnaFileItem[];
      message?: string;
    }>(response);
    if (!response.ok || !payload?.ok || !payload.files) {
      throw new Error(
        payload?.message ??
          (rawText ? `Failed to load DNA files (${response.status}).` : "Failed to load DNA files.")
      );
    }
    return payload.files;
  }, [orgId]);

  const loadDnaFiles = useCallback(
    async (silent?: boolean) => {
      try {
        const files = await fetchDnaFiles();
        setDnaFiles(files);
        return files;
      } catch (error) {
        if (!silent) {
          notify({
            title: "DNA Memory",
            message: error instanceof Error ? error.message : "Unable to load DNA files.",
            type: "error"
          });
        }
        throw error;
      }
    },
    [fetchDnaFiles, notify]
  );

  const loadPhase1 = useCallback(async () => {
    setPhase1Loading(true);
    try {
      const response = await fetch(`/api/dna/memory/phase1?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store"
      });
      const { payload } = await parseJsonResponse<Phase1Summary & { ok?: boolean }>(response);
      if (response.ok && payload?.ok) {
        setPhase1(payload);
      }
    } finally {
      setPhase1Loading(false);
    }
  }, [orgId]);

  const loadExplorerTier = useCallback(
    async (tier: "LONG_TERM" | "ARCHIVE") => {
      const response = await fetch(
        `/api/dna/memory/phase4/explorer?orgId=${encodeURIComponent(orgId)}&tier=${tier}&limit=120`,
        { cache: "no-store" }
      );
      const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; entries?: ExplorerEntry[] }>(
        response
      );
      if (!response.ok || !payload?.ok) {
        throw new Error(
          rawText
            ? `Failed to load ${friendlyLabel(tier)} folders (${response.status}).`
            : `Failed to load ${friendlyLabel(tier)} folders.`
        );
      }
      return payload.entries ?? [];
    },
    [orgId]
  );

  const loadLongTerm = useCallback(async () => {
    setLongTermLoading(true);
    try {
      const [files, explorerEntries] = await Promise.all([fetchDnaFiles(), loadExplorerTier("LONG_TERM")]);
      setDnaFiles(files);
      setLongTermEntries(explorerEntries);
    } catch (error) {
      notify({
        title: "DNA Memory",
        message: error instanceof Error ? error.message : "Unable to load long-term memory.",
        type: "error"
      });
    } finally {
      setLongTermLoading(false);
    }
  }, [fetchDnaFiles, loadExplorerTier, notify]);

  const loadArchive = useCallback(async () => {
    setArchiveLoading(true);
    try {
      setArchiveEntries(await loadExplorerTier("ARCHIVE"));
    } catch (error) {
      notify({
        title: "DNA Memory",
        message: error instanceof Error ? error.message : "Unable to load archive memory.",
        type: "error"
      });
    } finally {
      setArchiveLoading(false);
    }
  }, [loadExplorerTier, notify]);

  const loadShortTerm = useCallback(async () => {
    setShortTermLoading(true);
    try {
      const [queueResponse, kanbanResponse] = await Promise.all([
        fetch(`/api/dna/memory/phase2/queue?orgId=${encodeURIComponent(orgId)}&limit=40`, {
          cache: "no-store"
        }),
        fetch(`/api/dna/memory/phase4/kanban?orgId=${encodeURIComponent(orgId)}&limit=40`, {
          cache: "no-store"
        })
      ]);
      const { payload: queuePayload, rawText: queueRawText } = await parseJsonResponse<{
        ok?: boolean;
        backlog?: QueueBacklog[];
        tasks?: QueueTask[];
      }>(queueResponse);
      const { payload: kanbanPayload, rawText: kanbanRawText } = await parseJsonResponse<{
        ok?: boolean;
        boards?: KanbanBoard[];
        steps?: KanbanStep[];
      }>(kanbanResponse);
      if (!queueResponse.ok || !queuePayload?.ok) {
        throw new Error(
          queueRawText
            ? `Failed to load short-term queue (${queueResponse.status}).`
            : "Failed to load short-term queue."
        );
      }
      if (!kanbanResponse.ok || !kanbanPayload?.ok) {
        throw new Error(
          kanbanRawText
            ? `Failed to load short-term boards (${kanbanResponse.status}).`
            : "Failed to load short-term boards."
        );
      }
      setQueueBacklog(queuePayload.backlog ?? []);
      setQueueTasks(queuePayload.tasks ?? []);
      setKanbanBoards(kanbanPayload.boards ?? []);
      setKanbanSteps(kanbanPayload.steps ?? []);
    } catch (error) {
      notify({
        title: "DNA Memory",
        message: error instanceof Error ? error.message : "Unable to load short-term memory.",
        type: "error"
      });
    } finally {
      setShortTermLoading(false);
    }
  }, [notify, orgId]);

  const loadCache = useCallback(async () => {
    setProfilesLoading(true);
    try {
      const response = await fetch(`/api/dna/profiles?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store"
      });
      const { payload, rawText } = await parseJsonResponse<{
        ok?: boolean;
        profiles?: DnaProfile[];
        message?: string;
      }>(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText ? `Failed to load cache profiles (${response.status}).` : "Failed to load cache profiles.")
        );
      }
      setProfiles(payload.profiles ?? []);
    } catch (error) {
      notify({
        title: "DNA Memory",
        message: error instanceof Error ? error.message : "Unable to load cache folders.",
        type: "error"
      });
    } finally {
      setProfilesLoading(false);
    }
  }, [notify, orgId]);

  const loadQuarantine = useCallback(async () => {
    setQuarantineLoading(true);
    try {
      const response = await fetch(
        `/api/dna/memory/phase4/quarantine?orgId=${encodeURIComponent(orgId)}&limit=80`,
        { cache: "no-store" }
      );
      const { payload, rawText } = await parseJsonResponse<{
        ok?: boolean;
        items?: QuarantineItem[];
        message?: string;
      }>(response);
      if (response.status === 403) {
        setQuarantineDenied(true);
        setQuarantineItems([]);
        return;
      }
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed to load quarantine folders (${response.status}).`
              : "Failed to load quarantine folders.")
        );
      }
      setQuarantineDenied(false);
      setQuarantineItems(payload.items ?? []);
    } catch (error) {
      notify({
        title: "DNA Memory",
        message: error instanceof Error ? error.message : "Unable to load quarantine folders.",
        type: "error"
      });
    } finally {
      setQuarantineLoading(false);
    }
  }, [notify, orgId]);

  const loadCurrentTab = useCallback(
    async (targetTab: DnaTab) => {
      if (targetTab === "ARCHIVE") {
        await loadArchive();
        return;
      }
      if (targetTab === "LONG_TERM") {
        await loadLongTerm();
        return;
      }
      if (targetTab === "SHORT_TERM") {
        await loadShortTerm();
        return;
      }
      if (targetTab === "QUARANTINE") {
        await loadQuarantine();
        return;
      }
      await loadCache();
    },
    [loadArchive, loadCache, loadLongTerm, loadQuarantine, loadShortTerm]
  );

  useEffect(() => {
    void loadPhase1();
  }, [loadPhase1]);

  useEffect(() => {
    void loadDnaFiles(true).catch(() => null);
    const timer = window.setInterval(() => {
      void loadDnaFiles(true).catch(() => null);
    }, 18000);
    return () => window.clearInterval(timer);
  }, [loadDnaFiles]);

  useEffect(() => {
    void loadCurrentTab(tab);
  }, [loadCurrentTab, tab]);

  const refreshCurrent = useCallback(async () => {
    setRefreshing(true);
    try {
      const work = [loadPhase1(), loadCurrentTab(tab)] as Array<Promise<unknown>>;
      if (tab !== "LONG_TERM") {
        work.push(loadDnaFiles(true));
      }
      await Promise.all(work);
    } finally {
      setRefreshing(false);
    }
  }, [loadCurrentTab, loadDnaFiles, loadPhase1, tab]);

  const handleQuarantineReview = useCallback(
    async (item: QuarantineItem, action: "APPROVE" | "REJECT") => {
      setReviewingMemoryId(item.memoryId);
      try {
        const response = await fetch("/api/dna/memory/phase4/quarantine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            memoryId: item.memoryId,
            expectedVersion: item.version,
            action
          })
        });
        const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
          response
        );
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed to review quarantine item (${response.status}).`
                : "Failed to review quarantine item.")
          );
        }
        notify({
          title: "DNA Quarantine",
          message: `Memory ${item.memoryId} ${action === "APPROVE" ? "approved" : "rejected"}.`,
          type: "success"
        });
        await Promise.all([loadQuarantine(), loadPhase1()]);
      } catch (error) {
        notify({
          title: "DNA Quarantine",
          message: error instanceof Error ? error.message : "Review failed.",
          type: "error"
        });
      } finally {
        setReviewingMemoryId(null);
      }
    },
    [loadPhase1, loadQuarantine, notify, orgId]
  );

  const phase1Stats = phase1?.storage;
  const foldersByTab = useMemo<Record<DnaTab, MemoryFolder[]>>(
    () => ({
      ARCHIVE: withFallbackFolders(
        mergeUploadedFilesIntoFolders("ARCHIVE", buildArchiveFolders(archiveEntries), dnaFiles),
        DUMMY_FOLDERS.ARCHIVE
      ),
      LONG_TERM: withFallbackFolders(
        buildLongTermFolders(dnaFiles, longTermEntries),
        DUMMY_FOLDERS.LONG_TERM
      ),
      SHORT_TERM: withFallbackFolders(
        mergeUploadedFilesIntoFolders(
          "SHORT_TERM",
          buildShortTermFolders(queueBacklog, queueTasks, kanbanBoards, kanbanSteps),
          dnaFiles
        ),
        DUMMY_FOLDERS.SHORT_TERM
      ),
      QUARANTINE: withFallbackFolders(
        mergeUploadedFilesIntoFolders("QUARANTINE", buildQuarantineFolders(quarantineItems), dnaFiles),
        DUMMY_FOLDERS.QUARANTINE
      ),
      CACHE: withFallbackFolders(
        mergeUploadedFilesIntoFolders("CACHE", buildCacheFolders(profiles), dnaFiles),
        DUMMY_FOLDERS.CACHE
      )
    }),
    [
      archiveEntries,
      dnaFiles,
      kanbanBoards,
      kanbanSteps,
      longTermEntries,
      profiles,
      quarantineItems,
      queueBacklog,
      queueTasks
    ]
  );

  const functionalityGroupsByTab = useMemo<Record<DnaTab, FunctionalityFolderGroup[]>>(
    () => ({
      ARCHIVE: buildFunctionalityGroups("ARCHIVE", foldersByTab.ARCHIVE, folderGroupOverrides),
      LONG_TERM: buildFunctionalityGroups("LONG_TERM", foldersByTab.LONG_TERM, folderGroupOverrides),
      SHORT_TERM: buildFunctionalityGroups("SHORT_TERM", foldersByTab.SHORT_TERM, folderGroupOverrides),
      QUARANTINE: buildFunctionalityGroups("QUARANTINE", foldersByTab.QUARANTINE, folderGroupOverrides),
      CACHE: buildFunctionalityGroups("CACHE", foldersByTab.CACHE, folderGroupOverrides)
    }),
    [folderGroupOverrides, foldersByTab]
  );

  const laneFolders = foldersByTab[tab];
  const currentFunctionalityGroups = functionalityGroupsByTab[tab];
  const currentOpenFunctionalityId = openFunctionalityByTab[tab];
  const currentOpenFolderId = openFolderByTab[tab];
  const currentFolder = currentOpenFolderId
    ? currentFunctionalityGroups
        .flatMap((group) => group.folders)
        .find((folder) => folder.id === currentOpenFolderId) ?? null
    : null;
  const currentFunctionalityGroup = currentFolder
    ? currentFunctionalityGroups.find((group) =>
        group.folders.some((folder) => folder.id === currentFolder.id)
      ) ?? null
    : currentFunctionalityGroups.find((group) => group.id === currentOpenFunctionalityId) ?? null;
  const currentFolders = currentFunctionalityGroup?.folders ?? [];
  const currentView = folderViews[tab];
  const laneMeta = LANE_META[tab];
  const tabLoading =
    tab === "ARCHIVE"
      ? archiveLoading
      : tab === "LONG_TERM"
        ? longTermLoading
        : tab === "SHORT_TERM"
          ? shortTermLoading
          : tab === "QUARANTINE"
            ? quarantineLoading
            : profilesLoading;
  const laneMetrics = useMemo(
    () => [
      { label: "Functions", value: String(currentFunctionalityGroups.length) },
      { label: "Folders", value: String(laneFolders.length) },
      {
        label: "Files",
        value: String(laneFolders.reduce((sum, folder) => sum + folder.items.length, 0))
      },
      {
        label: "Pending",
        value: String(
          laneFolders.reduce(
            (sum, folder) =>
              sum + folder.items.filter((item) => item.state === "PENDING").length,
            0
          )
        )
      }
    ],
    [currentFunctionalityGroups.length, laneFolders]
  );
  const currentGroupMetrics = currentFunctionalityGroup?.metrics ?? [];
  const currentGraphMetrics = useMemo(
    () =>
      currentFolder
        ? [
            { label: "Files", value: String(currentFolder.items.length) },
            {
              label: "Pending",
              value: String(currentFolder.items.filter((item) => item.state === "PENDING").length)
            },
            {
              label: "Reconciled",
              value: String(
                currentFolder.items.filter((item) => item.state === "RECONCILED").length
              )
            }
          ]
        : [],
    [currentFolder]
  );
  const currentFunctionalityLabel = currentFolder
    ? resolveFunctionalityLabel(tab, currentFolder, folderGroupOverrides)
    : currentFunctionalityGroup?.title ?? "";

  useEffect(() => {
    setFunctionalityDraft(currentFunctionalityLabel);
  }, [currentFunctionalityLabel, currentFolder?.id]);

  useEffect(() => {
    setUploadFile(null);
    setUploadName("");
  }, [currentFolder?.id]);

  const saveCurrentFolderFunctionality = useCallback(() => {
    if (!currentFolder) return;
    const normalized = normalizeFunctionalityLabel(functionalityDraft);
    if (!normalized) {
      notify({
        title: "DNA Memory",
        message: "Enter a functionality folder name before saving.",
        type: "warning"
      });
      return;
    }
    setFolderGroupOverrides((previous) => ({
      ...previous,
      [toFolderOverrideKey(tab, currentFolder.id)]: normalized
    }));
    setOpenFunctionalityByTab((previous) => ({
      ...previous,
      [tab]: toFunctionalityGroupId(normalized)
    }));
    notify({
      title: "DNA Memory",
      message: `${currentFolder.title} now lives under ${normalized}.`,
      type: "success"
    });
  }, [currentFolder, functionalityDraft, notify, tab]);

  const resetCurrentFolderFunctionality = useCallback(() => {
    if (!currentFolder) return;
    const next = { ...folderGroupOverrides };
    delete next[toFolderOverrideKey(tab, currentFolder.id)];
    setFolderGroupOverrides(next);
    const fallbackLabel = inferFunctionalityLabel(tab, currentFolder);
    setOpenFunctionalityByTab((previous) => ({
      ...previous,
      [tab]: toFunctionalityGroupId(fallbackLabel)
    }));
    notify({
      title: "DNA Memory",
      message: `${currentFolder.title} returned to its suggested functionality grouping.`,
      type: "success"
    });
  }, [currentFolder, folderGroupOverrides, notify, tab]);

  const resetTabFunctionalityGrouping = useCallback(() => {
    setFolderGroupOverrides((previous) => {
      const next: FolderGroupOverrideMap = {};
      Object.entries(previous).forEach(([key, value]) => {
        if (!key.startsWith(`${tab}::`)) {
          next[key] = value;
        }
      });
      return next;
    });
    setOpenFunctionalityByTab((previous) => ({ ...previous, [tab]: null }));
    setOpenFolderByTab((previous) => ({ ...previous, [tab]: null }));
    notify({
      title: "DNA Memory",
      message: `${friendlyLabel(tab)} functionality grouping was reset for this tab.`,
      type: "success"
    });
  }, [notify, tab]);

  const handleUploadFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setUploadFile(nextFile);
    if (nextFile) {
      setUploadName((current) => (current.trim() ? current : nextFile.name));
    }
  }, []);

  const handleViewUploadedFile = useCallback(
    async (item: FolderTimelineItem) => {
      if (!item.fileId) return;
      setFilePreviews((previous) => ({
        ...previous,
        [item.fileId!]: {
          ...previous[item.fileId!],
          loading: true,
          error: null
        }
      }));

      try {
        const response = await fetch(
          `/api/hub/files/${encodeURIComponent(item.fileId)}/read?orgId=${encodeURIComponent(orgId)}`,
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
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed to read file preview (${response.status}).`
                : "Failed to read file preview.")
          );
        }

        setFilePreviews((previous) => ({
          ...previous,
          [item.fileId!]: {
            loading: false,
            contentPreview: payload.contentPreview ?? null,
            amnesiaWiped: Boolean(payload.amnesiaWiped),
            proof: payload.proof ?? null,
            error: null
          }
        }));
      } catch (error) {
        setFilePreviews((previous) => ({
          ...previous,
          [item.fileId!]: {
            loading: false,
            contentPreview: null,
            amnesiaWiped: false,
            proof: null,
            error: error instanceof Error ? error.message : "Unable to preview this file."
          }
        }));
      }
    },
    [orgId]
  );

  const handleFolderUpload = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!currentFolder || !uploadFile) {
        notify({
          title: "DNA Memory",
          message: "Select a file before uploading.",
          type: "warning"
        });
        return;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.set("orgId", orgId);
        formData.set("name", uploadName.trim() || uploadFile.name);
        formData.set("type", "DNA");
        formData.set("file", uploadFile);
        formData.set("hubScope", "DNA_MEMORY");
        formData.set("memoryLane", tab);
        formData.set("functionalityGroupKey", toFunctionalityGroupId(currentFunctionalityLabel));
        formData.set("functionalityGroupLabel", currentFunctionalityLabel);
        formData.set("targetFolderId", currentFolder.id);
        formData.set("targetFolderTitle", currentFolder.title);

        const response = await fetch("/api/hub/files", {
          method: "POST",
          body: formData
        });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          message?: string;
          warning?: string;
          file?: DnaFileItem;
        }>(response);
        if (!response.ok || !payload?.ok || !payload.file) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed to upload folder file (${response.status}).`
                : "Failed to upload folder file.")
          );
        }

        setDnaFiles((previous) => [
          payload.file!,
          ...previous.filter((item) => item.id !== payload.file!.id)
        ]);
        setUploadFile(null);
        setUploadName("");
        notify({
          title: "DNA Memory",
          message: payload.warning
            ? `File uploaded, but ingest publishing reported: ${payload.warning}`
            : `${payload.file.name} was uploaded and queued for reconciliation.`,
          type: payload.warning ? "warning" : "success"
        });
        await Promise.all([loadDnaFiles(true), loadCurrentTab(tab)]);
      } catch (error) {
        notify({
          title: "DNA Memory",
          message: error instanceof Error ? error.message : "Upload failed.",
          type: "error"
        });
      } finally {
        setUploading(false);
      }
    },
    [
      currentFolder,
      currentFunctionalityLabel,
      loadCurrentTab,
      loadDnaFiles,
      notify,
      orgId,
      tab,
      uploadFile,
      uploadName
    ]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">DNA Memory</p>
          <p className="text-xs text-slate-500">
            Archive, long-term, short-term, quarantine, and cache folder memory.
          </p>
        </div>
        <button
          onClick={() => void refreshCurrent()}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300"
        >
          {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-6">
        <Stat label="Long-term" value={String(phase1Stats?.tierCounts.longTerm ?? 0)} />
        <Stat label="Archive" value={String(phase1Stats?.tierCounts.archive ?? 0)} />
        <Stat label="Staging" value={String(phase1Stats?.tierCounts.staging ?? 0)} />
        <Stat label="Contextual" value={String(phase1Stats?.strandCounts.contextual ?? 0)} />
        <Stat label="Working" value={String(phase1Stats?.strandCounts.working ?? 0)} />
        <Stat label="Graph" value={`${phase1Stats?.graph.nodes ?? 0}/${phase1Stats?.graph.edges ?? 0}`} />
      </div>

      {phase1Loading ? (
        <div className="inline-flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={14} className="animate-spin" />
          Loading DNA memory overview...
        </div>
      ) : null}

      {phase1 && !phase1.installed && phase1.message ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {phase1.message}
        </div>
      ) : null}

      <div className="inline-flex rounded-full border border-white/10 bg-black/25 p-1">
        {TAB_ORDER.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setTab(item.value)}
            className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
              tab === item.value ? "bg-emerald-500/15 text-emerald-300" : "text-slate-300"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {currentFolder ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setOpenFolderByTab((previous) => ({ ...previous, [tab]: null }))
                  }
                  className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400"
                >
                  <ArrowLeft size={12} />
                  Back to folders
                </button>
                <p className="mt-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                  {currentFolder.title}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {currentFunctionalityLabel} functionality | Updated {formatTimestamp(currentFolder.updatedAt)}
                </p>
              </>
            ) : currentFunctionalityGroup ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setOpenFunctionalityByTab((previous) => ({ ...previous, [tab]: null }))
                  }
                  className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400"
                >
                  <ArrowLeft size={12} />
                  Back to functionality groups
                </button>
                <p className="mt-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                  {currentFunctionalityGroup.title}
                </p>
                <p className="mt-1 text-xs text-slate-500">{currentFunctionalityGroup.summary}</p>
              </>
            ) : (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                  {laneMeta.title}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {laneMeta.hint} Functionality groups now sit above the existing folders.
                </p>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {currentFolder
              ? VIEW_OPTIONS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() =>
                        setFolderViews((previous) => ({ ...previous, [tab]: item.value }))
                      }
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
                        currentView === item.value
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                          : "border-white/20 bg-white/5 text-slate-300"
                      }`}
                        >
                      <Icon size={11} />
                      {item.label}
                    </button>
                  );
                })
              : (currentFunctionalityGroup ? currentGroupMetrics : laneMetrics).map((metric) => (
                  <div
                    key={metric.label}
                    className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300"
                  >
                    {metric.label}: {metric.value}
                  </div>
                ))}
            {!currentFolder ? (
              <button
                type="button"
                onClick={resetTabFunctionalityGrouping}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300"
              >
                <RotateCcw size={11} />
                Reset grouping
              </button>
            ) : null}
          </div>
        </div>

        {tab === "QUARANTINE" && quarantineDenied ? (
          <div className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <span className="inline-flex items-center gap-2">
              <Lock size={14} />
              Admin access is required for quarantine review.
            </span>
          </div>
        ) : tabLoading ? (
          <div className="mt-4 inline-flex items-center gap-2 text-sm text-slate-400">
            <Loader2 size={14} className="animate-spin" />
            Loading {laneMeta.title.toLowerCase()}...
          </div>
        ) : currentFolder ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  Folder summary
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-200">{currentFolder.summary}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {currentFolder.metrics.map((metric) => (
                  <Stat key={`${currentFolder.id}-${metric.label}`} label={metric.label} value={metric.value} />
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    Functionality layer
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    This outer folder decides where the current folder sits inside the selected tab.
                  </p>
                </div>
                <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-emerald-300">
                  {currentFunctionalityLabel}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <input
                  value={functionalityDraft}
                  onChange={(event) => setFunctionalityDraft(event.target.value)}
                  placeholder="Strings, Organization, Employee, Storage..."
                  className="min-w-[240px] flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={saveCurrentFolderFunctionality}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300"
                >
                  <Save size={11} />
                  Save group
                </button>
                <button
                  type="button"
                  onClick={resetCurrentFolderFunctionality}
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300"
                >
                  <RotateCcw size={11} />
                  Reset folder
                </button>
                <button
                  type="button"
                  onClick={resetTabFunctionalityGrouping}
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300"
                >
                  <RotateCcw size={11} />
                  Reset tab
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
                    Timeline
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Summary on top, with the folder timeline shown as list view or knowledge graph.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {currentGraphMetrics.map((metric) => (
                    <div
                      key={`${currentFolder.id}-${metric.label}`}
                      className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300"
                    >
                      {metric.label}: {metric.value}
                    </div>
                  ))}
                </div>
              </div>

              <form
                onSubmit={handleFolderUpload}
                className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      Add file
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Upload any file to this folder before the list or knowledge graph view. DNA
                      processing queues automatically after upload.
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={!uploadFile || uploading}
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300 disabled:opacity-50"
                  >
                    {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                    {uploading ? "Uploading..." : "Upload file"}
                  </button>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <label className="space-y-2 text-xs text-slate-400">
                    File label
                    <input
                      value={uploadName}
                      onChange={(event) => setUploadName(event.target.value)}
                      placeholder={uploadFile?.name || "Optional display name"}
                      className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                    />
                  </label>
                  <label className="space-y-2 text-xs text-slate-400">
                    Select file
                    <input
                      type="file"
                      onChange={handleUploadFileChange}
                      className="block w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-slate-200 file:mr-3 file:rounded-full file:border-0 file:bg-emerald-500/15 file:px-3 file:py-1.5 file:text-xs file:font-bold file:uppercase file:tracking-[0.14em] file:text-emerald-300"
                    />
                  </label>
                </div>
              </form>

              {currentView === "LIST" ? (
                <div className="vx-scrollbar mt-4 max-h-[560px] space-y-3 overflow-y-auto pr-1">
                  {currentFolder.items.length === 0 ? (
                    <p className="text-sm text-slate-500">No timeline files are in this folder yet.</p>
                  ) : (
                    currentFolder.items.map((item) => {
                      const previewState = item.fileId ? filePreviews[item.fileId] : null;
                      return (
                        <div
                          key={item.id}
                          className="rounded-2xl border border-white/10 bg-black/30 p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-100">{item.title}</p>
                              <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                                {item.meta}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <StateBadge state={item.state} />
                              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                                {formatTimestamp(item.timestamp)}
                              </p>
                            </div>
                          </div>

                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                            {item.description}
                          </p>

                          {item.fileUrl || item.fileId ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {item.fileUrl ? (
                                <a
                                  href={item.fileUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-emerald-300"
                                >
                                  View file
                                </a>
                              ) : null}
                              {item.fileId ? (
                                <button
                                  type="button"
                                  onClick={() => void handleViewUploadedFile(item)}
                                  disabled={previewState?.loading}
                                  className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-slate-300 disabled:opacity-60"
                                >
                                  {previewState?.loading ? "Loading preview..." : "Preview text"}
                                </button>
                              ) : null}
                            </div>
                          ) : null}

                          {item.fileId && previewState && !previewState.loading ? (
                            <div className="mt-3 rounded-2xl border border-white/10 bg-black/35 p-3 text-sm text-slate-300">
                              {previewState.error ? (
                                <p>{previewState.error}</p>
                              ) : previewState.amnesiaWiped ? (
                                <p>
                                  Preview withheld because this file was read with amnesia protection.
                                  {previewState.proof ? ` Proof: ${previewState.proof}` : ""}
                                </p>
                              ) : previewState.contentPreview ? (
                                <pre className="whitespace-pre-wrap text-xs leading-6 text-slate-300">
                                  {previewState.contentPreview}
                                </pre>
                              ) : (
                                <p>No text preview is available for this file. Use View file to open it.</p>
                              )}
                            </div>
                          ) : null}

                          {item.quarantineItem?.diffPatch ? (
                            <pre className="mt-3 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
                              {item.quarantineItem.diffPatch}
                            </pre>
                          ) : null}

                          {tab === "QUARANTINE" && item.quarantineItem ? (
                            <div className="mt-3 flex gap-2">
                              <button
                                onClick={() =>
                                  void handleQuarantineReview(item.quarantineItem!, "APPROVE")
                                }
                                disabled={reviewingMemoryId === item.quarantineItem.memoryId}
                                className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-emerald-300 disabled:opacity-60"
                              >
                                {reviewingMemoryId === item.quarantineItem.memoryId ? "Saving..." : "Approve"}
                              </button>
                              <button
                                onClick={() =>
                                  void handleQuarantineReview(item.quarantineItem!, "REJECT")
                                }
                                disabled={reviewingMemoryId === item.quarantineItem.memoryId}
                                className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-red-300 disabled:opacity-60"
                              >
                                Reject
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="mt-4">
                  <DnaKnowledgeCanvas
                    title={`${currentFolder.title} knowledge graph`}
                    hint="Summary sits in the center. Pending files remain connected on outer spokes, while reconciled files detach after their signal is absorbed into the center summary."
                    summary={currentFolder.summary}
                    metrics={currentGraphMetrics}
                    items={currentFolder.items.map((item) => ({
                      id: item.id,
                      label: item.title,
                      summary: item.description,
                      meta: item.meta,
                      timestamp: item.timestamp,
                      status: item.state
                    }))}
                  />
                </div>
              )}
            </div>
          </div>
        ) : currentFunctionalityGroup ? (
          currentFolders.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-500">
              No folders are assigned to this functionality group yet.
            </div>
          ) : (
            <div className="vx-scrollbar mt-4 grid max-h-[620px] gap-4 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
              {currentFolders.map((folder) => {
                const pendingCount = folder.items.filter((item) => item.state === "PENDING").length;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() =>
                      setOpenFolderByTab((previous) => ({ ...previous, [tab]: folder.id }))
                    }
                    className="rounded-3xl border border-white/10 bg-black/25 p-4 text-left transition hover:border-white/20 hover:bg-black/35"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                          Folder
                        </p>
                        <p className="mt-2 text-base font-semibold text-slate-100">{folder.title}</p>
                      </div>
                      <FolderOpen size={16} className="text-slate-500" />
                    </div>

                    <p className="mt-3 line-clamp-4 text-sm leading-6 text-slate-300">
                      {folder.summary}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <StateBadge state={pendingCount > 0 ? "PENDING" : "RECONCILED"} />
                      <div className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300">
                        {folder.items.length} files
                      </div>
                      <div className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300">
                        Updated {formatTimestamp(folder.updatedAt)}
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex flex-wrap gap-2">
                        {folder.metrics.slice(0, 3).map((metric) => (
                          <div
                            key={`${folder.id}-${metric.label}`}
                            className="text-[10px] uppercase tracking-[0.14em] text-slate-500"
                          >
                            {metric.label}: {metric.value}
                          </div>
                        ))}
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
                        Open folder
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )
        ) : currentFunctionalityGroups.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-500">
            {laneMeta.empty}
          </div>
        ) : (
          <div className="vx-scrollbar mt-4 grid max-h-[620px] gap-4 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
            {currentFunctionalityGroups.map((group) => {
              const pendingCount = group.folders.reduce(
                (sum, folder) => sum + folder.items.filter((item) => item.state === "PENDING").length,
                0
              );
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() =>
                    setOpenFunctionalityByTab((previous) => ({ ...previous, [tab]: group.id }))
                  }
                  className="rounded-3xl border border-white/10 bg-black/25 p-4 text-left transition hover:border-white/20 hover:bg-black/35"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                        Functionality
                      </p>
                      <p className="mt-2 text-base font-semibold text-slate-100">{group.title}</p>
                    </div>
                    <FolderOpen size={16} className="text-slate-500" />
                  </div>

                  <p className="mt-3 line-clamp-4 text-sm leading-6 text-slate-300">
                    {group.summary}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <StateBadge state={pendingCount > 0 ? "PENDING" : "RECONCILED"} />
                    <div className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300">
                      {group.folders.length} folders
                    </div>
                    <div className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300">
                      Updated {formatTimestamp(group.updatedAt)}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex flex-wrap gap-2">
                      {group.metrics.slice(0, 3).map((metric) => (
                        <div key={`${group.id}-${metric.label}`} className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                          {metric.label}: {metric.value}
                        </div>
                      ))}
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
                      Open group
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
