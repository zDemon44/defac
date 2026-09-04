import { randomBytes, randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { RowDataPacket } from "mysql2/promise";
import { app } from "../server.js";
import { getDatabasePool, closeDatabasePool } from "../database/mysql.js";
import { userContext } from "./context.js";
import { loadNormalizedInvoicesByAccessKeys } from "../database/invoice.repository.js";

// Opt-in: uses real MySQL, creates only isolated test users/company, cleans those exact IDs.
describe.skipIf(process.env.AUTH_INTEGRATION !== "true")(
  "acceso HTTP y aislamiento (MySQL)",
  () => {
    let server: Server;
    let base: string;
    let companyId: number | undefined;
    const emails = [0, 1].map(
      () => `auth-test-${randomUUID()}@example.invalid`,
    );
    const password = randomBytes(24).toString("base64url");
    const userIds: number[] = [];
    const cookies: string[] = [];
    const origin = new URL(process.env.APP_ORIGIN || "http://localhost:3000")
      .origin;
    const headers = {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Defac-Request": "1",
    };
    const post = (path: string, body: unknown, cookie = "") =>
      fetch(base + path, {
        method: "POST",
        headers: { ...headers, Cookie: cookie },
        body: JSON.stringify(body),
        redirect: "manual",
      });
    beforeAll(async () => {
      server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Sin puerto de pruebas");
      base = `http://127.0.0.1:${address.port}`;
    });
    afterAll(async () => {
      // Only the synthetic company and users created by this test run are removed.
      if (companyId)
        await getDatabasePool().execute(
          "DELETE FROM companies WHERE id=? AND business_name LIKE 'AUTH TEST %'",
          [companyId],
        );
      for (const email of emails) {
        await getDatabasePool().execute(
          "DELETE FROM auth_users WHERE email=?",
          [email],
        );
        await getDatabasePool().execute(
          "DELETE FROM auth_attempts WHERE bucket_hash=?",
          [createHash("sha256").update(`login-email:${email}`).digest("hex")],
        );
      }
      if (server)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      await closeDatabasePool();
    });
    it("bloquea API/reportes anónimos y solicitudes de otro origen", async () => {
      for (const path of [
        "/api/auth/me",
        "/api/companies",
        "/api/companies/1/reports",
        "/api/batches/otro/excel",
      ])
        expect((await fetch(base + path, { redirect: "manual" })).status).toBe(
          401,
        );
      expect(
        (await fetch(base + "/", { redirect: "manual" })).headers.get(
          "location",
        ),
      ).toBe("/login");
      const denied = await fetch(base + "/api/auth/register", {
        method: "POST",
        headers: { ...headers, Origin: "https://otro.example" },
        body: "{}",
      });
      expect(denied.status).toBe(403);
      const noHeader = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { Origin: origin },
        body: "{}",
      });
      expect(noHeader.status).toBe(403);
    });
    it("registra sin compartir empresas existentes y guarda solo hashes", async () => {
      for (const email of emails) {
        const response = await post("/api/auth/register", {
          email,
          name: "Usuario de pruebas",
          password,
          passwordConfirmation: password,
        });
        expect(response.status).toBe(201);
        const setCookie = response.headers.get("set-cookie")!;
        expect(setCookie).toContain("HttpOnly");
        expect(setCookie).toContain("SameSite=Strict");
        cookies.push(setCookie.split(";")[0]!);
        const { user } = await response.json();
        userIds.push(user.id);
        const result = await fetch(base + "/api/companies", {
          headers: { Cookie: cookies.at(-1)! },
        });
        expect((await result.json()).companies).toEqual([]);
        const [rows] = await getDatabasePool().execute<RowDataPacket[]>(
          "SELECT password_hash FROM auth_users WHERE id=?",
          [user.id],
        );
        expect(rows[0]!.password_hash).not.toBe(password);
        const [sessions] = await getDatabasePool().execute<RowDataPacket[]>(
          "SELECT token_hash FROM auth_sessions WHERE user_id=?",
          [user.id],
        );
        expect(sessions[0]!.token_hash).not.toBe(cookies.at(-1)!.split("=")[1]);
      }
    }, 15000);
    it("no permite duplicar la cuenta ni acceder a empresas de otra cuenta", async () => {
      expect(
        (
          await post("/api/auth/register", {
            email: emails[0],
            name: "Duplicado",
            password,
            passwordConfirmation: password,
          })
        ).status,
      ).toBe(409);
      const taxId = `99${(BigInt(`0x${randomBytes(6).toString("hex")}`) % 100000000000n).toString().padStart(11, "0")}`;
      const created = await post(
        "/api/companies",
        { taxId, businessName: `AUTH TEST ${randomUUID()}` },
        cookies[0],
      );
      expect(created.status).toBe(201);
      companyId = (await created.json()).id;
      expect(
        (
          await fetch(base + `/api/companies/${companyId}/summary`, {
            headers: { Cookie: cookies[0]! },
          })
        ).status,
      ).toBe(200);
      const encoded = [...String(companyId)]
        .map((char) => `%${char.charCodeAt(0).toString(16)}`)
        .join("");
      for (const id of [companyId, encoded]) {
        for (const suffix of [
          "summary",
          "purchases",
          "sales",
          "withholdings",
          "reports",
        ]) {
          expect(
            (
              await fetch(base + `/api/companies/${id}/${suffix}`, {
                headers: { Cookie: cookies[1]! },
              })
            ).status,
          ).toBe(404);
        }
      }
      const other = await fetch(base + "/api/companies", {
        headers: { Cookie: cookies[1]! },
      });
      expect((await other.json()).companies).toEqual([]);
      expect(
        (await post("/api/sales/direct-xml", { companyId }, cookies[1])).status,
      ).toBe(400);
      // Known invoice keys from the legacy database cannot be used to bypass report scoping.
      const [known] = await getDatabasePool().query<
        Array<RowDataPacket & { accessKey: string }>
      >("SELECT access_key AS accessKey FROM invoices LIMIT 1");
      if (known[0]) {
        const result = await userContext.run(
          { id: userIds[1]!, email: emails[1]!, name: "Test" },
          () => loadNormalizedInvoicesByAccessKeys([known[0]!.accessKey]),
        );
        expect(result.size).toBe(0);
      }
    }, 15000);
    it("rechaza contraseña incorrecta, permite ingresar y revoca al salir", async () => {
      expect(
        (
          await post("/api/auth/login", {
            email: emails[0],
            password: "contraseña incorrecta larga",
          })
        ).status,
      ).toBe(401);
      const loggedIn = await post(
        "/api/auth/login",
        { email: emails[0], password },
        cookies[0],
      );
      expect(loggedIn.status).toBe(200);
      const fresh = loggedIn.headers.get("set-cookie")!.split(";")[0]!;
      expect(fresh).not.toBe(cookies[0]);
      expect(
        (
          await fetch(base + "/api/auth/me", {
            headers: { Cookie: cookies[0]! },
          })
        ).status,
      ).toBe(401);
      expect(
        (await fetch(base + "/api/auth/me", { headers: { Cookie: fresh } }))
          .status,
      ).toBe(200);
      expect((await post("/api/auth/logout", {}, fresh)).status).toBe(200);
      expect(
        (await fetch(base + "/api/auth/me", { headers: { Cookie: fresh } }))
          .status,
      ).toBe(401);
      await getDatabasePool().execute(
        "UPDATE auth_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE user_id=?",
        [userIds[1]!],
      );
      expect(
        (
          await fetch(base + "/api/auth/me", {
            headers: { Cookie: cookies[1]! },
          })
        ).status,
      ).toBe(401);
    }, 15000);
    it("limita intentos repetidos por cuenta", async () => {
      const key = createHash("sha256")
        .update(`login-email:${emails[1]}`)
        .digest("hex");
      await getDatabasePool().execute(
        "INSERT INTO auth_attempts (bucket_hash,attempts,expires_at) VALUES (?,10,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE)) ON DUPLICATE KEY UPDATE attempts=10",
        [key],
      );
      const result = await post("/api/auth/login", {
        email: emails[1],
        password,
      });
      expect(result.status).toBe(429);
      expect(result.headers.get("retry-after")).toBe("900");
    });
  },
);
