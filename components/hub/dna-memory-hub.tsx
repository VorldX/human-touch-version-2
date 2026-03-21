"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Lock, RefreshCw, UploadCloud } from "lucide-react";

import { DnaMemoryPanel } from "@/components/hub/dna-memory-panel";
import { DnaKnowledgeCanvas } from "@/components/hub/dna-knowledge-canvas";
import { parseJsonResponse } from "@/lib/http/json-response";
import { useVorldXStore } from "@/lib/store/vorldx-store";

type DnaTab = "LONG_TERM" | "SHORT_TERM" | "ARCHIVE" | "QUARANTINE";
type LaneInnerTab = "FILES" | "KNOWLEDGE_CANVAS";

interface DnaMemoryHubProps {
  orgId: string;
  themeStyle: {
    border: string;
  };
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

interface TraceRun {
  traceId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  flowId: string | null;
  taskId: string | null;
  agentName: string;
  responsePreview: string;
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

interface KnowledgeGraphNode {
  id: number;
  label: string;
  propertiesJsonb: Record<string, unknown> | null;
  version: number;
  updatedAt: string;
}

interface KnowledgeGraphEdge {
  id: number;
  sourceId: number;
  targetId: number;
  relationshipType: string;
  weight: number;
  version: number;
  updatedAt: string;
}

interface KnowledgeGraphSnapshot {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

interface CanvasMetric {
  label: string;
  value: string;
}

const LANE_META: Record<
  DnaTab,
  {
    title: string;
    hint: string;
  }
> = {
  LONG_TERM: {
    title: "Long-term memory",
    hint: "Source files, ingest tools, and surfaced DNA entries."
  },
  SHORT_TERM: {
    title: "Short-term memory",
    hint: "Queue backlog, boards, and live claim-check activity."
  },
  ARCHIVE: {
    title: "Archive",
    hint: "Archived memory slices and trace history."
  },
  QUARANTINE: {
    title: "Quarantine",
    hint: "Admin review queue for memory items under inspection."
  }
};

const INNER_TABS: Array<{ value: LaneInnerTab; label: string }> = [
  { value: "FILES", label: "Files" },
  { value: "KNOWLEDGE_CANVAS", label: "Knowledge Canvas" }
];

function formatFileSize(raw: string) {
  const bytes = Number(raw);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}

export function DnaMemoryHub({ orgId, themeStyle }: DnaMemoryHubProps) {
  const notify = useVorldXStore((state) => state.pushNotification);
  const [tab, setTab] = useState<DnaTab>("LONG_TERM");
  const [laneViews, setLaneViews] = useState<Record<DnaTab, LaneInnerTab>>({
    LONG_TERM: "FILES",
    SHORT_TERM: "FILES",
    ARCHIVE: "FILES",
    QUARANTINE: "FILES"
  });
  const [refreshing, setRefreshing] = useState(false);
  const [phase1, setPhase1] = useState<Phase1Summary | null>(null);
  const [phase1Loading, setPhase1Loading] = useState(true);
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraphSnapshot | null>(null);
  const [knowledgeGraphLoading, setKnowledgeGraphLoading] = useState(false);
  const [knowledgeGraphError, setKnowledgeGraphError] = useState<string | null>(null);
  const [dnaFiles, setDnaFiles] = useState<DnaFileItem[]>([]);
  const [dnaLoading, setDnaLoading] = useState(true);
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
  const [longTermEntries, setLongTermEntries] = useState<ExplorerEntry[]>([]);
  const [queueBacklog, setQueueBacklog] = useState<QueueBacklog[]>([]);
  const [queueTasks, setQueueTasks] = useState<QueueTask[]>([]);
  const [kanbanBoards, setKanbanBoards] = useState<KanbanBoard[]>([]);
  const [kanbanSteps, setKanbanSteps] = useState<KanbanStep[]>([]);
  const [archiveEntries, setArchiveEntries] = useState<ExplorerEntry[]>([]);
  const [traces, setTraces] = useState<TraceRun[]>([]);
  const [quarantineItems, setQuarantineItems] = useState<QuarantineItem[]>([]);
  const [quarantineLoading, setQuarantineLoading] = useState(false);
  const [quarantineDenied, setQuarantineDenied] = useState(false);
  const [reviewingMemoryId, setReviewingMemoryId] = useState<number | null>(null);
  const currentLaneView = laneViews[tab];

  const loadPhase1 = useCallback(async () => {
    setPhase1Loading(true);
    try {
      const response = await fetch(`/api/dna/memory/phase1?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store"
      });
      const { payload } = await parseJsonResponse<Phase1Summary & { ok?: boolean }>(response);
      if (response.ok && payload?.ok) setPhase1(payload);
    } finally {
      setPhase1Loading(false);
    }
  }, [orgId]);

  const loadDnaFiles = useCallback(async () => {
    setDnaLoading(true);
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
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed to load DNA files (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed to load DNA files.")
        );
      }
      setDnaFiles(payload.files);
    } catch (error) {
      notify({
        title: "DNA Memory",
        message: error instanceof Error ? error.message : "Unable to load DNA files.",
        type: "error"
      });
    } finally {
      setDnaLoading(false);
    }
  }, [notify, orgId]);

  const loadExplorerTier = useCallback(
    async (tier: "LONG_TERM" | "ARCHIVE", setter: (entries: ExplorerEntry[]) => void) => {
      const response = await fetch(
        `/api/dna/memory/phase4/explorer?orgId=${encodeURIComponent(orgId)}&tier=${tier}&limit=20`,
        { cache: "no-store" }
      );
      const { payload } = await parseJsonResponse<{ ok?: boolean; entries?: ExplorerEntry[] }>(
        response
      );
      if (response.ok && payload?.ok && payload.entries) setter(payload.entries);
    },
    [orgId]
  );

  const loadKnowledgeGraph = useCallback(async () => {
    setKnowledgeGraphLoading(true);
    setKnowledgeGraphError(null);
    try {
      const response = await fetch(
        `/api/dna/memory/phase4/graph?orgId=${encodeURIComponent(orgId)}&nodeLimit=14&edgeLimit=20`,
        { cache: "no-store" }
      );
      const { payload, rawText } = await parseJsonResponse<
        { ok?: boolean; message?: string; nodes?: KnowledgeGraphNode[]; edges?: KnowledgeGraphEdge[] }
      >(response);
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed to load DNA graph (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed to load DNA graph.")
        );
      }
      setKnowledgeGraph({
        nodes: payload.nodes ?? [],
        edges: payload.edges ?? []
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load DNA graph.";
      setKnowledgeGraphError(message);
      notify({
        title: "DNA Memory",
        message,
        type: "error"
      });
    } finally {
      setKnowledgeGraphLoading(false);
    }
  }, [notify, orgId]);

  const loadShortTerm = useCallback(async () => {
    const [queueResponse, kanbanResponse] = await Promise.all([
      fetch(`/api/dna/memory/phase2/queue?orgId=${encodeURIComponent(orgId)}&limit=12`, {
        cache: "no-store"
      }),
      fetch(`/api/dna/memory/phase4/kanban?orgId=${encodeURIComponent(orgId)}&limit=12`, {
        cache: "no-store"
      })
    ]);
    const { payload: queuePayload } = await parseJsonResponse<{
      ok?: boolean;
      backlog?: QueueBacklog[];
      tasks?: QueueTask[];
    }>(queueResponse);
    const { payload: kanbanPayload } = await parseJsonResponse<{
      ok?: boolean;
      boards?: KanbanBoard[];
      steps?: KanbanStep[];
    }>(kanbanResponse);
    if (queueResponse.ok && queuePayload?.ok) {
      setQueueBacklog(queuePayload.backlog ?? []);
      setQueueTasks(queuePayload.tasks ?? []);
    }
    if (kanbanResponse.ok && kanbanPayload?.ok) {
      setKanbanBoards(kanbanPayload.boards ?? []);
      setKanbanSteps(kanbanPayload.steps ?? []);
    }
  }, [orgId]);

  const loadArchive = useCallback(async () => {
    const traceResponse = await fetch(
      `/api/dna/memory/phase4/trace?orgId=${encodeURIComponent(orgId)}&limit=12`,
      { cache: "no-store" }
    );
    const { payload } = await parseJsonResponse<{ ok?: boolean; traces?: TraceRun[] }>(traceResponse);
    if (traceResponse.ok && payload?.ok) setTraces(payload.traces ?? []);
    await loadExplorerTier("ARCHIVE", setArchiveEntries);
  }, [loadExplorerTier, orgId]);

  const loadQuarantine = useCallback(async () => {
    setQuarantineLoading(true);
    try {
      const response = await fetch(
        `/api/dna/memory/phase4/quarantine?orgId=${encodeURIComponent(orgId)}&limit=20`,
        { cache: "no-store" }
      );
      const { payload, rawText } = await parseJsonResponse<{
        ok?: boolean;
        message?: string;
        items?: QuarantineItem[];
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
              ? `Failed to load quarantine (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed to load quarantine.")
        );
      }
      setQuarantineDenied(false);
      setQuarantineItems(payload.items ?? []);
    } catch (error) {
      notify({
        title: "DNA Memory",
        message: error instanceof Error ? error.message : "Unable to load quarantine items.",
        type: "error"
      });
    } finally {
      setQuarantineLoading(false);
    }
  }, [notify, orgId]);

  useEffect(() => {
    void loadPhase1();
  }, [loadPhase1]);

  useEffect(() => {
    if (tab === "LONG_TERM") {
      void Promise.all([loadDnaFiles(), loadExplorerTier("LONG_TERM", setLongTermEntries)]);
    }
    if (tab === "SHORT_TERM") {
      void loadShortTerm();
    }
    if (tab === "ARCHIVE") {
      void loadArchive();
    }
    if (tab === "QUARANTINE") {
      void loadQuarantine();
    }
  }, [loadArchive, loadDnaFiles, loadExplorerTier, loadQuarantine, loadShortTerm, tab]);

  useEffect(() => {
    if (currentLaneView === "KNOWLEDGE_CANVAS") {
      void loadKnowledgeGraph();
    }
  }, [currentLaneView, loadKnowledgeGraph, tab]);

  const refreshCurrent = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadPhase1();
      if (tab === "LONG_TERM") {
        await Promise.all([loadDnaFiles(), loadExplorerTier("LONG_TERM", setLongTermEntries)]);
      }
      if (tab === "SHORT_TERM") {
        await loadShortTerm();
      }
      if (tab === "ARCHIVE") {
        await loadArchive();
      }
      if (tab === "QUARANTINE") {
        await loadQuarantine();
      }
      if (currentLaneView === "KNOWLEDGE_CANVAS") {
        await loadKnowledgeGraph();
      }
    } finally {
      setRefreshing(false);
    }
  }, [
    currentLaneView,
    loadArchive,
    loadDnaFiles,
    loadExplorerTier,
    loadKnowledgeGraph,
    loadPhase1,
    loadQuarantine,
    loadShortTerm,
    tab
  ]);

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
        const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string; warning?: string }>(
          response
        );
        if (!response.ok || !payload?.ok) {
          notify({
            title: "DNA Upload",
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
          message: payload.warning ?? "DNA file uploaded.",
          type: "success"
        });
        setDnaName("");
        setDnaAmnesia(false);
        setDnaSelectedFile(null);
        setDnaSourceUrl("");
        await loadDnaFiles();
      } finally {
        setDnaUploading(false);
      }
    },
    [dnaAmnesia, dnaName, dnaSelectedFile, dnaSourceUrl, loadDnaFiles, notify, orgId]
  );

  const handleDnaRead = useCallback(
    async (file: DnaFileItem) => {
      setReadingFileId(file.id);
      try {
        const response = await fetch(`/api/hub/files/${file.id}/read?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store"
        });
        const { payload, rawText } = await parseJsonResponse<{
          ok?: boolean;
          contentPreview?: string | null;
          amnesiaWiped?: boolean;
          proof?: string;
        }>(response);
        if (!response.ok || !payload?.ok) {
          throw new Error(
            rawText
              ? `Unable to read DNA file (${response.status}): ${rawText.slice(0, 180)}`
              : "Unable to read DNA file."
          );
        }
        setDnaPreview({
          fileName: file.name,
          contentPreview: payload.contentPreview ?? null,
          amnesiaWiped: Boolean(payload.amnesiaWiped),
          proof: payload.proof
        });
      } catch (error) {
        notify({
          title: "DNA Memory",
          message: error instanceof Error ? error.message : "Unable to read DNA file.",
          type: "error"
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
        const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string; warning?: string }>(
          response
        );
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Unable to queue DNA ingest (${response.status}): ${rawText.slice(0, 180)}`
                : "Unable to queue DNA ingest.")
          );
        }
        notify({
          title: "DNA Memory",
          message: payload.warning ?? payload.message ?? "DNA ingest queued.",
          type: "success"
        });
        await loadDnaFiles();
      } catch (error) {
        notify({
          title: "DNA Memory",
          message: error instanceof Error ? error.message : "Unable to queue DNA ingest.",
          type: "error"
        });
      } finally {
        setIngestingFileId(null);
      }
    },
    [loadDnaFiles, notify, orgId]
  );

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
                ? `Failed to review quarantine item (${response.status}): ${rawText.slice(0, 180)}`
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
  const queuedCount = useMemo(
    () => queueBacklog.reduce((sum, item) => sum + item.queuedItems, 0),
    [queueBacklog]
  );
  const laneMeta = LANE_META[tab];
  const laneCanvasMetrics: CanvasMetric[] =
    tab === "LONG_TERM"
      ? [
          { label: "Files", value: String(dnaFiles.length) },
          { label: "Entries", value: String(longTermEntries.length) },
          { label: "Graph", value: String(knowledgeGraph?.nodes.length ?? phase1Stats?.graph.nodes ?? 0) }
        ]
      : tab === "SHORT_TERM"
        ? [
            { label: "Queued", value: String(queuedCount) },
            { label: "Boards", value: String(kanbanBoards.length) },
            { label: "Tasks", value: String(queueTasks.length) }
          ]
        : tab === "ARCHIVE"
          ? [
              { label: "Archive", value: String(archiveEntries.length) },
              { label: "Traces", value: String(traces.length) },
              { label: "Graph", value: String(knowledgeGraph?.edges.length ?? phase1Stats?.graph.edges ?? 0) }
            ]
          : [
              { label: "Pending", value: String(quarantineItems.length) },
              { label: "Denied", value: quarantineDenied ? "Yes" : "No" },
              { label: "Graph", value: String(knowledgeGraph?.nodes.length ?? phase1Stats?.graph.nodes ?? 0) }
            ];
  const handleLaneViewChange = useCallback(
    (value: LaneInnerTab) => {
      setLaneViews((prev) => ({ ...prev, [tab]: value }));
    },
    [tab]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">DNA Memory</p>
          <p className="text-xs text-slate-500">
            Long-term, short-term, archive, and quarantine memory operations.
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
        {([
          ["LONG_TERM", "Long-term memory"],
          ["SHORT_TERM", "Short-term memory"],
          ["ARCHIVE", "Archive"],
          ["QUARANTINE", "Quarantine"]
        ] as Array<[DnaTab, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
              tab === value ? "bg-emerald-500/15 text-emerald-300" : "text-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">{laneMeta.title}</p>
            <p className="mt-1 text-xs text-slate-500">{laneMeta.hint}</p>
          </div>
          <div className="inline-flex rounded-full border border-white/10 bg-black/25 p-1">
            {INNER_TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => handleLaneViewChange(item.value)}
                className={`rounded-full px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${
                  currentLaneView === item.value ? "bg-emerald-500/15 text-emerald-300" : "text-slate-300"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          {currentLaneView === "FILES" ? (
            <div className="space-y-4">
              {tab === "LONG_TERM" && (
        <div className="space-y-4">
          <div className="grid gap-4 2xl:grid-cols-[1.15fr_0.85fr]">
            <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">DNA Source Files</p>
              <div className="mt-3 space-y-3">
                {dnaLoading ? (
                  <div className="inline-flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 size={14} className="animate-spin" />
                    Loading DNA files...
                  </div>
                ) : dnaFiles.length === 0 ? (
                  <p className="rounded-2xl border border-white/10 bg-black/25 px-4 py-4 text-sm text-slate-500">
                    No DNA files available.
                  </p>
                ) : (
                  dnaFiles.map((file) => (
                    <div key={file.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-100">{file.name}</p>
                          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                            {formatFileSize(file.size)} | Health {file.health}
                          </p>
                        </div>
                        {file.isAmnesiaProtected ? (
                          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-amber-300">
                            Amnesia
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => void handleDnaRead(file)} className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-200">
                          {readingFileId === file.id ? "Reading..." : "Read"}
                        </button>
                        <button onClick={() => void handleDnaIngest(file)} className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-cyan-300">
                          {ingestingFileId === file.id ? "Queueing..." : "Run ingest"}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className={`vx-panel space-y-4 rounded-3xl p-4 ${themeStyle.border}`}>
              <form onSubmit={handleDnaUpload} className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">Upload DNA Source</p>
                <input value={dnaName} onChange={(event) => setDnaName(event.target.value)} placeholder="Display name" className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none" />
                <input type="file" onChange={(event) => setDnaSelectedFile(event.target.files?.[0] ?? null)} className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs" />
                <input value={dnaSourceUrl} onChange={(event) => setDnaSourceUrl(event.target.value)} placeholder="Or remote source URL" className="w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-slate-100 outline-none" />
                <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-400">
                  <input type="checkbox" checked={dnaAmnesia} onChange={(event) => setDnaAmnesia(event.target.checked)} />
                  Enable amnesia protection
                </label>
                <button type="submit" disabled={dnaUploading} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-black transition hover:bg-emerald-500 hover:text-white disabled:opacity-60">
                  {dnaUploading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
                  Upload DNA
                </button>
              </form>

              {dnaPreview ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{dnaPreview.fileName}</p>
                  {dnaPreview.amnesiaWiped ? (
                    <div className="mt-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-xs text-amber-300">
                      Raw content wiped by Amnesia protocol.
                      {dnaPreview.proof ? <span className="block pt-1">Proof: {dnaPreview.proof}</span> : null}
                    </div>
                  ) : (
                    <pre className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/35 p-3 text-xs text-slate-300">
                      {dnaPreview.contentPreview || "No preview available."}
                    </pre>
                  )}
                </div>
              ) : null}

              <DnaMemoryPanel orgId={orgId} />
            </div>
          </div>

          <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">Long-term Entries</p>
            <div className="mt-3 space-y-2">
              {longTermEntries.length === 0 ? (
                <p className="text-sm text-slate-500">No long-term memory entries surfaced yet.</p>
              ) : (
                longTermEntries.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {entry.memoryDomain} | {entry.memoryKind} | {entry.tokenCount} tokens
                    </p>
                    <p className="mt-2 text-sm text-slate-300">{entry.content}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "SHORT_TERM" && (
        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">Queue Backlog</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Stat label="Queued Items" value={String(queuedCount)} />
              <Stat label="Boards" value={String(kanbanBoards.length)} />
              <Stat label="Live Steps" value={String(kanbanSteps.length)} />
            </div>
            <div className="mt-4 space-y-2">
              {queueBacklog.length === 0 ? (
                <p className="text-sm text-slate-500">No short-term queue backlog right now.</p>
              ) : (
                queueBacklog.map((item) => (
                  <div key={`${item.userId}-${item.status}`} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <p className="text-sm font-semibold text-slate-100">{item.status}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {item.queuedItems} queued | Latest {item.newestCreatedAt ? new Date(item.newestCreatedAt).toLocaleString() : "N/A"}
                    </p>
                  </div>
                ))
              )}
            </div>
            <div className="mt-4 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Recent claim-check tasks</p>
              {queueTasks.length === 0 ? (
                <p className="text-sm text-slate-500">No short-term tasks queued recently.</p>
              ) : (
                queueTasks.map((task) => (
                  <div key={task.taskId} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <p className="text-sm font-semibold text-slate-100">{task.status}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      Session {task.sessionId} | Attempts {task.attemptCount}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">Active Boards</p>
            <div className="mt-3 space-y-2">
              {kanbanBoards.length === 0 ? (
                <p className="text-sm text-slate-500">No active short-term boards right now.</p>
              ) : (
                kanbanBoards.map((board) => (
                  <div key={board.boardId} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <p className="text-sm font-semibold text-slate-100">{board.boardStatus}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      Steps {board.completedSteps}/{board.totalSteps} complete | Pending {board.pendingSteps}
                    </p>
                  </div>
                ))
              )}
            </div>
            <div className="mt-4 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Step activity</p>
              {kanbanSteps.length === 0 ? (
                <p className="text-sm text-slate-500">No live short-term steps surfaced.</p>
              ) : (
                kanbanSteps.slice(0, 12).map((step) => (
                  <div key={step.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <p className="text-sm font-semibold text-slate-100">
                      {step.stepOrder}. {step.stepKey}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {step.status} | {step.claimedByAgentId ?? "Unclaimed"}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "ARCHIVE" && (
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">Archived Memory</p>
            <div className="mt-3 space-y-2">
              {archiveEntries.length === 0 ? (
                <p className="text-sm text-slate-500">No archived memory entries available yet.</p>
              ) : (
                archiveEntries.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {entry.documentId} | {entry.tokenCount} tokens
                    </p>
                    <p className="mt-2 text-sm text-slate-300">{entry.content}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-200">Trace History</p>
            <div className="mt-3 space-y-2">
              {traces.length === 0 ? (
                <p className="text-sm text-slate-500">No archived trace runs available yet.</p>
              ) : (
                traces.map((trace) => (
                  <div key={trace.traceId} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                    <p className="text-sm font-semibold text-slate-100">{trace.agentName}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      {trace.status} | {new Date(trace.startedAt).toLocaleString()}
                    </p>
                    <p className="mt-2 line-clamp-3 text-xs text-slate-400">{trace.responsePreview}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "QUARANTINE" && (
        <div className={`vx-panel rounded-3xl p-4 ${themeStyle.border}`}>
          {quarantineDenied ? (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <span className="inline-flex items-center gap-2">
                <Lock size={14} />
                Admin access is required for quarantine review.
              </span>
            </div>
          ) : quarantineLoading ? (
            <div className="inline-flex items-center gap-2 text-sm text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              Loading quarantine items...
            </div>
          ) : quarantineItems.length === 0 ? (
            <p className="text-sm text-slate-500">No quarantine items pending review.</p>
          ) : (
            <div className="space-y-3">
              {quarantineItems.map((item) => (
                <div key={item.memoryId} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    Memory {item.memoryId} | {item.documentId} | Chunk {item.chunkIndex}
                  </p>
                  <pre className="mt-3 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/35 p-3 text-xs text-slate-300">
                    {item.content}
                  </pre>
                  {item.diffPatch ? (
                    <pre className="mt-3 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
                      {item.diffPatch}
                    </pre>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => void handleQuarantineReview(item, "APPROVE")} disabled={reviewingMemoryId === item.memoryId} className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-emerald-300 disabled:opacity-60">
                      {reviewingMemoryId === item.memoryId ? "Saving..." : "Approve"}
                    </button>
                    <button onClick={() => void handleQuarantineReview(item, "REJECT")} disabled={reviewingMemoryId === item.memoryId} className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-red-300 disabled:opacity-60">
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
            </div>
          ) : (
            <DnaKnowledgeCanvas
              title={`${laneMeta.title} knowledge canvas`}
              hint={laneMeta.hint}
              metrics={laneCanvasMetrics}
              graph={knowledgeGraph}
              loading={knowledgeGraphLoading}
              error={knowledgeGraphError}
            />
          )}
        </div>
      </div>
    </div>
  );
}
