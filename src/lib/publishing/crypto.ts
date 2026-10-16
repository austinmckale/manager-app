import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

export function decodeEncryptionKey(keyBase64: string) {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("MARKETING_TOKEN_ENCRYPTION_KEY must be 32 bytes of base64.");
  }
  return key;
}

export function encryptionKeyReady(value: string | undefined) {
  if (!value?.trim()) return false;
  try {
    decodeEncryptionKey(value.trim());
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string, keyBase64: string) {
  const key = decodeEncryptionKey(keyBase64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, keyBase64: string) {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error("Unable to read the saved authorization.");
  }
  const key = decodeEncryptionKey(keyBase64);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
