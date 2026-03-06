export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import {
  defaultIntegrationsReturnPath,
  handleOAuthCallback
} from "@/lib/integrations/composio/service";

function buildReturnUrl(input: {
  request: NextRequest;
  returnTo?: string;
  status: "connected" | "error";
  toolkit?: string;
  reason?: string;
}) {
  const fallback = new URL(defaultIntegrationsReturnPath(), input.request.nextUrl.origin);
  let target = fallback;
  if (input.returnTo) {
    try {
      const candidate = new URL(input.returnTo, input.request.nextUrl.origin);
      if (candidate.origin === input.request.nextUrl.origin) {
        target = candidate;
      }
    } catch {
      target = fallback;
    }
  }

  target.searchParams.set("composio", input.status);
  if (input.toolkit) {
    target.searchParams.set("toolkit", input.toolkit);
  }
  if (input.reason) {
    target.searchParams.set("reason", input.reason);
  }
  return target;
}

async function processCallback(request: NextRequest) {
  const result = await handleOAuthCallback(request);
  if (!result.ok) {
    const redirect = buildReturnUrl({
      request,
      returnTo: result.returnTo,
      status: "error",
      reason: result.reason
    });
    return NextResponse.redirect(redirect, { status: 302 });
  }

  const redirect = buildReturnUrl({
    request,
    returnTo: result.returnTo,
    status: "connected",
    toolkit: result.toolkit
  });
  return NextResponse.redirect(redirect, { status: 302 });
}

export async function GET(request: NextRequest) {
  return processCallback(request);
}

export async function POST(request: NextRequest) {
  return processCallback(request);
}
