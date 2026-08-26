import type { NormalizedInvoice } from "../../models/invoice.js";
import { identificationsMatch } from "../../utils/identification.js";

export type InvoiceMovement = "PURCHASE" | "SALE";

export function validateInvoiceOwnership(invoice: NormalizedInvoice, companyTaxId: string, movement: InvoiceMovement): void {
  const xmlIdentification = movement === "SALE" ? invoice.ruc : invoice.recipientIdentification;
  if (identificationsMatch(xmlIdentification, companyTaxId)) return;
  const role = movement === "SALE" ? "RUC emisor" : "identificación del receptor";
  throw new Error(`El ${role} del XML (${xmlIdentification}) no coincide con la empresa activa (${companyTaxId}).`);
}
