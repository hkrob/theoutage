/**
 * Password hashing (PBKDF2 via Web Crypto), random token generation,
 * and HMAC cookie signing. All built on native `crypto.subtle` — no
 * external dependency, per spec §5 open questions.
 *
 * CPU-budget note (measured, not estimated): Workers Free plan caps CPU
 * time at 10ms/request — network/D1 I/O is free, but PBKDF2 is pure CPU
 * and V8-benchmarked numbers here run ~0.43ms per 1,000 iterations
 * (10k ~8.6ms, 50k ~24ms, 100k ~43ms — Workers' isolate may differ from
 * this sandbox, but same order of magnitude). Even OWASP's *old* 100k
 * floor for PBKDF2-SHA256 likely blows the Free plan's entire CPU budget
 * on its own, before the rest of the request runs, and would trip Cloudflare
 * error 1102. Current default (see wrangler.toml PBKDF2_ITERATIONS) is
 * intentionally below OWASP's 600k recommendation as a result — this is a
 * real security/cost tradeoff, not a rounding error. Only routes that hash
 * or verify a password (login, set-password, reset-confirm) pay this cost;
 * magic-link auth (the default path) never touches this code.
 * To raise iterations safely: move this Worker to Workers Paid ($5/mo,
 * 30s CPU/request by default, configurable up to 5min via `[limits]
 * cpu_ms` in wrangler.toml) and bump PBKDF2_ITERATIONS — no code change.
 */

const PBKDF2_HASH = "SHA-256";
const SALT_BYTES = 16;
const KEY_LENGTH_BITS = 256;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: PBKDF2_HASH },
    keyMaterial,
    KEY_LENGTH_BITS
  );
}

export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

  const iterations = parseInt(parts[1], 10);
  const salt = fromHex(parts[2]);
  const expected = fromHex(parts[3]);
  if (!iterations || salt.length === 0 || expected.length === 0) return false;

  const actual = new Uint8Array(await pbkdf2(password, salt, iterations));
  return constantTimeEqual(actual, expected);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hmacSign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64url(new Uint8Array(sig));
}

export async function hmacVerify(value: string, signature: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(value, secret);
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(signature);
  return constantTimeEqual(a, b);
}
