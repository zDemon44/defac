import type { ImportedInvoiceRow, TxtImportResult } from "../../models/importedInvoice.js";
import { validateAccessKey } from "../../utils/accessKey.js";
import { parseDecimal } from "../../utils/numbers.js";

const REQUIRED=["FECHA_EMISION","COMPROBANTE","NUMERO_COMPROBANTE","IDENTIFICACION_RECEPTOR","RAZON_SOCIAL","CLAVE_ACCESO","VALOR_TOTAL"];
export function importSriSalesTxt(content:string):TxtImportResult{
  const lines=content.replace(/^\uFEFF/,"").split(/\r?\n/).filter(line=>line.trim());if(!lines.length)throw new Error("El archivo TXT está vacío.");
  const delimiter=lines[0]?.includes("\t")?"\t":";";const headers=(lines[0]??"").split(delimiter).map(h=>h.trim().toUpperCase());const missing=REQUIRED.filter(h=>!headers.includes(h));if(missing.length)throw new Error(`Faltan columnas requeridas: ${missing.join(", ")}`);
  const index=Object.fromEntries(headers.map((h,i)=>[h,i]));const get=(cells:string[],h:string)=>cells[index[h]??-1]?.trim()??"";const rows:ImportedInvoiceRow[]=[];const errors:string[]=[];
  for(let i=1;i<lines.length;i++){const cells=(lines[i]??"").split(delimiter);const accessKey=get(cells,"CLAVE_ACCESO");let validationError:string|undefined;try{validateAccessKey(accessKey)}catch(error){validationError=error instanceof Error?error.message:String(error);errors.push(`Fila ${i+1}: ${validationError}`)}
    rows.push({rowNumber:i+1,issuerRuc:"",issuerBusinessName:get(cells,"RAZON_SOCIAL"),documentType:get(cells,"COMPROBANTE"),documentNumber:get(cells,"NUMERO_COMPROBANTE"),accessKey,authorizationDate:"",issueDate:get(cells,"FECHA_EMISION"),recipientIdentification:get(cells,"IDENTIFICACION_RECEPTOR"),reportedSubtotal:0,reportedVat:0,reportedTotal:parseDecimal(get(cells,"VALOR_TOTAL"),"VALOR_TOTAL"),modifiedDocumentNumber:"",...(validationError?{validationError}:{})});
  }return{rows,errors};
}
