export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import {
  ComposioServiceError,
  composioIntegrationStatus,
  createConnection
} from "@/lib/integrations/composio/service";
import { resolveIntegrationActor } from "@/lib/integrations/composio/request-context";

type ConnectBody = {
  orgId?: string;
  toolkit?: string;
  returnTo?: string;
  userId?: string;
  userEmail?: string;
} | null;

export async function POST(request: NextRequest) {
  const integrationStatus = composioIntegrationStatus();
  if (!integrationStatus.enabled) {
    return NextResponse.json(
      {
        ok: false,
        message: !integrationStatus.featureEnabled
          ? "App integrations are disabled. Set FEATURE_COMPOSIO_INTEGRATIONS=true."
          : integrationStatus.apiKeyReason === "placeholder"
            ? "App integrations are disabled. COMPOSIO_API_KEY is still a placeholder value."
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

  try {
    const callbackUrlOverride = `${request.nextUrl.origin}/api/integrations/composio/oauth/callback`;
    const result = await createConnection({
      userId: actorResult.actor.userId,
      orgId: actorResult.actor.orgId,
      toolkit,
      callbackUrlOverride,
      ...(body?.returnTo?.trim() ? { returnTo: body.returnTo.trim() } : {})
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
