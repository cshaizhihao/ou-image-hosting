import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validatePassword(value: string) {
  const issues: string[] = [];
  if (value.length < 12) issues.push("密码至少需要 12 个字符");
  if (!/[a-z]/.test(value)) issues.push("密码需要包含小写字母");
  if (!/[A-Z]/.test(value)) issues.push("密码需要包含大写字母");
  if (!/\d/.test(value)) issues.push("密码需要包含数字");
  if (!/[^A-Za-z0-9]/.test(value)) issues.push("密码需要包含特殊字符");
  return issues;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;

  const salt = Buffer.from(saltValue, "base64url");
  const expected = Buffer.from(hashValue, "base64url");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}
