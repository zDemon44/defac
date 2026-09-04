import type { RowDataPacket } from "mysql2/promise";
import { getDatabasePool, closeDatabasePool } from "../database/mysql.js";

// Local administrative action only. Never exposed as an HTTP endpoint.
const [email, idText] = process.argv.slice(2);
const companyId = Number(idText);
async function main() {
  try {
    if (!email || !Number.isSafeInteger(companyId) || companyId < 1)
      throw new Error(
        "Uso: npm run auth:grant -- correo@ejemplo.com ID_EMPRESA",
      );
    const [users] = await getDatabasePool().execute<
      Array<RowDataPacket & { id: number }>
    >("SELECT id FROM auth_users WHERE email=?", [email.trim().toLowerCase()]);
    const [companies] = await getDatabasePool().execute<RowDataPacket[]>(
      "SELECT id FROM companies WHERE id=?",
      [companyId],
    );
    if (!users[0] || !companies[0])
      throw new Error("La cuenta o empresa indicada no existe.");
    await getDatabasePool().execute(
      "INSERT IGNORE INTO auth_company_members (company_id,user_id) VALUES (?,?)",
      [companyId, users[0].id],
    );
    console.log(`[INFO] Acceso concedido a la empresa ${companyId}.`);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "No se pudo conceder acceso.",
    );
    process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}
void main();
