import { createHash } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type {
  InvoiceWithholdingTotal,
  NormalizedWithholding,
  StoredWithholding,
} from "../models/withholding.js";
import { getDatabasePool } from "./mysql.js";
const sqlDate = (value: string) => {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error(`Fecha inválida: ${value}.`);
  return `${match[3]}-${match[2]}-${match[1]}`;
};
const sqlDateTime = (value?: string) => (value ? new Date(value) : null);

export async function findExistingWithholdingKeys(
  companyId: number,
  keys: string[],
): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const placeholders = keys.map(() => "?").join(",");
  const [rows] = await getDatabasePool().query<
    Array<RowDataPacket & { accessKey: string }>
  >(
    `SELECT access_key AS accessKey FROM withholdings WHERE company_id=? AND access_key IN (${placeholders})`,
    [companyId, ...keys],
  );
  return new Set(rows.map((row) => row.accessKey));
}
export async function listStoredWithholdings(
  companyId: number,
): Promise<StoredWithholding[]> {
  const [rows] = await getDatabasePool().query<
    Array<RowDataPacket & StoredWithholding>
  >(
    `SELECT w.id,w.access_key AS accessKey,w.authorization_number AS authorizationNumber,DATE_FORMAT(w.issue_date,'%d/%m/%Y') AS issueDate,w.document_number AS documentNumber,w.issuer_tax_id AS issuerTaxId,w.issuer_business_name AS issuerBusinessName,GROUP_CONCAT(DISTINCT d.support_document_number ORDER BY d.support_document_number SEPARATOR ', ') AS supportDocuments,w.income_tax_withheld AS incomeTaxWithheld,w.vat_withheld AS vatWithheld,w.total_withheld AS totalWithheld,COUNT(l.id) AS lineCount,COUNT(DISTINCT d.id) AS documentCount,COUNT(DISTINCT d.invoice_id) AS linkedDocumentCount FROM withholdings w JOIN withholding_documents d ON d.withholding_id=w.id JOIN withholding_lines l ON l.withholding_document_id=d.id WHERE w.company_id=? GROUP BY w.id ORDER BY w.issue_date DESC,w.id DESC`,
    [companyId],
  );
  return rows;
}
export async function listInvoiceWithholdingTotals(
  companyId: number,
): Promise<InvoiceWithholdingTotal[]> {
  const [rows] = await getDatabasePool().query<
    Array<RowDataPacket & InvoiceWithholdingTotal>
  >(
    `SELECT d.support_document_number AS documentNumber,SUM(CASE WHEN l.tax_type='INCOME_TAX' THEN l.withheld_value ELSE 0 END) AS incomeTaxWithheld,SUM(CASE WHEN l.tax_type='VAT' THEN l.withheld_value ELSE 0 END) AS vatWithheld FROM withholding_documents d JOIN withholdings w ON w.id=d.withholding_id JOIN withholding_lines l ON l.withholding_document_id=d.id WHERE w.company_id=? GROUP BY d.support_document_number`,
    [companyId],
  );
  return rows;
}
export async function saveWithholding(
  companyId: number,
  item: NormalizedWithholding,
  xmlPath: string,
  xml: string,
): Promise<void> {
  const connection = await getDatabasePool().getConnection();
  try {
    await connection.beginTransaction();
    const [header] = await connection.execute<ResultSetHeader>(
      `INSERT INTO withholdings (company_id,access_key,authorization_number,authorization_date,issue_date,document_version,issuer_tax_id,issuer_business_name,retained_subject_id,retained_subject_name,establishment,emission_point,sequential,document_number,income_tax_withheld,vat_withheld,total_withheld,xml_path,xml_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        companyId,
        item.accessKey,
        item.authorizationNumber,
        sqlDateTime(item.authorizationDate),
        sqlDate(item.issueDate),
        item.version,
        item.issuerTaxId,
        item.issuerBusinessName,
        item.retainedSubjectId,
        item.retainedSubjectName,
        item.establishment,
        item.emissionPoint,
        item.sequential,
        item.documentNumber,
        item.incomeTaxWithheld,
        item.vatWithheld,
        item.totalWithheld,
        xmlPath,
        createHash("sha256").update(xml).digest("hex"),
      ],
    );
    for (const document of item.documents) {
      const [invoiceRows] = await connection.query<
        Array<RowDataPacket & { id: number }>
      >(
        "SELECT id FROM invoices WHERE company_id=? AND movement_type='SALE' AND REPLACE(document_number,'-','')=? LIMIT 1",
        [companyId, document.supportDocumentNumber.replace(/-/g, "")],
      );
      const [storedDocument] = await connection.execute<ResultSetHeader>(
        `INSERT INTO withholding_documents (withholding_id,invoice_id,support_document_code,support_document_number,support_authorization_number,support_issue_date) VALUES (?,?,?,?,?,?)`,
        [
          header.insertId,
          invoiceRows[0]?.id ?? null,
          document.supportDocumentCode,
          document.supportDocumentNumber,
          document.supportAuthorizationNumber ?? null,
          document.supportIssueDate ? sqlDate(document.supportIssueDate) : null,
        ],
      );
      for (const line of document.lines)
        await connection.execute(
          "INSERT INTO withholding_lines (withholding_document_id,tax_type,tax_code,withholding_code,taxable_base,withholding_percentage,withheld_value) VALUES (?,?,?,?,?,?,?)",
          [
            storedDocument.insertId,
            line.taxType,
            line.taxCode,
            line.withholdingCode,
            line.taxableBase,
            line.percentage,
            line.value,
          ],
        );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
