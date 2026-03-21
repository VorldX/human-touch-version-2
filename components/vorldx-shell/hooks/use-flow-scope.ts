import { useEffect, useMemo } from "react";

import {
  type ApprovalCheckpointItem,
  type ControlMode,
  type ControlThreadHistoryItem,
  type DirectionPlanningResult,
  type NavItemId,
  type PermissionRequestItem,
  controlThreadDisplayTitle,
  toLocalDateKey
} from "@/components/vorldx-shell/shared";

interface UseFlowScopeInput {
  activeControlThread: ControlThreadHistoryItem | null;
  activeTab: NavItemId;
  approvalCheckpoints: ApprovalCheckpointItem[];
  controlMode: ControlMode;
  controlScopedFlowIds: string[];
  controlThreadHistory: ControlThreadHistoryItem[];
  directionPlanningResult: DirectionPlanningResult | null;
  flowCalendarSelectedDate: string | null;
  flowSelectedStringId: string | null;
  permissionRequests: PermissionRequestItem[];
  setFlowSelectedStringId: (value: string | null) => void;
}

export function useFlowScope(input: UseFlowScopeInput) {
  const {
    activeControlThread,
    activeTab,
    approvalCheckpoints,
    controlMode,
    controlScopedFlowIds,
    controlThreadHistory,
    directionPlanningResult,
    flowCalendarSelectedDate,
    flowSelectedStringId,
    permissionRequests,
    setFlowSelectedStringId
  } = input;

  const flowVisibleStringItems = useMemo(() => {
    const filtered = flowCalendarSelectedDate
      ? controlThreadHistory.filter(
          (item) => toLocalDateKey(item.updatedAt) === flowCalendarSelectedDate
        )
      : controlThreadHistory;
    return [...filtered].sort((left, right) => right.updatedAt - left.updatedAt);
  }, [controlThreadHistory, flowCalendarSelectedDate]);

  const flowCalendarStringItems = useMemo(
    () =>
      controlThreadHistory.map((item) => ({
        id: item.id,
        title: controlThreadDisplayTitle(item),
        updatedAt: new Date(item.updatedAt).toISOString(),
        mode: item.mode === "DIRECTION" ? ("direction" as const) : ("discussion" as const)
      })),
    [controlThreadHistory]
  );

  const flowSelectedString = useMemo(
    () =>
      flowSelectedStringId
        ? flowVisibleStringItems.find((item) => item.id === flowSelectedStringId) ?? null
        : null,
    [flowSelectedStringId, flowVisibleStringItems]
  );

  useEffect(() => {
    if (!flowSelectedStringId) {
      return;
    }
    if (flowVisibleStringItems.some((item) => item.id === flowSelectedStringId)) {
      return;
    }
    setFlowSelectedStringId(null);
  }, [flowSelectedStringId, flowVisibleStringItems, setFlowSelectedStringId]);

  const flowSelectedStringLabel = flowSelectedString
    ? controlThreadDisplayTitle(flowSelectedString)
    : "";
  const flowSelectedStringPlanId = flowSelectedString?.launchScope?.planId?.trim() ?? "";
  const flowSelectedStringDirectionId = flowSelectedString?.launchScope?.directionId?.trim() ?? "";

  const flowVisibleStringPlanIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of flowVisibleStringItems) {
      const planId =
        item.launchScope?.planId?.trim() ?? item.planningResult?.planRecord?.id?.trim() ?? "";
      if (planId) {
        ids.add(planId);
      }
    }
    return [...ids];
  }, [flowVisibleStringItems]);

  const flowVisibleStringDirectionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of flowVisibleStringItems) {
      const directionId =
        item.launchScope?.directionId?.trim() ??
        item.planningResult?.directionRecord?.id?.trim() ??
        "";
      if (directionId) {
        ids.add(directionId);
      }
    }
    return [...ids];
  }, [flowVisibleStringItems]);

  const flowVisibleStringFlowIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of flowVisibleStringItems) {
      for (const flowId of item.launchScope?.flowIds ?? []) {
        const normalized = flowId.trim();
        if (normalized) {
          ids.add(normalized);
        }
      }
    }
    return [...ids];
  }, [flowVisibleStringItems]);

  const flowVisibleStringPermissionRequestIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of flowVisibleStringItems) {
      for (const requestId of item.launchScope?.permissionRequestIds ?? []) {
        const normalized = requestId.trim();
        if (normalized) {
          ids.add(normalized);
        }
      }
      for (const request of item.planningResult?.permissionRequests ?? []) {
        const normalized = request.id?.trim() ?? "";
        if (normalized) {
          ids.add(normalized);
        }
      }
    }
    return [...ids];
  }, [flowVisibleStringItems]);

  const flowSelectedStringFlowIds = useMemo(() => {
    const ids = new Set<string>();
    for (const value of flowSelectedString?.launchScope?.flowIds ?? []) {
      const normalized = value.trim();
      if (normalized) {
        ids.add(normalized);
      }
    }
    return [...ids];
  }, [flowSelectedString?.launchScope?.flowIds]);

  const flowSelectedStringPermissionRequestIds = useMemo(() => {
    const ids = new Set<string>();
    for (const requestId of flowSelectedString?.launchScope?.permissionRequestIds ?? []) {
      const normalized = requestId.trim();
      if (normalized) {
        ids.add(normalized);
      }
    }
    for (const request of flowSelectedString?.planningResult?.permissionRequests ?? []) {
      const normalized = request.id?.trim();
      if (normalized) {
        ids.add(normalized);
      }
    }
    return [...ids];
  }, [
    flowSelectedString?.launchScope?.permissionRequestIds,
    flowSelectedString?.planningResult?.permissionRequests
  ]);

  const flowCalendarScopedPermissionRequests = useMemo(() => {
    if (!flowCalendarSelectedDate) {
      return permissionRequests;
    }
    const visiblePlanIds = new Set(flowVisibleStringPlanIds);
    const visibleDirectionIds = new Set(flowVisibleStringDirectionIds);
    const visibleRequestIds = new Set(flowVisibleStringPermissionRequestIds);
    return permissionRequests.filter((request) => {
      if (visibleRequestIds.has(request.id)) {
        return true;
      }
      if (request.planId && visiblePlanIds.has(request.planId)) {
        return true;
      }
      if (request.directionId && visibleDirectionIds.has(request.directionId)) {
        return true;
      }
      return toLocalDateKey(request.createdAt) === flowCalendarSelectedDate;
    });
  }, [
    flowCalendarSelectedDate,
    flowVisibleStringDirectionIds,
    flowVisibleStringPermissionRequestIds,
    flowVisibleStringPlanIds,
    permissionRequests
  ]);

  const flowCalendarScopedApprovalCheckpoints = useMemo(() => {
    if (!flowCalendarSelectedDate) {
      return approvalCheckpoints;
    }
    const visibleFlowIds = new Set(flowVisibleStringFlowIds);
    return approvalCheckpoints.filter((item) => {
      const flowId = item.flowId?.trim();
      if (flowId && visibleFlowIds.has(flowId)) {
        return true;
      }
      return toLocalDateKey(item.requestedAt) === flowCalendarSelectedDate;
    });
  }, [approvalCheckpoints, flowCalendarSelectedDate, flowVisibleStringFlowIds]);

  const flowScopedPermissionRequests = useMemo(() => {
    if (!flowSelectedString) {
      return flowCalendarScopedPermissionRequests;
    }
    const planId = flowSelectedString.launchScope?.planId?.trim() ?? "";
    const directionId = flowSelectedString.launchScope?.directionId?.trim() ?? "";
    const scopedIds = new Set(flowSelectedStringPermissionRequestIds);
    return flowCalendarScopedPermissionRequests.filter((request) => {
      if (scopedIds.has(request.id)) {
        return true;
      }
      if (planId && request.planId === planId) {
        return true;
      }
      if (directionId && request.directionId === directionId) {
        return true;
      }
      return false;
    });
  }, [
    flowCalendarScopedPermissionRequests,
    flowSelectedString,
    flowSelectedStringPermissionRequestIds
  ]);

  const flowScopedApprovalCheckpoints = useMemo(() => {
    if (!flowSelectedString) {
      return flowCalendarScopedApprovalCheckpoints;
    }
    if (flowSelectedStringFlowIds.length === 0) {
      return [] as ApprovalCheckpointItem[];
    }
    const scopedFlowIds = new Set(flowSelectedStringFlowIds);
    return flowCalendarScopedApprovalCheckpoints.filter((item) => {
      const flowId = item.flowId?.trim();
      return Boolean(flowId && scopedFlowIds.has(flowId));
    });
  }, [
    flowCalendarScopedApprovalCheckpoints,
    flowSelectedString,
    flowSelectedStringFlowIds
  ]);

  const activePlanId =
    activeControlThread?.launchScope?.planId?.trim() ??
    directionPlanningResult?.planRecord?.id?.trim() ??
    "";
  const activeDirectionId =
    activeControlThread?.launchScope?.directionId?.trim() ??
    directionPlanningResult?.directionRecord?.id?.trim() ??
    "";

  const activeScopedPermissionRequestIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of activeControlThread?.launchScope?.permissionRequestIds ?? []) {
      const normalized = item.trim();
      if (normalized) {
        ids.add(normalized);
      }
    }
    for (const request of directionPlanningResult?.permissionRequests ?? []) {
      if (request.id?.trim()) {
        ids.add(request.id.trim());
      }
    }
    return [...ids];
  }, [
    activeControlThread?.launchScope?.permissionRequestIds,
    directionPlanningResult?.permissionRequests
  ]);

  const activeScopedFlowIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of activeControlThread?.launchScope?.flowIds ?? []) {
      const normalized = item.trim();
      if (normalized) {
        ids.add(normalized);
      }
    }
    for (const item of controlScopedFlowIds) {
      const normalized = item.trim();
      if (normalized) {
        ids.add(normalized);
      }
    }
    return [...ids];
  }, [activeControlThread?.launchScope?.flowIds, controlScopedFlowIds]);

  const launchScopedPermissionRequests = useMemo(() => {
    const byId = new Map<string, PermissionRequestItem>();
    const scopedIdSet = new Set(activeScopedPermissionRequestIds);

    for (const request of directionPlanningResult?.permissionRequests ?? []) {
      byId.set(request.id, request);
    }

    for (const request of permissionRequests) {
      const matchesPlan = activePlanId.length > 0 && request.planId === activePlanId;
      const matchesDirection =
        !matchesPlan && activeDirectionId.length > 0 && request.directionId === activeDirectionId;
      const matchesScopedIds = scopedIdSet.has(request.id);
      if (matchesPlan || matchesDirection || matchesScopedIds || byId.has(request.id)) {
        byId.set(request.id, request);
      }
    }

    return [...byId.values()];
  }, [
    activeDirectionId,
    activePlanId,
    activeScopedPermissionRequestIds,
    directionPlanningResult?.permissionRequests,
    permissionRequests
  ]);

  const pendingLaunchPermissionRequestCount = useMemo(
    () => launchScopedPermissionRequests.filter((item) => item.status === "PENDING").length,
    [launchScopedPermissionRequests]
  );

  const rejectedLaunchPermissionRequestCount = useMemo(
    () => launchScopedPermissionRequests.filter((item) => item.status === "REJECTED").length,
    [launchScopedPermissionRequests]
  );

  const launchPermissionRequestIds = useMemo(
    () => launchScopedPermissionRequests.map((item) => item.id),
    [launchScopedPermissionRequests]
  );

  const launchScopedApprovalCheckpoints = useMemo(() => {
    const scopedFlowSet = new Set(activeScopedFlowIds);
    if (scopedFlowSet.size === 0) {
      return [] as ApprovalCheckpointItem[];
    }
    return approvalCheckpoints.filter((item) => {
      const flowId = item.flowId?.trim();
      return Boolean(flowId && scopedFlowSet.has(flowId));
    });
  }, [activeScopedFlowIds, approvalCheckpoints]);

  const requestCenterPermissionRequests = useMemo(() => {
    const commandScoped =
      activeTab === "control" &&
      controlMode === "DIRECTION" &&
      launchScopedPermissionRequests.length > 0;
    return commandScoped ? launchScopedPermissionRequests : permissionRequests;
  }, [activeTab, controlMode, launchScopedPermissionRequests, permissionRequests]);

  const requestCenterApprovalCheckpoints = useMemo(() => {
    const commandScoped =
      activeTab === "control" &&
      controlMode === "DIRECTION" &&
      launchScopedApprovalCheckpoints.length > 0;
    return commandScoped ? launchScopedApprovalCheckpoints : approvalCheckpoints;
  }, [activeTab, approvalCheckpoints, controlMode, launchScopedApprovalCheckpoints]);

  const isRequestCenterScopedToCommand =
    activeTab === "control" &&
    controlMode === "DIRECTION" &&
    (launchScopedPermissionRequests.length > 0 || launchScopedApprovalCheckpoints.length > 0);

  const requestCenterPermissionPendingCount = useMemo(
    () => requestCenterPermissionRequests.filter((item) => item.status === "PENDING").length,
    [requestCenterPermissionRequests]
  );

  const requestCenterCheckpointPendingCount = useMemo(
    () => requestCenterApprovalCheckpoints.filter((item) => item.status === "PENDING").length,
    [requestCenterApprovalCheckpoints]
  );

  const requestCenterPendingCount = useMemo(
    () => requestCenterPermissionPendingCount + requestCenterCheckpointPendingCount,
    [requestCenterCheckpointPendingCount, requestCenterPermissionPendingCount]
  );

  return {
    flowCalendarStringItems,
    flowScopedApprovalCheckpoints,
    flowScopedPermissionRequests,
    flowSelectedString,
    flowSelectedStringDirectionId,
    flowSelectedStringFlowIds,
    flowSelectedStringLabel,
    flowSelectedStringPlanId,
    flowVisibleStringItems,
    isRequestCenterScopedToCommand,
    launchPermissionRequestIds,
    pendingLaunchPermissionRequestCount,
    rejectedLaunchPermissionRequestCount,
    requestCenterApprovalCheckpoints,
    requestCenterCheckpointPendingCount,
    requestCenterPendingCount,
    requestCenterPermissionPendingCount,
    requestCenterPermissionRequests
  };
}
