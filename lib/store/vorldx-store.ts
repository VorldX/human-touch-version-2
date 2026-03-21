import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type AppTheme = "APEX" | "VEDA" | "NEXUS";
export type EarthProfileRole = "Human" | "AI" | "Mixed";
export type EarthProfileMode = "OFFLINE" | "LIVE" | "MIXED";
export type EarthApprovalMode = "HUMAN_ONLY" | "AI_REQUESTS_HUMAN" | "AI_SELF_APPROVE";
export const EARTH_ORG_ID = "__earth__";

export function normalizeEarthControlLevel(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function earthControlLevelFromRole(role: EarthProfileRole) {
  if (role === "AI") {
    return 100;
  }
  if (role === "Mixed") {
    return 50;
  }
  return 0;
}

export function earthProfileRoleFromControlLevel(value: unknown): EarthProfileRole {
  const normalized = normalizeEarthControlLevel(value);
  if (normalized > 50) {
    return "AI";
  }
  if (normalized < 50) {
    return "Human";
  }
  return "Mixed";
}

export function normalizeEarthApprovalMode(
  value: unknown,
  controlLevel: unknown
): EarthApprovalMode {
  const normalizedControlLevel = normalizeEarthControlLevel(controlLevel);
  if (normalizedControlLevel < 100) {
    return "HUMAN_ONLY";
  }
  if (value === "AI_SELF_APPROVE" || value === "AI_REQUESTS_HUMAN") {
    return value;
  }
  return "AI_REQUESTS_HUMAN";
}

export function earthApprovalModeLabel(mode: EarthApprovalMode) {
  if (mode === "AI_SELF_APPROVE") {
    return "AI self approval";
  }
  if (mode === "AI_REQUESTS_HUMAN") {
    return "AI requests approval";
  }
  return "Human approval only";
}

export interface OrgContext {
  id: string;
  name: string;
  role: string;
  theme: AppTheme;
  kind?: "WORKSPACE" | "FALLBACK";
}

export function buildEarthOrgContext(role: EarthProfileRole): OrgContext {
  return {
    id: EARTH_ORG_ID,
    name: "Earth",
    role,
    theme: "NEXUS",
    kind: "FALLBACK"
  };
}

export function isEarthOrgContext(
  org: Pick<OrgContext, "id"> | null | undefined
): boolean {
  return org?.id === EARTH_ORG_ID;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  createdAt: number;
}

export interface ActiveUser {
  id: string;
  name: string;
  color: string;
  email?: string;
  role?: string;
  kind?: "HUMAN" | "AI";
  online?: boolean;
  source?: "team" | "squad" | "presence" | "system";
}

interface VorldXState {
  orgs: OrgContext[];
  currentOrg: OrgContext | null;
  earthRole: EarthProfileRole;
  earthControlLevel: number;
  earthMode: EarthProfileMode;
  earthApprovalMode: EarthApprovalMode;
  theme: AppTheme;
  isGhostModeActive: boolean;
  notifications: NotificationItem[];
  activeUsers: ActiveUser[];
  setOrgs: (orgs: OrgContext[]) => void;
  addOrg: (org: OrgContext) => void;
  setCurrentOrg: (org: OrgContext | null) => void;
  setEarthControlLevel: (controlLevel: number) => void;
  setEarthMode: (mode: EarthProfileMode) => void;
  setEarthApprovalMode: (mode: EarthApprovalMode) => void;
  setTheme: (theme: AppTheme) => void;
  toggleGhostMode: () => void;
  pushNotification: (payload: Omit<NotificationItem, "id" | "createdAt">) => void;
  dismissNotification: (id: string) => void;
  setActiveUsers: (users: ActiveUser[]) => void;
  upsertActiveUsers: (users: ActiveUser[]) => void;
  removeActiveUser: (id: string) => void;
}

const memoryStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined
};

export const useVorldXStore = create<VorldXState>()(
  persist(
    (set) => ({
      orgs: [],
      currentOrg: null,
      earthRole: "Human",
      earthControlLevel: 0,
      earthMode: "LIVE",
      earthApprovalMode: "HUMAN_ONLY",
      theme: "NEXUS",
      isGhostModeActive: false,
      notifications: [],
      activeUsers: [],

      setOrgs: (orgs) =>
        set(() => ({
          orgs
        })),

      addOrg: (org) =>
        set((state) => ({
          orgs: state.orgs.some((item) => item.id === org.id) ? state.orgs : [...state.orgs, org]
        })),

      setCurrentOrg: (org) =>
        set((state) => ({
          currentOrg: org,
          theme: org?.theme ?? state.theme
        })),

      setEarthControlLevel: (controlLevel) =>
        set((state) => {
          const normalizedControlLevel = normalizeEarthControlLevel(controlLevel);
          const nextRole = earthProfileRoleFromControlLevel(normalizedControlLevel);
          return {
            earthControlLevel: normalizedControlLevel,
            earthRole: nextRole,
            earthApprovalMode: normalizeEarthApprovalMode(
              state.earthApprovalMode,
              normalizedControlLevel
            ),
            currentOrg: isEarthOrgContext(state.currentOrg)
              ? buildEarthOrgContext(nextRole)
              : state.currentOrg
          };
        }),

      setEarthMode: (mode) =>
        set(() => ({
          earthMode: mode
        })),

      setEarthApprovalMode: (mode) =>
        set((state) => ({
          earthApprovalMode: normalizeEarthApprovalMode(mode, state.earthControlLevel)
        })),

      setTheme: (theme) =>
        set(() => ({
          theme
        })),

      toggleGhostMode: () =>
        set((state) => ({
          isGhostModeActive: !state.isGhostModeActive
        })),

      pushNotification: (payload) =>
        set((state) => ({
          notifications: [
            ...state.notifications,
            {
              id: crypto.randomUUID(),
              createdAt: Date.now(),
              ...payload
            }
          ]
        })),

      dismissNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((item) => item.id !== id)
        })),

      setActiveUsers: (users) =>
        set(() => ({
          activeUsers: users
        })),

      upsertActiveUsers: (users) =>
        set((state) => {
          if (users.length === 0) {
            return { activeUsers: state.activeUsers };
          }
          const map = new Map<string, ActiveUser>();
          for (const existing of state.activeUsers) {
            map.set(existing.id, existing);
          }
          for (const incoming of users) {
            const previous = map.get(incoming.id);
            map.set(incoming.id, {
              ...previous,
              ...incoming,
              online: incoming.online ?? previous?.online ?? true
            });
          }
          return {
            activeUsers: Array.from(map.values())
          };
        }),

      removeActiveUser: (id) =>
        set((state) => ({
          activeUsers: state.activeUsers.filter((item) => item.id !== id)
        }))
    }),
    {
      name: "vorldx-store",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : memoryStorage
      ),
      partialize: (state) => ({
        orgs: state.orgs,
        currentOrg: state.currentOrg,
        earthRole: state.earthRole,
        earthControlLevel: state.earthControlLevel,
        earthMode: state.earthMode,
        earthApprovalMode: state.earthApprovalMode,
        theme: state.theme,
        isGhostModeActive: state.isGhostModeActive
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<VorldXState>;
        const earthControlLevel = normalizeEarthControlLevel(
          persisted.earthControlLevel ??
            earthControlLevelFromRole(
              persisted.earthRole ?? currentState.earthRole
            )
        );
        const earthRole = earthProfileRoleFromControlLevel(earthControlLevel);
        const currentOrg =
          persisted.currentOrg && isEarthOrgContext(persisted.currentOrg)
            ? buildEarthOrgContext(earthRole)
            : persisted.currentOrg ?? currentState.currentOrg;

        return {
          ...currentState,
          ...persisted,
          currentOrg,
          earthControlLevel,
          earthRole,
          earthApprovalMode: normalizeEarthApprovalMode(
            persisted.earthApprovalMode,
            earthControlLevel
          )
        };
      }
    }
  )
);
