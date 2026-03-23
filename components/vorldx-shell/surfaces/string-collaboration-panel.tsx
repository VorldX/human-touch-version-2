"use client";

import { useMemo } from "react";
import { Check, ShieldCheck, Users, Workflow } from "lucide-react";

import type {
  ApprovalCheckpointItem,
  ControlThreadHistoryItem,
  DirectionTurn,
  PermissionRequestItem
} from "@/components/vorldx-shell/shared";

function statusPillClass(status: string) {
  if (status === "APPROVED") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "REJECTED" || status === "CANCELLED") {
    return "border-red-500/40 bg-red-500/10 text-red-200";
  }
  return "border-amber-500/40 bg-amber-500/10 text-amber-200";
}

export function StringCollaborationPanel({
  stringItem,
  isActiveStringThread,
  isApprovalBusy,
  discussionTurns,
  permissionRequests,
  approvalCheckpoints,
  resourcePlan,
  autoSquad,
  permissionRequestActionId,
  approvalCheckpointActionId,
  onSelectThread,
  onApprovePlanLaunch,
  onRejectPlanLaunch,
  onApproveEmailDraft,
  onRejectEmailDraft,
  onApproveToolkitAccess,
  onRejectToolkitAccess,
  onPermissionRequestDecision,
  onApprovalCheckpointDecision
}: {
  stringItem: ControlThreadHistoryItem;
  isActiveStringThread: boolean;
  isApprovalBusy: boolean;
  discussionTurns: Array<
    DirectionTurn & {
      timestamp: number;
      actorType: string;
      actorLabel: string;
    }
  >;
  permissionRequests: PermissionRequestItem[];
  approvalCheckpoints: ApprovalCheckpointItem[];
  resourcePlan: Array<{
    workforceType: "HUMAN" | "AGENT" | "HYBRID";
    role: string;
    responsibility: string;
    capacityPct: number;
    tools: string[];
  }>;
  autoSquad: {
    triggered?: boolean;
    requestedRoles?: string[];
    created?: Array<{ id: string; name: string; role: string }>;
  } | null;
  permissionRequestActionId: string | null;
  approvalCheckpointActionId: string | null;
  onSelectThread: (threadId: string) => void;
  onApprovePlanLaunch: () => void;
  onRejectPlanLaunch: () => void;
  onApproveEmailDraft: () => void;
  onRejectEmailDraft: () => void;
  onApproveToolkitAccess: () => void;
  onRejectToolkitAccess: () => void;
  onPermissionRequestDecision: (requestId: string, decision: "APPROVE" | "REJECT") => void;
  onApprovalCheckpointDecision: (
    checkpointId: string,
    decision: "APPROVE" | "REJECT"
  ) => void;
}) {
  const participants = useMemo(() => {
    const byParticipant = new Map<
      string,
      {
        id: string;
        actorType: string;
        actorLabel: string;
        turnCount: number;
      }
    >();

    discussionTurns.forEach((turn) => {
      const actorLabel = turn.actorLabel?.trim() || "Unknown";
      const key = `${turn.actorType}:${actorLabel}`;
      const current = byParticipant.get(key);
      if (current) {
        current.turnCount += 1;
        return;
      }
      byParticipant.set(key, {
        id: key,
        actorType: turn.actorType,
        actorLabel,
        turnCount: 1
      });
    });

    return [...byParticipant.values()].sort(
      (left, right) =>
        right.turnCount - left.turnCount ||
        left.actorLabel.localeCompare(right.actorLabel)
    );
  }, [discussionTurns]);

  const pendingStringCards =
    Number(Boolean(stringItem.pendingPlanLaunchApproval)) +
    Number(Boolean(stringItem.pendingToolkitApproval)) +
    Number(Boolean(stringItem.pendingEmailApproval));

  return (
    <div className="space-y-3">
      {!isActiveStringThread ? (
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

      <div className="grid gap-2 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Participants</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">{participants.length}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Workforce</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">{resourcePlan.length}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Requested Roles</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {autoSquad?.requestedRoles?.length ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Created Team</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {autoSquad?.created?.length ?? 0}
          </p>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.1fr)]">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <Users size={12} />
              Participants
            </p>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
              From string turns
            </span>
          </div>
          {participants.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No participants captured for this string yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {participants.map((participant) => (
                <div
                  key={participant.id}
                  className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                          participant.actorType === "HUMAN"
                            ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                            : participant.actorType === "AI"
                              ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-200"
                              : "border-white/10 bg-white/5 text-slate-300"
                        }`}
                      >
                        {participant.actorType}
                      </span>
                      <p className="text-xs font-semibold text-slate-100">
                        {participant.actorLabel}
                      </p>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {participant.turnCount} turn(s)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <ShieldCheck size={12} />
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

          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <Workflow size={12} />
                Workforce Context
              </p>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
                {resourcePlan.length} line(s)
              </span>
            </div>
            {resourcePlan.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No workforce plan linked yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {resourcePlan.map((resource, index) => (
                  <div
                    key={`${resource.role}-${index}`}
                    className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-100">{resource.role}</p>
                      <span className="rounded-full border border-white/15 bg-black/30 px-2 py-0.5 text-[10px] text-slate-300">
                        {resource.workforceType} | {resource.capacityPct}%
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">{resource.responsibility}</p>
                    {resource.tools.length > 0 ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Tools: {resource.tools.join(" | ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {autoSquad ? (
              <div className="mt-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-100">
                Auto-WorkForce {autoSquad.triggered ? "triggered" : "not triggered"}.
                {(autoSquad.created?.length ?? 0) > 0
                  ? ` Created ${autoSquad.created?.length} profile(s).`
                  : ""}
                {(autoSquad.requestedRoles?.length ?? 0) > 0
                  ? ` Roles: ${autoSquad.requestedRoles?.join(" | ")}.`
                  : ""}
              </div>
            ) : null}
            {(autoSquad?.created?.length ?? 0) > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {autoSquad?.created?.map((member) => (
                  <span
                    key={member.id}
                    className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100"
                  >
                    {member.name} | {member.role}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Permission Requests ({permissionRequests.length})
          </p>
          {permissionRequests.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No string permission requests found.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {permissionRequests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-100">
                        {request.area} | {request.taskTitle}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {request.workflowTitle || "No workflow"} | {request.requestedByEmail}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${statusPillClass(request.status)}`}
                    >
                      {request.status}
                    </span>
                  </div>
                  {request.status === "PENDING" && isActiveStringThread ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onPermissionRequestDecision(request.id, "APPROVE")}
                        disabled={permissionRequestActionId === request.id}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 disabled:opacity-60"
                      >
                        {permissionRequestActionId === request.id ? "Working..." : "Approve"}
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
            Approval Checkpoints ({approvalCheckpoints.length})
          </p>
          {approvalCheckpoints.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No string approval checkpoints found.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {approvalCheckpoints.map((checkpoint) => (
                <div
                  key={checkpoint.id}
                  className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-100">{checkpoint.reason}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Requested {new Date(checkpoint.requestedAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${statusPillClass(checkpoint.status)}`}
                    >
                      {checkpoint.status}
                    </span>
                  </div>
                  {checkpoint.status === "PENDING" && isActiveStringThread ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onApprovalCheckpointDecision(checkpoint.id, "APPROVE")}
                        disabled={approvalCheckpointActionId === checkpoint.id}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 disabled:opacity-60"
                      >
                        {approvalCheckpointActionId === checkpoint.id ? "Working..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onApprovalCheckpointDecision(checkpoint.id, "REJECT")}
                        disabled={approvalCheckpointActionId === checkpoint.id}
                        className="rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-200 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  ) : checkpoint.resolvedAt ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Resolved {new Date(checkpoint.resolvedAt).toLocaleString()}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
