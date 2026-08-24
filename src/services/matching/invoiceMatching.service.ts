import type { ImportedInvoiceRow } from "../../models/importedInvoice.js";
import type { NormalizedInvoice } from "../../models/invoice.js";

export interface InvoiceMatchResult {
  matched: Array<{ source: ImportedInvoiceRow; invoice: NormalizedInvoice }>;
  missingXml: ImportedInvoiceRow[];
  unlistedXml: NormalizedInvoice[];
}

export function matchInvoicesByAccessKey(
  rows: ImportedInvoiceRow[],
  invoices: NormalizedInvoice[],
): InvoiceMatchResult {
  const byKey = new Map(invoices.map((invoice) => [invoice.accessKey, invoice]));
  const sourceKeys = new Set(rows.map((row) => row.accessKey));
  const matched: InvoiceMatchResult["matched"] = [];
  const missingXml: ImportedInvoiceRow[] = [];

  for (const row of rows) {
    const invoice = byKey.get(row.accessKey);
    if (invoice) matched.push({ source: row, invoice });
    else missingXml.push(row);
  }
  return {
    matched,
    missingXml,
    unlistedXml: invoices.filter((invoice) => !sourceKeys.has(invoice.accessKey)),
  };
}
