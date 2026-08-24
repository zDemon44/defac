import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseInvoiceXml } from "./parsers/xml/factura.parser.js";
import { importSriTxt } from "./services/imports/txtImport.service.js";
import { matchInvoicesByAccessKey } from "./services/matching/invoiceMatching.service.js";

async function main(): Promise<void> {
  const txtPath = path.resolve("ejemplo-txt-sri.txt.txt");
  const xmlPath = path.resolve("Factura con base 5%.xml");
  const imported = importSriTxt(await readFile(txtPath, "utf8"));
  const invoice = parseInvoiceXml(await readFile(xmlPath, "utf8"));
  const matching = matchInvoicesByAccessKey(imported.rows, [invoice]);

  console.log(`[INFO] Filas importadas: ${imported.rows.length}`);
  console.log(`[INFO] Claves invalidas: ${imported.errors.length}`);
  console.log(`[INFO] XML: ${invoice.documentNumber} - ${invoice.businessName}`);
  console.log(`[INFO] Base 5%: ${invoice.vat.base5.toFixed(2)} | IVA 5%: ${invoice.vat.vat5.toFixed(2)}`);
  console.log(`[INFO] Base 15%: ${invoice.vat.base15.toFixed(2)} | IVA 15%: ${invoice.vat.vat15.toFixed(2)}`);
  console.log(`[INFO] Subtotal: ${invoice.subtotal.toFixed(2)} | IVA: ${invoice.vatTotal.toFixed(2)} | Total: ${invoice.total.toFixed(2)}`);
  console.log(`[INFO] Coincidencias TXT/XML: ${matching.matched.length}`);
  console.log(`[INFO] Pendientes de XML: ${matching.missingXml.length}`);
  console.log(`[INFO] XML ajenos al lote: ${matching.unlistedXml.length}`);
}

main().catch((error: unknown) => {
  console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
