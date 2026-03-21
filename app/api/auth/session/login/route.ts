export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS
} from "@/lib/security/session";

interface LoginBody {
  email?: string;
  otp?: string;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidOtp(value: string) {
  return /^\d{6}$/.test(value.trim());
}

function deriveUsername(email: string) {
  const base = email.split("@")[0]?.trim() || "user";
  return base.slice(0, 64);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as LoginBody | null;
  const email = normalizeEmail(body?.email ?? "");
  const otp = (body?.otp ?? "").trim();

  if (!isValidEmail(email)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Enter a valid email address."
      },
      { status: 400 }
    );
  }

  if (!isValidOtp(otp)) {
    return NextResponse.json(
      {
        ok: false,
        message: "OTP must be exactly 6 digits."
      },
      { status: 400 }
    );
  }

  const requiredOtp = process.env.DEV_AUTH_STATIC_OTP?.trim();
  if (requiredOtp && otp !== requiredOtp) {
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid OTP."
      },
      { status: 401 }
    );
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      username: deriveUsername(email)
    },
    create: {
      email,
      username: deriveUsername(email)
    },
    select: {
      id: true,
      email: true,
      username: true
    }
  });

  const token = await createSessionToken({
    userId: user.id,
    email: user.email,
    ttlSeconds: SESSION_TTL_SECONDS
  });

  const response = NextResponse.json({
    ok: true,
    user: {
      uid: user.id,
      email: user.email,
      username: user.username
    }
  });

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });

  return response;
}

