import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Company, CompanyInput } from "../models/company.js";
import { getDatabasePool } from "./mysql.js";
import { requireUserId } from "../auth/context.js";

interface CompanyRow extends RowDataPacket {
  id: number;
  taxId: string;
  businessName: string;
  tradeName: string | null;
  email: string | null;
  phone: string | null;
  isActive: number;
  createdAt: Date;
  updatedAt: Date;
}

const selectColumns = `
  id, tax_id AS taxId, business_name AS businessName, trade_name AS tradeName,
  email, phone, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
`;

export async function listCompanies(): Promise<Company[]> {
  const [rows] = await getDatabasePool().query<CompanyRow[]>(
    `SELECT ${selectColumns} FROM companies WHERE is_active = TRUE AND id IN (SELECT company_id FROM auth_company_members WHERE user_id=?) ORDER BY business_name`,
    [requireUserId()],
  );
  return rows.map(mapCompany);
}

export async function findCompanyById(
  id: number,
): Promise<Company | undefined> {
  const [rows] = await getDatabasePool().execute<CompanyRow[]>(
    `SELECT ${selectColumns} FROM companies WHERE id = ? AND id IN (SELECT company_id FROM auth_company_members WHERE user_id=?) LIMIT 1`,
    [id, requireUserId()],
  );
  return rows[0] ? mapCompany(rows[0]) : undefined;
}

export async function createCompany(input: CompanyInput): Promise<Company> {
  const connection = await getDatabasePool().getConnection();
  let id: number;
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO companies (tax_id, business_name, trade_name, email, phone)
     VALUES (?, ?, ?, ?, ?)`,
      [
        input.taxId,
        input.businessName,
        input.tradeName ?? null,
        input.email ?? null,
        input.phone ?? null,
      ],
    );
    id = result.insertId;
    await connection.execute(
      "INSERT INTO auth_company_members (company_id,user_id) VALUES (?,?)",
      [id, requireUserId()],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const company = await findCompanyById(id);
  if (!company) throw new Error("No fue posible recuperar la empresa creada.");
  return company;
}

export async function updateCompany(
  id: number,
  input: CompanyInput,
): Promise<Company | undefined> {
  if (!(await findCompanyById(id))) return undefined;
  const [result] = await getDatabasePool().execute<ResultSetHeader>(
    `UPDATE companies SET tax_id = ?, business_name = ?, trade_name = ?, email = ?, phone = ?
     WHERE id = ? AND is_active = TRUE`,
    [
      input.taxId,
      input.businessName,
      input.tradeName ?? null,
      input.email ?? null,
      input.phone ?? null,
      id,
    ],
  );
  if (!result.affectedRows) return undefined;
  return findCompanyById(id);
}

export async function getActiveCompanyId(): Promise<number | undefined> {
  const [rows] = await getDatabasePool().execute<
    Array<RowDataPacket & { companyId: string }>
  >("SELECT active_company_id AS companyId FROM auth_users WHERE id=?", [
    requireUserId(),
  ]);
  const value = Number(rows[0]?.companyId);
  return Number.isSafeInteger(value) &&
    value > 0 &&
    (await findCompanyById(value))
    ? value
    : undefined;
}

export async function setActiveCompany(id: number): Promise<Company> {
  const company = await findCompanyById(id);
  if (!company || !company.isActive)
    throw new Error("La empresa seleccionada no existe o esta inactiva.");
  await getDatabasePool().execute(
    "UPDATE auth_users SET active_company_id=? WHERE id=?",
    [id, requireUserId()],
  );
  return company;
}

function mapCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    taxId: row.taxId,
    businessName: row.businessName,
    ...(row.tradeName ? { tradeName: row.tradeName } : {}),
    ...(row.email ? { email: row.email } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    isActive: Boolean(row.isActive),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
