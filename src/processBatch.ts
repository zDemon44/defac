import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSriConfig } from "./config/sri.config.js";
import { processBatch } from "./services/batch/batchProcessor.service.js";
import { importSriTxt } from "./services/imports/txtImport.service.js";
import { createSriAuthorizationClient } from "./sri/sriSoapClient.js";

async function main(): Promise<void> {
  const config = getSriConfig();
  console.log(`[INFO] Importando ${config.inputFile}`);
  const imported = importSriTxt(await readFile(config.inputFile, "utf8"));
  console.log(`[INFO] ${imported.rows.length} filas; concurrencia ${config.concurrency}; reintentos ${config.maxRetries}.`);
  const [authorizationClient, validityClient] = await Promise.all([
    createSriAuthorizationClient(config.wsdlUrl, config.timeoutMs),
    createSriAuthorizationClient(config.validityWsdlUrl, config.timeoutMs),
  ]);
  const log = await processBatch(imported.rows, {
    authorizationClient,
    validityClient,
    outputDir: config.outputDir,
    concurrency: config.concurrency,
    maxRetries: config.maxRetries,
    retryDelayMs: config.retryDelayMs,
    environment: config.environment,
    inputFile: config.inputFile,
  });
  await mkdir(config.outputDir, { recursive: true });
  const logPath = path.join(config.outputDir, `lote-${Date.now()}.json`);
  await writeFile(logPath, JSON.stringify(log, null, 2), "utf8");
  console.log("[INFO] Resumen:", log.summary);
  console.log(`[INFO] Log guardado: ${logPath}`);
}

main().catch((error: unknown) => {
  console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
