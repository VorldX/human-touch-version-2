import { createHmac, timingSafeEqual } from "node:crypto";

import type { OAuthStatePayload } from "@/lib/integrations/composio/service-core";

function toBase64Url(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function fromBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function stateSecret() {
  const explicit = process.env.COMPOSIO_OAUTH_STATE_SECRET?.trim();
  if (explicit) return explicit;

  const encryptionKey = process.env.ENCRYPTION_MASTER_KEY?.trim();
  if (encryptionKey) return encryptionKey;

  return process.env.COMPOSIO_API_KEY?.trim() ?? "composio-oauth-state-dev";
}

function sign(payloadB64: string) {
  return createHmac("sha256", stateSecret()).update(payloadB64).digest("base64url");
}

export function createComposioOAuthState(payload: OAuthStatePayload) {
  const serialized = JSON.stringify(payload);
  const payloadB64 = toBase64Url(serialized);
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

export function verifyComposioOAuthState(token: string): OAuthStatePayload | null {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) {
    return null;
  }

  const expected = sign(payloadB64);
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return null;
  }

  try {
    const decoded = JSON.parse(fromBase64Url(payloadB64)) as Partial<OAuthStatePayload>;
    if (
      typeof decoded?.nonce !== "string" ||
      typeof decoded?.userId !== "string" ||
      typeof decoded?.orgId !== "string" ||
      typeof decoded?.toolkit !== "string" ||
      typeof decoded?.returnTo !== "string" ||
      typeof decoded?.issuedAt !== "number" ||
      typeof decoded?.expiresAt !== "number"
    ) {
      return null;
    }
    if (!Number.isFinite(decoded.expiresAt) || decoded.expiresAt < Date.now()) {
      return null;
    }
    return {
      nonce: decoded.nonce,
      userId: decoded.userId,
      orgId: decoded.orgId,
      toolkit: decoded.toolkit,
      returnTo: decoded.returnTo,
      issuedAt: decoded.issuedAt,
      expiresAt: decoded.expiresAt
    };
  } catch {
    return null;
  }
}
