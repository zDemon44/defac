import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import type {
  BatchItemResult,
  BatchLog,
  BatchStatus,
} from "../models/batchProcess.js";
import type { ImportedInvoiceRow } from "../models/importedInvoice.js";
import type { NormalizedInvoice } from "../models/invoice.js";
import type { PointDocSaleRow } from "../models/pointDoc.js";
import { parseInvoiceXml } from "../parsers/xml/factura.parser.js";
import { getDatabasePool } from "./mysql.js";
import { validateInvoiceOwnership } from "../services/validation/invoiceOwnership.service.js";

export interface StoredInvoiceRow {
  id: number;
  accessKey: string;
  documentNumber: string;
  issueDate: string;
  issuerTaxId: string;
  issuerBusinessName: string;
  subtotal: number;
  vatTotal: number;
  total: number;
  xmlPath: string;
  movementType: "PURCHASE" | "SALE";
}

export async function findExistingPurchaseKeys(
  companyId: number,
  keys: string[],
): Promise<Set<string>> {
  return findExistingKeys(companyId, keys, "PURCHASE");
}
export async function findExistingSaleKeys(
  companyId: number,
  keys: string[],
): Promise<Set<string>> {
  return findExistingKeys(companyId, keys, "SALE");
}
async function findExistingKeys(
  companyId: number,
  keys: string[],
  movement: "PURCHASE" | "SALE",
): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const placeholders = keys.map(() => "?").join(",");
  const [rows] = await getDatabasePool().query<
    Array<{ accessKey: string } & import("mysql2/promise").RowDataPacket>
  >(
    `SELECT access_key AS accessKey FROM invoices WHERE company_id=? AND movement_type=? AND access_key IN (${placeholders})`,
    [companyId, movement, ...keys],
  );
  return new Set(rows.map((row) => row.accessKey));
}

export async function listStoredPurchases(
  companyId: number,
  year?: number,
  month?: number,
): Promise<StoredInvoiceRow[]> {
  const conditions = ["company_id=?", "movement_type='PURCHASE'"];
  const values: Array<number> = [companyId];
  if (year) {
    conditions.push("YEAR(issue_date)=?");
    values.push(year);
  }
  if (month) {
    conditions.push("MONTH(issue_date)=?");
    values.push(month);
  }
  const [rows] = await getDatabasePool().query<
    Array<StoredInvoiceRow & import("mysql2/promise").RowDataPacket>
  >(
    `SELECT id, access_key AS accessKey, document_number AS documentNumber, DATE_FORMAT(issue_date,'%d/%m/%Y') AS issueDate, 'PURCHASE' AS movementType,
      issuer_tax_id AS issuerTaxId, issuer_business_name AS issuerBusinessName, subtotal, vat_total AS vatTotal, total, xml_path AS xmlPath
     FROM invoices WHERE ${conditions.join(" AND ")} ORDER BY issue_date DESC, id DESC LIMIT 2000`,
    values,
  );
  return rows;
}
export async function listStoredSales(
  companyId: number,
): Promise<StoredInvoiceRow[]> {
  const [rows] = await getDatabasePool().query<
    Array<StoredInvoiceRow & import("mysql2/promise").RowDataPacket>
  >(
    `SELECT id,access_key AS accessKey,document_number AS documentNumber,DATE_FORMAT(issue_date,'%d/%m/%Y') AS issueDate,'SALE' AS movementType,recipient_id AS issuerTaxId,recipient_business_name AS issuerBusinessName,subtotal,vat_total AS vatTotal,total,xml_path AS xmlPath FROM invoices WHERE company_id=? AND movement_type='SALE' ORDER BY issue_date DESC,id DESC LIMIT 2000`,
    [companyId],
  );
  return rows;
}

export async function listStoredInvoicesForReport(
  companyId: number,
  movement: "PURCHASE" | "SALE" | "BOTH",
  from: string,
  to: string,
): Promise<StoredInvoiceRow[]> {
  const conditions = ["company_id=?", "issue_date BETWEEN ? AND ?"];
  const values: Array<number | string> = [companyId, from, to];
  if (movement !== "BOTH") {
    conditions.push("movement_type=?");
    values.push(movement);
  }
  const [rows] = await getDatabasePool().query<
    Array<StoredInvoiceRow & import("mysql2/promise").RowDataPacket>
  >(
    `SELECT id, access_key AS accessKey, document_number AS documentNumber, DATE_FORMAT(issue_date,'%d/%m/%Y') AS issueDate, movement_type AS movementType,
      issuer_tax_id AS issuerTaxId, issuer_business_name AS issuerBusinessName, subtotal, vat_total AS vatTotal, total, xml_path AS xmlPath
     FROM invoices WHERE ${conditions.join(" AND ")} ORDER BY issue_date, id LIMIT 10000`,
    values,
  );
  return rows;
}

export async function createPurchaseBatch(
  companyId: number,
  year: number,
  month: number,
  filename: string,
  rows: ImportedInvoiceRow[],
): Promise<number> {
  return createDatabaseBatch(
    companyId,
    year,
    month,
    filename,
    rows,
    "PURCHASE",
  );
}
export async function createSalesBatch(
  companyId: number,
  year: number,
  month: number,
  filename: string,
  rows: ImportedInvoiceRow[],
): Promise<number> {
  return createDatabaseBatch(companyId, year, month, filename, rows, "SALE");
}
async function createDatabaseBatch(
  companyId: number,
  year: number,
  month: number,
  filename: string,
  rows: ImportedInvoiceRow[],
  movement: "PURCHASE" | "SALE",
): Promise<number> {
  const connection = await getDatabasePool().getConnection();
  try {
    await connection.beginTransaction();
    const [batch] = await connection.execute<ResultSetHeader>(
      `INSERT INTO batches (company_id, movement_type, fiscal_year, fiscal_month, source_filename, total_records)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [companyId, movement, year, month, filename, rows.length],
    );
    for (const row of rows) {
      await connection.execute(
        `INSERT INTO batch_items (batch_id, access_key, document_number, issuer_business_name, status, message)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          batch.insertId,
          row.accessKey,
          row.documentNumber || null,
          row.issuerBusinessName || null,
          row.validationError ? "ERROR" : "PENDING",
          row.validationError ?? null,
        ],
      );
    }
    await connection.commit();
    return batch.insertId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function savePurchaseBatchResult(
  databaseBatchId: number,
  companyId: number,
  companyTaxId: string,
  log: BatchLog,
): Promise<void> {
  return saveBatchResult(
    databaseBatchId,
    companyId,
    companyTaxId,
    log,
    "PURCHASE",
  );
}
export async function saveSalesBatchResult(
  databaseBatchId: number,
  companyId: number,
  companyTaxId: string,
  log: BatchLog,
): Promise<void> {
  return saveBatchResult(databaseBatchId, companyId, companyTaxId, log, "SALE");
}

export async function savePointDocExcelSales(
  databaseBatchId: number,
  companyId: number,
  companyTaxId: string,
  companyBusinessName: string,
  filename: string,
  rows: PointDocSaleRow[],
  provider = "Punto Doc",
): Promise<void> {
  const connection = await getDatabasePool().getConnection();
  try {
    await connection.beginTransaction();
    for (const row of rows) {
      const [establishment, emissionPoint, sequential] =
        row.documentNumber.split("-");
      if (!establishment || !emissionPoint || !sequential)
        throw new Error(`Fila ${row.rowNumber}: número de documento inválido.`);
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO invoices (company_id,batch_id,movement_type,document_type,access_key,authorization_number,authorization_date,issue_date,issuer_tax_id,issuer_business_name,recipient_id,recipient_business_name,establishment,emission_point,sequential,document_number,subtotal,discount,tip,vat_total,total,sri_status,xml_source,xml_path,xml_sha256) VALUES (?,?,'SALE','FACTURA',?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?, 'AUTORIZADO','MANUAL',?,?)`,
        [
          companyId,
          databaseBatchId,
          row.accessKey,
          row.accessKey,
          sqlDateTime(row.authorizationDate),
          sqlDate(row.issueDate),
          companyTaxId,
          companyBusinessName,
          row.recipientIdentification,
          row.recipientBusinessName,
          establishment,
          emissionPoint,
          sequential,
          row.documentNumber,
          row.subtotal,
          row.vat5 + row.vat12 + row.vat13 + row.vat15,
          row.total,
          row.sourcePath ??
            `${provider.toUpperCase().replace(/\s/g, "_")}_EXCEL:${filename}`,
          createHash("sha256").update(JSON.stringify(row)).digest("hex"),
        ],
      );
      const invoiceId = result.insertId;
      const taxes = [
        { code: "5", rate: 5, base: row.subtotal5, value: row.vat5 },
        { code: "2", rate: 12, base: row.subtotal12, value: row.vat12 },
        { code: "10", rate: 13, base: row.subtotal13, value: row.vat13 },
        { code: "4", rate: 15, base: row.subtotal15, value: row.vat15 },
        { code: "0", rate: 0, base: row.subtotal0, value: 0 },
        { code: "6", rate: null, base: row.subtotalNotTaxable, value: 0 },
        { code: "7", rate: null, base: row.subtotalExempt, value: 0 },
      ];
      for (const tax of taxes.filter((item) => item.base || item.value))
        await connection.execute(
          "INSERT INTO invoice_taxes (invoice_id,tax_code,percentage_code,rate,taxable_base,tax_value) VALUES (?, '2', ?, ?, ?, ?)",
          [invoiceId, tax.code, tax.rate, tax.base, tax.value],
        );
      await connection.execute(
        "UPDATE batch_items SET status='MANUAL',message=?,invoice_id=?,processed_at=NOW() WHERE batch_id=? AND access_key=?",
        [
          `Importado desde Excel de ${provider}`,
          invoiceId,
          databaseBatchId,
          row.accessKey,
        ],
      );
    }
    await connection.execute(
      "UPDATE batches SET status='COMPLETED',manual_records=?,finished_at=NOW() WHERE id=?",
      [rows.length, databaseBatchId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
async function saveBatchResult(
  databaseBatchId: number,
  companyId: number,
  companyTaxId: string,
  log: BatchLog,
  movement: "PURCHASE" | "SALE",
): Promise<void> {
  const connection = await getDatabasePool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      "UPDATE batches SET status = 'PROCESSING', started_at = ? WHERE id = ?",
      [sqlDateTime(log.startedAt), databaseBatchId],
    );
    for (const result of log.results) {
      let invoiceId: number | null = null;
      if (isAvailable(result) && result.xmlPath) {
        const xmlPath = result.xmlPath;
        const rawXml = await readFile(xmlPath, "utf8");
        const invoice = parseInvoiceXml(rawXml);
        validateInvoiceOwnership(invoice, companyTaxId, movement);
        invoiceId = await upsertInvoice(
          connection,
          databaseBatchId,
          companyId,
          invoice,
          { ...result, xmlPath },
          rawXml,
          movement,
        );
      }
      await connection.execute(
        `UPDATE batch_items SET status = ?, message = ?, invoice_id = ?, processed_at = ? WHERE batch_id = ? AND access_key = ?`,
        [
          databaseStatus(result.status),
          result.message ?? null,
          invoiceId,
          sqlDateTime(result.processedAt),
          databaseBatchId,
          result.accessKey,
        ],
      );
    }
    const finalStatus =
      log.summary.errors ||
      log.summary.notAuthorized ||
      log.summary.notFound ||
      log.summary.outsideRange
        ? "COMPLETED_WITH_ERRORS"
        : "COMPLETED";
    await connection.execute(
      `UPDATE batches SET status = ?, downloaded_records = ?, manual_records = ?, error_records = ?, finished_at = ? WHERE id = ?`,
      [
        finalStatus,
        log.summary.downloaded + log.summary.existing,
        log.summary.manual,
        log.summary.errors,
        sqlDateTime(log.finishedAt),
        databaseBatchId,
      ],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function upsertInvoice(
  connection: PoolConnection,
  batchId: number,
  companyId: number,
  invoice: NormalizedInvoice,
  result: BatchItemResult & { xmlPath: string },
  rawXml: string,
  movement: "PURCHASE" | "SALE",
): Promise<number> {
  await connection.execute(
    `INSERT INTO invoices (company_id, batch_id, movement_type, document_type, document_version, access_key, authorization_number, authorization_date, issue_date,
      issuer_tax_id, issuer_business_name, recipient_id, recipient_business_name, establishment, emission_point, sequential, document_number,
      subtotal, discount, tip, vat_total, total, sri_status, xml_source, xml_path, xml_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUTORIZADO', ?, ?, ?)
     ON DUPLICATE KEY UPDATE batch_id=VALUES(batch_id), authorization_number=VALUES(authorization_number), authorization_date=VALUES(authorization_date),
       issue_date=VALUES(issue_date), issuer_business_name=VALUES(issuer_business_name), recipient_id=VALUES(recipient_id), recipient_business_name=VALUES(recipient_business_name),
       subtotal=VALUES(subtotal), discount=VALUES(discount), tip=VALUES(tip), vat_total=VALUES(vat_total), total=VALUES(total), xml_source=VALUES(xml_source), xml_path=VALUES(xml_path), xml_sha256=VALUES(xml_sha256)`,
    [
      companyId,
      batchId,
      movement,
      invoice.type,
      invoice.version || null,
      invoice.accessKey,
      result.authorizationNumber ??
        invoice.authorizationNumber ??
        invoice.accessKey,
      sqlDateTime(result.authorizationDate ?? invoice.authorizationDate),
      sqlDate(invoice.issueDate),
      invoice.ruc,
      invoice.businessName,
      invoice.recipientIdentification,
      invoice.recipientBusinessName ?? null,
      invoice.establishment,
      invoice.emissionPoint,
      invoice.sequential,
      invoice.documentNumber,
      invoice.subtotal,
      invoice.discount,
      invoice.tip,
      invoice.vatTotal,
      invoice.total,
      result.status === "XML_CARGADO_MANUAL" ? "MANUAL" : "SRI",
      result.xmlPath,
      createHash("sha256").update(rawXml).digest("hex"),
    ],
  );
  const [ids] = await connection.execute<
    Array<{ id: number } & import("mysql2/promise").RowDataPacket>
  >(
    "SELECT id FROM invoices WHERE company_id = ? AND movement_type = ? AND access_key = ? LIMIT 1",
    [companyId, movement, invoice.accessKey],
  );
  const invoiceId = ids[0]?.id;
  if (!invoiceId)
    throw new Error("No fue posible recuperar la factura guardada.");
  await connection.execute("DELETE FROM invoice_taxes WHERE invoice_id = ?", [
    invoiceId,
  ]);
  await connection.execute("DELETE FROM invoice_details WHERE invoice_id = ?", [
    invoiceId,
  ]);
  await connection.execute(
    "DELETE FROM invoice_payments WHERE invoice_id = ?",
    [invoiceId],
  );
  for (const tax of invoice.taxes)
    await connection.execute(
      "INSERT INTO invoice_taxes (invoice_id, tax_code, percentage_code, rate, taxable_base, tax_value) VALUES (?, ?, ?, ?, ?, ?)",
      [
        invoiceId,
        tax.code,
        tax.percentageCode,
        tax.rate ?? null,
        tax.taxableBase,
        tax.value,
      ],
    );
  for (const [index, detail] of invoice.details.entries()) {
    const [detailResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO invoice_details (invoice_id, line_number, main_code, auxiliary_code, description, quantity, unit_price, discount, total_without_tax)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId,
        index + 1,
        detail.mainCode ?? null,
        detail.auxiliaryCode ?? null,
        detail.description,
        detail.quantity,
        detail.unitPrice,
        detail.discount,
        detail.totalWithoutTax,
      ],
    );
    for (const tax of detail.taxes)
      await connection.execute(
        "INSERT INTO detail_taxes (detail_id, tax_code, percentage_code, rate, taxable_base, tax_value) VALUES (?, ?, ?, ?, ?, ?)",
        [
          detailResult.insertId,
          tax.code,
          tax.percentageCode,
          tax.rate ?? null,
          tax.taxableBase,
          tax.value,
        ],
      );
  }
  for (const method of invoice.paymentMethods)
    await connection.execute(
      "INSERT INTO invoice_payments (invoice_id, payment_method_code) VALUES (?, ?)",
      [invoiceId, method],
    );
  return invoiceId;
}

function isAvailable(result: BatchItemResult): boolean {
  return ["DESCARGADO", "YA_DESCARGADO", "XML_CARGADO_MANUAL"].includes(
    result.status,
  );
}
function databaseStatus(status: BatchStatus): string {
  return (
    {
      PENDIENTE: "PENDING",
      DESCARGADO: "DOWNLOADED",
      YA_DESCARGADO: "EXISTING",
      XML_CARGADO_MANUAL: "MANUAL",
      FUERA_DE_RANGO: "OUTSIDE_RANGE",
      NO_ENCONTRADO: "NOT_FOUND",
      NO_AUTORIZADO: "NOT_AUTHORIZED",
      ERROR: "ERROR",
    } as const
  )[status];
}
function sqlDate(value: string): string {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value.slice(0, 10);
}
function sqlDateTime(value?: string): string | null {
  if (!value) return null;
  const local = value.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/,
  );
  if (local)
    return `${local[3]}-${local[2]}-${local[1]} ${local[4] ?? "00"}:${local[5] ?? "00"}:${local[6] ?? "00"}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString().slice(0, 19).replace("T", " ");
}
