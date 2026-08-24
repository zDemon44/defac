import type { ImportedInvoiceRow, TxtImportResult } from "../../models/importedInvoice.js";
import { validateAccessKey } from "../../utils/accessKey.js";
import { parseDecimal } from "../../utils/numbers.js";

const REQUIRED_HEADERS = [
  "RUC_EMISOR",
  "RAZON_SOCIAL_EMISOR",
  "TIPO_COMPROBANTE",
  "SERIE_COMPROBANTE",
  "CLAVE_ACCESO",
  "FECHA_AUTORIZACION",
  "FECHA_EMISION",
  "IDENTIFICACION_RECEPTOR",
  "VALOR_SIN_IMPUESTOS",
  "IVA",
  "IMPORTE_TOTAL",
] as const;

export function importSriTxt(content: string): TxtImportResult {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new Error("El archivo TXT esta vacio.");

  const delimiter = lines[0]?.includes("\t") ? "\t" : ";";
  const headers = (lines[0] ?? "").split(delimiter).map((header) => header.trim().toUpperCase());
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new Error(`Faltan columnas requeridas: ${missing.join(", ")}`);
  }

  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const get = (cells: string[], header: string): string => cells[index[header] ?? -1]?.trim() ?? "";
  const rows: ImportedInvoiceRow[] = [];
  const errors: string[] = [];

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const cells = (lines[lineIndex] ?? "").split(delimiter);
    const accessKey = get(cells, "CLAVE_ACCESO");
    let validationError: string | undefined;
    try {
      validateAccessKey(accessKey);
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error);
      errors.push(`Fila ${lineIndex + 1}: ${validationError}`);
    }

    const row: ImportedInvoiceRow = {
      rowNumber: lineIndex + 1,
      issuerRuc: get(cells, "RUC_EMISOR"),
      issuerBusinessName: get(cells, "RAZON_SOCIAL_EMISOR"),
      documentType: get(cells, "TIPO_COMPROBANTE"),
      documentNumber: get(cells, "SERIE_COMPROBANTE"),
      accessKey,
      authorizationDate: get(cells, "FECHA_AUTORIZACION"),
      issueDate: get(cells, "FECHA_EMISION"),
      recipientIdentification: get(cells, "IDENTIFICACION_RECEPTOR"),
      reportedSubtotal: parseDecimal(get(cells, "VALOR_SIN_IMPUESTOS"), "VALOR_SIN_IMPUESTOS"),
      reportedVat: parseDecimal(get(cells, "IVA"), "IVA"),
      reportedTotal: parseDecimal(get(cells, "IMPORTE_TOTAL"), "IMPORTE_TOTAL"),
      modifiedDocumentNumber: get(cells, "NUMERO_DOCUMENTO_MODIFICADO"),
      ...(validationError ? { validationError } : {}),
    };
    rows.push(row);
  }

  return { rows, errors };
}
