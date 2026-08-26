import ExcelJS from "exceljs";
import type { PointDocSaleRow } from "../../models/pointDoc.js";
import { validateAccessKey } from "../../utils/accessKey.js";
import { identificationsMatch } from "../../utils/identification.js";

const REQUIRED = [
  "Fecha Emisión",
  "Número Documento",
  "Identificación",
  "Cliente",
  "Subtotal 5%",
  "Subtotal 12%",
  "Subtotal 13%",
  "Subtotal 15%",
  "Subtotal 0%",
  "Subtotal No Obj. de IVA",
  "Subtotal Exento de IVA",
  "Subtotal ICE",
  "Subtotal",
  "Valor 5%",
  "Valor 12%",
  "Valor 13%",
  "Valor 15%",
  "Valor ICE",
  "Valor Total",
  "Clave Acceso",
  "Fecha Autorización",
];
export function issuerTaxIdFromAccessKey(accessKey: string): string {
  validateAccessKey(accessKey);
  return accessKey.slice(10, 23);
}
function identification(cell: ExcelJS.Cell, rowNumber: number): string {
  if (typeof cell.value === "number") return Math.trunc(cell.value).toFixed(0);
  const value = String(cell.text ?? "")
    .trim()
    .replace(/\.0$/, "");
  if (/e\+/i.test(value))
    throw new Error(
      `Fila ${rowNumber}: la identificación perdió precisión; guárdela como texto.`,
    );
  return value.replace(/\D/g, "");
}
export async function parsePointDocExcel(
  buffer: Buffer,
  companyTaxId: string,
): Promise<PointDocSaleRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet("Emitidos") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("El Excel no contiene hojas.");
  const headers = new Map<string, number>();
  sheet
    .getRow(1)
    .eachCell((cell, column) => headers.set(String(cell.text).trim(), column));
  const missing = REQUIRED.filter((h) => !headers.has(h));
  if (missing.length)
    throw new Error(`El Excel de Punto Doc no contiene: ${missing.join(", ")}`);
  const rows: PointDocSaleRow[] = [];
  for (let number = 2; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number);
    if (!row.hasValues) continue;
    const text = (name: string) =>
      String(row.getCell(headers.get(name)!).text ?? "").trim();
    const money = (name: string) => {
      const cell = row.getCell(headers.get(name)!);
      const value =
        typeof cell.value === "number"
          ? cell.value
          : Number(String(cell.text).replace(/,/g, ""));
      if (!Number.isFinite(value))
        throw new Error(`Fila ${number}: ${name} no es numérico.`);
      return value;
    };
    const accessKey = text("Clave Acceso").replace(/\D/g, "");
    const issuer = issuerTaxIdFromAccessKey(accessKey);
    if (!identificationsMatch(issuer, companyTaxId))
      throw new Error(
        `Fila ${number}: el RUC emisor de la clave (${issuer}) no coincide con la empresa activa (${companyTaxId}).`,
      );
    rows.push({
      rowNumber: number,
      issueDate: text("Fecha Emisión"),
      documentNumber: text("Número Documento"),
      recipientIdentification: identification(
        row.getCell(headers.get("Identificación")!),
        number,
      ),
      recipientBusinessName: text("Cliente"),
      accessKey,
      authorizationDate: text("Fecha Autorización"),
      subtotal5: money("Subtotal 5%"),
      subtotal12: money("Subtotal 12%"),
      subtotal13: money("Subtotal 13%"),
      subtotal15: money("Subtotal 15%"),
      subtotal0: money("Subtotal 0%"),
      subtotalNotTaxable: money("Subtotal No Obj. de IVA"),
      subtotalExempt: money("Subtotal Exento de IVA"),
      subtotalIce: money("Subtotal ICE"),
      subtotal: money("Subtotal"),
      vat5: money("Valor 5%"),
      vat12: money("Valor 12%"),
      vat13: money("Valor 13%"),
      vat15: money("Valor 15%"),
      ice: money("Valor ICE"),
      total: money("Valor Total"),
    });
  }
  if (!rows.length)
    throw new Error("El Excel de Punto Doc no contiene ventas.");
  return rows;
}
