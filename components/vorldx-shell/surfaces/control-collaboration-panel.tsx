"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Check,
  Loader2,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Users,
  Workflow,
  X
} from "lucide-react";

import type {
  ApprovalCheckpointItem,
  ControlThreadHistoryItem,
  PermissionRequestItem
} from "@/components/vorldx-shell/shared";
import { parseJsonResponse } from "@/lib/http/json-response";

type MembershipRole = "FOUNDER" | "ADMIN" | "EMPLOYEE";
type JoinRequestRole = "EMPLOYEE" | "ADMIN";
type ManagementLevel = "FOUNDER" | "ADMIN" | "SUB_ADMIN" | "MANAGER" | "WORKER";
type AccessArea = "STRINGS" | "APPROVALS" | "WORKFORCE" | "HUB" | "SETTINGS" | "ROLES";
export type CollaborationSurfaceTab =
  | "OVERVIEW"
  | "REQUESTS"
  | "STRINGS"
  | "TEAMS"
  | "ACCESS";

interface CollaborationMessage {
  tone: "success" | "warning" | "error";
  text: string;
}

interface CollaborationActor {
  userId: string;
  email: string;
  role: MembershipRole;
  roleLabel: string;
  isAdmin: boolean;
  managementLevel: ManagementLevel;
  managementLabel: string;
  accessAreas: AccessArea[];
  activeTeamId: string | null;
  activeTeamName: string | null;
}

interface CollaborationMember {
  userId: string;
  username: string;
  email: string;
  role: MembershipRole;
  roleLabel: string;
  joinedAt: string;
  isActiveOrganization: boolean;
  managementLevel: ManagementLevel;
  managementLabel: string;
  accessAreas: AccessArea[];
  activeTeamId: string | null;
  activeTeamName: string | null;
  teamIds: string[];
  teamNames: string[];
}

interface CollaborationPersonnel {
  id: string;
  name: string;
  type: "HUMAN" | "AI";
  role: string;
  status: string;
  teamIds: string[];
  teamNames: string[];
}

interface CollaborationTeam {
  id: string;
  name: string;
  description: string;
  leadUserId: string | null;
  leadName: string | null;
  leadEmail: string | null;
  memberUserIds: string[];
  memberNames: string[];
  memberCount: number;
  personnelIds: string[];
  personnelNames: string[];
  personnelCount: number;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
}

interface CollaborationCatalogItem<T extends string> {
  id: T;
  label: string;
  helper: string;
}

interface OrganizationSummary {
  id: string;
  name: string;
  description: string | null;
  teamCount: number;
  memberCounts: {
    founders: number;
    admins: number;
    employees: number;
  };
}

interface CollaborationPayload {
  ok?: boolean;
  message?: string;
  actor?: CollaborationActor;
  organization?: OrganizationSummary;
  members?: CollaborationMember[];
  personnel?: CollaborationPersonnel[];
  collaboration?: {
    teams?: CollaborationTeam[];
    managementLevels?: CollaborationCatalogItem<ManagementLevel>[];
    accessAreas?: CollaborationCatalogItem<AccessArea>[];
  };
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
}

interface TeamEditorState {
  id: string | null;
  name: string;
  description: string;
  leadUserId: string;
  memberUserIds: string[];
  personnelIds: string[];
}

function emptyTeamEditor(): TeamEditorState {
  return {
    id: null,
    name: "",
    description: "",
    leadUserId: "",
    memberUserIds: [],
    personnelIds: []
  };
}

function statusPillClass(status: string) {
  if (status === "APPROVED") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "REJECTED" || status === "CANCELLED") {
    return "border-red-500/40 bg-red-500/10 text-red-200";
  }
  return "border-amber-500/40 bg-amber-500/10 text-amber-200";
}

function managementPillClass(level: ManagementLevel) {
  if (level === "FOUNDER") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  }
  if (level === "ADMIN") {
    return "border-cyan-500/40 bg-cyan-500/10 text-cyan-200";
  }
  if (level === "SUB_ADMIN") {
    return "border-violet-500/40 bg-violet-500/10 text-violet-200";
  }
  if (level === "MANAGER") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  }
  return "border-white/15 bg-white/5 text-slate-300";
}

function areaPillClass(area: AccessArea) {
  if (area === "APPROVALS" || area === "ROLES") {
    return "border-amber-500/35 bg-amber-500/10 text-amber-100";
  }
  if (area === "WORKFORCE") {
    return "border-emerald-500/35 bg-emerald-500/10 text-emerald-100";
  }
  return "border-cyan-500/35 bg-cyan-500/10 text-cyan-100";
}

function arraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  const nextLeft = [...left].sort();
  const nextRight = [...right].sort();
  return nextLeft.every((value, index) => value === nextRight[index]);
}

function normalizeManagementLevelForRole(role: MembershipRole, level: ManagementLevel) {
  if (role === "ADMIN") {
    return "ADMIN" as const;
  }
  if (role === "FOUNDER") {
    return "FOUNDER" as const;
  }
  if (level === "FOUNDER" || level === "ADMIN") {
    return "WORKER" as const;
  }
  return level;
}

function defaultAccessAreasForLevel(level: ManagementLevel): AccessArea[] {
  if (level === "FOUNDER" || level === "ADMIN") {
    return ["APPROVALS", "HUB", "ROLES", "SETTINGS", "STRINGS", "WORKFORCE"];
  }
  if (level === "SUB_ADMIN") {
    return ["APPROVALS", "HUB", "STRINGS", "WORKFORCE"];
  }
  if (level === "MANAGER") {
    return ["APPROVALS", "STRINGS", "WORKFORCE"];
  }
  return ["STRINGS"];
}

function toggleItem(items: string[], value: string) {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function sortedUnique(items: string[]) {
  return [...new Set(items.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function noop() {}

function noopSelectThread(_threadId: string) {}

function noopDecision(_id: string, _decision: "APPROVE" | "REJECT") {}

export function ControlCollaborationPanel({
  orgId,
  orgName,
  orgRoleLabel,
  showStringSections = true,
  stringItem = null,
  isActiveStringThread = true,
  isApprovalBusy = false,
  permissionRequests = [],
  approvalCheckpoints = [],
  activeStringPermissionRequests = [],
  activeStringApprovalCheckpoints = [],
  activeStringResourcePlan = [],
  activeStringAutoSquad = null,
  permissionRequestActionId = null,
  approvalCheckpointActionId = null,
  onSelectThread = noopSelectThread,
  onApprovePlanLaunch = noop,
  onRejectPlanLaunch = noop,
  onApproveEmailDraft = noop,
  onRejectEmailDraft = noop,
  onApproveToolkitAccess = noop,
  onRejectToolkitAccess = noop,
  onPermissionRequestDecision = noopDecision,
  onApprovalCheckpointDecision = noopDecision,
  onActiveTabChange
}: {
  orgId: string | null;
  orgName: string;
  orgRoleLabel: string;
  showStringSections?: boolean;
  stringItem?: ControlThreadHistoryItem | null;
  isActiveStringThread?: boolean;
  isApprovalBusy?: boolean;
  permissionRequests?: PermissionRequestItem[];
  approvalCheckpoints?: ApprovalCheckpointItem[];
  activeStringPermissionRequests?: PermissionRequestItem[];
  activeStringApprovalCheckpoints?: ApprovalCheckpointItem[];
  activeStringResourcePlan?: Array<{
    workforceType: "HUMAN" | "AGENT" | "HYBRID";
    role: string;
    responsibility: string;
    capacityPct: number;
    tools: string[];
  }>;
  activeStringAutoSquad?: {
    triggered?: boolean;
    requestedRoles?: string[];
    created?: Array<{ id: string; name: string; role: string }>;
  } | null;
  permissionRequestActionId?: string | null;
  approvalCheckpointActionId?: string | null;
  onSelectThread?: (threadId: string) => void;
  onApprovePlanLaunch?: () => void;
  onRejectPlanLaunch?: () => void;
  onApproveEmailDraft?: () => void;
  onRejectEmailDraft?: () => void;
  onApproveToolkitAccess?: () => void;
  onRejectToolkitAccess?: () => void;
  onPermissionRequestDecision?: (requestId: string, decision: "APPROVE" | "REJECT") => void;
  onApprovalCheckpointDecision?: (
    checkpointId: string,
    decision: "APPROVE" | "REJECT"
  ) => void;
  onActiveTabChange?: (tab: CollaborationSurfaceTab) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<CollaborationMessage | null>(null);
  const [actor, setActor] = useState<CollaborationActor | null>(null);
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null);
  const [members, setMembers] = useState<CollaborationMember[]>([]);
  const [personnel, setPersonnel] = useState<CollaborationPersonnel[]>([]);
  const [teams, setTeams] = useState<CollaborationTeam[]>([]);
  const [managementCatalog, setManagementCatalog] = useState<
    CollaborationCatalogItem<ManagementLevel>[]
  >([]);
  const [accessCatalog, setAccessCatalog] = useState<CollaborationCatalogItem<AccessArea>[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequestItem[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, MembershipRole>>({});
  const [levelDrafts, setLevelDrafts] = useState<Record<string, ManagementLevel>>({});
  const [accessDrafts, setAccessDrafts] = useState<Record<string, AccessArea[]>>({});
  const [joinRequestRoleDrafts, setJoinRequestRoleDrafts] = useState<
    Record<string, JoinRequestRole>
  >({});
  const [joinRequestNoteDrafts, setJoinRequestNoteDrafts] = useState<Record<string, string>>({});
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<JoinRequestRole>("EMPLOYEE");
  const [activeSurfaceTab, setActiveSurfaceTab] =
    useState<CollaborationSurfaceTab>("OVERVIEW");
  const [activeTeamDraft, setActiveTeamDraft] = useState("");
  const [teamEditor, setTeamEditor] = useState<TeamEditorState>(() => emptyTeamEditor());
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [savingActiveTeam, setSavingActiveTeam] = useState(false);
  const [savingTeam, setSavingTeam] = useState(false);
  const [deletingTeamId, setDeletingTeamId] = useState<string | null>(null);
  const [teamDeleteConfirm, setTeamDeleteConfirm] = useState<CollaborationTeam | null>(null);
  const [actingJoinRequestId, setActingJoinRequestId] = useState<string | null>(null);

  const canCreateTeams = actor?.role === "FOUNDER";
  const canManageMembers = actor?.isAdmin ?? false;
  const pendingJoinRequests = joinRequests.filter((request) => request.status === "PENDING");
  const orgPendingPermissionCount = useMemo(
    () =>
      showStringSections
        ? permissionRequests.filter((request) => request.status === "PENDING").length
        : 0,
    [permissionRequests, showStringSections]
  );
  const orgPendingCheckpointCount = useMemo(
    () =>
      showStringSections
        ? approvalCheckpoints.filter((checkpoint) => checkpoint.status === "PENDING").length
        : 0,
    [approvalCheckpoints, showStringSections]
  );
  const actorMembership = useMemo(
    () => members.find((member) => member.userId === actor?.userId) ?? null,
    [actor?.userId, members]
  );
  const actorTeamOptions = useMemo(
    () =>
      teams.filter((team) =>
        actor?.userId ? team.memberUserIds.includes(actor.userId) : false
      ),
    [actor?.userId, teams]
  );
  const activeTeam = useMemo(
    () => teams.find((team) => team.id === (activeTeamDraft || actor?.activeTeamId || "")) ?? null,
    [activeTeamDraft, actor?.activeTeamId, teams]
  );
  const pendingStringCards =
    showStringSections && stringItem
      ? Number(Boolean(stringItem.pendingPlanLaunchApproval)) +
        Number(Boolean(stringItem.pendingToolkitApproval)) +
        Number(Boolean(stringItem.pendingEmailApproval))
      : 0;

  const loadCollaboration = useCallback(
    async (silent?: boolean) => {
      if (!orgId) {
        return;
      }

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const [hubResponse, joinRequestsResponse] = await Promise.all([
          fetch(`/api/hub/organization?orgId=${encodeURIComponent(orgId)}`, {
            cache: "no-store"
          }),
          fetch(`/api/squad/join-requests?orgId=${encodeURIComponent(orgId)}&status=PENDING`, {
            cache: "no-store"
          })
        ]);

        const { payload, rawText } = await parseJsonResponse<CollaborationPayload>(hubResponse);
        if (!hubResponse.ok || !payload?.ok || !payload.actor || !payload.organization) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed to load collaboration (${hubResponse.status}): ${rawText.slice(0, 180)}`
                : "Failed to load collaboration.")
          );
        }

        setActor(payload.actor);
        setOrganization(payload.organization);
        setMembers(payload.members ?? []);
        setPersonnel(payload.personnel ?? []);
        setTeams(payload.collaboration?.teams ?? []);
        setManagementCatalog(payload.collaboration?.managementLevels ?? []);
        setAccessCatalog(payload.collaboration?.accessAreas ?? []);
        setRoleDrafts(
          Object.fromEntries((payload.members ?? []).map((member) => [member.userId, member.role]))
        );
        setLevelDrafts(
          Object.fromEntries(
            (payload.members ?? []).map((member) => [member.userId, member.managementLevel])
          )
        );
        setAccessDrafts(
          Object.fromEntries(
            (payload.members ?? []).map((member) => [member.userId, member.accessAreas])
          )
        );
        setActiveTeamDraft(payload.actor.activeTeamId ?? "");
        setMessage(null);

        const { payload: joinPayload, rawText: joinRawText } =
          await parseJsonResponse<{ ok?: boolean; message?: string; requests?: JoinRequestItem[] }>(
            joinRequestsResponse
          );
        if (joinRequestsResponse.status === 403) {
          setJoinRequests([]);
          setJoinRequestRoleDrafts({});
          setJoinRequestNoteDrafts({});
        } else if (!joinRequestsResponse.ok || !joinPayload?.ok) {
          throw new Error(
            joinPayload?.message ??
              (joinRawText
                ? `Failed to load join requests (${joinRequestsResponse.status}): ${joinRawText.slice(0, 180)}`
                : "Failed to load join requests.")
          );
        } else {
          const requests = joinPayload.requests ?? [];
          setJoinRequests(requests);
          setJoinRequestRoleDrafts(
            Object.fromEntries(requests.map((request) => [request.id, request.requestedRole]))
          );
          setJoinRequestNoteDrafts((current) => {
            const next: Record<string, string> = {};
            for (const request of requests) {
              next[request.id] = current[request.id] ?? "";
            }
            return next;
          });
        }
      } catch (error) {
        setMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Failed to load collaboration."
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orgId]
  );

  useEffect(() => {
    if (!orgId) {
      return;
    }
    void loadCollaboration();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      void loadCollaboration(true);
    }, 15000);
    return () => clearInterval(timer);
  }, [loadCollaboration, orgId]);

  useEffect(() => {
    setTeamEditor(emptyTeamEditor());
    setNewMemberEmail("");
    setNewMemberName("");
    setNewMemberRole("EMPLOYEE");
  }, [orgId]);

  useEffect(() => {
    setActiveSurfaceTab("OVERVIEW");
  }, [orgId, showStringSections]);

  useEffect(() => {
    onActiveTabChange?.(activeSurfaceTab);
  }, [activeSurfaceTab, onActiveTabChange]);

  const handleAddMember = useCallback(async () => {
    if (!orgId) {
      return;
    }

    const email = newMemberEmail.trim().toLowerCase();
    const username = newMemberName.trim();
    if (!email) {
      setMessage({
        tone: "warning",
        text: "Member email is required."
      });
      return;
    }

    setAddingMember(true);
    try {
      const response = await fetch("/api/hub/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          collaborationAction: "ADD_MEMBER",
          email,
          username: username || undefined,
          memberRole: newMemberRole
        })
      });
      const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
        response
      );
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed to add member (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed to add member.")
        );
      }

      setNewMemberEmail("");
      setNewMemberName("");
      setNewMemberRole("EMPLOYEE");
      setMessage({
        tone: "success",
        text: `${email} added to the organization.`
      });
      await loadCollaboration(true);
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to add member."
      });
    } finally {
      setAddingMember(false);
    }
  }, [loadCollaboration, newMemberEmail, newMemberName, newMemberRole, orgId]);

  const handleSaveMember = useCallback(
    async (member: CollaborationMember) => {
      if (!orgId) {
        return;
      }

      const nextRole = roleDrafts[member.userId] ?? member.role;
      const requestedLevel = levelDrafts[member.userId] ?? member.managementLevel;
      const normalizedLevel = normalizeManagementLevelForRole(nextRole, requestedLevel);
      const requestedAccessAreas = sortedUnique(
        accessDrafts[member.userId] ?? member.accessAreas
      ) as AccessArea[];
      const normalizedAccessAreas =
        nextRole === "EMPLOYEE"
          ? requestedLevel === normalizedLevel && requestedAccessAreas.length > 0
            ? requestedAccessAreas
            : defaultAccessAreasForLevel(normalizedLevel)
          : defaultAccessAreasForLevel("ADMIN");
      const hasRoleChange = nextRole !== member.role;
      const shouldSaveProfile =
        nextRole === "EMPLOYEE" &&
        (member.role !== "EMPLOYEE" ||
          normalizedLevel !== member.managementLevel ||
          !arraysEqual(normalizedAccessAreas, sortedUnique(member.accessAreas)));

      if (!hasRoleChange && !shouldSaveProfile) {
        return;
      }

      setSavingMemberId(member.userId);
      try {
        if (hasRoleChange) {
          const response = await fetch("/api/hub/organization", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orgId,
              memberUserId: member.userId,
              role: nextRole
            })
          });
          const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
            response
          );
          if (!response.ok || !payload?.ok) {
            throw new Error(
              payload?.message ??
                (rawText
                  ? `Failed to update org role (${response.status}): ${rawText.slice(0, 180)}`
                  : "Failed to update org role.")
            );
          }
        }

        if (shouldSaveProfile) {
          const response = await fetch("/api/hub/organization", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orgId,
              collaborationAction: "SAVE_MEMBER_PROFILE",
              memberUserId: member.userId,
              managementLevel: normalizedLevel,
              accessAreas: normalizedAccessAreas
            })
          });
          const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
            response
          );
          if (!response.ok || !payload?.ok) {
            throw new Error(
              payload?.message ??
                (rawText
                  ? `Failed to update collaboration profile (${response.status}): ${rawText.slice(0, 180)}`
                  : "Failed to update collaboration profile.")
            );
          }
        }

        setMessage({
          tone: "success",
          text: `${member.username} access profile updated.`
        });
        await loadCollaboration(true);
      } catch (error) {
        setMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Failed to save member changes."
        });
      } finally {
        setSavingMemberId(null);
      }
    },
    [accessDrafts, levelDrafts, loadCollaboration, orgId, roleDrafts]
  );

  const handleSetActiveTeam = useCallback(async () => {
    if (!orgId) {
      return;
    }

    setSavingActiveTeam(true);
    try {
      const response = await fetch("/api/hub/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          collaborationAction: "SET_ACTIVE_TEAM",
          activeTeamId: activeTeamDraft || null
        })
      });
      const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
        response
      );
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed to update active team (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed to update active team.")
        );
      }

      setMessage({
        tone: "success",
        text: activeTeamDraft
          ? `Active team switched to ${activeTeam?.name ?? "the selected team"}.`
          : "Active team cleared for the current member."
      });
      await loadCollaboration(true);
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to update active team."
      });
    } finally {
      setSavingActiveTeam(false);
    }
  }, [activeTeam?.name, activeTeamDraft, loadCollaboration, orgId]);

  const handleEditTeam = useCallback((team: CollaborationTeam) => {
    setTeamEditor({
      id: team.id,
      name: team.name,
      description: team.description,
      leadUserId: team.leadUserId ?? "",
      memberUserIds: team.memberUserIds,
      personnelIds: team.personnelIds
    });
  }, []);

  const resetTeamEditor = useCallback(() => {
    setTeamEditor(emptyTeamEditor());
  }, []);

  const handleSaveTeam = useCallback(async () => {
    if (!orgId) {
      return;
    }

    const nextMembers = sortedUnique(teamEditor.memberUserIds);
    const nextPersonnel = sortedUnique(teamEditor.personnelIds);
    if (!teamEditor.name.trim()) {
      setMessage({
        tone: "warning",
        text: "Team name is required."
      });
      return;
    }

    setSavingTeam(true);
    try {
      const response = await fetch("/api/hub/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          collaborationAction: "SAVE_TEAM",
          team: {
            id: teamEditor.id ?? undefined,
            name: teamEditor.name.trim(),
            description: teamEditor.description.trim(),
            leadUserId: teamEditor.leadUserId || null,
            memberUserIds: nextMembers,
            personnelIds: nextPersonnel
          }
        })
      });
      const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
        response
      );
      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.message ??
            (rawText
              ? `Failed to save team (${response.status}): ${rawText.slice(0, 180)}`
              : "Failed to save team.")
        );
      }

      setMessage({
        tone: "success",
        text: `${teamEditor.name.trim()} ${teamEditor.id ? "updated" : "created"}.`
      });
      resetTeamEditor();
      await loadCollaboration(true);
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed to save team."
      });
    } finally {
      setSavingTeam(false);
    }
  }, [loadCollaboration, orgId, resetTeamEditor, teamEditor]);

  const handleDeleteTeam = useCallback(
    async (team: CollaborationTeam) => {
      if (!orgId) {
        return;
      }

      setTeamDeleteConfirm(null);
      setDeletingTeamId(team.id);
      try {
        const response = await fetch("/api/hub/organization", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            collaborationAction: "DELETE_TEAM",
            teamId: team.id
          })
        });
        const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
          response
        );
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed to delete team (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed to delete team.")
          );
        }

        if (teamEditor.id === team.id) {
          resetTeamEditor();
        }
        setMessage({
          tone: "success",
          text: `${team.name} removed from collaboration.`
        });
        await loadCollaboration(true);
      } catch (error) {
        setMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Failed to delete team."
        });
      } finally {
        setDeletingTeamId(null);
      }
    },
    [loadCollaboration, orgId, resetTeamEditor, teamEditor.id]
  );

  const handleJoinRequestDecision = useCallback(
    async (request: JoinRequestItem, decision: "APPROVE" | "REJECT") => {
      if (!orgId) {
        return;
      }

      setActingJoinRequestId(request.id);
      try {
        const response = await fetch(`/api/squad/join-requests/${request.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId,
            decision,
            role: joinRequestRoleDrafts[request.id] ?? request.requestedRole,
            note: joinRequestNoteDrafts[request.id] ?? ""
          })
        });
        const { payload, rawText } = await parseJsonResponse<{ ok?: boolean; message?: string }>(
          response
        );
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ??
              (rawText
                ? `Failed to process join request (${response.status}): ${rawText.slice(0, 180)}`
                : "Failed to process join request.")
          );
        }

        setMessage({
          tone: "success",
          text: `Join request ${decision === "APPROVE" ? "approved" : "rejected"}.`
        });
        await loadCollaboration(true);
      } catch (error) {
        setMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Failed to process join request."
        });
      } finally {
        setActingJoinRequestId(null);
      }
    },
    [joinRequestNoteDrafts, joinRequestRoleDrafts, loadCollaboration, orgId]
  );

  const collaborationTabs = useMemo(
    () =>
      [
        {
          id: "OVERVIEW" as const,
          label: "Overview",
          helper: "Org posture and current state",
          count: null
        },
        {
          id: "REQUESTS" as const,
          label: "Requests",
          helper: "Incoming access reviews",
          count: pendingJoinRequests.length
        },
        ...(showStringSections
          ? [
              {
                id: "STRINGS" as const,
                label: "Strings",
                helper: "String approvals and workforce context",
                count:
                  pendingStringCards +
                  activeStringPermissionRequests.length +
                  activeStringApprovalCheckpoints.length
              }
            ]
          : []),
        {
          id: "TEAMS" as const,
          label: "Teams",
          helper: "Builder, roster, and assignments",
          count: teams.length
        },
        {
          id: "ACCESS" as const,
          label: "Access",
          helper: "Roles, levels, and permissions",
          count: members.length
        }
      ] satisfies Array<{
        id: CollaborationSurfaceTab;
        label: string;
        helper: string;
        count: number | null;
      }>,
    [
      activeStringApprovalCheckpoints.length,
      activeStringPermissionRequests.length,
      members.length,
      pendingJoinRequests.length,
      pendingStringCards,
      showStringSections,
      teams.length
    ]
  );
  const linkedWorkforceCount = personnel.filter((item) => item.teamIds.length > 0).length;
  const activeTabDetails = (() => {
    if (activeSurfaceTab === "REQUESTS") {
      return {
        kicker: "Requests Workspace",
        title: "Review incoming organization access requests",
        description: canManageMembers
          ? "Approve or reject membership requests and shape how new collaborators join the organization."
          : "This queue is reserved for founders and admins, but it still shows where incoming membership demand lands.",
        containerClass:
          "border-amber-500/20 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_55%),rgba(2,6,23,0.92)]",
        kickerClass: "text-amber-200",
        metrics: [
          {
            label: "Pending requests",
            value: pendingJoinRequests.length,
            helper: canManageMembers ? "Need review" : "Visible to admins"
          },
          {
            label: "Admin reviewers",
            value: organization?.memberCounts.admins ?? 0,
            helper: "Can process joins"
          },
          {
            label: "Employees",
            value: organization?.memberCounts.employees ?? 0,
            helper: "Already onboarded"
          }
        ]
      };
    }

    if (activeSurfaceTab === "STRINGS") {
      return {
        kicker: "Strings Workspace",
        title: "Resolve string-linked approvals and workforce signals",
        description: isActiveStringThread
          ? "Track thread approvals, permission requests, checkpoints, and workforce context for the active string."
          : "This string is in monitor mode until it becomes active, so approvals stay visible but read-only.",
        containerClass:
          "border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_55%),rgba(2,6,23,0.92)]",
        kickerClass: "text-emerald-200",
        metrics: [
          {
            label: "Pending cards",
            value: pendingStringCards,
            helper: "Launch, toolkit, email"
          },
          {
            label: "Permission requests",
            value: activeStringPermissionRequests.length,
            helper: "String access asks"
          },
          {
            label: "Checkpoints",
            value: activeStringApprovalCheckpoints.length,
            helper: "Approval gates"
          },
          {
            label: "Workforce roles",
            value: activeStringResourcePlan.length,
            helper: "Linked to this string"
          }
        ]
      };
    }

    if (activeSurfaceTab === "TEAMS") {
      return {
        kicker: "Teams Workspace",
        title: "Build collaboration teams and manage assignments",
        description: canCreateTeams
          ? "Create and edit teams, attach workforce, and let members switch their active operating team here."
          : "See your available team assignments and switch your active team while founders manage the shared roster.",
        containerClass:
          "border-cyan-500/20 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.14),transparent_55%),rgba(2,6,23,0.92)]",
        kickerClass: "text-cyan-200",
        metrics: [
          {
            label: "Active team",
            value: actor?.activeTeamName || "Unassigned",
            helper: `${actorMembership?.teamNames.length ?? 0} linked team(s)`
          },
          {
            label: "Teams",
            value: teams.length,
            helper: "Org collaboration groups"
          },
          {
            label: "Workforce linked",
            value: linkedWorkforceCount,
            helper: "Personnel on teams"
          },
          {
            label: "Builder access",
            value: canCreateTeams ? "Founder" : "View only",
            helper: canCreateTeams ? "You can edit teams" : "Founder manages changes"
          }
        ]
      };
    }

    if (activeSurfaceTab === "ACCESS") {
      return {
        kicker: "Access Workspace",
        title: "Manage member authority, levels, and coverage",
        description: canManageMembers
          ? "Add members, set organization role, assign collaboration level, and scope access areas from one place."
          : "This view shows how collaboration authority is distributed across the organization.",
        containerClass:
          "border-sky-500/20 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.14),transparent_55%),rgba(2,6,23,0.92)]",
        kickerClass: "text-sky-200",
        metrics: [
          {
            label: "Members",
            value: members.length,
            helper: "Org-linked users"
          },
          {
            label: "Profiles",
            value: managementCatalog.length,
            helper: "Management levels"
          },
          {
            label: "Employee roles",
            value: organization?.memberCounts.employees ?? 0,
            helper: "Can be scoped"
          },
          {
            label: "Admins",
            value: organization?.memberCounts.admins ?? 0,
            helper: "Full org coverage"
          }
        ]
      };
    }

    return {
      kicker: "Overview Workspace",
      title: "Monitor collaboration health across the organization",
      description:
        "See your org posture, current assignment state, pending work, and collaboration capacity before drilling into a focused tab.",
      containerClass:
        "border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_55%),rgba(2,6,23,0.92)]",
      kickerClass: "text-cyan-200",
      metrics: [
        {
          label: "Organization",
          value: orgName,
          helper: orgRoleLabel
        },
        {
          label: "My team",
          value: actor?.activeTeamName || "Unassigned",
          helper: `${actorMembership?.teamNames.length ?? 0} linked team(s)`
        },
        {
          label: "Members",
          value: members.length,
          helper: `${organization?.memberCounts.employees ?? 0} employee role(s)`
        },
        {
          label: "Teams",
          value: teams.length,
          helper: `${linkedWorkforceCount} workforce linked`
        },
        {
          label: "Pending inbox",
          value: pendingJoinRequests.length + orgPendingPermissionCount + orgPendingCheckpointCount,
          helper: showStringSections
            ? `${pendingJoinRequests.length} join | ${orgPendingPermissionCount} requests`
            : `${pendingJoinRequests.length} join request(s)`
        }
      ]
    };
  })();
  const activeTabMetricGridClass =
    activeTabDetails.metrics.length >= 5
      ? "md:grid-cols-2 xl:grid-cols-5"
      : activeTabDetails.metrics.length === 4
        ? "md:grid-cols-2 xl:grid-cols-4"
        : "md:grid-cols-3";

  if (!orgId) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-slate-500">
        Collaboration controls become available once an organization is active.
      </div>
    );
  }

  if (loading && !organization) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-10 text-center text-sm text-slate-400">
        <Loader2 size={16} className="mx-auto mb-3 animate-spin" />
        Loading collaboration controls...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showStringSections && stringItem && !isActiveStringThread ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-200">
            This string is in read-only monitor mode. Make it active to approve or reject
            string-linked items.
          </p>
          <button
            type="button"
            onClick={() => onSelectThread(stringItem.id)}
            className="mt-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-100"
          >
            Make Active String
          </button>
        </div>
      ) : null}

      {message ? (
        <div
          className={`rounded-2xl border px-3 py-2 text-xs ${
            message.tone === "error"
              ? "border-red-500/35 bg-red-500/10 text-red-200"
              : message.tone === "warning"
                ? "border-amber-500/35 bg-amber-500/10 text-amber-100"
                : "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className={`rounded-[28px] border px-4 py-4 ${activeTabDetails.containerClass}`}>
        <div>
          <p
            className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${activeTabDetails.kickerClass}`}
          >
            {activeTabDetails.kicker}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {activeTabDetails.title}
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-400">
            {activeTabDetails.description}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-200">
            {orgName}
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
            {actor?.roleLabel || orgRoleLabel}
          </span>
          <button
            type="button"
            onClick={() => void loadCollaboration(true)}
            className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200"
          >
            {refreshing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Refresh
          </button>
        </div>
      </div>

      <div
        className={`grid gap-2 ${
          showStringSections ? "sm:grid-cols-2 xl:grid-cols-5" : "sm:grid-cols-2 xl:grid-cols-4"
        }`}
      >
        {collaborationTabs.map((tab) => {
          const active = activeSurfaceTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSurfaceTab(tab.id)}
              className={`rounded-[22px] border px-3 py-3 text-left transition ${
                active
                  ? "border-cyan-400/45 bg-cyan-500/12 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.12)]"
                  : "border-white/10 bg-black/20 text-slate-300 hover:bg-white/5"
              }`}
              aria-pressed={active}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p
                    className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${
                      active ? "text-cyan-100" : "text-slate-500"
                    }`}
                  >
                    {tab.label}
                  </p>
                  <p className={`mt-1 text-xs leading-5 ${active ? "text-slate-100" : "text-slate-400"}`}>
                    {tab.helper}
                  </p>
                </div>
                {tab.count !== null ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      active ? "bg-cyan-500/20 text-cyan-100" : "bg-black/30 text-slate-400"
                    }`}
                  >
                    {tab.count}
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      <div className={`grid gap-2 ${activeTabMetricGridClass}`}>
        {activeTabDetails.metrics.map((metric) => (
          <article key={metric.label} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{metric.label}</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{metric.value}</p>
            <p className="mt-1 text-[11px] text-slate-500">{metric.helper}</p>
          </article>
        ))}
      </div>

      {activeSurfaceTab !== "ACCESS" ? (
        <div
          className={
            showStringSections
              ? "grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]"
              : "grid gap-3 xl:grid-cols-2"
          }
        >
          {activeSurfaceTab === "REQUESTS" || activeSurfaceTab === "STRINGS" ? (
            <div className={showStringSections ? "space-y-3" : "contents"}>
              {showStringSections && stringItem && activeSurfaceTab === "STRINGS" ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  String Action Queue
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                  {pendingStringCards} pending
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {stringItem.pendingPlanLaunchApproval ? (
                  <div className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-100">
                    Plan Launch Pending
                  </div>
                ) : null}
                {stringItem.pendingToolkitApproval ? (
                  <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-100">
                    Toolkit Access Pending
                  </div>
                ) : null}
                {stringItem.pendingEmailApproval ? (
                  <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-100">
                    Email Approval Pending
                  </div>
                ) : null}
                {pendingStringCards === 0 ? (
                  <p className="text-xs text-slate-500">No pending approval cards.</p>
                ) : null}
              </div>
              {isActiveStringThread ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {stringItem.pendingPlanLaunchApproval ? (
                    <>
                      <button
                        type="button"
                        onClick={onApprovePlanLaunch}
                        disabled={isApprovalBusy}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-200 disabled:opacity-60"
                      >
                        Approve Plan Launch
                      </button>
                      <button
                        type="button"
                        onClick={onRejectPlanLaunch}
                        disabled={isApprovalBusy}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-200 disabled:opacity-60"
                      >
                        Reject Plan Launch
                      </button>
                    </>
                  ) : null}
                  {stringItem.pendingToolkitApproval ? (
                    <>
                      <button
                        type="button"
                        onClick={onApproveToolkitAccess}
                        disabled={isApprovalBusy}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-200 disabled:opacity-60"
                      >
                        Approve Toolkit
                      </button>
                      <button
                        type="button"
                        onClick={onRejectToolkitAccess}
                        disabled={isApprovalBusy}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-200 disabled:opacity-60"
                      >
                        Reject Toolkit
                      </button>
                    </>
                  ) : null}
                  {stringItem.pendingEmailApproval ? (
                    <>
                      <button
                        type="button"
                        onClick={onApproveEmailDraft}
                        disabled={isApprovalBusy}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-200 disabled:opacity-60"
                      >
                        Approve Email
                      </button>
                      <button
                        type="button"
                        onClick={onRejectEmailDraft}
                        disabled={isApprovalBusy}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-200 disabled:opacity-60"
                      >
                        Reject Email
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

              {activeSurfaceTab === "REQUESTS" ? (
                <div
                  className={`rounded-2xl border border-white/10 bg-black/20 p-3 ${
                    showStringSections ? "" : "xl:order-3 xl:col-span-2"
                  }`}
                >
            <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Incoming Organization Requests
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                  {pendingJoinRequests.length}
                </span>
              </div>
              {!canManageMembers ? (
                <p className="mt-3 text-xs text-slate-500">
                  Join requests are visible only to founders and admins.
                </p>
              ) : pendingJoinRequests.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">
                  No pending join requests for this organization.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {pendingJoinRequests.map((request) => (
                  <article
                    key={request.id}
                    className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-slate-100">
                          {request.requesterName || request.requesterEmail}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">{request.requesterEmail}</p>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusPillClass(request.status)}`}>
                        {request.status}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-300">
                      Requested {request.requestedRole.toLowerCase()} access on{" "}
                      {new Date(request.createdAt).toLocaleString()}.
                    </p>
                    {request.message ? (
                      <p className="mt-2 text-xs leading-5 text-slate-400">{request.message}</p>
                    ) : null}
                    <div className="mt-3 grid gap-2 md:grid-cols-[180px_minmax(0,1fr)]">
                      <select
                        value={joinRequestRoleDrafts[request.id] ?? request.requestedRole}
                        onChange={(event) =>
                          setJoinRequestRoleDrafts((current) => ({
                            ...current,
                            [request.id]: event.target.value as JoinRequestRole
                          }))
                        }
                        className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-semibold text-slate-100 outline-none"
                      >
                        <option value="EMPLOYEE">Employee</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                      <input
                        value={joinRequestNoteDrafts[request.id] ?? ""}
                        onChange={(event) =>
                          setJoinRequestNoteDrafts((current) => ({
                            ...current,
                            [request.id]: event.target.value
                          }))
                        }
                        placeholder="Optional note"
                        className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-slate-100 outline-none"
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleJoinRequestDecision(request, "APPROVE")}
                        disabled={actingJoinRequestId === request.id}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 disabled:opacity-60"
                      >
                        {actingJoinRequestId === request.id ? "Working..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleJoinRequestDecision(request, "REJECT")}
                        disabled={actingJoinRequestId === request.id}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] font-semibold text-red-200 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </article>
                  ))}
                </div>
              )}
                </div>
              ) : null}

              {showStringSections && activeSurfaceTab === "STRINGS" ? (
            <>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Workforce Context ({activeStringResourcePlan.length})
                </p>
                {activeStringResourcePlan.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">No workforce plan linked yet.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {activeStringResourcePlan.map((resource, index) => (
                      <div
                        key={`${resource.role}-${index}`}
                        className="rounded-xl border border-white/10 bg-black/25 px-2.5 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-100">{resource.role}</p>
                          <span className="rounded-full border border-white/15 bg-black/30 px-2 py-0.5 text-[10px] text-slate-300">
                            {resource.workforceType} | {resource.capacityPct}%
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {resource.responsibility}
                        </p>
                        {resource.tools.length > 0 ? (
                          <p className="mt-1 text-[11px] text-slate-500">
                            Tools: {resource.tools.join(" | ")}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                {activeStringAutoSquad ? (
                  <div className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-2 text-[11px] text-cyan-100">
                    Auto-WorkForce {activeStringAutoSquad.triggered ? "triggered" : "not triggered"}.
                    {(activeStringAutoSquad.created?.length ?? 0) > 0
                      ? ` Created ${activeStringAutoSquad.created?.length} agent(s).`
                      : ""}
                    {(activeStringAutoSquad.requestedRoles?.length ?? 0) > 0
                      ? ` Roles: ${activeStringAutoSquad.requestedRoles?.join(" | ")}.`
                      : ""}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Permission Requests ({activeStringPermissionRequests.length})
                  </p>
                  {activeStringPermissionRequests.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">
                      No permission requests for this string.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {activeStringPermissionRequests.map((request) => (
                        <div
                          key={request.id}
                          className="rounded-xl border border-white/10 bg-black/25 px-2.5 py-2"
                        >
                          <p className="text-xs text-slate-200">
                            {request.status} | {request.area} | {request.workflowTitle}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-400">{request.reason}</p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {request.requestedByEmail} | {new Date(request.createdAt).toLocaleString()}
                          </p>
                          {request.status === "PENDING" && isActiveStringThread ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => onPermissionRequestDecision(request.id, "APPROVE")}
                                disabled={permissionRequestActionId === request.id}
                                className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 disabled:opacity-60"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => onPermissionRequestDecision(request.id, "REJECT")}
                                disabled={permissionRequestActionId === request.id}
                                className="rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-200 disabled:opacity-60"
                              >
                                Reject
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Approval Checkpoints ({activeStringApprovalCheckpoints.length})
                  </p>
                  {activeStringApprovalCheckpoints.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">
                      No approval checkpoints for this string.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {activeStringApprovalCheckpoints.map((checkpoint) => (
                        <div
                          key={checkpoint.id}
                          className="rounded-xl border border-white/10 bg-black/25 px-2.5 py-2"
                        >
                          <p className="text-xs text-slate-200">
                            {checkpoint.status} | Flow {checkpoint.flowId?.slice(0, 8) ?? "N/A"}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-400">{checkpoint.reason}</p>
                          {checkpoint.status === "PENDING" && isActiveStringThread ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  onApprovalCheckpointDecision(checkpoint.id, "APPROVE")
                                }
                                disabled={approvalCheckpointActionId === checkpoint.id}
                                className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 disabled:opacity-60"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onApprovalCheckpointDecision(checkpoint.id, "REJECT")
                                }
                                disabled={approvalCheckpointActionId === checkpoint.id}
                                className="rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-200 disabled:opacity-60"
                              >
                                Reject
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
            </div>
          ) : null}
          {activeSurfaceTab === "OVERVIEW" || activeSurfaceTab === "TEAMS" ? (
            <div className={showStringSections ? "space-y-3" : "contents"}>
              {activeSurfaceTab === "OVERVIEW" ? (
                <div
                  className={`rounded-2xl border border-white/10 bg-black/20 p-3 ${
                    showStringSections ? "" : "xl:order-1"
                  }`}
                >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <Building2 size={12} />
                  Current Organization
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-100">
                  {organization?.name || orgName}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {actor?.roleLabel || orgRoleLabel} | {actor?.managementLabel || "Worker"}
                </p>
              </div>
              <div className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                {organization?.teamCount ?? teams.length} team(s)
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              {organization?.description ||
                "Use collaboration to route org requests, define teams, and manage access boundaries."}
            </p>
                </div>
              ) : null}

              {activeSurfaceTab === "TEAMS" ? (
                <div
                  className={`rounded-2xl border border-white/10 bg-black/20 p-3 ${
                    showStringSections ? "" : "xl:order-3"
                  }`}
                >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <Workflow size={12} />
                Active Team
              </p>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                {actorTeamOptions.length} option(s)
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Members can switch between their assigned teams. Founders assign the teams.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={activeTeamDraft}
                onChange={(event) => setActiveTeamDraft(event.target.value)}
                className="min-w-[200px] rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-semibold text-slate-100 outline-none"
              >
                <option value="">No active team</option>
                {actorTeamOptions.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleSetActiveTeam()}
                disabled={savingActiveTeam || (activeTeamDraft || "") === (actor?.activeTeamId || "")}
                className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 disabled:opacity-60"
              >
                {savingActiveTeam ? "Saving..." : "Save active team"}
              </button>
            </div>
            {activeTeam ? (
              <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100">
                    Current team
                  </span>
                  <p className="text-sm font-semibold text-slate-100">{activeTeam.name}</p>
                </div>
                {activeTeam.description ? (
                  <p className="mt-2 text-xs leading-5 text-slate-400">{activeTeam.description}</p>
                ) : null}
                <p className="mt-2 text-[11px] text-slate-500">
                  Lead: {activeTeam.leadName || "Not assigned"} | Members: {activeTeam.memberCount}
                </p>
              </div>
            ) : null}
                </div>
              ) : null}

              {activeSurfaceTab === "TEAMS" ? (
                <div
                  className={`rounded-2xl border border-white/10 bg-black/20 p-3 ${
                    showStringSections ? "" : "xl:order-4 xl:col-span-2"
                  }`}
                >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <Users size={12} />
                Team Studio
              </p>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
                Founder managed
              </span>
            </div>
            {canCreateTeams ? (
              <div className="mt-3 space-y-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                <input
                  value={teamEditor.name}
                  onChange={(event) =>
                    setTeamEditor((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Team name"
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-slate-100 outline-none"
                />
                <textarea
                  value={teamEditor.description}
                  onChange={(event) =>
                    setTeamEditor((current) => ({
                      ...current,
                      description: event.target.value
                    }))
                  }
                  placeholder="Team mission or description"
                  className="h-20 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-slate-100 outline-none"
                />
                <select
                  value={teamEditor.leadUserId}
                  onChange={(event) =>
                    setTeamEditor((current) => ({
                      ...current,
                      leadUserId: event.target.value
                    }))
                  }
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-semibold text-slate-100 outline-none"
                >
                  <option value="">No team lead</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.username}
                    </option>
                  ))}
                </select>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      Employees
                    </p>
                    <div className="mt-2 space-y-2">
                      {members.map((member) => {
                        const selected = teamEditor.memberUserIds.includes(member.userId);
                        return (
                          <button
                            key={member.userId}
                            type="button"
                            onClick={() =>
                              setTeamEditor((current) => ({
                                ...current,
                                memberUserIds: toggleItem(current.memberUserIds, member.userId)
                              }))
                            }
                            className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-[11px] transition ${
                              selected
                                ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-100"
                                : "border-white/10 bg-black/30 text-slate-300"
                            }`}
                          >
                            <span>{member.username}</span>
                            {selected ? <Check size={12} /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      Workforce
                    </p>
                    <div className="mt-2 space-y-2">
                      {personnel.map((person) => {
                        const selected = teamEditor.personnelIds.includes(person.id);
                        return (
                          <button
                            key={person.id}
                            type="button"
                            onClick={() =>
                              setTeamEditor((current) => ({
                                ...current,
                                personnelIds: toggleItem(current.personnelIds, person.id)
                              }))
                            }
                            className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-[11px] transition ${
                              selected
                                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
                                : "border-white/10 bg-black/30 text-slate-300"
                            }`}
                          >
                            <span>{person.name}</span>
                            {selected ? <Check size={12} /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveTeam()}
                    disabled={savingTeam}
                    className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 disabled:opacity-60"
                  >
                    {savingTeam ? <Loader2 size={13} className="animate-spin" /> : <PlusCircle size={13} />}
                    {teamEditor.id ? "Update team" : "Create team"}
                  </button>
                  {teamEditor.id ? (
                    <button
                      type="button"
                      onClick={resetTeamEditor}
                      className="rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200"
                    >
                      Cancel edit
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                Founder creates and edits teams here. Admins and employees can still see their
                assigned teams and active team selection.
              </p>
            )}
            <div className="mt-3 space-y-2">
              {teams.map((team) => (
                <article
                  key={team.id}
                  className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-100">{team.name}</p>
                        {team.id === actor?.activeTeamId ? (
                          <span className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100">
                            Active
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Lead: {team.leadName || "Not assigned"} | {team.memberCount} member(s) |{" "}
                        {team.personnelCount} workforce
                      </p>
                    </div>
                    {canCreateTeams ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditTeam(team)}
                          className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-200"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setTeamDeleteConfirm(team)}
                          disabled={deletingTeamId === team.id}
                          className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-200 disabled:opacity-60"
                        >
                          {deletingTeamId === team.id ? "Removing..." : "Delete"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {team.memberNames.map((name) => (
                      <span
                        key={`${team.id}-member-${name}`}
                        className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] text-slate-300"
                      >
                        {name}
                      </span>
                    ))}
                    {team.personnelNames.map((name) => (
                      <span
                        key={`${team.id}-person-${name}`}
                        className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
              {teams.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-4 text-xs text-slate-500">
                  No teams created yet.
                </p>
              ) : null}
            </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeSurfaceTab === "ACCESS" ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <ShieldCheck size={12} />
            Management Levels
          </p>
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
            {managementCatalog.length} profiles
          </span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-5">
              {managementCatalog.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-2xl border px-3 py-3 ${managementPillClass(item.id)}`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">
                    {item.label}
                  </p>
                  <p className="mt-2 text-[11px] leading-5 text-current/85">{item.helper}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <UserCheck size={12} />
            Employee Directory And Access Control
          </p>
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300">
            {members.length} member(s)
          </span>
            </div>
            <div className="mt-3 space-y-3">
          {canManageMembers ? (
            <div className="rounded-2xl border border-dashed border-cyan-500/30 bg-cyan-500/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
                    Add Organization Member
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Add an employee or admin so collaboration access becomes manageable here.
                  </p>
                </div>
                <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-[10px] text-cyan-100">
                  Founder/Admin
                </span>
              </div>
              <div className="mt-3 grid gap-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_160px_auto]">
                <input
                  value={newMemberEmail}
                  onChange={(event) => setNewMemberEmail(event.target.value)}
                  placeholder="member@email.com"
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-slate-100 outline-none"
                />
                <input
                  value={newMemberName}
                  onChange={(event) => setNewMemberName(event.target.value)}
                  placeholder="Display name"
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-slate-100 outline-none"
                />
                <select
                  value={newMemberRole}
                  onChange={(event) => setNewMemberRole(event.target.value as JoinRequestRole)}
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-semibold text-slate-100 outline-none"
                >
                  <option value="EMPLOYEE">Employee</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <button
                  type="button"
                  onClick={() => void handleAddMember()}
                  disabled={addingMember}
                  className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-[11px] font-semibold text-cyan-200 disabled:opacity-60"
                >
                  {addingMember ? "Adding..." : "Add member"}
                </button>
              </div>
            </div>
          ) : null}
          {canManageMembers && members.filter((member) => member.role !== "FOUNDER").length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-4 text-[11px] text-slate-500">
              Only the founder is in organization access right now. Add a member above to manage collaboration permissions here.
            </div>
          ) : null}
          {members.map((member) => {
            const roleDraft = roleDrafts[member.userId] ?? member.role;
            const levelDraft = levelDrafts[member.userId] ?? member.managementLevel;
            const accessDraft = sortedUnique(accessDrafts[member.userId] ?? member.accessAreas);
            const isFixedRole = member.role === "FOUNDER";
            const memberControlsEditable = roleDraft === "EMPLOYEE" && member.role !== "FOUNDER";
            const hasPendingChange =
              roleDraft !== member.role ||
              (memberControlsEditable &&
                (levelDraft !== member.managementLevel ||
                  !arraysEqual(accessDraft, sortedUnique(member.accessAreas))));

            return (
              <article
                key={member.userId}
                className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-100">{member.username}</p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${managementPillClass(member.managementLevel)}`}
                      >
                        {member.managementLabel}
                      </span>
                      {member.activeTeamName ? (
                        <span className="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100">
                          {member.activeTeamName}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{member.email}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Org role: {member.roleLabel} | Joined{" "}
                      {new Date(member.joinedAt).toLocaleDateString()}
                    </p>
                  </div>
                  {isFixedRole ? (
                    <div className="rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-200">
                      Founder access is fixed
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={roleDraft}
                        onChange={(event) => {
                          const nextRole = event.target.value as MembershipRole;
                          const currentLevel = levelDrafts[member.userId] ?? member.managementLevel;
                          const normalizedLevel = normalizeManagementLevelForRole(
                            nextRole,
                            currentLevel
                          );
                          const currentAccessAreas = sortedUnique(
                            accessDrafts[member.userId] ?? member.accessAreas
                          ) as AccessArea[];

                          setRoleDrafts((current) => ({
                            ...current,
                            [member.userId]: nextRole
                          }));
                          setLevelDrafts((current) => ({
                            ...current,
                            [member.userId]: normalizedLevel
                          }));
                          setAccessDrafts((current) => ({
                            ...current,
                            [member.userId]:
                              nextRole === "EMPLOYEE" && currentLevel === normalizedLevel
                                ? currentAccessAreas
                                : defaultAccessAreasForLevel(normalizedLevel)
                          }));
                        }}
                        disabled={!canManageMembers}
                        className="rounded-full border border-white/10 bg-black/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-100 outline-none disabled:opacity-60"
                      >
                        <option value="ADMIN">ADMIN</option>
                        <option value="EMPLOYEE">EMPLOYEE</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleSaveMember(member)}
                        disabled={!canManageMembers || !hasPendingChange || savingMemberId === member.userId}
                        className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200 disabled:opacity-60"
                      >
                        {savingMemberId === member.userId ? "Saving..." : "Save Member"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-3 grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)]">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      Management Level
                    </p>
                    <select
                      value={levelDraft}
                      onChange={(event) =>
                        setLevelDrafts((current) => ({
                          ...current,
                          [member.userId]: event.target.value as ManagementLevel
                        }))
                      }
                      disabled={!canManageMembers || !memberControlsEditable}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-semibold text-slate-100 outline-none disabled:opacity-60"
                    >
                      {managementCatalog
                        .filter((item) =>
                          roleDraft === "EMPLOYEE"
                            ? item.id !== "FOUNDER" && item.id !== "ADMIN"
                            : item.id === "ADMIN"
                        )
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                      Access Areas
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {accessCatalog.map((area) => {
                        const selected = accessDraft.includes(area.id);
                        return (
                          <button
                            key={`${member.userId}-${area.id}`}
                            type="button"
                            onClick={() =>
                              setAccessDrafts((current) => ({
                                ...current,
                                [member.userId]: sortedUnique(
                                  toggleItem(current[member.userId] ?? member.accessAreas, area.id)
                                ) as AccessArea[]
                              }))
                            }
                            disabled={!canManageMembers || !memberControlsEditable}
                            className={`rounded-full border px-2.5 py-1 text-[10px] transition ${
                              selected
                                ? areaPillClass(area.id)
                                : "border-white/10 bg-white/5 text-slate-400"
                            } disabled:opacity-60`}
                          >
                            {area.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-[11px] leading-5 text-slate-500">
                      {memberControlsEditable
                        ? "Choose exactly which areas this employee can manage."
                        : "Founders and admins inherit full coverage from their organization role."}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
            </div>
          </div>
        </div>
      ) : null}

      {teamDeleteConfirm ? (
        <div
          className="fixed inset-0 z-[72] flex items-center justify-center bg-black/75 p-4"
          onClick={() => {
            if (!deletingTeamId) {
              setTeamDeleteConfirm(null);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-[28px] border border-white/15 bg-[#0d1117] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-300">Delete Team</p>
                <p className="mt-2 text-sm font-semibold text-slate-100">
                  Remove {teamDeleteConfirm.name} from collaboration?
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTeamDeleteConfirm(null)}
                disabled={Boolean(deletingTeamId)}
                className="rounded-full border border-white/20 p-2 text-slate-300 transition hover:bg-white/10 disabled:opacity-60"
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-3 text-sm text-slate-300">
              This removes the team and its current collaboration assignment structure from the organization UI.
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setTeamDeleteConfirm(null)}
                disabled={Boolean(deletingTeamId)}
                className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteTeam(teamDeleteConfirm)}
                disabled={Boolean(deletingTeamId)}
                className="rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-60"
              >
                {deletingTeamId === teamDeleteConfirm.id ? "Deleting..." : "Delete team"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
