import "dotenv/config";
import path from "node:path";

export type SriEnvironment = "test" | "production";

const DEFAULT_WSDLS: Record<SriEnvironment, string> = {
  test: "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl",
  production: "https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl",
};

const DEFAULT_VALIDITY_WSDLS: Record<SriEnvironment, string> = {
  test: "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/ConsultaComprobante?wsdl",
  production: "https://cel.sri.gob.ec/comprobantes-electronicos-ws/ConsultaComprobante?wsdl",
};

function readEnvironment(): SriEnvironment {
  const value = (process.env.SRI_ENVIRONMENT ?? "production").trim().toLowerCase();
  if (value !== "test" && value !== "production") {
    throw new Error("SRI_ENVIRONMENT debe ser 'test' o 'production'.");
  }
  return value;
}

function readTimeout(): number {
  const value = Number(process.env.SRI_REQUEST_TIMEOUT_MS ?? "30000");
  if (!Number.isInteger(value) || value < 1000) {
    throw new Error("SRI_REQUEST_TIMEOUT_MS debe ser un entero mayor o igual a 1000.");
  }
  return value;
}

function readInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? String(fallback));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} debe ser un entero entre ${minimum} y ${maximum}.`);
  }
  return value;
}

export function getSriConfig() {
  const environment = readEnvironment();
  const configuredWsdl = environment === "test"
    ? process.env.SRI_AUTHORIZATION_WSDL_TEST
    : process.env.SRI_AUTHORIZATION_WSDL_PRODUCTION;

  return {
    environment,
    wsdlUrl: configuredWsdl?.trim() || DEFAULT_WSDLS[environment],
    validityWsdlUrl: process.env.SRI_VALIDITY_WSDL?.trim() || DEFAULT_VALIDITY_WSDLS[environment],
    timeoutMs: readTimeout(),
    outputDir: path.resolve(process.env.SRI_OUTPUT_DIR?.trim() || "./output"),
    inputFile: path.resolve(process.env.SRI_INPUT_FILE?.trim() || "./ejemplo-txt-sri.txt.txt"),
    concurrency: readInteger("SRI_CONCURRENCY", 3, 1, 10),
    maxRetries: readInteger("SRI_MAX_RETRIES", 3, 0, 10),
    retryDelayMs: readInteger("SRI_RETRY_DELAY_MS", 1000, 100, 60_000),
  } as const;
}
