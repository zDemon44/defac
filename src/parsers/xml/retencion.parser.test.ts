import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWithholdingXml } from "./retencion.parser.js";
describe("parseWithholdingXml", () => {
  it("lee retención 2.0 vinculada a factura", () => {
    const item = parseWithholdingXml(
      readFileSync("Retencion normal.xml", "utf8"),
    );
    expect(item.documents[0]?.supportDocumentNumber).toBe("001-002-000000578");
    expect(item.documents[0]?.lines).toHaveLength(2);
    expect(item.incomeTaxWithheld).toBe(1.78);
    expect(item.vatWithheld).toBe(4.01);
  });
  it("conserva más de dos líneas en formato 1.0", () => {
    const item = parseWithholdingXml(
      readFileSync("Retencion que trae mas de 2 retenciones.xml", "utf8"),
    );
    expect(item.documents[0]?.supportDocumentNumber).toBe("001-002-000000589");
    expect(item.documents[0]?.lines).toHaveLength(4);
    expect(item.incomeTaxWithheld).toBe(6.21);
    expect(item.vatWithheld).toBe(19.05);
  });
  it("rechaza retenciones cuyo sustento no es una factura", () => {
    const xml = readFileSync("Retencion normal.xml", "utf8").replace(
      "<codDocSustento>01</codDocSustento>",
      "<codDocSustento>03</codDocSustento>",
    );
    expect(() => parseWithholdingXml(xml)).toThrow(
      "no está vinculada a una factura",
    );
  });
});
