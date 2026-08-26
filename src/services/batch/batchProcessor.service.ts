import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import type { Client } from "soap";
import type { BatchItemResult, BatchLog, BatchStatus, BatchSummary } from "../../models/batchProcess.js";
import type { ImportedInvoiceRow } from "../../models/importedInvoice.js";
import { parseInvoiceXml } from "../../parsers/xml/factura.parser.js";
import { queryAuthorization } from "../../sri/sriAuthorization.service.js";
import { queryValidity } from "../../sri/sriValidity.service.js";
import { withRetry } from "../../utils/retry.js";
import { identificationsMatch } from "../../utils/identification.js";
import { validateInvoiceOwnership, type InvoiceMovement } from "../validation/invoiceOwnership.service.js";

export interface BatchProcessorOptions {
  authorizationClient: Client;
  validityClient: Client;
  outputDir: string;
  concurrency: number;
  maxRetries: number;
  retryDelayMs: number;
  environment: "test" | "production";
  inputFile: string;
  companyTaxId?: string;
  movement?: InvoiceMovement;
}

export async function processBatch(
  rows: ImportedInvoiceRow[],
  options: BatchProcessorOptions,
): Promise<BatchLog> {
  const startedAt = new Date().toISOString();
  const xmlDir = path.join(options.outputDir, "xml");
  const soapDir = path.join(options.outputDir, "soap");
  await Promise.all([mkdir(xmlDir, { recursive: true }), mkdir(soapDir, { recursive: true })]);
  const limit = pLimit(options.concurrency);
  let completed = 0;

  const results = await Promise.all(rows.map((row) => limit(async () => {
    const result = await processOne(row, options, xmlDir, soapDir);
    completed += 1;
    console.log(`[INFO] ${completed}/${rows.length} ${row.documentNumber}: ${result.status}${result.message ? ` - ${result.message}` : ""}`);
    return result;
  })));

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    environment: options.environment,
    inputFile: options.inputFile,
    summary: summarize(results),
    results,
  };
}

async function processOne(
  row: ImportedInvoiceRow,
  options: BatchProcessorOptions,
  xmlDir: string,
  soapDir: string,
): Promise<BatchItemResult> {
  const base = {
    accessKey: row.accessKey,
    documentNumber: row.documentNumber,
    issuerBusinessName: row.issuerBusinessName,
    processedAt: new Date().toISOString(),
  };
  if (row.validationError) return { ...base, status: "ERROR", message: row.validationError };
  const xmlPath = path.join(xmlDir, `${row.accessKey}.xml`);
  if (await exists(xmlPath)) {
    try {
      const { readFile } = await import("node:fs/promises");
      const invoice = parseInvoiceXml(await readFile(xmlPath, "utf8"));
      if (invoice.accessKey !== row.accessKey) throw new Error("La clave interna no coincide.");
      if (!identificationsMatch(invoice.recipientIdentification, row.recipientIdentification)) throw new Error("El receptor del XML no coincide con el receptor del TXT.");
      if (options.companyTaxId && options.movement) validateInvoiceOwnership(invoice, options.companyTaxId, options.movement);
      return { ...base, status: "YA_DESCARGADO", xmlPath };
    } catch (error) {
      return { ...base, status: "ERROR", xmlPath, message: `XML existente invalido: ${errorMessage(error)}` };
    }
  }

  try {
    const authorization = await withRetry(
      () => queryAuthorization(options.authorizationClient, row.accessKey),
      options.maxRetries,
      options.retryDelayMs,
      (attempt) => console.warn(`[WARN] Reintento ${attempt} para ${row.documentNumber}`),
    );
    await writeFile(path.join(soapDir, `${row.accessKey}.authorization.xml`), authorization.rawResponse, "utf8");
    const authorized = authorization.authorizations.find((item) => item.estado?.trim().toUpperCase() === "AUTORIZADO");
    if (authorized?.comprobante) {
      const parsed = parseInvoiceXml(authorized.comprobante);
      if (parsed.accessKey !== row.accessKey) throw new Error("La clave del XML descargado no coincide con la consultada.");
      if (!identificationsMatch(parsed.recipientIdentification, row.recipientIdentification)) throw new Error("El receptor del XML no coincide con la empresa seleccionada.");
      if (options.companyTaxId && options.movement) validateInvoiceOwnership(parsed, options.companyTaxId, options.movement);
      await writeFile(xmlPath, authorized.comprobante, { encoding: "utf8", flag: "wx" });
      return {
        ...base,
        status: "DESCARGADO",
        ...(authorized.numeroAutorizacion ? { authorizationNumber: authorized.numeroAutorizacion } : {}),
        ...(authorized.fechaAutorizacion ? { authorizationDate: String(authorized.fechaAutorizacion) } : {}),
        xmlPath,
      };
    }
    if (authorization.authorizations.length > 0) {
      const last = authorization.authorizations.at(-1);
      return { ...base, status: "NO_AUTORIZADO", message: messageFromAuthorization(last) };
    }
    return await classifyWithValidity(row, options, soapDir, base);
  } catch (error) {
    return { ...base, status: "ERROR", message: errorMessage(error) };
  }
}

async function classifyWithValidity(
  row: ImportedInvoiceRow,
  options: BatchProcessorOptions,
  soapDir: string,
  base: Omit<BatchItemResult, "status">,
): Promise<BatchItemResult> {
  const validity = await withRetry(
    () => queryValidity(options.validityClient, row.accessKey),
    options.maxRetries,
    options.retryDelayMs,
  );
  await writeFile(path.join(soapDir, `${row.accessKey}.validity.xml`), validity.rawResponse, "utf8");
  const message = validity.messages.map((item) => item.informacionAdicional || item.mensaje).filter(Boolean).join(" | ");
  if (/fuera del rango/i.test(message)) return { ...base, status: "FUERA_DE_RANGO", message };
  if (/no existen datos/i.test(message)) return { ...base, status: "NO_ENCONTRADO", message };
  const state = validity.authorizationStatus?.toUpperCase();
  if (state === "NO AUTORIZADO") return { ...base, status: "NO_AUTORIZADO", message: state };
  if (state === "AUTORIZADO") {
    return { ...base, status: "PENDIENTE", message: "El SRI confirma AUTORIZADO, pero el servicio no entrego el XML." };
  }
  return { ...base, status: "PENDIENTE", message: message || validity.queryStatus || "Sin respuesta concluyente." };
}

function summarize(results: BatchItemResult[]): BatchSummary {
  const count = (status: BatchStatus) => results.filter((item) => item.status === status).length;
  return {
    total: results.length,
    downloaded: count("DESCARGADO"),
    existing: count("YA_DESCARGADO"),
    manual: count("XML_CARGADO_MANUAL"),
    outsideRange: count("FUERA_DE_RANGO"),
    notFound: count("NO_ENCONTRADO"),
    notAuthorized: count("NO_AUTORIZADO"),
    pending: count("PENDIENTE"),
    errors: count("ERROR"),
  };
}

async function exists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

function messageFromAuthorization(value: { estado?: string; mensajes?: { mensaje?: unknown } } | undefined): string {
  return value?.estado ?? "El SRI devolvio una autorizacion sin estado.";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
