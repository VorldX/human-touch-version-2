export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { enqueueIdleSessionsForOrg } from "@/lib/dna/phase2";
import { requireOrgAccess } from "@/lib/security/org-access";

interface BacklogRow {
  tenantId: string;
  userId: string;
  status: string;
  queuedItems: number;
  oldestCreatedAt: Date | null;
  newestCreatedAt: Date | null;
}

interface TaskRow {
  taskId: string;
  sessionId: string;
  status: string;
  streamId: string | null;
  attemptCount: number;
  createdAt: Date;
  processedAt: Date | null;
}

function parseLimit(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim() ?? "";
  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId query param is required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"), 30, 120);

  const [backlogRows, taskRows] = await Promise.all([
    prisma.$queryRawUnsafe<BacklogRow[]>(
      `
        SELECT
          tenant_id AS "tenantId",
          user_id AS "userId",
          status::text AS status,
          queued_items::int AS "queuedItems",
          oldest_created_at AS "oldestCreatedAt",
          newest_created_at AS "newestCreatedAt"
        FROM dna_memory.phase2_queue_backlog
        WHERE tenant_id = $1
          AND user_id = $2
        ORDER BY queued_items DESC
      `,
      orgId,
      access.actor.userId
    ),
    prisma.$queryRawUnsafe<TaskRow[]>(
      `
        SELECT
          task_id::text AS "taskId",
          session_id AS "sessionId",
          status::text AS status,
          stream_id AS "streamId",
          attempt_count AS "attemptCount",
          created_at AS "createdAt",
          processed_at AS "processedAt"
        FROM dna_memory.claim_check_tasks
        WHERE tenant_id = $1
          AND user_id = $2
        ORDER BY created_at DESC
        LIMIT $3
      `,
      orgId,
      access.actor.userId,
      limit
    )
  ]);

  return NextResponse.json({
    ok: true,
    orgId,
    userId: access.actor.userId,
    backlog: backlogRows,
    tasks: taskRows
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        limit?: number;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  if (!orgId) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId is required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) {
    return access.response;
  }

  const limit =
    typeof body?.limit === "number" && Number.isFinite(body.limit)
      ? Math.max(1, Math.min(200, Math.floor(body.limit)))
      : 40;

  const queued = await enqueueIdleSessionsForOrg({
    tenantId: orgId,
    limit
  });

  return NextResponse.json({
    ok: true,
    orgId,
    queued
  });
}
