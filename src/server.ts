import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSriConfig } from "./config/sri.config.js";
import {
  authRouter,
  requireAuthentication,
  requestSecurity,
  validateAuthConfig,
} from "./auth/auth.js";
import type { BatchItemResult, BatchLog } from "./models/batchProcess.js";
import type { ImportedInvoiceRow } from "./models/importedInvoice.js";
import { parseInvoiceXml } from "./parsers/xml/factura.parser.js";
import {
  processBatch,
  removeDownloadedBatchXml,
} from "./services/batch/batchProcessor.service.js";
import { importSriTxt } from "./services/imports/txtImport.service.js";
import { createSriAuthorizationClient } from "./sri/sriSoapClient.js";
import { collectExcelData } from "./services/excel/excelData.service.js";
import { testDatabaseConnection } from "./database/mysql.js";
import {
  createCompany,
  findCompanyById,
  getActiveCompanyId,
  listCompanies,
  setActiveCompany,
  updateCompany,
} from "./database/company.repository.js";
import type { CompanyInput } from "./models/company.js";
import {
  createPurchaseBatch,
  createSalesBatch,
  findExistingPurchaseKeys,
  findExistingSaleKeys,
  listStoredInvoicesForReport,
  listStoredPurchases,
  listStoredSales,
  savePointDocExcelSales,
  savePurchaseBatchResult,
  saveSalesBatchResult,
} from "./database/invoice.repository.js";
import { getDatabasePool } from "./database/mysql.js";
import type { RowDataPacket } from "mysql2/promise";
import { identificationsMatch } from "./utils/identification.js";
import { importSriSalesTxt } from "./services/imports/salesTxtImport.service.js";
import { validateInvoiceOwnership } from "./services/validation/invoiceOwnership.service.js";
import { parsePointDocExcel } from "./services/imports/pointDocExcel.service.js";
import { normalizePointDocSale } from "./services/imports/pointDocNormalizer.service.js";
import { parseContificoExcel } from "./services/imports/contificoExcel.service.js";
import pLimit from "p-limit";
import { queryAuthorization } from "./sri/sriAuthorization.service.js";
import { parseWithholdingXml } from "./parsers/xml/retencion.parser.js";
import { importWithholdingKeys } from "./services/imports/withholdingTxt.service.js";
import { withRetry } from "./utils/retry.js";
import {
  findExistingWithholdingKeys,
  listStoredWithholdings,
  listInvoiceWithholdingTotals,
  saveWithholding,
} from "./database/withholding.repository.js";

interface ActiveBatch {
  id: string;
  companyId: number;
  databaseBatchId: number;
  movement: "PURCHASE" | "SALE";
  filename: string;
  rows: ImportedInvoiceRow[];
  result?: BatchLog;
  metadata: { businessName: string; ruc: string; year: string; month: string };
}

const config = getSriConfig();
function periodFromAccessKey(rows: ImportedInvoiceRow[]): {
  year: number;
  month: number;
} {
  const key = rows[0]?.accessKey ?? "";
  const month = Number(key.slice(2, 4));
  const year = Number(key.slice(4, 8));
  if (
    !/^\d{49}$/.test(key) ||
    month < 1 ||
    month > 12 ||
    year < 2000 ||
    year > 2200
  )
    throw new Error(
      "No se pudo determinar automáticamente el período desde la clave de acceso.",
    );
  return { year, month };
}
export const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 500 },
});
const batches = new Map<string, ActiveBatch>();
const execFileAsync = promisify(execFile);

validateAuthConfig();
app.disable("x-powered-by");
if (process.env.APP_TRUST_PROXY === "loopback")
  app.set("trust proxy", "loopback");
app.use(requestSecurity);
app.use(express.json({ limit: "32kb" }));
app.use("/api/auth", authRouter);
app.get(["/login", "/register"], (_request, response) =>
  response.sendFile(path.resolve("public/login.html")),
);
for (const asset of ["auth.js", "auth.css"]) {
  app.get(`/${asset}`, (_request, response) =>
    response.sendFile(path.resolve("public", asset)),
  );
}
app.use(requireAuthentication);
// Covers every URL-based company lookup, including reports and direct XML uploads.
app.use("/api/companies/:companyId", async (request, response, next) => {
  if (request.params.companyId === "active") return next();
  if (!(await findCompanyById(Number(request.params.companyId))))
    return response.status(404).json({ error: "Empresa no encontrada." });
  next();
});
app.use("/api/batches/:id", async (request, response, next) => {
  const batch = batches.get(String(request.params.id));
  if (!batch || !(await findCompanyById(batch.companyId)))
    return response.status(404).json({ error: "Lote no encontrado." });
  next();
});
app.use(express.static(path.resolve("public")));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, environment: config.environment });
});

app.get("/api/database/health", async (_request, response) => {
  try {
    const info = await testDatabaseConnection();
    response.json({
      ok: true,
      database: info.databaseName,
      version: info.version,
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "No fue posible conectar con MySQL.",
    });
  }
});

app.get("/api/companies", async (_request, response) => {
  response.json({
    companies: await listCompanies(),
    activeCompanyId: (await getActiveCompanyId()) ?? null,
  });
});

app.post("/api/companies", async (request, response) => {
  const input = validateCompanyInput(request.body);
  const company = await createCompany(input);
  if (!(await getActiveCompanyId())) await setActiveCompany(company.id);
  response.status(201).json(company);
});

app.put("/api/companies/:id", async (request, response) => {
  const id = parseId(request.params.id);
  const company = await updateCompany(id, validateCompanyInput(request.body));
  if (!company)
    return response.status(404).json({ error: "Empresa no encontrada." });
  return response.json(company);
});

app.put("/api/companies/active/:id", async (request, response) => {
  response.json(await setActiveCompany(parseId(request.params.id)));
});

app.get("/api/companies/:id/summary", async (request, response) => {
  const companyId = parseId(request.params.id);
  const [rows] = await getDatabasePool().execute<
    Array<RowDataPacket & { purchases: number; sales: number }>
  >(
    `SELECT COUNT(CASE WHEN movement_type='PURCHASE' THEN 1 END) AS purchases,
            COUNT(CASE WHEN movement_type='SALE' THEN 1 END) AS sales
     FROM invoices WHERE company_id = ?`,
    [companyId],
  );
  response.json(rows[0] ?? { purchases: 0, sales: 0 });
});

app.get("/api/companies/:id/purchases", async (request, response) => {
  const year = optionalPeriodNumber(request.query.year, 2000, 2200);
  const month = optionalPeriodNumber(request.query.month, 1, 12);
  response.json({
    invoices: await listStoredPurchases(
      parseId(request.params.id),
      year,
      month,
    ),
  });
});
app.get("/api/companies/:id/sales", async (request, response) =>
  response.json({
    invoices: await listStoredSales(parseId(request.params.id)),
  }),
);
app.get("/api/companies/:id/withholdings", async (request, response) =>
  response.json({
    withholdings: await listStoredWithholdings(parseId(request.params.id)),
  }),
);
app.post(
  "/api/companies/:id/withholdings/import",
  upload.single("txt"),
  async (request, response) => {
    if (!request.file)
      return response
        .status(400)
        .json({ error: "Seleccione el TXT de retenciones." });
    const companyId = parseId(request.params.id);
    const company = await findCompanyById(companyId);
    if (!company)
      return response
        .status(400)
        .json({ error: "Seleccione una empresa válida." });
    const keys = importWithholdingKeys(request.file.buffer.toString("utf8"));
    const existing = await findExistingWithholdingKeys(companyId, keys);
    const pending = keys.filter((key) => !existing.has(key));
    if (!pending.length)
      return response.status(409).json({
        error: "Todas las retenciones del archivo ya están guardadas.",
      });
    const client = await createSriAuthorizationClient(
      config.wsdlUrl,
      config.timeoutMs,
    );
    const directory = path.join(config.outputDir, "xml", "retenciones");
    await mkdir(directory, { recursive: true });
    const limit = pLimit(config.concurrency);
    const results = await Promise.all(
      pending.map((key) =>
        limit(async () => {
          try {
            const queried = await withRetry(
              () => queryAuthorization(client, key),
              config.maxRetries,
              config.retryDelayMs,
            );
            const authorization = queried.authorizations.find(
              (item) =>
                item.estado?.toUpperCase() === "AUTORIZADO" && item.comprobante,
            );
            if (!authorization?.comprobante)
              throw new Error(
                "El SRI no devolvió una retención autorizada con XML.",
              );
            const item = parseWithholdingXml(authorization.comprobante);
            if (!identificationsMatch(item.retainedSubjectId, company.taxId))
              throw new Error(
                `El sujeto retenido (${item.retainedSubjectId}) no coincide con la empresa activa (${company.taxId}).`,
              );
            item.authorizationNumber =
              authorization.numeroAutorizacion ?? item.accessKey;
            if (authorization.fechaAutorizacion)
              item.authorizationDate = String(authorization.fechaAutorizacion);
            const destination = path.join(directory, `${key}.xml`);
            await writeFile(destination, authorization.comprobante, "utf8");
            await saveWithholding(
              companyId,
              item,
              destination,
              authorization.comprobante,
            );
            await unlink(destination).catch((error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT")
                console.warn(
                  `[WARN] No se pudo eliminar el XML temporal ${destination}: ${error.message}`,
                );
            });
            return {
              key,
              status: "GUARDADA",
              documentNumber: item.documentNumber,
              invoices: item.documents.map(
                (document) => document.supportDocumentNumber,
              ),
              incomeTaxWithheld: item.incomeTaxWithheld,
              vatWithheld: item.vatWithheld,
              totalWithheld: item.totalWithheld,
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            const connectionError =
              /Hostname\/IP does not match certificate|altnames|ECONN|ETIMEDOUT|EAI_AGAIN|socket|timeout/i.test(
                message,
              );
            return {
              key,
              status: connectionError ? "ERROR_CONEXION" : "RECHAZADA",
              message: connectionError
                ? "Error temporal de conexión segura con el SRI. La retención no fue rechazada por el SRI; puede intentar nuevamente."
                : message,
            };
          }
        }),
      ),
    );
    return response.json({
      accepted: results.filter((item) => item.status === "GUARDADA").length,
      omitted: existing.size,
      rejected: results.filter((item) => item.status !== "GUARDADA"),
      results,
    });
  },
);

app.post(
  "/api/companies/:id/withholdings/direct-xml",
  upload.array("xmls", 500),
  async (request, response) => {
    const companyId = parseId(request.params.id);
    const company = await findCompanyById(companyId);
    if (!company)
      return response
        .status(400)
        .json({ error: "Seleccione una empresa válida." });
    const files = request.files as Express.Multer.File[] | undefined;
    if (!files?.length)
      return response
        .status(400)
        .json({ error: "Seleccione al menos un XML de retención." });

    const parsed: Array<{
      file: Express.Multer.File;
      raw: string;
      item: ReturnType<typeof parseWithholdingXml>;
    }> = [];
    const rejected: Array<{
      key?: string;
      filename?: string;
      status: string;
      message: string;
    }> = [];
    for (const file of files) {
      try {
        const raw = file.buffer.toString("utf8");
        const item = parseWithholdingXml(raw);
        if (!identificationsMatch(item.retainedSubjectId, company.taxId))
          throw new Error(
            `El sujeto retenido (${item.retainedSubjectId}) no coincide con la empresa activa (${company.taxId}).`,
          );
        parsed.push({ file, raw, item });
      } catch (error) {
        rejected.push({
          key: file.originalname,
          filename: file.originalname,
          status: "RECHAZADA",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const unique = Array.from(
      new Map(parsed.map((entry) => [entry.item.accessKey, entry])).values(),
    );
    const duplicateUploads = parsed.length - unique.length;
    const existing = await findExistingWithholdingKeys(
      companyId,
      unique.map((entry) => entry.item.accessKey),
    );
    const pending = unique.filter(
      (entry) => !existing.has(entry.item.accessKey),
    );
    const directory = path.join(config.outputDir, "xml", "retenciones");
    await mkdir(directory, { recursive: true });
    const results: Array<{
      key: string;
      status: string;
      invoices?: string[];
      incomeTaxWithheld?: number;
      vatWithheld?: number;
      totalWithheld?: number;
      message?: string;
    }> = [];
    for (const entry of pending) {
      const destination = path.join(directory, `${entry.item.accessKey}.xml`);
      try {
        await writeFile(destination, entry.raw, "utf8");
        await saveWithholding(companyId, entry.item, destination, entry.raw);
        await unlink(destination).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT")
            console.warn(
              `[WARN] No se pudo eliminar el XML temporal ${destination}: ${error.message}`,
            );
        });
        results.push({
          key: entry.item.accessKey,
          status: "GUARDADA",
          invoices: entry.item.documents.map(
            (document) => document.supportDocumentNumber,
          ),
          incomeTaxWithheld: entry.item.incomeTaxWithheld,
          vatWithheld: entry.item.vatWithheld,
          totalWithheld: entry.item.totalWithheld,
        });
      } catch (error) {
        results.push({
          key: entry.item.accessKey,
          status: "RECHAZADA",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const allRejected = [
      ...rejected,
      ...results.filter((item) => item.status !== "GUARDADA"),
    ];
    return response.json({
      accepted: results.filter((item) => item.status === "GUARDADA").length,
      omitted: existing.size + duplicateUploads,
      rejected: allRejected,
      results: [...results, ...rejected],
    });
  },
);

app.get("/api/companies/:id/purchases/report", async (request, response) => {
  const company = await findCompanyById(parseId(request.params.id));
  if (!company)
    return response.status(404).json({ error: "Empresa no encontrada." });
  const year = optionalPeriodNumber(request.query.year, 2000, 2200);
  const month = optionalPeriodNumber(request.query.month, 1, 12);
  const stored = await listStoredPurchases(company.id, year, month);
  if (!stored.length)
    return response
      .status(404)
      .json({ error: "No hay compras guardadas para ese período." });
  const results: BatchItemResult[] = stored.map((invoice) => ({
    accessKey: invoice.accessKey,
    documentNumber: invoice.documentNumber,
    issuerBusinessName: invoice.issuerBusinessName,
    status: "YA_DESCARGADO",
    xmlPath: invoice.xmlPath,
    processedAt: "",
  }));
  const data = await collectExcelData(results, {
    businessName: company.businessName,
    ruc: company.taxId,
    year: year ? String(year) : "Todos",
    month: month ? String(month).padStart(2, "0") : "Todos",
  });
  const excelDir = path.join(config.outputDir, "excel");
  await mkdir(excelDir, { recursive: true });
  const token = `${company.id}-${year ?? "todos"}-${month ?? "todos"}`;
  const inputPath = path.join(excelDir, `report-${token}.json`);
  const filename = `compras-${token}.xlsx`;
  const outputPath = path.join(excelDir, filename);
  await writeFile(inputPath, JSON.stringify(data), "utf8");
  const nodeBin =
    process.env.ARTIFACT_NODE_BIN ||
    "C:\\Users\\Julio\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe";
  await execFileAsync(
    nodeBin,
    [
      path.resolve("artifact-runtime", "build-excel.mjs"),
      inputPath,
      outputPath,
    ],
    { timeout: 120_000, maxBuffer: 5 * 1024 * 1024 },
  );
  return response.download(outputPath, filename);
});

app.get("/api/companies/:id/reports", async (request, response) => {
  const company = await findCompanyById(parseId(request.params.id));
  if (!company)
    return response.status(404).json({ error: "Empresa no encontrada." });
  const movement = String(request.query.movement ?? "PURCHASE").toUpperCase();
  if (!["PURCHASE", "SALE", "BOTH"].includes(movement))
    return response.status(400).json({ error: "Tipo de reporte inválido." });
  const from = validateIsoDate(request.query.from, "fecha inicial");
  const to = validateIsoDate(request.query.to, "fecha final");
  if (from > to)
    return response
      .status(400)
      .json({ error: "La fecha inicial no puede ser posterior a la final." });
  const stored = await listStoredInvoicesForReport(
    company.id,
    movement as "PURCHASE" | "SALE" | "BOTH",
    from,
    to,
  );
  if (!stored.length)
    return response.status(404).json({
      error: "No hay comprobantes guardados para los filtros seleccionados.",
    });
  const results: BatchItemResult[] = stored.map((invoice) => ({
    accessKey: invoice.accessKey,
    documentNumber: invoice.documentNumber,
    issuerBusinessName: invoice.issuerBusinessName,
    status: "YA_DESCARGADO",
    xmlPath: invoice.xmlPath,
    processedAt: "",
  }));
  const reportLabel =
    movement === "PURCHASE"
      ? "COMPRAS"
      : movement === "SALE"
        ? "VENTAS"
        : "COMPRAS Y VENTAS";
  const data = await collectExcelData(results, {
    businessName: company.businessName,
    ruc: company.taxId,
    year: from.slice(0, 4),
    month: `${from} a ${to}`,
    reportLabel,
  });
  const movements = new Map(
    stored.map((item) => [item.accessKey, item.movementType]),
  );
  const withholdingTotals = new Map(
    (await listInvoiceWithholdingTotals(company.id)).map((item) => [
      item.documentNumber,
      item,
    ]),
  );
  data.invoices = data.invoices.map((item) => ({
    ...item,
    movementType: movements.get(item.invoice.accessKey) ?? "PURCHASE",
    ...(withholdingTotals.get(item.invoice.documentNumber) ?? {}),
  }));
  const excelDir = path.join(config.outputDir, "excel");
  await mkdir(excelDir, { recursive: true });
  const token = `${company.id}-${movement.toLowerCase()}-${from}-${to}`;
  const inputPath = path.join(excelDir, `report-${token}.json`);
  const filename = `reporte-${token}.xlsx`;
  const outputPath = path.join(excelDir, filename);
  await writeFile(inputPath, JSON.stringify(data), "utf8");
  const nodeBin =
    process.env.ARTIFACT_NODE_BIN ||
    "C:\\Users\\Julio\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe";
  await execFileAsync(
    nodeBin,
    [
      path.resolve("artifact-runtime", "build-excel.mjs"),
      inputPath,
      outputPath,
    ],
    { timeout: 120_000, maxBuffer: 5 * 1024 * 1024 },
  );
  return response.download(outputPath, filename);
});

app.post(
  "/api/companies/:id/purchases/direct-xml",
  upload.array("xmls", 500),
  async (request, response) => {
    const companyId = parseId(request.params.id);
    const company = await findCompanyById(companyId);
    if (!company)
      return response.status(404).json({ error: "Empresa no encontrada." });
    const files = request.files as Express.Multer.File[] | undefined;
    if (!files?.length)
      return response
        .status(400)
        .json({ error: "Seleccione al menos un XML de compra." });

    const parsed: Array<{
      file: Express.Multer.File;
      raw: string;
      invoice: ReturnType<typeof parseInvoiceXml>;
    }> = [];
    const rejected: Array<{ filename: string; error: string }> = [];
    for (const file of files) {
      try {
        const raw = file.buffer.toString("utf8");
        const invoice = parseInvoiceXml(raw);
        validateInvoiceOwnership(invoice, company.taxId, "PURCHASE");
        parsed.push({ file, raw, invoice });
      } catch (error) {
        rejected.push({
          filename: file.originalname,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const unique = Array.from(
      new Map(parsed.map((item) => [item.invoice.accessKey, item])).values(),
    );
    const duplicateUploads = parsed.length - unique.length;
    const existing = await findExistingPurchaseKeys(
      companyId,
      unique.map((item) => item.invoice.accessKey),
    );
    const pending = unique.filter(
      (item) => !existing.has(item.invoice.accessKey),
    );
    if (!pending.length)
      return response.status(400).json({
        error: rejected.length
          ? "Ningún XML válido pudo importarse."
          : "Todos los XML seleccionados ya están guardados.",
        omitted: existing.size + duplicateUploads,
        rejected,
      });

    const firstDate = pending[0]!.invoice.issueDate.match(
      /^(\d{2})\/(\d{2})\/(\d{4})$/,
    );
    if (!firstDate)
      throw new Error("La fecha de emisión del XML no es válida.");
    const rows: ImportedInvoiceRow[] = pending.map(({ invoice }, index) => ({
      rowNumber: index + 1,
      issuerRuc: invoice.ruc,
      issuerBusinessName: invoice.businessName,
      documentType: "Factura",
      documentNumber: invoice.documentNumber,
      accessKey: invoice.accessKey,
      authorizationDate: invoice.authorizationDate ?? "",
      issueDate: invoice.issueDate,
      recipientIdentification: invoice.recipientIdentification,
      reportedSubtotal: invoice.subtotal,
      reportedVat: invoice.vatTotal,
      reportedTotal: invoice.total,
      modifiedDocumentNumber: "",
    }));
    const databaseBatchId = await createPurchaseBatch(
      companyId,
      Number(firstDate[3]),
      Number(firstDate[2]),
      "XML manual de compras",
      rows,
    );
    const xmlDir = path.join(config.outputDir, "xml");
    await mkdir(xmlDir, { recursive: true });
    const results: BatchItemResult[] = [];
    for (const item of pending) {
      const destination = path.join(xmlDir, `${item.invoice.accessKey}.xml`);
      await writeFile(destination, item.raw, "utf8");
      results.push({
        accessKey: item.invoice.accessKey,
        documentNumber: item.invoice.documentNumber,
        issuerBusinessName: item.invoice.businessName,
        status: "XML_CARGADO_MANUAL",
        authorizationNumber:
          item.invoice.authorizationNumber ?? item.invoice.accessKey,
        ...(item.invoice.authorizationDate
          ? { authorizationDate: item.invoice.authorizationDate }
          : {}),
        xmlPath: destination,
        message: `Importado manualmente desde ${item.file.originalname}`,
        processedAt: new Date().toISOString(),
      });
    }
    const now = new Date().toISOString();
    const log: BatchLog = {
      startedAt: now,
      finishedAt: now,
      environment: config.environment,
      inputFile: "XML manual de compras",
      summary: summarize(results),
      results,
    };
    await savePurchaseBatchResult(
      databaseBatchId,
      companyId,
      company.taxId,
      log,
    );
    await removeDownloadedBatchXml(log, config.outputDir);
    return response.json({
      accepted: results.length,
      omitted: existing.size + duplicateUploads,
      rejected,
    });
  },
);

app.post("/api/batches", upload.single("txt"), (request, response) => {
  if (!request.file)
    return response.status(400).json({ error: "Seleccione un archivo TXT." });
  return createBatchFromRequest(request, response);
});
app.post(
  "/api/sales/batches",
  upload.single("txt"),
  async (request, response) => {
    if (!request.file)
      return response.status(400).json({ error: "Seleccione un archivo TXT." });
    const companyId = parseId(request.body.companyId);
    const company = await findCompanyById(companyId);
    if (!company)
      return response
        .status(400)
        .json({ error: "Seleccione una empresa válida." });
    const imported = importSriSalesTxt(request.file.buffer.toString("utf8"));
    const { year, month } = periodFromAccessKey(imported.rows);
    const existing = await findExistingSaleKeys(
      companyId,
      imported.rows.map((row) => row.accessKey),
    );
    const rows = imported.rows.filter((row) => !existing.has(row.accessKey));
    if (!rows.length)
      return response
        .status(409)
        .json({ error: "Todas las ventas del archivo ya están guardadas." });
    const id = randomUUID();
    const batch: ActiveBatch = {
      id,
      companyId,
      databaseBatchId: await createSalesBatch(
        companyId,
        year,
        month,
        request.file.originalname,
        rows,
      ),
      movement: "SALE",
      filename: request.file.originalname,
      rows,
      metadata: {
        businessName: company.businessName,
        ruc: company.taxId,
        year: String(year),
        month: String(month).padStart(2, "0"),
      },
    };
    batches.set(id, batch);
    return response.json({
      id,
      total: rows.length,
      omitted: existing.size,
      invalid: imported.errors.length,
      rows: rows.map(initialRow),
    });
  },
);
app.post(
  ["/api/sales/security-data", "/api/sales/direct-xml"],
  upload.array("xmls", 500),
  async (request, response) => {
    const provider =
      request.body.provider === "SRI"
        ? "Facturador SRI"
        : request.body.provider === "PUNTO_DOC"
          ? "Punto Doc"
          : "Security Data";
    const companyId = parseId(request.body.companyId);
    const company = await findCompanyById(companyId);
    if (!company)
      return response
        .status(400)
        .json({ error: "Seleccione una empresa válida." });
    const files = request.files as Express.Multer.File[] | undefined;
    if (!files?.length)
      return response
        .status(400)
        .json({ error: `Seleccione al menos un XML de ${provider}.` });
    const parsed: Array<{
      file: Express.Multer.File;
      invoice: ReturnType<typeof parseInvoiceXml>;
      raw: string;
    }> = [];
    const rejected: Array<{ filename: string; error: string }> = [];
    for (const file of files) {
      try {
        const raw = file.buffer.toString("utf8");
        const invoice = parseInvoiceXml(raw);
        validateInvoiceOwnership(invoice, company.taxId, "SALE");
        parsed.push({ file, invoice, raw });
      } catch (error) {
        rejected.push({
          filename: file.originalname,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const uniqueParsed = [
      ...new Map(parsed.map((item) => [item.invoice.accessKey, item])).values(),
    ];
    const duplicateUploads = parsed.length - uniqueParsed.length;
    const existing = await findExistingSaleKeys(
      companyId,
      uniqueParsed.map((item) => item.invoice.accessKey),
    );
    const pending = uniqueParsed.filter(
      (item) => !existing.has(item.invoice.accessKey),
    );
    if (!pending.length)
      return response.status(400).json({
        error: rejected.length
          ? "Ningún XML válido pudo importarse."
          : "Todos los XML seleccionados ya están guardados.",
        omitted: existing.size,
        rejected,
      });
    const firstDate = pending[0]!.invoice.issueDate.match(
      /^(\d{2})\/(\d{2})\/(\d{4})$/,
    );
    if (!firstDate)
      throw new Error("La fecha de emisión del XML no es válida.");
    const rows: ImportedInvoiceRow[] = pending.map(({ invoice }, index) => ({
      rowNumber: index + 1,
      issuerRuc: invoice.ruc,
      issuerBusinessName: invoice.recipientBusinessName ?? "Cliente",
      documentType: "Factura",
      documentNumber: invoice.documentNumber,
      accessKey: invoice.accessKey,
      authorizationDate: invoice.authorizationDate ?? "",
      issueDate: invoice.issueDate,
      recipientIdentification: invoice.recipientIdentification,
      reportedSubtotal: invoice.subtotal,
      reportedVat: invoice.vatTotal,
      reportedTotal: invoice.total,
      modifiedDocumentNumber: "",
    }));
    const databaseBatchId = await createSalesBatch(
      companyId,
      Number(firstDate[3]),
      Number(firstDate[2]),
      `${provider} · XML directo`,
      rows,
    );
    const xmlDir = path.join(config.outputDir, "xml");
    await mkdir(xmlDir, { recursive: true });
    const results: BatchItemResult[] = [];
    for (const item of pending) {
      const destination = path.join(xmlDir, `${item.invoice.accessKey}.xml`);
      await writeFile(destination, item.raw, "utf8");
      results.push({
        accessKey: item.invoice.accessKey,
        documentNumber: item.invoice.documentNumber,
        issuerBusinessName: item.invoice.recipientBusinessName ?? "Cliente",
        status: "XML_CARGADO_MANUAL",
        authorizationNumber:
          item.invoice.authorizationNumber ?? item.invoice.accessKey,
        ...(item.invoice.authorizationDate
          ? { authorizationDate: item.invoice.authorizationDate }
          : {}),
        xmlPath: destination,
        message: `Importado directamente desde ${provider} (${item.file.originalname})`,
        processedAt: new Date().toISOString(),
      });
    }
    const now = new Date().toISOString();
    const log: BatchLog = {
      startedAt: now,
      finishedAt: now,
      environment: config.environment,
      inputFile: `${provider} · XML directo`,
      summary: summarize(results),
      results,
    };
    await saveSalesBatchResult(databaseBatchId, companyId, company.taxId, log);
    await removeDownloadedBatchXml(log, config.outputDir);
    return response.json({
      accepted: results.length,
      omitted: existing.size + duplicateUploads,
      rejected,
      results,
    });
  },
);
app.post(
  "/api/sales/punto-doc/excel",
  upload.single("excel"),
  async (request, response) => {
    if (!request.file)
      return response
        .status(400)
        .json({ error: "Seleccione el Excel de Punto Doc." });
    const companyId = parseId(request.body.companyId);
    const company = await findCompanyById(companyId);
    if (!company)
      return response
        .status(400)
        .json({ error: "Seleccione una empresa válida." });
    const parsed = await parsePointDocExcel(request.file.buffer, company.taxId);
    const existing = await findExistingSaleKeys(
      companyId,
      parsed.map((row) => row.accessKey),
    );
    const rows = parsed.filter((row) => !existing.has(row.accessKey));
    if (!rows.length)
      return response
        .status(409)
        .json({ error: "Todas las ventas del Excel ya están guardadas." });
    const normalizedDir = path.join(
      config.outputDir,
      "normalized",
      "point-doc",
    );
    await mkdir(normalizedDir, { recursive: true });
    for (const row of rows) {
      row.sourcePath = path.join(normalizedDir, `${row.accessKey}.json`);
      await writeFile(
        row.sourcePath,
        JSON.stringify(
          normalizePointDocSale(row, company.taxId, company.businessName),
          null,
          2,
        ),
        "utf8",
      );
    }
    const imported: ImportedInvoiceRow[] = rows.map((row) => ({
      rowNumber: row.rowNumber,
      issuerRuc: company.taxId,
      issuerBusinessName: row.recipientBusinessName,
      documentType: "Factura",
      documentNumber: row.documentNumber,
      accessKey: row.accessKey,
      authorizationDate: row.authorizationDate,
      issueDate: row.issueDate,
      recipientIdentification: row.recipientIdentification,
      reportedSubtotal: row.subtotal,
      reportedVat: row.vat5 + row.vat12 + row.vat13 + row.vat15,
      reportedTotal: row.total,
      modifiedDocumentNumber: "",
    }));
    const date = rows[0]!.issueDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!date) throw new Error("La fecha de emisión no es válida.");
    const batchId = await createSalesBatch(
      companyId,
      Number(date[3]),
      Number(date[2]),
      request.file.originalname,
      imported,
    );
    await savePointDocExcelSales(
      batchId,
      companyId,
      company.taxId,
      company.businessName,
      request.file.originalname,
      rows,
    );
    return response.json({ accepted: rows.length, omitted: existing.size });
  },
);

app.post(
  "/api/sales/contifico/excel",
  upload.single("excel"),
  async (request, response) => {
    if (!request.file)
      return response
        .status(400)
        .json({ error: "Seleccione el Excel de Contífico." });
    const companyId = parseId(request.body.companyId);
    const company = await findCompanyById(companyId);
    if (!company)
      return response
        .status(400)
        .json({ error: "Seleccione una empresa válida." });
    const parsed = parseContificoExcel(request.file.buffer, company.taxId);
    const existing = await findExistingSaleKeys(
      companyId,
      parsed.map((row) => row.accessKey),
    );
    const rows = parsed.filter((row) => !existing.has(row.accessKey));
    if (!rows.length)
      return response
        .status(409)
        .json({ error: "Todas las ventas del Excel ya están guardadas." });
    const normalizedDir = path.join(
      config.outputDir,
      "normalized",
      "contifico",
    );
    await mkdir(normalizedDir, { recursive: true });
    for (const row of rows) {
      row.sourcePath = path.join(normalizedDir, `${row.accessKey}.json`);
      await writeFile(
        row.sourcePath,
        JSON.stringify(
          normalizePointDocSale(row, company.taxId, company.businessName),
          null,
          2,
        ),
        "utf8",
      );
    }
    const imported: ImportedInvoiceRow[] = rows.map((row) => ({
      rowNumber: row.rowNumber,
      issuerRuc: company.taxId,
      issuerBusinessName: row.recipientBusinessName,
      documentType: "Factura",
      documentNumber: row.documentNumber,
      accessKey: row.accessKey,
      authorizationDate: row.authorizationDate,
      issueDate: row.issueDate,
      recipientIdentification: row.recipientIdentification,
      reportedSubtotal: row.subtotal,
      reportedVat: row.vat5 + row.vat12 + row.vat13 + row.vat15,
      reportedTotal: row.total,
      modifiedDocumentNumber: "",
    }));
    const date = rows[0]!.issueDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!date) throw new Error("La fecha de emisión no es válida.");
    const batchId = await createSalesBatch(
      companyId,
      Number(date[3]),
      Number(date[2]),
      request.file.originalname,
      imported,
    );
    await savePointDocExcelSales(
      batchId,
      companyId,
      company.taxId,
      company.businessName,
      request.file.originalname,
      rows,
      "Contífico",
    );
    return response.json({ accepted: rows.length, omitted: existing.size });
  },
);

async function createBatchFromRequest(request: Request, response: Response) {
  if (!request.file)
    return response.status(400).json({ error: "Seleccione un archivo TXT." });
  const companyId = parseId(request.body.companyId);
  const company = await findCompanyById(companyId);
  if (!company)
    return response
      .status(400)
      .json({ error: "Seleccione una empresa valida." });
  await setActiveCompany(companyId);
  const imported = importSriTxt(request.file.buffer.toString("utf8"));
  const mismatched = imported.rows.filter(
    (row) => !identificationsMatch(row.recipientIdentification, company.taxId),
  );
  if (mismatched.length) {
    return response.status(400).json({
      error: `El TXT contiene ${mismatched.length} factura(s) cuyo IDENTIFICACION_RECEPTOR no coincide con ${company.taxId}. No se importó el lote.`,
      rows: mismatched.slice(0, 10).map((row) => ({
        row: row.rowNumber,
        document: row.documentNumber,
        recipient: row.recipientIdentification,
      })),
    });
  }
  const { year, month } = periodFromAccessKey(imported.rows);
  const existingKeys = await findExistingPurchaseKeys(
    companyId,
    imported.rows.map((row) => row.accessKey),
  );
  const newRows = imported.rows.filter(
    (row) => !existingKeys.has(row.accessKey),
  );
  if (!newRows.length)
    return response.status(409).json({
      error: `Las ${imported.rows.length} facturas del archivo ya están guardadas. No hay nada que consultar.`,
    });
  const databaseBatchId = await createPurchaseBatch(
    companyId,
    year,
    month,
    request.file.originalname,
    newRows,
  );
  const id = randomUUID();
  const batch: ActiveBatch = {
    id,
    companyId,
    databaseBatchId,
    movement: "PURCHASE",
    filename: request.file.originalname,
    rows: newRows,
    metadata: {
      businessName: company.businessName,
      ruc: company.taxId,
      year: String(year),
      month: String(month).padStart(2, "0"),
    },
  };
  batches.set(id, batch);
  return response.json({
    id,
    filename: batch.filename,
    metadata: batch.metadata,
    total: batch.rows.length,
    omitted: existingKeys.size,
    invalid: imported.errors.length,
    rows: batch.rows.map(initialRow),
  });
}

app.post("/api/batches/:id/process", async (request, response) => {
  const batch = batches.get(String(request.params.id));
  if (!batch)
    return response
      .status(404)
      .json({ error: "El lote no existe o la aplicacion fue reiniciada." });
  const [authorizationClient, validityClient] = await Promise.all([
    createSriAuthorizationClient(config.wsdlUrl, config.timeoutMs),
    createSriAuthorizationClient(config.validityWsdlUrl, config.timeoutMs),
  ]);
  batch.result = await processBatch(batch.rows, {
    authorizationClient,
    validityClient,
    outputDir: config.outputDir,
    concurrency: config.concurrency,
    maxRetries: config.maxRetries,
    retryDelayMs: config.retryDelayMs,
    environment: config.environment,
    inputFile: batch.filename,
    companyTaxId: batch.metadata.ruc,
    movement: batch.movement,
  });
  if (batch.movement === "SALE")
    await saveSalesBatchResult(
      batch.databaseBatchId,
      batch.companyId,
      batch.metadata.ruc,
      batch.result,
    );
  else
    await savePurchaseBatchResult(
      batch.databaseBatchId,
      batch.companyId,
      batch.metadata.ruc,
      batch.result,
    );
  await removeDownloadedBatchXml(batch.result, config.outputDir);
  await persistBatch(batch);
  return response.json(batch.result);
});

app.post(
  "/api/batches/:id/xml",
  upload.array("xmls", 500),
  async (request, response) => {
    const batch = batches.get(String(request.params.id));
    if (!batch)
      return response
        .status(404)
        .json({ error: "El lote no existe o la aplicacion fue reiniciada." });
    if (!batch.result)
      return response
        .status(409)
        .json({ error: "Primero debe procesar el lote." });
    const files = request.files as Express.Multer.File[] | undefined;
    if (!files?.length)
      return response
        .status(400)
        .json({ error: "Seleccione al menos un XML." });
    const xmlDir = path.join(config.outputDir, "xml");
    await mkdir(xmlDir, { recursive: true });
    const expected = new Map(batch.rows.map((row) => [row.accessKey, row]));
    const accepted: string[] = [];
    const rejected: Array<{ filename: string; error: string }> = [];

    for (const file of files) {
      try {
        const raw = file.buffer.toString("utf8");
        const invoice = parseInvoiceXml(raw);
        const row = expected.get(invoice.accessKey);
        if (!row) throw new Error("La clave del XML no pertenece a este lote.");
        validateInvoiceOwnership(invoice, batch.metadata.ruc, batch.movement);
        const destination = path.join(xmlDir, `${invoice.accessKey}.xml`);
        await writeFile(destination, raw, "utf8");
        const current = batch.result.results.find(
          (item) => item.accessKey === invoice.accessKey,
        );
        if (current) {
          current.status = "XML_CARGADO_MANUAL";
          current.xmlPath = destination;
          current.authorizationNumber =
            invoice.authorizationNumber ?? invoice.accessKey;
          if (invoice.authorizationDate)
            current.authorizationDate = invoice.authorizationDate;
          current.message = `Cargado manualmente desde ${file.originalname}`;
        }
        accepted.push(invoice.accessKey);
      } catch (error) {
        rejected.push({
          filename: file.originalname,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    batch.result.summary = summarize(batch.result.results);
    if (batch.movement === "SALE")
      await saveSalesBatchResult(
        batch.databaseBatchId,
        batch.companyId,
        batch.metadata.ruc,
        batch.result,
      );
    else
      await savePurchaseBatchResult(
        batch.databaseBatchId,
        batch.companyId,
        batch.metadata.ruc,
        batch.result,
      );
    await removeDownloadedBatchXml(batch.result, config.outputDir);
    await persistBatch(batch);
    return response.json({ accepted, rejected, result: batch.result });
  },
);

app.get("/api/batches/:id", (request, response) => {
  const batch = batches.get(String(request.params.id));
  if (!batch)
    return response.status(404).json({ error: "Lote no encontrado." });
  return response.json(batch.result ?? { rows: batch.rows.map(initialRow) });
});

app.get("/api/batches/:id/excel", async (request, response) => {
  const batch = batches.get(String(request.params.id));
  if (!batch?.result)
    return response
      .status(409)
      .json({ error: "Primero debe procesar el lote." });
  const data = await collectExcelData(batch.result.results, batch.metadata);
  const excelDir = path.join(config.outputDir, "excel");
  const previewDir = path.join(excelDir, `preview-${batch.id}`);
  await mkdir(excelDir, { recursive: true });
  const inputPath = path.join(excelDir, `${batch.id}.json`);
  const filename = `compras-${batch.metadata.year || "periodo"}-${batch.metadata.month || "00"}.xlsx`;
  const outputPath = path.join(
    excelDir,
    `${batch.id}-${randomUUID()}-${filename}`,
  );
  await writeFile(inputPath, JSON.stringify(data), "utf8");
  const nodeBin =
    process.env.ARTIFACT_NODE_BIN ||
    "C:\\Users\\Julio\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe";
  const builder = path.resolve("artifact-runtime", "build-excel.mjs");
  await execFileAsync(nodeBin, [builder, inputPath, outputPath, previewDir], {
    timeout: 120_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  return response.download(outputPath, filename);
});

app.use(
  (
    error: unknown,
    request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string; status?: number })?.code;
    if (request.originalUrl.startsWith("/api/auth/") || code) {
      console.error(`[ERROR] Solicitud fallida (${code ?? "AUTH"}).`);
      return response.status(code === "ER_DUP_ENTRY" ? 409 : 503).json({
        error:
          code === "ER_DUP_ENTRY"
            ? "Ese registro ya existe. No se realizaron cambios."
            : "No se pudo completar la solicitud. Revisa la conexión y la configuración del servidor.",
      });
    }
    const status = (error as { status?: number })?.status;
    console.error("[ERROR] No se pudo completar la solicitud.");
    return response
      .status(status === 413 ? 413 : 400)
      .json({
        error:
          process.env.NODE_ENV === "production"
            ? "No se pudo completar la solicitud."
            : message,
      });
  },
);

const port = Number(process.env.APP_PORT ?? "3000");
if (process.env.NODE_ENV !== "test")
  app.listen(port, "127.0.0.1", () => {
    console.log(
      `[INFO] Descargador SRI disponible en http://localhost:${port}`,
    );
  });

function initialRow(row: ImportedInvoiceRow): BatchItemResult {
  return {
    accessKey: row.accessKey,
    documentNumber: row.documentNumber,
    issuerBusinessName: row.issuerBusinessName,
    status: row.validationError ? "ERROR" : "PENDIENTE",
    ...(row.validationError ? { message: row.validationError } : {}),
    processedAt: "",
  };
}

async function persistBatch(batch: ActiveBatch): Promise<void> {
  const directory = path.join(config.outputDir, "batches");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${batch.id}.json`),
    JSON.stringify(batch, null, 2),
    "utf8",
  );
}

function summarize(results: BatchItemResult[]) {
  const count = (status: BatchItemResult["status"]) =>
    results.filter((item) => item.status === status).length;
  return {
    total: results.length,
    downloaded: count("DESCARGADO"),
    existing: count("YA_DESCARGADO"),
    manual: count("XML_CARGADO_MANUAL"),
    outsideRange: count("FUERA_DE_RANGO"),
    notFound: count("NO_ENCONTRADO"),
    notAuthorized: count("NO_AUTORIZADO"),
    pending: count("PENDIENTE"),
    errors: count("ERROR"),
  };
}

function validateCompanyInput(value: unknown): CompanyInput {
  const body = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const taxId = String(body.taxId ?? "").trim();
  const businessName = String(body.businessName ?? "").trim();
  if (!/^\d{10,13}$/.test(taxId))
    throw new Error("La identificacion debe tener entre 10 y 13 digitos.");
  if (businessName.length < 2 || businessName.length > 300)
    throw new Error("La razon social debe tener entre 2 y 300 caracteres.");
  const optional = (name: string, max: number) => {
    const text = String(body[name] ?? "").trim();
    if (text.length > max)
      throw new Error(`${name} supera la longitud permitida.`);
    return text || undefined;
  };
  const tradeName = optional("tradeName", 300);
  const email = optional("email", 320);
  const phone = optional("phone", 30);
  return {
    taxId,
    businessName,
    ...(tradeName ? { tradeName } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
  };
}

function parseId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error("Identificador invalido.");
  return id;
}

function optionalPeriodNumber(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === "") return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error("Filtro de período inválido.");
  return number;
}
function validateIsoDate(value: unknown, label: string): string {
  const text = String(value ?? "");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    Number.isNaN(new Date(`${text}T00:00:00`).getTime())
  )
    throw new Error(`La ${label} no es válida.`);
  return text;
}
