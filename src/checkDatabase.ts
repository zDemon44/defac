import { closeDatabasePool, testDatabaseConnection } from "./database/mysql.js";

async function main(): Promise<void> {
  try {
    const info = await testDatabaseConnection();
    console.log(`[INFO] Conexion MySQL correcta.`);
    console.log(`[INFO] Base: ${info.databaseName}`);
    console.log(`[INFO] Version: ${info.version}`);
    console.log(`[INFO] Hora del servidor: ${info.currentTime.toISOString()}`);
  } finally {
    await closeDatabasePool();
  }
}

main().catch((error: unknown) => {
  console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
