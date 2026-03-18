import { create } from "zustand";

export type DnaPhase4Tab =
  | "quarantine"
  | "trace"
  | "kanban"
  | "explorer"
  | "graph"
  | "admin";

export interface DnaPhase4ActorState {
  userId: string;
  role: string;
  isAdmin: boolean;
}

interface DnaPhase4OrgState {
  selectedTab: DnaPhase4Tab;
  traceDrawerOpen: boolean;
  selectedTraceId: string;
  selectedBoardId: string;
  explorerView: "list" | "grid";
  actor: DnaPhase4ActorState | null;
}

interface DnaPhase4Store {
  byOrg: Record<string, DnaPhase4OrgState>;
  ensureOrg: (orgId: string) => void;
  setActor: (orgId: string, actor: DnaPhase4ActorState | null) => void;
  setSelectedTab: (orgId: string, tab: DnaPhase4Tab) => void;
  setTraceDrawerOpen: (orgId: string, open: boolean) => void;
  setSelectedTraceId: (orgId: string, traceId: string) => void;
  setSelectedBoardId: (orgId: string, boardId: string) => void;
  setExplorerView: (orgId: string, view: "list" | "grid") => void;
}

function defaultState(): DnaPhase4OrgState {
  return {
    selectedTab: "trace",
    traceDrawerOpen: false,
    selectedTraceId: "",
    selectedBoardId: "",
    explorerView: "list",
    actor: null
  };
}

export const useDnaPhase4Store = create<DnaPhase4Store>((set) => ({
  byOrg: {},
  ensureOrg: (orgId) =>
    set((state) => ({
      byOrg: {
        ...state.byOrg,
        [orgId]: state.byOrg[orgId] ?? defaultState()
      }
    })),
  setActor: (orgId, actor) =>
    set((state) => ({
      byOrg: {
        ...state.byOrg,
        [orgId]: {
          ...(state.byOrg[orgId] ?? defaultState()),
          actor
        }
      }
    })),
  setSelectedTab: (orgId, tab) =>
    set((state) => ({
      byOrg: {
        ...state.byOrg,
        [orgId]: {
          ...(state.byOrg[orgId] ?? defaultState()),
          selectedTab: tab
        }
      }
    })),
  setTraceDrawerOpen: (orgId, open) =>
    set((state) => ({
      byOrg: {
        ...state.byOrg,
        [orgId]: {
          ...(state.byOrg[orgId] ?? defaultState()),
          traceDrawerOpen: open
        }
      }
    })),
  setSelectedTraceId: (orgId, traceId) =>
    set((state) => ({
      byOrg: {
        ...state.byOrg,
        [orgId]: {
          ...(state.byOrg[orgId] ?? defaultState()),
          selectedTraceId: traceId
        }
      }
    })),
  setSelectedBoardId: (orgId, boardId) =>
    set((state) => ({
      byOrg: {
        ...state.byOrg,
        [orgId]: {
          ...(state.byOrg[orgId] ?? defaultState()),
          selectedBoardId: boardId
        }
      }
    })),
  setExplorerView: (orgId, view) =>
    set((state) => ({
      byOrg: {
        ...state.byOrg,
        [orgId]: {
          ...(state.byOrg[orgId] ?? defaultState()),
          explorerView: view
        }
      }
    }))
}));
