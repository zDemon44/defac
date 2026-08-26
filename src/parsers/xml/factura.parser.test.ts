import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseInvoiceXml } from "./factura.parser.js";

const samplePath = path.resolve("ejemplo xml de security data.xml");
const sample = existsSync(samplePath) ? readFileSync(samplePath, "utf8") : "";

describe.skipIf(!sample)("parseInvoiceXml", () => {
  it("extrae la base e IVA 15% desde un XML autorizado", () => {
    const invoice = parseInvoiceXml(sample);
    expect(invoice.ruc).toBe("0912852332001");
    expect(invoice.documentNumber).toBe("001-002-000000113");
    expect(invoice.vat.base15).toBe(46.96);
    expect(invoice.vat.vat15).toBe(7.04);
    expect(invoice.subtotal).toBe(46.96);
    expect(invoice.vatTotal).toBe(7.04);
    expect(invoice.tip).toBe(0);
    expect(invoice.total).toBe(54);
  });

  it("extrae el detalle y la forma de pago", () => {
    const invoice = parseInvoiceXml(sample);
    expect(invoice.details).toHaveLength(1);
    expect(invoice.paymentMethods).toEqual(["20"]);
  });
});
