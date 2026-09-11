import "server-only";

import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

const KEY_LENGTH = 64;
const PARAMS = { N: 16384, r: 8, p: 1 } as const;

/**
 * Password hashing with Node's built-in scrypt. Format:
 *   scrypt$N$r$p$<salt-base64>$<hash-base64>
 * Parameters are stored with the hash so they can be raised later without
 * invalidating existing credentials.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), derived.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, nStr, rStr, pStr, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !nStr || !rStr || !pStr || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
