import { describe, expect, it } from "vitest";
import { importSriSalesTxt } from "./salesTxtImport.service.js";

describe("importSriSalesTxt",()=>{it("interpreta cliente, factura y clave del Facturador SRI",()=>{const text="FECHA_EMISION\tCOMPROBANTE\tNUMERO_COMPROBANTE\tIDENTIFICACION_RECEPTOR\tRAZON_SOCIAL\tCLAVE_ACCESO\tVALOR_TOTAL\n22/07/2026\tFactura\t001-002-000000028\t0992990554001\tCLIENTE S.A.\t2207202601091234048600120010020000000286137239310\t2200";const result=importSriSalesTxt(text);expect(result.rows).toHaveLength(1);expect(result.rows[0]).toMatchObject({documentNumber:"001-002-000000028",recipientIdentification:"0992990554001",issuerBusinessName:"CLIENTE S.A.",reportedTotal:2200})})});
