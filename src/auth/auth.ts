import { createHash, randomBytes } from "node:crypto";
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { getDatabasePool } from "../database/mysql.js";
import { userContext, type SessionUser } from "./context.js";
import {
  hashPassword,
  verifyPassword,
  validPassword,
  dummyHash,
} from "./password.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const cookieName = "defac_session";
const sessionMs = 8 * 60 * 60 * 1000;
const configuredOrigin = () =>
  new URL(
    process.env.APP_ORIGIN ||
      `http://localhost:${process.env.APP_PORT || "3000"}`,
  ).origin;
const cookieOptions = () => ({
  httpOnly: true,
  secure: configuredOrigin().startsWith("https:"),
  sameSite: "strict" as const,
  path: "/",
});

export function validateAuthConfig(): void {
  if (
    process.env.NODE_ENV === "production" &&
    !configuredOrigin().startsWith("https:")
  )
    throw new Error(
      "Configure APP_ORIGIN con HTTPS antes de publicar en producción.",
    );
}

export function requestSecurity(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  response.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  if (configuredOrigin().startsWith("https:"))
    response.set("Strict-Transport-Security", "max-age=31536000");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    (request.get("origin") !== configuredOrigin() ||
      request.get("x-defac-request") !== "1")
  )
    return response
      .status(403)
      .json({
        error:
          "Solicitud no permitida. Recarga la página desde la dirección de la aplicación.",
      });
  next();
}

function tokenFrom(request: Request): string | undefined {
  const raw = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : undefined;
}
async function sessionUser(request: Request): Promise<SessionUser | undefined> {
  const token = tokenFrom(request);
  if (!token) return undefined;
  const [rows] = await getDatabasePool().execute<
    Array<RowDataPacket & SessionUser>
  >(
    "SELECT u.id,u.email,u.display_name AS name FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() LIMIT 1",
    [hash(token)],
  );
  return rows[0]
    ? { id: rows[0].id, email: rows[0].email, name: rows[0].name }
    : undefined;
}
export async function requireAuthentication(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const user = await sessionUser(request);
  if (!user) {
    response.clearCookie(cookieName, cookieOptions());
    return request.originalUrl.startsWith("/api/")
      ? response.status(401).json({ error: "Inicia sesión para continuar." })
      : response.redirect("/login");
  }
  userContext.run(user, () => next());
}
async function revokeSession(request: Request) {
  const token = tokenFrom(request);
  if (token)
    await getDatabasePool().execute(
      "DELETE FROM auth_sessions WHERE token_hash=?",
      [hash(token)],
    );
}
async function issueSession(
  request: Request,
  response: Response,
  user: SessionUser,
) {
  await revokeSession(request);
  const token = randomBytes(32).toString("base64url");
  await getDatabasePool().execute(
    "INSERT INTO auth_sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR))",
    [hash(token), user.id],
  );
  response.cookie(cookieName, token, { ...cookieOptions(), maxAge: sessionMs });
}
async function allowedAttempt(key: string, maximum: number): Promise<boolean> {
  const bucket = hash(key);
  const pool = getDatabasePool();
  await pool.execute(
    "DELETE FROM auth_attempts WHERE expires_at<UTC_TIMESTAMP() LIMIT 100",
  );
  await pool.execute(
    "DELETE FROM auth_sessions WHERE expires_at<UTC_TIMESTAMP() LIMIT 100",
  );
  await pool.execute(
    "INSERT INTO auth_attempts (bucket_hash,attempts,expires_at) VALUES (?,1,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE)) ON DUPLICATE KEY UPDATE attempts=attempts+1",
    [bucket],
  );
  const [rows] = await pool.execute<
    Array<RowDataPacket & { attempts: number }>
  >("SELECT attempts FROM auth_attempts WHERE bucket_hash=?", [bucket]);
  return (rows[0]?.attempts ?? maximum + 1) <= maximum;
}
const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";
const validEmail = (value: string) =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const tooMany = (response: Response) =>
  response
    .set("Retry-After", "900")
    .status(429)
    .json({ error: "Demasiados intentos. Intenta nuevamente en 15 minutos." });

export const authRouter = Router();
authRouter.post("/register", async (request, response) => {
  if (process.env.AUTH_ALLOW_REGISTRATION === "false")
    return response.status(403).json({ error: "El registro está cerrado." });
  if (!(await allowedAttempt(`register:${request.ip}`, 10)))
    return tooMany(response);
  const email = normalizeEmail(request.body?.email);
  const password: unknown = request.body?.password;
  const name =
    typeof request.body?.name === "string" ? request.body.name.trim() : "";
  if (
    !validEmail(email) ||
    !validPassword(password) ||
    name.length < 2 ||
    name.length > 120
  )
    return response
      .status(400)
      .json({
        error:
          "Indica tu nombre, un correo válido y una contraseña de 12 a 128 caracteres.",
      });
  if (request.body.passwordConfirmation !== password)
    return response
      .status(400)
      .json({ error: "Las contraseñas no coinciden." });
  try {
    const [result] = await getDatabasePool().execute<ResultSetHeader>(
      "INSERT INTO auth_users (email,display_name,password_hash) VALUES (?,?,?)",
      [email, name, await hashPassword(password)],
    );
    const user = { id: result.insertId, email, name };
    await issueSession(request, response, user);
    return response.status(201).json({ user });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY")
      return response
        .status(409)
        .json({
          error:
            "No se pudo registrar esa cuenta. Si ya tienes una, inicia sesión.",
        });
    throw error;
  }
});
authRouter.post("/login", async (request, response) => {
  if (!(await allowedAttempt(`login-ip:${request.ip}`, 40)))
    return tooMany(response);
  const email = normalizeEmail(request.body?.email);
  if (!validEmail(email) || !validPassword(request.body?.password))
    return response
      .status(401)
      .json({ error: "Correo o contraseña incorrectos." });
  if (!(await allowedAttempt(`login-email:${email}`, 10)))
    return tooMany(response);
  const [rows] = await getDatabasePool().execute<
    Array<RowDataPacket & SessionUser & { passwordHash: string }>
  >(
    "SELECT id,email,display_name AS name,password_hash AS passwordHash FROM auth_users WHERE email=? LIMIT 1",
    [email],
  );
  const row = rows[0];
  const matches = await verifyPassword(
    request.body.password,
    row?.passwordHash ?? dummyHash,
  );
  if (!row || !matches)
    return response
      .status(401)
      .json({ error: "Correo o contraseña incorrectos." });
  const user = { id: row.id, email: row.email, name: row.name };
  await issueSession(request, response, user);
  await getDatabasePool().execute(
    "DELETE FROM auth_attempts WHERE bucket_hash=?",
    [hash(`login-email:${email}`)],
  );
  return response.json({ user });
});
authRouter.get("/me", requireAuthentication, (_request, response) =>
  response.json({ user: userContext.getStore() }),
);
authRouter.post("/logout", async (request, response) => {
  await revokeSession(request);
  response.clearCookie(cookieName, cookieOptions());
  response.json({ ok: true });
});
