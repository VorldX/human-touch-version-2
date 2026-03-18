export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import {
  createPgvectorBackup,
  deleteAdminJsonConfig,
  listAdminJsonConfigs,
  listPgvectorBackups,
  rollbackPgvectorBackup,
  upsertAdminJsonConfig
} from "@/lib/dna/phase4";
import { requireOrgAccess } from "@/lib/security/org-access";

function denyAdminOnly() {
  return NextResponse.json(
    {
      ok: false,
      message: "Admin access is required for phase4 admin tools."
    },
    { status: 403 }
  );
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
  if (!access.ok) return access.response;
  if (!access.actor.isAdmin) return denyAdminOnly();

  const [configs, backups] = await Promise.all([
    listAdminJsonConfigs({ tenantId: orgId, userId: access.actor.userId }),
    listPgvectorBackups({ tenantId: orgId, userId: access.actor.userId, limit: 20 })
  ]);

  return NextResponse.json({
    ok: true,
    orgId,
    actor: {
      userId: access.actor.userId,
      role: access.actor.role,
      isAdmin: access.actor.isAdmin
    },
    configs,
    backups
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        orgId?: string;
        action?: "save_config" | "delete_config" | "create_backup" | "rollback_backup";
        configKey?: string;
        configJson?: Record<string, unknown>;
        expectedVersion?: number;
        backupId?: string;
        backupLabel?: string;
      }
    | null;

  const orgId = body?.orgId?.trim() ?? "";
  if (!orgId || !body?.action) {
    return NextResponse.json(
      {
        ok: false,
        message: "orgId and action are required."
      },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId, allowInternal: true });
  if (!access.ok) return access.response;
  if (!access.actor.isAdmin) return denyAdminOnly();

  if (body.action === "save_config") {
    const configKey = body.configKey?.trim() ?? "";
    const configJson = body.configJson;
    if (!configKey || !configJson || typeof configJson !== "object" || Array.isArray(configJson)) {
      return NextResponse.json(
        {
          ok: false,
          message: "configKey and configJson object are required for save_config."
        },
        { status: 400 }
      );
    }

    const result = await upsertAdminJsonConfig({
      tenantId: orgId,
      userId: access.actor.userId,
      configKey,
      configJson,
      expectedVersion: typeof body.expectedVersion === "number" ? body.expectedVersion : undefined
    });

    return NextResponse.json({
      ok: result.applied,
      orgId,
      result
    });
  }

  if (body.action === "delete_config") {
    const configKey = body.configKey?.trim() ?? "";
    if (!configKey) {
      return NextResponse.json(
        {
          ok: false,
          message: "configKey is required for delete_config."
        },
        { status: 400 }
      );
    }

    const result = await deleteAdminJsonConfig({
      tenantId: orgId,
      userId: access.actor.userId,
      configKey
    });

    return NextResponse.json({
      ok: true,
      orgId,
      result
    });
  }

  if (body.action === "create_backup") {
    const backup = await createPgvectorBackup({
      tenantId: orgId,
      userId: access.actor.userId,
      backupLabel: body.backupLabel,
      requestedBy: access.actor.userId
    });

    return NextResponse.json({
      ok: true,
      orgId,
      backup
    });
  }

  if (body.action === "rollback_backup") {
    const backupId = body.backupId?.trim() ?? "";
    if (!backupId) {
      return NextResponse.json(
        {
          ok: false,
          message: "backupId is required for rollback_backup."
        },
        { status: 400 }
      );
    }

    const result = await rollbackPgvectorBackup({
      tenantId: orgId,
      userId: access.actor.userId,
      backupId,
      requestedBy: access.actor.userId
    });

    return NextResponse.json({
      ok: true,
      orgId,
      result
    });
  }

  return NextResponse.json(
    {
      ok: false,
      message: "Unsupported action."
    },
    { status: 400 }
  );
}
