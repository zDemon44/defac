import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseContificoExcel } from "./contificoExcel.service.js";

describe.skipIf(!existsSync("excel de contifico ejemplo.xls"))(
  "Excel de Contífico",
  () => {
    it("lee las facturas y sus bases", async () => {
      const rows = parseContificoExcel(
        await readFile("excel de contifico ejemplo.xls"),
        "0993080179001",
      );
      expect(rows).toHaveLength(18);
      expect(rows[0]).toMatchObject({
        accessKey: "2408202601099308017900120010020000002348533475112",
        documentNumber: "001-002-000000234",
        recipientIdentification: "0993382595001",
        subtotal15: 16.05,
        vat15: 2.41,
        total: 18.46,
      });
    });

    it("rechaza un archivo perteneciente a otra empresa", async () => {
      const buffer = await readFile("excel de contifico ejemplo.xls");
      expect(() => parseContificoExcel(buffer, "0912852332001")).toThrow(
        "no coincide",
      );
    });
  },
);
