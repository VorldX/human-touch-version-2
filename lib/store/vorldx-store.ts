import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type AppTheme = "APEX" | "VEDA" | "NEXUS";

export interface OrgContext {
  id: string;
  name: string;
  role: string;
  theme: AppTheme;
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
}

interface VorldXState {
  orgs: OrgContext[];
  currentOrg: OrgContext | null;
  theme: AppTheme;
  isGhostModeActive: boolean;
  notifications: NotificationItem[];
  activeUsers: ActiveUser[];
  setOrgs: (orgs: OrgContext[]) => void;
  addOrg: (org: OrgContext) => void;
  setCurrentOrg: (org: OrgContext) => void;
  setTheme: (theme: AppTheme) => void;
  toggleGhostMode: () => void;
  pushNotification: (payload: Omit<NotificationItem, "id" | "createdAt">) => void;
  dismissNotification: (id: string) => void;
  setActiveUsers: (users: ActiveUser[]) => void;
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
        set(() => ({
          currentOrg: org,
          theme: org.theme
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
        theme: state.theme,
        isGhostModeActive: state.isGhostModeActive
      })
    }
  )
);
