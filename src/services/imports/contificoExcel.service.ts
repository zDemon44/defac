import * as XLSX from "xlsx";
import type { PointDocSaleRow } from "../../models/pointDoc.js";
import { identificationsMatch } from "../../utils/identification.js";
import { issuerTaxIdFromAccessKey } from "./pointDocExcel.service.js";

const REQUIRED = [
  "Fecha",
  "Tipo Documento",
  "# Documento",
  "Autorización",
  "Persona",
  "Identificación",
  "Subtotal IVA mayor a 0%",
  "Subtotal IVA 0%",
  "IVA",
  "Total",
];
const number = (value: unknown, row: number, header: string) => {
  const result = Number(
    String(value ?? "0")
      .replace(/,/g, "")
      .trim(),
  );
  if (!Number.isFinite(result))
    throw new Error(`Fila ${row}: ${header} no es numérico.`);
  return result;
};
function date(value: unknown, row: number): string {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) throw new Error(`Fila ${row}: fecha inválida (${text}).`);
  const year = match[3]!.length === 2 ? `20${match[3]}` : match[3]!;
  return `${match[1]!.padStart(2, "0")}/${match[2]!.padStart(2, "0")}/${year}`;
}

export function parseContificoExcel(
  buffer: Buffer,
  companyTaxId: string,
): PointDocSaleRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("El Excel de Contífico no contiene hojas.");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("No se pudo leer la hoja de Contífico.");
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  const headerIndex = matrix.findIndex((row) =>
    REQUIRED.every((header) => row.map(String).includes(header)),
  );
  if (headerIndex < 0)
    throw new Error(
      `El Excel de Contífico no contiene: ${REQUIRED.join(", ")}.`,
    );
  const headers = new Map(
    matrix[headerIndex]!.map((value, index) => [String(value).trim(), index]),
  );
  const get = (row: unknown[], name: string) => row[headers.get(name)!];
  const rows: PointDocSaleRow[] = [];
  for (let index = headerIndex + 1; index < matrix.length; index++) {
    const source = matrix[index]!;
    const authorization = String(get(source, "Autorización") ?? "").replace(
      /\D/g,
      "",
    );
    if (!authorization) continue;
    if (
      String(get(source, "Tipo Documento")).trim().toLowerCase() !== "factura"
    )
      continue;
    const issuer = issuerTaxIdFromAccessKey(authorization);
    if (!identificationsMatch(issuer, companyTaxId))
      throw new Error(
        `Fila ${index + 1}: el RUC emisor de la autorización (${issuer}) no coincide con la empresa activa (${companyTaxId}).`,
      );
    const taxable = number(
      get(source, "Subtotal IVA mayor a 0%"),
      index + 1,
      "Subtotal IVA mayor a 0%",
    );
    const base0 = number(
      get(source, "Subtotal IVA 0%"),
      index + 1,
      "Subtotal IVA 0%",
    );
    const vat = number(get(source, "IVA"), index + 1, "IVA");
    const rate = taxable ? Math.round((vat / taxable) * 100) : 0;
    if (taxable && ![5, 12, 13, 15].includes(rate))
      throw new Error(
        `Fila ${index + 1}: tarifa de IVA no reconocida (${rate}%).`,
      );
    const ice = number(get(source, "ICE"), index + 1, "ICE");
    rows.push({
      rowNumber: index + 1,
      issueDate: date(get(source, "Fecha"), index + 1),
      documentNumber: String(get(source, "# Documento")).trim(),
      recipientIdentification: String(get(source, "Identificación"))
        .replace(/\.0$/, "")
        .replace(/\D/g, ""),
      recipientBusinessName: String(get(source, "Persona")).trim(),
      accessKey: authorization,
      authorizationDate: date(get(source, "Fecha"), index + 1),
      subtotal5: rate === 5 ? taxable : 0,
      subtotal12: rate === 12 ? taxable : 0,
      subtotal13: rate === 13 ? taxable : 0,
      subtotal15: rate === 15 ? taxable : 0,
      subtotal0: base0,
      subtotalNotTaxable: 0,
      subtotalExempt: 0,
      subtotalIce: ice,
      subtotal: taxable + base0,
      vat5: rate === 5 ? vat : 0,
      vat12: rate === 12 ? vat : 0,
      vat13: rate === 13 ? vat : 0,
      vat15: rate === 15 ? vat : 0,
      ice,
      total: number(get(source, "Total"), index + 1, "Total"),
      description: String(get(source, "Descripción") ?? "").trim(),
    });
  }
  if (!rows.length)
    throw new Error("El Excel de Contífico no contiene facturas.");
  return rows;
}
