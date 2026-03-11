export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import {
  ComposioServiceError,
  composioAllowlistedToolkits,
  composioIntegrationEnabled,
  getConnections,
  isConnectedIntegrationStatus,
  listAvailableToolkits
} from "@/lib/integrations/composio/service";
import { resolveIntegrationActor } from "@/lib/integrations/composio/request-context";

export async function GET(request: NextRequest) {
  if (!composioIntegrationEnabled()) {
    const allowlisted = composioAllowlistedToolkits();
    return NextResponse.json({
      ok: true,
      enabled: false,
      allowlistedToolkits: allowlisted,
      toolkits: allowlisted.map((slug) => ({
        slug,
        name: slug
          .split(/[-_]/g)
          .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
          .join(" "),
        description: "",
        logoUrl: null,
        appUrl: null,
        status: "DISABLED",
        connected: false,
        connectionId: null
      }))
    });
  }

  const actorResult = await resolveIntegrationActor({ request });
  if (!actorResult.ok) {
    return actorResult.response;
  }

  try {
    const actor = actorResult.actor;
    const [toolkits, connections] = await Promise.all([
      listAvailableToolkits({ userId: actor.userId }),
      getConnections({ userId: actor.userId, orgId: actor.orgId })
    ]);

    const preferredByToolkit = new Map<
      string,
      {
        status: string;
        connectionId: string | null;
      }
    >();
    for (const connection of connections) {
      const current = preferredByToolkit.get(connection.toolkit);
      if (!current || !isConnectedIntegrationStatus(current.status)) {
        preferredByToolkit.set(connection.toolkit, {
          status: connection.status,
          connectionId: connection.connectionId
        });
      }
    }

    const merged = toolkits.map((toolkit) => {
      const preferred = preferredByToolkit.get(toolkit.slug);
      return {
        ...toolkit,
        status: preferred?.status ?? toolkit.status,
        connected: isConnectedIntegrationStatus(preferred?.status ?? toolkit.status),
        connectionId: preferred?.connectionId ?? toolkit.connectionId
      };
    });

    return NextResponse.json({
      ok: true,
      enabled: composioIntegrationEnabled(),
      allowlistedToolkits: composioAllowlistedToolkits(),
      toolkits: merged
    });
  } catch (error) {
    const status = error instanceof ComposioServiceError ? error.status : 503;
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof ComposioServiceError
            ? error.message
            : "Integrations are temporarily unavailable. Try again shortly."
      },
      { status }
    );
  }
}
