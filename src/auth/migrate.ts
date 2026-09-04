import { readFile } from "node:fs/promises";
import { getDatabasePool, closeDatabasePool } from "../database/mysql.js";

async function main() {
  try {
    const sql = await readFile("database/auth-nuevas-tablas.sql", "utf8");
    for (const statement of sql
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean))
      await getDatabasePool().query(statement);
    console.log(
      "[INFO] Tablas de acceso creadas. Las empresas y facturas existentes no se modificaron.",
    );
  } catch {
    console.error(
      "[ERROR] No se pudo preparar el acceso. Comprueba MySQL y la configuración DB_*.",
    );
    process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}
void main();
