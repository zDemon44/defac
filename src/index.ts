import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSriConfig } from "./config/sri.config.js";
import { createSriAuthorizationClient } from "./sri/sriSoapClient.js";
import { queryAuthorization } from "./sri/sriAuthorization.service.js";
import { validateAccessKey } from "./utils/accessKey.js";

async function main(): Promise<void> {
  const config = getSriConfig();
  const accessKey = validateAccessKey(process.env.SRI_ACCESS_KEY ?? "");

  console.log(`[INFO] Consultando una clave en ambiente ${config.environment}.`);
  const client = await createSriAuthorizationClient(config.wsdlUrl, config.timeoutMs);
  const result = await queryAuthorization(client, accessKey);

  await mkdir(config.outputDir, { recursive: true });
  const rawPath = path.join(config.outputDir, `${accessKey}.soap.xml`);
  await writeFile(rawPath, result.rawResponse, "utf8");

  console.log(`[INFO] Comprobantes encontrados: ${result.response.numeroComprobantes ?? "0"}`);
  console.log(`[INFO] Respuesta SOAP guardada: ${rawPath}`);

  if (result.authorizations.length === 0) {
    console.log("[WARN] El SRI no devolvio autorizaciones para la clave consultada.");
    return;
  }

  for (const [index, authorization] of result.authorizations.entries()) {
    const suffix = result.authorizations.length === 1 ? "" : `-${index + 1}`;
    console.log(`[INFO] Estado: ${authorization.estado ?? "SIN ESTADO"}`);
    console.log(`[INFO] Numero de autorizacion: ${authorization.numeroAutorizacion ?? "N/D"}`);
    console.log(`[INFO] Fecha: ${String(authorization.fechaAutorizacion ?? "N/D")}`);

    if (authorization.comprobante) {
      const xmlPath = path.join(config.outputDir, `${accessKey}${suffix}.xml`);
      await writeFile(xmlPath, authorization.comprobante, "utf8");
      console.log(`[INFO] XML del comprobante guardado: ${xmlPath}`);
    } else {
      console.log("[WARN] Esta autorizacion no contiene XML de comprobante.");
    }

    const messages = authorization.mensajes?.mensaje;
    for (const message of messages ? (Array.isArray(messages) ? messages : [messages]) : []) {
      console.log(
        `[${message.tipo ?? "MENSAJE"}] ${message.identificador ?? "S/C"}: ${message.mensaje ?? ""}`,
      );
      if (message.informacionAdicional) {
        console.log(`  ${message.informacionAdicional}`);
      }
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ERROR] ${message}`);
  process.exitCode = 1;
});
