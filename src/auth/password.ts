import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import pLimit from "p-limit";

const limit = pLimit(1);
const derive = (password: string, salt: string) =>
  limit(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scrypt(
          password,
          salt,
          64,
          { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 },
          (error, key) => (error ? reject(error) : resolve(key)),
        );
      }),
  );

export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `scrypt$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [algorithm, salt, digest] = stored.split("$");
  if (
    algorithm !== "scrypt" ||
    !salt ||
    !digest ||
    !/^[a-f0-9]{128}$/.test(digest)
  )
    return false;
  return timingSafeEqual(
    await derive(password, salt),
    Buffer.from(digest, "hex"),
  );
}
// Missing accounts incur the same password derivation work without storing a real password.
export const dummyHash = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;
