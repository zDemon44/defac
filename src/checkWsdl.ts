import { getSriConfig } from "./config/sri.config.js";
import { createSriAuthorizationClient } from "./sri/sriSoapClient.js";

async function main(): Promise<void> {
  const config = getSriConfig();
  console.log(`[INFO] Verificando WSDL (${config.environment})`);
  console.log(`[INFO] ${config.wsdlUrl}`);
  const client = await createSriAuthorizationClient(config.wsdlUrl, config.timeoutMs);
  const description = client.describe() as Record<string, unknown>;
  console.log("[INFO] Servicio SOAP disponible.");
  console.dir(description, { depth: 5, colors: true });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ERROR] ${message}`);
  process.exitCode = 1;
});
