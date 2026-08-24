import "dotenv/config";
import path from "node:path";

export type SriEnvironment = "test" | "production";

const DEFAULT_WSDLS: Record<SriEnvironment, string> = {
  test: "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl",
  production: "https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl",
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

export function getSriConfig() {
  const environment = readEnvironment();
  const configuredWsdl = environment === "test"
    ? process.env.SRI_AUTHORIZATION_WSDL_TEST
    : process.env.SRI_AUTHORIZATION_WSDL_PRODUCTION;

  return {
    environment,
    wsdlUrl: configuredWsdl?.trim() || DEFAULT_WSDLS[environment],
    timeoutMs: readTimeout(),
    outputDir: path.resolve(process.env.SRI_OUTPUT_DIR?.trim() || "./output"),
  } as const;
}
