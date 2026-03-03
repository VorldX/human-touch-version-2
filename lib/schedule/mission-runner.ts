import "server-only";

import {
  computeNextRunAt,
  getMissionSchedule,
  type MissionSchedule,
  updateMissionSchedule
} from "@/lib/schedule/mission-schedules";

interface FlowLaunchResponse {
  ok?: boolean;
  warning?: string;
  message?: string;
  flow?: {
    id: string;
    status: string;
    taskCount?: number;
  };
}

export interface RunMissionScheduleSuccess {
  ok: true;
  schedule: MissionSchedule;
  flow: {
    id: string;
    status: string;
    taskCount?: number;
  };
  warning?: string;
}

export interface RunMissionScheduleFailure {
  ok: false;
  status: number;
  message: string;
}

export type RunMissionScheduleResult = RunMissionScheduleSuccess | RunMissionScheduleFailure;

interface RunMissionScheduleInput {
  origin: string;
  orgId: string;
  scheduleId: string;
  force?: boolean;
}

export async function runMissionSchedule(
  input: RunMissionScheduleInput
): Promise<RunMissionScheduleResult> {
  const schedule = await getMissionSchedule(input.orgId, input.scheduleId);
  if (!schedule) {
    return {
      ok: false,
      status: 404,
      message: "Schedule not found."
    };
  }

  if (!input.force && !schedule.enabled) {
    return {
      ok: false,
      status: 409,
      message: "Schedule is disabled."
    };
  }

  if (!schedule.direction.trim()) {
    return {
      ok: false,
      status: 400,
      message: "Schedule direction is empty."
    };
  }

  let response: Response;
  try {
    response = await fetch(`${input.origin}/api/flows`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        orgId: input.orgId,
        prompt: schedule.direction,
        ...(schedule.directionId ? { directionId: schedule.directionId } : {}),
        swarmDensity: schedule.swarmDensity,
        predictedBurn: schedule.predictedBurn,
        requiredSignatures: schedule.requiredSignatures,
        approvalsProvided: schedule.requiredSignatures
      }),
      cache: "no-store"
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      message: error instanceof Error ? error.message : "Failed launching scheduled flow."
    };
  }

  const payload = (await response.json().catch(() => null)) as FlowLaunchResponse | null;
  if (!response.ok || !payload?.ok || !payload.flow) {
    return {
      ok: false,
      status: response.status || 502,
      message: payload?.message ?? "Scheduled flow launch failed."
    };
  }

  const nowIso = new Date().toISOString();
  const updated =
    (await updateMissionSchedule(input.orgId, schedule.id, {
      lastRunAt: nowIso,
      nextRunAt: computeNextRunAt(nowIso, schedule.cadence)
    })) ?? schedule;

  return {
    ok: true,
    schedule: updated,
    flow: payload.flow,
    ...(payload.warning ? { warning: payload.warning } : {})
  };
}
