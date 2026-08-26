import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  issuerTaxIdFromAccessKey,
  parsePointDocExcel,
} from "./pointDocExcel.service.js";

const key = "0408202601092433981500120010110000001334084897914";
const sampleExists = existsSync("Punto Doc Excel de ejemplo.xlsx");

describe("Punto Doc", () => {
  it("extrae el RUC emisor de la clave de acceso", () => {
    expect(issuerTaxIdFromAccessKey(key)).toBe("0924339815001");
  });

  it.skipIf(!sampleExists)(
    "lee el Excel de ejemplo y valida la empresa",
    async () => {
      const buffer = await readFile("Punto Doc Excel de ejemplo.xlsx");
      const rows = await parsePointDocExcel(buffer, "0924339815001");
      expect(rows).toHaveLength(7);
      expect(rows[0]?.accessKey).toBe(key);
      expect(rows[0]?.recipientIdentification).toBe("0993238317001");
    },
  );

  it.skipIf(!sampleExists)("rechaza el Excel de otra empresa", async () => {
    const buffer = await readFile("Punto Doc Excel de ejemplo.xlsx");
    await expect(parsePointDocExcel(buffer, "0912852332001")).rejects.toThrow(
      "no coincide",
    );
  });
});
