import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const AES_ALGO = "aes-256-gcm";
const AES_KEY_BYTES = 32;
const IV_BYTES = 12;

export interface EncryptedSecret {
  cipherText: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

function resolveMasterKey(): Buffer {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw) {
    throw new Error("Missing ENCRYPTION_MASTER_KEY.");
  }

  const normalized = raw.trim();

  if (normalized.startsWith("base64:")) {
    const key = Buffer.from(normalized.slice("base64:".length), "base64");
    if (key.length !== AES_KEY_BYTES) {
      throw new Error("ENCRYPTION_MASTER_KEY base64 value must decode to 32 bytes.");
    }
    return key;
  }

  if (normalized.startsWith("hex:")) {
    const key = Buffer.from(normalized.slice("hex:".length), "hex");
    if (key.length !== AES_KEY_BYTES) {
      throw new Error("ENCRYPTION_MASTER_KEY hex value must decode to 32 bytes.");
    }
    return key;
  }

  const utf8Key = Buffer.from(normalized, "utf8");
  if (utf8Key.length === AES_KEY_BYTES) {
    return utf8Key;
  }

  const base64Key = Buffer.from(normalized, "base64");
  if (base64Key.length === AES_KEY_BYTES) {
    return base64Key;
  }

  throw new Error("ENCRYPTION_MASTER_KEY must be 32-byte utf8, base64:<value>, or hex:<value>.");
}

export function encryptSecret(plainText: string, keyVersion = 1): EncryptedSecret {
  const key = resolveMasterKey();
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(AES_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    cipherText: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion
  };
}

export function decryptSecret(payload: EncryptedSecret): string {
  const key = resolveMasterKey();
  const decipher = createDecipheriv(AES_ALGO, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.cipherText, "base64")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

export function serializeSecret(payload: EncryptedSecret): string {
  return `${payload.keyVersion}.${payload.iv}.${payload.authTag}.${payload.cipherText}`;
}

export function deserializeSecret(serialized: string): EncryptedSecret {
  const [keyVersionRaw, iv, authTag, cipherText] = serialized.split(".");
  const keyVersion = Number(keyVersionRaw);
  if (!Number.isInteger(keyVersion) || !iv || !authTag || !cipherText) {
    throw new Error("Invalid encrypted secret payload.");
  }

  return { keyVersion, iv, authTag, cipherText };
}

export const encryptAccessToken = encryptSecret;
export const decryptAccessToken = decryptSecret;
export const encryptBrainKey = encryptSecret;
export const decryptBrainKey = decryptSecret;

export interface JoltProofInput {
  taskId: string;
  digest: string;
  policy: string;
  timestamp?: number;
}

export async function createJoltProofStub(input: JoltProofInput): Promise<string> {
  const payload = `${input.taskId}|${input.digest}|${input.policy}|${input.timestamp ?? Date.now()}`;
  const hash = createHash("sha256").update(payload).digest("hex");
  return `JOLT-STUB:${hash}`;
}

export async function verifyJoltProofStub(proof: string): Promise<boolean> {
  return /^JOLT-STUB:[a-f0-9]{64}$/.test(proof);
}
