import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSriConfig } from "./config/sri.config.js";
import type { BatchItemResult, BatchLog } from "./models/batchProcess.js";
import type { ImportedInvoiceRow } from "./models/importedInvoice.js";
import { parseInvoiceXml } from "./parsers/xml/factura.parser.js";
import { processBatch } from "./services/batch/batchProcessor.service.js";
import { importSriTxt } from "./services/imports/txtImport.service.js";
import { createSriAuthorizationClient } from "./sri/sriSoapClient.js";
import { collectExcelData } from "./services/excel/excelData.service.js";
import { testDatabaseConnection } from "./database/mysql.js";
import { createCompany, findCompanyById, getActiveCompanyId, listCompanies, setActiveCompany, updateCompany } from "./database/company.repository.js";
import type { CompanyInput } from "./models/company.js";
import { createPurchaseBatch, createSalesBatch, findExistingPurchaseKeys, findExistingSaleKeys, listStoredInvoicesForReport, listStoredPurchases, listStoredSales, savePurchaseBatchResult, saveSalesBatchResult } from "./database/invoice.repository.js";
import { getDatabasePool } from "./database/mysql.js";
import type { RowDataPacket } from "mysql2/promise";
import { identificationsMatch } from "./utils/identification.js";
import { importSriSalesTxt } from "./services/imports/salesTxtImport.service.js";

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
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 500 },
});
const batches = new Map<string, ActiveBatch>();
const execFileAsync = promisify(execFile);

app.use(express.json());
app.use(express.static(path.resolve("public")));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, environment: config.environment });
});

app.get("/api/database/health", async (_request, response) => {
  try {
    const info = await testDatabaseConnection();
    response.json({ ok: true, database: info.databaseName, version: info.version });
  } catch (error) {
    response.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "No fue posible conectar con MySQL.",
    });
  }
});

app.get("/api/companies", async (_request, response) => {
  response.json({ companies: await listCompanies(), activeCompanyId: await getActiveCompanyId() ?? null });
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
  if (!company) return response.status(404).json({ error: "Empresa no encontrada." });
  return response.json(company);
});

app.put("/api/companies/active/:id", async (request, response) => {
  response.json(await setActiveCompany(parseId(request.params.id)));
});

app.get("/api/companies/:id/summary", async (request, response) => {
  const companyId = parseId(request.params.id);
  const [rows] = await getDatabasePool().execute<Array<RowDataPacket & { purchases: number; sales: number }>>(
    `SELECT COUNT(CASE WHEN movement_type='PURCHASE' THEN 1 END) AS purchases,
            COUNT(CASE WHEN movement_type='SALE' THEN 1 END) AS sales
     FROM invoices WHERE company_id = ?`, [companyId],
  );
  response.json(rows[0] ?? { purchases: 0, sales: 0 });
});

app.get("/api/companies/:id/purchases", async (request, response) => {
  const year = optionalPeriodNumber(request.query.year, 2000, 2200);
  const month = optionalPeriodNumber(request.query.month, 1, 12);
  response.json({ invoices: await listStoredPurchases(parseId(request.params.id), year, month) });
});
app.get("/api/companies/:id/sales",async(request,response)=>response.json({invoices:await listStoredSales(parseId(request.params.id))}));

app.get("/api/companies/:id/purchases/report", async (request, response) => {
  const company = await findCompanyById(parseId(request.params.id));
  if (!company) return response.status(404).json({ error: "Empresa no encontrada." });
  const year = optionalPeriodNumber(request.query.year, 2000, 2200);
  const month = optionalPeriodNumber(request.query.month, 1, 12);
  const stored = await listStoredPurchases(company.id, year, month);
  if (!stored.length) return response.status(404).json({ error: "No hay compras guardadas para ese período." });
  const results: BatchItemResult[] = stored.map((invoice) => ({ accessKey: invoice.accessKey, documentNumber: invoice.documentNumber, issuerBusinessName: invoice.issuerBusinessName, status: "YA_DESCARGADO", xmlPath: invoice.xmlPath, processedAt: "" }));
  const data = await collectExcelData(results, { businessName: company.businessName, ruc: company.taxId, year: year ? String(year) : "Todos", month: month ? String(month).padStart(2,"0") : "Todos" });
  const excelDir = path.join(config.outputDir, "excel"); await mkdir(excelDir, { recursive: true });
  const token = `${company.id}-${year ?? "todos"}-${month ?? "todos"}`; const inputPath = path.join(excelDir, `report-${token}.json`); const filename = `compras-${token}.xlsx`; const outputPath = path.join(excelDir, filename);
  await writeFile(inputPath, JSON.stringify(data), "utf8");
  const nodeBin = process.env.ARTIFACT_NODE_BIN || "C:\\Users\\Julio\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe";
  await execFileAsync(nodeBin, [path.resolve("artifact-runtime", "build-excel.mjs"), inputPath, outputPath], { timeout: 120_000, maxBuffer: 5 * 1024 * 1024 });
  return response.download(outputPath, filename);
});

app.get("/api/companies/:id/reports", async (request, response) => {
  const company = await findCompanyById(parseId(request.params.id)); if (!company) return response.status(404).json({ error: "Empresa no encontrada." });
  const movement = String(request.query.movement ?? "PURCHASE").toUpperCase(); if (!["PURCHASE","SALE","BOTH"].includes(movement)) return response.status(400).json({ error: "Tipo de reporte inválido." });
  const from = validateIsoDate(request.query.from, "fecha inicial"); const to = validateIsoDate(request.query.to, "fecha final"); if (from > to) return response.status(400).json({ error: "La fecha inicial no puede ser posterior a la final." });
  const stored = await listStoredInvoicesForReport(company.id, movement as "PURCHASE"|"SALE"|"BOTH", from, to); if (!stored.length) return response.status(404).json({ error: "No hay comprobantes guardados para los filtros seleccionados." });
  const results: BatchItemResult[] = stored.map((invoice) => ({ accessKey:invoice.accessKey, documentNumber:invoice.documentNumber, issuerBusinessName:invoice.issuerBusinessName, status:"YA_DESCARGADO", xmlPath:invoice.xmlPath, processedAt:"" }));
  const reportLabel = movement === "PURCHASE" ? "COMPRAS" : movement === "SALE" ? "VENTAS" : "COMPRAS Y VENTAS";
  const data = await collectExcelData(results, { businessName:company.businessName, ruc:company.taxId, year:from.slice(0,4), month:`${from} a ${to}`, reportLabel });
  const movements = new Map(stored.map((item) => [item.accessKey, item.movementType]));
  data.invoices = data.invoices.map((item) => ({ ...item, movementType: movements.get(item.invoice.accessKey) ?? "PURCHASE" }));
  const excelDir=path.join(config.outputDir,"excel");await mkdir(excelDir,{recursive:true});const token=`${company.id}-${movement.toLowerCase()}-${from}-${to}`;const inputPath=path.join(excelDir,`report-${token}.json`);const filename=`reporte-${token}.xlsx`;const outputPath=path.join(excelDir,filename);await writeFile(inputPath,JSON.stringify(data),"utf8");
  const nodeBin=process.env.ARTIFACT_NODE_BIN||"C:\\Users\\Julio\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe";await execFileAsync(nodeBin,[path.resolve("artifact-runtime","build-excel.mjs"),inputPath,outputPath],{timeout:120_000,maxBuffer:5*1024*1024});return response.download(outputPath,filename);
});

app.post("/api/batches", upload.single("txt"), (request, response) => {
  if (!request.file) return response.status(400).json({ error: "Seleccione un archivo TXT." });
  return createBatchFromRequest(request, response);
});
app.post("/api/sales/batches", upload.single("txt"), async (request, response) => {
  if (!request.file) return response.status(400).json({ error:"Seleccione un archivo TXT." });
  if (request.body.confirmCompany !== "true") return response.status(400).json({ error:"Confirme que el TXT corresponde a la empresa seleccionada." });
  const companyId=parseId(request.body.companyId);const company=await findCompanyById(companyId);if(!company)return response.status(400).json({error:"Seleccione una empresa válida."});
  const imported=importSriSalesTxt(request.file.buffer.toString("utf8"));const year=Number(request.body.year),month=Number(request.body.month);if(!Number.isInteger(year)||year<2000||year>2200||!Number.isInteger(month)||month<1||month>12)return response.status(400).json({error:"Seleccione un período válido."});
  const existing=await findExistingSaleKeys(companyId,imported.rows.map(row=>row.accessKey));const rows=imported.rows.filter(row=>!existing.has(row.accessKey));if(!rows.length)return response.status(409).json({error:"Todas las ventas del archivo ya están guardadas."});
  const id=randomUUID();const batch:ActiveBatch={id,companyId,databaseBatchId:await createSalesBatch(companyId,year,month,request.file.originalname,rows),movement:"SALE",filename:request.file.originalname,rows,metadata:{businessName:company.businessName,ruc:company.taxId,year:String(year),month:String(month).padStart(2,"0")}};batches.set(id,batch);
  return response.json({id,total:rows.length,omitted:existing.size,invalid:imported.errors.length,rows:rows.map(initialRow)});
});

async function createBatchFromRequest(request: Request, response: Response) {
  if (!request.file) return response.status(400).json({ error: "Seleccione un archivo TXT." });
  const companyId = parseId(request.body.companyId);
  const company = await findCompanyById(companyId);
  if (!company) return response.status(400).json({ error: "Seleccione una empresa valida." });
  await setActiveCompany(companyId);
  const imported = importSriTxt(request.file.buffer.toString("utf8"));
  const mismatched = imported.rows.filter((row) => !identificationsMatch(row.recipientIdentification, company.taxId));
  if (mismatched.length) {
    return response.status(400).json({
      error: `El TXT contiene ${mismatched.length} factura(s) cuyo IDENTIFICACION_RECEPTOR no coincide con ${company.taxId}. No se importó el lote.`,
      rows: mismatched.slice(0, 10).map((row) => ({ row: row.rowNumber, document: row.documentNumber, recipient: row.recipientIdentification })),
    });
  }
  const year = Number(request.body.year);
  const month = Number(request.body.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) {
    return response.status(400).json({ error: "Seleccione un año y mes válidos." });
  }
  const existingKeys = await findExistingPurchaseKeys(companyId, imported.rows.map((row) => row.accessKey));
  const newRows = imported.rows.filter((row) => !existingKeys.has(row.accessKey));
  if (!newRows.length) return response.status(409).json({ error: `Las ${imported.rows.length} facturas del archivo ya están guardadas. No hay nada que consultar.` });
  const databaseBatchId = await createPurchaseBatch(companyId, year, month, request.file.originalname, newRows);
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
      year: String(request.body.year ?? "").trim(),
      month: String(request.body.month ?? "").trim(),
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
  if (!batch) return response.status(404).json({ error: "El lote no existe o la aplicacion fue reiniciada." });
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
  });
  if(batch.movement==="SALE")await saveSalesBatchResult(batch.databaseBatchId,batch.companyId,batch.metadata.ruc,batch.result);else await savePurchaseBatchResult(batch.databaseBatchId,batch.companyId,batch.metadata.ruc,batch.result);
  await persistBatch(batch);
  return response.json(batch.result);
});

app.post("/api/batches/:id/xml", upload.array("xmls", 500), async (request, response) => {
  const batch = batches.get(String(request.params.id));
  if (!batch) return response.status(404).json({ error: "El lote no existe o la aplicacion fue reiniciada." });
  if (!batch.result) return response.status(409).json({ error: "Primero debe procesar el lote." });
  const files = request.files as Express.Multer.File[] | undefined;
  if (!files?.length) return response.status(400).json({ error: "Seleccione al menos un XML." });
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
      const belongs=batch.movement==="SALE"?identificationsMatch(invoice.ruc,batch.metadata.ruc):identificationsMatch(invoice.recipientIdentification,batch.metadata.ruc);
      if(!belongs)throw new Error(`El XML no corresponde a la empresa ${batch.metadata.ruc}.`);
      const destination = path.join(xmlDir, `${invoice.accessKey}.xml`);
      await writeFile(destination, raw, "utf8");
      const current = batch.result.results.find((item) => item.accessKey === invoice.accessKey);
      if (current) {
        current.status = "XML_CARGADO_MANUAL";
        current.xmlPath = destination;
        current.authorizationNumber = invoice.authorizationNumber ?? invoice.accessKey;
        if (invoice.authorizationDate) current.authorizationDate = invoice.authorizationDate;
        current.message = `Cargado manualmente desde ${file.originalname}`;
      }
      accepted.push(invoice.accessKey);
    } catch (error) {
      rejected.push({ filename: file.originalname, error: error instanceof Error ? error.message : String(error) });
    }
  }
  batch.result.summary = summarize(batch.result.results);
  if(batch.movement==="SALE")await saveSalesBatchResult(batch.databaseBatchId,batch.companyId,batch.metadata.ruc,batch.result);else await savePurchaseBatchResult(batch.databaseBatchId,batch.companyId,batch.metadata.ruc,batch.result);
  await persistBatch(batch);
  return response.json({ accepted, rejected, result: batch.result });
});

app.get("/api/batches/:id", (request, response) => {
  const batch = batches.get(String(request.params.id));
  if (!batch) return response.status(404).json({ error: "Lote no encontrado." });
  return response.json(batch.result ?? { rows: batch.rows.map(initialRow) });
});

app.get("/api/batches/:id/excel", async (request, response) => {
  const batch = batches.get(String(request.params.id));
  if (!batch?.result) return response.status(409).json({ error: "Primero debe procesar el lote." });
  const data = await collectExcelData(batch.result.results, batch.metadata);
  const excelDir = path.join(config.outputDir, "excel");
  const previewDir = path.join(excelDir, `preview-${batch.id}`);
  await mkdir(excelDir, { recursive: true });
  const inputPath = path.join(excelDir, `${batch.id}.json`);
  const filename = `compras-${batch.metadata.year || "periodo"}-${batch.metadata.month || "00"}.xlsx`;
  const outputPath = path.join(excelDir, filename);
  await writeFile(inputPath, JSON.stringify(data), "utf8");
  const nodeBin = process.env.ARTIFACT_NODE_BIN || "C:\\Users\\Julio\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe";
  const builder = path.resolve("artifact-runtime", "build-excel.mjs");
  await execFileAsync(nodeBin, [builder, inputPath, outputPath, previewDir], { timeout: 120_000, maxBuffer: 5 * 1024 * 1024 });
  return response.download(outputPath, filename);
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ERROR] ${message}`);
  response.status(500).json({ error: message });
});

const port = Number(process.env.APP_PORT ?? "3000");
app.listen(port, "127.0.0.1", () => {
  console.log(`[INFO] Descargador SRI disponible en http://localhost:${port}`);
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
  await writeFile(path.join(directory, `${batch.id}.json`), JSON.stringify(batch, null, 2), "utf8");
}

function summarize(results: BatchItemResult[]) {
  const count = (status: BatchItemResult["status"]) => results.filter((item) => item.status === status).length;
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
  const body = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const taxId = String(body.taxId ?? "").trim();
  const businessName = String(body.businessName ?? "").trim();
  if (!/^\d{10,13}$/.test(taxId)) throw new Error("La identificacion debe tener entre 10 y 13 digitos.");
  if (businessName.length < 2 || businessName.length > 300) throw new Error("La razon social debe tener entre 2 y 300 caracteres.");
  const optional = (name: string, max: number) => {
    const text = String(body[name] ?? "").trim();
    if (text.length > max) throw new Error(`${name} supera la longitud permitida.`);
    return text || undefined;
  };
  const tradeName = optional("tradeName", 300);
  const email = optional("email", 320);
  const phone = optional("phone", 30);
  return { taxId, businessName, ...(tradeName ? { tradeName } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
}

function parseId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Identificador invalido.");
  return id;
}

function optionalPeriodNumber(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === "") return undefined;
  const number = Number(value); if (!Number.isInteger(number) || number < min || number > max) throw new Error("Filtro de período inválido."); return number;
}
function validateIsoDate(value: unknown, label: string): string { const text=String(value??"");if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(new Date(`${text}T00:00:00`).getTime()))throw new Error(`La ${label} no es válida.`);return text; }
