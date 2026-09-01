import type { BatchItemResult } from "../../models/batchProcess.js";
import type { NormalizedInvoice } from "../../models/invoice.js";
import { loadNormalizedInvoicesByAccessKeys } from "../../database/invoice.repository.js";

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
    incomeTaxWithheld?: number;
    vatWithheld?: number;
  }>;
}

export async function collectExcelData(
  results: BatchItemResult[],
  metadata: ExcelExportData["metadata"],
): Promise<ExcelExportData> {
  const invoices: ExcelExportData["invoices"] = [];
  const stored = await loadNormalizedInvoicesByAccessKeys(
    results.map((item) => item.accessKey),
  );
  for (const process of results) {
    const invoice = stored.get(process.accessKey);
    if (invoice) invoices.push({ invoice, process });
  }
  if (!invoices.length)
    throw new Error("No hay comprobantes guardados para generar el Excel.");
  return { metadata, invoices };
}
