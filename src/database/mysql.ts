import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { getDatabaseConfig } from "../config/database.config.js";

let pool: Pool | undefined;

export function getDatabasePool(): Pool {
  if (!pool) {
    const config = getDatabaseConfig();
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: config.connectionLimit,
      queueLimit: 0,
      charset: "utf8mb4",
      timezone: "-05:00",
      decimalNumbers: true,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return pool;
}

interface DatabaseInfoRow extends RowDataPacket {
  databaseName: string;
  version: string;
  currentTime: Date;
}

export async function testDatabaseConnection() {
  const [rows] = await getDatabasePool().query<DatabaseInfoRow[]>(
    "SELECT DATABASE() AS databaseName, VERSION() AS version, NOW() AS currentTime",
  );
  const info = rows[0];
  if (!info) throw new Error("MySQL no devolvio informacion de conexion.");
  return info;
}

export async function closeDatabasePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
