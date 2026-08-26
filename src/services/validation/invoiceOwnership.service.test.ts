import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseInvoiceXml } from "../../parsers/xml/factura.parser.js";
import { validateInvoiceOwnership } from "./invoiceOwnership.service.js";

const samplePath = "ejemplo xml de security data.xml";
const xml = existsSync(samplePath) ? readFileSync(samplePath, "utf8") : "";
const invoice = xml ? parseInvoiceXml(xml) : undefined;

describe.skipIf(!invoice)("validateInvoiceOwnership", () => {
  it("acepta el XML de venta cuando el RUC emisor pertenece a la empresa activa", () => {
    expect(() =>
      validateInvoiceOwnership(invoice!, "0912852332001", "SALE"),
    ).not.toThrow();
  });

  it("acepta el XML autorizado de Security Data para su emisor", () => {
    const securityXml = readFileSync(samplePath, "utf8");
    const securityInvoice = parseInvoiceXml(securityXml);
    expect(securityInvoice.ruc).toBe("0912852332001");
    expect(() =>
      validateInvoiceOwnership(securityInvoice, "0912852332001", "SALE"),
    ).not.toThrow();
  });

  it("rechaza el XML de venta de otro emisor", () => {
    expect(() =>
      validateInvoiceOwnership(invoice!, "0999999999001", "SALE"),
    ).toThrow("RUC emisor del XML (0912852332001) no coincide");
  });
});
