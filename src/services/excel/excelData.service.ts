import { readFile } from "node:fs/promises";
import type { BatchItemResult } from "../../models/batchProcess.js";
import type { NormalizedInvoice } from "../../models/invoice.js";
import { parseInvoiceXml } from "../../parsers/xml/factura.parser.js";

export interface ExcelExportData {
  metadata: {
    businessName: string;
    ruc: string;
    year: string;
    month: string;
    reportLabel?: string;
  };
  invoices: Array<{
    invoice: NormalizedInvoice;
    process: BatchItemResult;
    movementType?: "PURCHASE" | "SALE";
  }>;
}

export async function collectExcelData(
  results: BatchItemResult[],
  metadata: ExcelExportData["metadata"],
): Promise<ExcelExportData> {
  const invoices: ExcelExportData["invoices"] = [];
  for (const process of results.filter((item) => item.xmlPath)) {
    if (!process.xmlPath) continue;
    const contents = await readFile(process.xmlPath, "utf8");
    const invoice = process.xmlPath.toLowerCase().endsWith(".json")
      ? (JSON.parse(contents) as NormalizedInvoice)
      : parseInvoiceXml(contents);
    if (invoice.accessKey !== process.accessKey)
      throw new Error(
        `La clave interna no coincide en ${process.documentNumber}.`,
      );
    invoices.push({ invoice, process });
  }
  if (!invoices.length)
    throw new Error("No hay XML validados para generar el Excel.");
  return { metadata, invoices };
}
