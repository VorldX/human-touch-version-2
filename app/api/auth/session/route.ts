export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { getSessionFromRequest } from "@/lib/security/session";

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      {
        ok: false,
        message: "Not authenticated."
      },
      { status: 401 }
    );
  }

  let user;
  try {
    user = await prisma.user.findFirst({
      where: {
        id: session.userId,
        email: session.email
      },
      select: {
        id: true,
        email: true,
        username: true
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return NextResponse.json(
        {
          ok: false,
          message: "Database is still starting. Try again in a few seconds."
        },
        { status: 503 }
      );
    }
    throw error;
  }

  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        message: "Session is invalid."
      },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    user: {
      uid: user.id,
      email: user.email,
      username: user.username
    }
  });
}

