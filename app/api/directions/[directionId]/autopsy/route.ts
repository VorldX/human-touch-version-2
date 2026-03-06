import { NextRequest, NextResponse } from "next/server";

import { getDirectionAutopsy } from "@/lib/direction/directions";
import { requireOrgAccess } from "@/lib/security/org-access";

interface RouteContext {
  params: Promise<{
    directionId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { directionId } = await context.params;
  const orgId = request.nextUrl.searchParams.get("orgId")?.trim();
  if (!orgId || !directionId?.trim()) {
    return NextResponse.json(
      { ok: false, message: "orgId and directionId are required." },
      { status: 400 }
    );
  }

  const access = await requireOrgAccess({ request, orgId });
  if (!access.ok) {
    return access.response;
  }

  const autopsy = await getDirectionAutopsy(orgId, directionId);
  if (!autopsy) {
    return NextResponse.json({ ok: false, message: "Direction not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    autopsy
  });
}
