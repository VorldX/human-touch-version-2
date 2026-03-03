import { NextRequest, NextResponse } from "next/server";

import {
  ComposioServiceError,
  disconnectConnection
} from "@/lib/integrations/composio/service";
import { resolveIntegrationActor } from "@/lib/integrations/composio/request-context";

interface Params {
  params: {
    id: string;
  };
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const actorResult = await resolveIntegrationActor({ request });
  if (!actorResult.ok) {
    return actorResult.response;
  }

  const connectionId = params.id?.trim() ?? "";
  if (!connectionId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Connection id is required."
      },
      { status: 400 }
    );
  }

  try {
    const actor = actorResult.actor;
    const disconnected = await disconnectConnection({
      userId: actor.userId,
      orgId: actor.orgId,
      connectionId
    });

    if (!disconnected) {
      return NextResponse.json(
        {
          ok: false,
          message: "Connection not found."
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      connection: disconnected
    });
  } catch (error) {
    const status = error instanceof ComposioServiceError ? error.status : 503;
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof ComposioServiceError
            ? error.message
            : "Unable to disconnect app integration."
      },
      { status }
    );
  }
}
