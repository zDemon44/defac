import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseInvoiceXml } from "./factura.parser.js";

const sample = readFileSync(path.resolve("Factura con base 5%.xml"), "utf8");

describe("parseInvoiceXml", () => {
  it("extrae las bases 5% y 15% desde un XML autorizado", () => {
    const invoice = parseInvoiceXml(sample);
    expect(invoice.ruc).toBe("0927334672001");
    expect(invoice.documentNumber).toBe("001-001-000000018");
    expect(invoice.vat.base5).toBe(4.66);
    expect(invoice.vat.vat5).toBe(0.23);
    expect(invoice.vat.base15).toBe(0.13);
    expect(invoice.vat.vat15).toBe(0.02);
    expect(invoice.subtotal).toBe(4.79);
    expect(invoice.vatTotal).toBe(0.25);
    expect(invoice.tip).toBe(0);
    expect(invoice.total).toBe(5.04);
  });

  it("extrae los cuatro detalles", () => {
    const invoice = parseInvoiceXml(sample);
    expect(invoice.details).toHaveLength(4);
    expect(invoice.paymentMethods).toEqual(["01"]);
  });
});
