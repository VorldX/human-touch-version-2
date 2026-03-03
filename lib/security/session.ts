import { NextRequest } from "next/server";

export const SESSION_COOKIE_NAME = "ht_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

interface SessionTokenPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export interface SessionClaims {
  userId: string;
  email: string;
  issuedAt: number;
  expiresAt: number;
}

let signingKeyPromise: Promise<CryptoKey> | null = null;

function resolveSessionSecret() {
  const secret =
    process.env.SESSION_SECRET?.trim() ||
    process.env.ENCRYPTION_MASTER_KEY?.trim() ||
    process.env.INTERNAL_API_KEY?.trim() ||
    "";

  if (!secret) {
    throw new Error(
      "Missing SESSION_SECRET (or ENCRYPTION_MASTER_KEY / INTERNAL_API_KEY fallback)."
    );
  }

  return secret;
}

function toBase64(input: string) {
  if (typeof btoa === "function") {
    return btoa(input);
  }
  return Buffer.from(input, "binary").toString("base64");
}

function fromBase64(input: string) {
  if (typeof atob === "function") {
    return atob(input);
  }
  return Buffer.from(input, "base64").toString("binary");
}

function bytesToBinary(bytes: Uint8Array) {
  let out = "";
  for (let index = 0; index < bytes.length; index += 1) {
    out += String.fromCharCode(bytes[index]!);
  }
  return out;
}

function binaryToBytes(input: string) {
  const bytes = new Uint8Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    bytes[index] = input.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array) {
  return toBase64(bytesToBinary(bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const needsPadding = padded.length % 4;
  const normalized =
    needsPadding === 0 ? padded : `${padded}${"=".repeat(4 - needsPadding)}`;
  return binaryToBytes(fromBase64(normalized));
}

async function getSigningKey() {
  if (!signingKeyPromise) {
    const encoder = new TextEncoder();
    const material = encoder.encode(resolveSessionSecret());
    signingKeyPromise = crypto.subtle.importKey(
      "raw",
      material,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
  }
  return signingKeyPromise;
}

async function sign(input: string) {
  const key = await getSigningKey();
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  const signature = await crypto.subtle.sign("HMAC", key, bytes);
  return encodeBase64Url(new Uint8Array(signature));
}

async function verifySignature(input: string, signature: string) {
  const key = await getSigningKey();
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const sigBytes = decodeBase64Url(signature);
  return crypto.subtle.verify("HMAC", key, sigBytes, data);
}

function parsePayload(input: unknown): SessionClaims | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  if (
    typeof record.sub !== "string" ||
    typeof record.email !== "string" ||
    typeof record.iat !== "number" ||
    typeof record.exp !== "number"
  ) {
    return null;
  }

  if (!Number.isFinite(record.exp) || record.exp <= Date.now()) {
    return null;
  }

  return {
    userId: record.sub,
    email: record.email,
    issuedAt: record.iat,
    expiresAt: record.exp
  };
}

export async function createSessionToken(input: {
  userId: string;
  email: string;
  ttlSeconds?: number;
}) {
  const issuedAt = Date.now();
  const ttlMs = (input.ttlSeconds ?? SESSION_TTL_SECONDS) * 1000;
  const payload: SessionTokenPayload = {
    sub: input.userId,
    email: input.email,
    iat: issuedAt,
    exp: issuedAt + ttlMs
  };

  const encodedPayload = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const signature = await sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(token: string) {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const valid = await verifySignature(encodedPayload, signature).catch(() => false);
  if (!valid) {
    return null;
  }

  try {
    const decoded = new TextDecoder().decode(decodeBase64Url(encodedPayload));
    return parsePayload(JSON.parse(decoded));
  } catch {
    return null;
  }
}

export async function getSessionFromRequest(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? "";
  if (!token) {
    return null;
  }
  return verifySessionToken(token);
}

