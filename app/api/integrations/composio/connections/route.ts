export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import {
  ComposioServiceError,
  composioIntegrationStatus,
  createConnection,
  getConnections
} from "@/lib/integrations/composio/service";
import { resolveIntegrationActor } from "@/lib/integrations/composio/request-context";

type ConnectBody = {
  orgId?: string;
  toolkit?: string;
  returnTo?: string;
  userId?: string;
  userEmail?: string;
} | null;

export async function GET(request: NextRequest) {
  const integrationStatus = composioIntegrationStatus();
  if (!integrationStatus.enabled) {
    return NextResponse.json({
      ok: true,
      enabled: false,
      reason: !integrationStatus.featureEnabled
        ? "FEATURE_COMPOSIO_INTEGRATIONS is disabled."
        : integrationStatus.apiKeyReason === "placeholder"
          ? "COMPOSIO_API_KEY is a placeholder value."
          : "COMPOSIO_API_KEY is missing or invalid.",
      ...(integrationStatus.diagnostics ? { diagnostics: integrationStatus.diagnostics } : {}),
      connections: []
    });
  }

  const actorResult = await resolveIntegrationActor({ request });
  if (!actorResult.ok) {
    return actorResult.response;
  }

  try {
    const actor = actorResult.actor;
    const connections = await getConnections({
      userId: actor.userId,
      orgId: actor.orgId
    });

    return NextResponse.json({
      ok: true,
      connections
    });
  } catch (error) {
    const status = error instanceof ComposioServiceError ? error.status : 503;
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof ComposioServiceError
            ? error.message
            : "Unable to load app connections right now."
      },
      { status }
    );
  }
}

export async function POST(request: NextRequest) {
  const integrationStatus = composioIntegrationStatus();
  if (!integrationStatus.enabled) {
    return NextResponse.json(
      {
        ok: false,
        message: !integrationStatus.featureEnabled
          ? "App integrations are disabled. Set FEATURE_COMPOSIO_INTEGRATIONS=true."
          : "App integrations are disabled. Set a valid COMPOSIO_API_KEY."
      },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => null)) as ConnectBody;
  const actorResult = await resolveIntegrationActor({
    request,
    body: {
      orgId: body?.orgId,
      userEmail: body?.userEmail,
      userId: body?.userId
    }
  });
  if (!actorResult.ok) {
    return actorResult.response;
  }

  const toolkit = body?.toolkit?.trim().toLowerCase() ?? "";
  if (!toolkit) {
    return NextResponse.json(
      {
        ok: false,
        message: "toolkit is required."
      },
      { status: 400 }
    );
  }

  const returnTo = body?.returnTo?.trim();
  try {
    const actor = actorResult.actor;
    const callbackUrlOverride = `${request.nextUrl.origin}/api/integrations/composio/oauth/callback`;
    const result = await createConnection({
      userId: actor.userId,
      orgId: actor.orgId,
      toolkit,
      callbackUrlOverride,
      ...(returnTo ? { returnTo } : {})
    });

    return NextResponse.json(
      {
        ok: true,
        connectUrl: result.connectUrl,
        connection: result.connection
      },
      { status: 201 }
    );
  } catch (error) {
    const status = error instanceof ComposioServiceError ? error.status : 503;
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof ComposioServiceError
            ? error.message
            : "Could not start app connection flow."
      },
      { status }
    );
  }
}
