import { create } from "zustand";

export interface DnaPhase1PartitionSample {
  parent: "central_memory" | "nodes" | "edges";
  child: string;
}

export interface DnaPhase1Status {
  phase: "PHASE_1";
  installed: boolean;
  subject: {
    tenantId: string;
    userId: string;
  };
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
    partitions: {
      suffix: string;
      expected: {
        centralMemory: string;
        nodes: string;
        edges: string;
      };
      present: {
        centralMemory: boolean;
        nodes: boolean;
        edges: boolean;
      };
      totals: {
        centralMemory: number;
        nodes: number;
        edges: number;
      };
      samples: DnaPhase1PartitionSample[];
    };
    safeguards: {
      rls: {
        centralMemory: boolean;
        nodes: boolean;
        edges: boolean;
      };
      occColumns: {
        centralMemory: boolean;
        nodes: boolean;
        edges: boolean;
      };
      schemaVersionColumns: {
        centralMemory: boolean;
        nodes: boolean;
        edges: boolean;
      };
    };
  };
}

export interface DnaPhase1OrgState {
  data: DnaPhase1Status | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  loadedAt: number | null;
}

interface DnaPhase1Store {
  byOrg: Record<string, DnaPhase1OrgState>;
  startLoad: (orgId: string, silent?: boolean) => void;
  finishLoad: (orgId: string, data: DnaPhase1Status) => void;
  failLoad: (orgId: string, error: string) => void;
}

function defaultOrgState(): DnaPhase1OrgState {
  return {
    data: null,
    loading: true,
    refreshing: false,
    error: null,
    loadedAt: null
  };
}

export const useDnaPhase1Store = create<DnaPhase1Store>((set) => ({
  byOrg: {},
  startLoad: (orgId, silent = false) =>
    set((state) => {
      const existing = state.byOrg[orgId] ?? defaultOrgState();
      return {
        byOrg: {
          ...state.byOrg,
          [orgId]: {
            ...existing,
            loading: silent ? existing.loading : true,
            refreshing: silent,
            error: silent ? existing.error : null
          }
        }
      };
    }),
  finishLoad: (orgId, data) =>
    set((state) => ({
      byOrg: {
        ...state.byOrg,
        [orgId]: {
          data,
          loading: false,
          refreshing: false,
          error: null,
          loadedAt: Date.now()
        }
      }
    })),
  failLoad: (orgId, error) =>
    set((state) => {
      const existing = state.byOrg[orgId] ?? defaultOrgState();
      return {
        byOrg: {
          ...state.byOrg,
          [orgId]: {
            ...existing,
            loading: false,
            refreshing: false,
            error
          }
        }
      };
    })
}));
