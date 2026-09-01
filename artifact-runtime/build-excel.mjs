import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const [inputPath, outputPath, previewDir] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Uso: build-excel.mjs <input.json> <output.xlsx> [preview-dir]");
const data = JSON.parse(await fs.readFile(inputPath, "utf8"));
const workbook = Workbook.create();
const green = "#176B4A", pale = "#E7F1EB", line = "#D8E3DC", ink = "#17251F", muted = "#64736B";

const reportLabel=data.metadata.reportLabel||"COMPRAS";
const groups=reportLabel==="COMPRAS Y VENTAS"?[{name:"Compras",movement:"PURCHASE"},{name:"Ventas",movement:"SALE"}]:[{name:reportLabel==="VENTAS"?"Ventas":"Compras",movement:reportLabel==="VENTAS"?"SALE":"PURCHASE"}];
for(const group of groups){const sheet=workbook.worksheets.add(group.name);buildInvoices(sheet,data.invoices.filter(item=>(item.movementType||"PURCHASE")===group.movement),group.name);}
for(const group of groups)console.log((await workbook.inspect({ kind: "table", range: `${group.name}!A1:${group.movement==="SALE"?"Q":"O"}20`, include: "values,formulas", tableMaxRows: 20, tableMaxCols: 17 })).ndjson);
console.log((await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "formula errors" })).ndjson);
if (previewDir) {
  await fs.mkdir(previewDir, { recursive: true });
  for (const sheetName of groups.map(group=>group.name)) {
    const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
    await fs.writeFile(path.join(previewDir, `${sheetName}.png`), new Uint8Array(await preview.arrayBuffer()));
  }
}
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await (await SpreadsheetFile.exportXlsx(workbook)).save(outputPath);

function buildInvoices(s,invoices,sheetLabel) {
  s.showGridLines=false;
  const isSales=sheetLabel==="Ventas"; const end=isSales?"Q":"O";
  const period=String(data.metadata.month||"").includes(" a ")?data.metadata.month:`${data.metadata.year||""}-${data.metadata.month||""}`;
  s.getRange(`A1:${end}1`).merge(); s.getRange("A1").values=[[`REPORTE DE ${sheetLabel.toUpperCase()} · COMPROBANTES ELECTRÓNICOS`]];
  s.getRange(`A1:${end}1`).format={fill:green,font:{bold:true,color:"#FFFFFF",size:16},rowHeight:32,verticalAlignment:"center"};
  s.getRange(`A2:${end}2`).values=[["Razón social",data.metadata.businessName||"No indicada","RUC",data.metadata.ruc?null:"No indicado","Período",period,"Documentos",invoices.length,`Total ${sheetLabel.toLowerCase()}`,null,null,null,null,null,null,...(isSales?[null,null]:[])]];
  if(data.metadata.ruc)s.getRange("D2").formulas=[[textFormula(data.metadata.ruc)]];
  s.getRange("J2").formulas=[[invoices.length?`=SUM(O7:O${6+invoices.length})`:"=0"]];
  s.getRange(`A2:${end}2`).format={fill:pale,font:{color:ink},rowHeight:27,verticalAlignment:"center"}; s.getRange("A2:I2").format.font={bold:true,color:ink}; s.getRange("J2").format={fill:"#D7EBDD",font:{bold:true,color:green},numberFormat:"#,##0.00"};
  s.getRange(`A4:${end}4`).merge(); s.getRange("A4").values=[["DETALLE muestra el primer producto o servicio de cada factura. BASE 0% consolida tarifa 0%, no objeto y exento."]]; s.getRange(`A4:${end}4`).format={font:{italic:true,color:muted},rowHeight:22};
  const headers=["RUC","RAZÓN SOCIAL","FACTURA","FECHA","DETALLE","BASE 0%","BASE 15%","BASE 5%","BASE TARIFA ESPECIAL","SUBTOTAL","IVA 15%","IVA 5%","IVA TARIFA ESPECIAL","PROPINA","TOTAL",...(isSales?["RETENCIÓN RENTA","RETENCIÓN IVA"]:[])];
  s.getRange(`A6:${end}6`).values=[headers]; styleHeader(s.getRange(`A6:${end}6`));
  const rows=invoices.map(({invoice,incomeTaxWithheld=0,vatWithheld=0})=>[null,isSales?(invoice.recipientBusinessName||"Consumidor final"):invoice.businessName,null,toDate(invoice.issueDate),invoice.details[0]?.description||"Sin detalle",invoice.vat.base0Consolidated,invoice.vat.base15,invoice.vat.base5,invoice.vat.baseSpecial,invoice.subtotal,invoice.vat.vat15,invoice.vat.vat5,invoice.vat.vatSpecial,invoice.tip,invoice.total,...(isSales?[incomeTaxWithheld,vatWithheld]:[])]);
  if(rows.length){s.getRange(`A7:${end}${6+rows.length}`).values=rows;for(let i=0;i<rows.length;i++){const invoice=invoices[i].invoice;s.getRange(`A${7+i}`).formulas=[[textFormula(isSales?invoice.recipientIdentification:invoice.ruc)]];s.getRange(`C${7+i}`).formulas=[[textFormula(invoice.documentNumber)]];}s.getRange(`D7:D${6+rows.length}`).format.numberFormat="dd/mm/yyyy";s.getRange(`F7:${end}${6+rows.length}`).format.numberFormat="#,##0.00";s.getRange(`A6:${end}${6+rows.length}`).format.borders={insideHorizontal:{style:"thin",color:line},bottom:{style:"thin",color:line}};const t=s.tables.add(`A6:${end}${6+rows.length}`,true,`${sheetLabel}Table`);t.style="TableStyleMedium4";t.showBandedRows=true;}
  s.freezePanes.freezeRows(6); widths(s,[16,38,22,13,55,14,14,14,20,14,14,14,20,12,14,...(isSales?[18,18]:[])]);
}
function buildDetails(){const s=detailSheet;s.showGridLines=false;const headers=["CLAVE DE ACCESO","FECHA","RUC","RAZÓN SOCIAL","FACTURA","CÓDIGO PRINCIPAL","CÓDIGO AUXILIAR","DESCRIPCIÓN","CANTIDAD","PRECIO UNITARIO","DESCUENTO","SUBTOTAL","TARIFA IVA","IVA","TOTAL"];title(s,"DETALLE DE PRODUCTOS Y SERVICIOS",headers.length);s.getRange("A4:O4").values=[headers];styleHeader(s.getRange("A4:O4"));const rows=[],ids=[];for(const {invoice} of data.invoices)for(const d of invoice.details){const taxes=d.taxes.filter(t=>t.code==="2");const rates=taxes.map(t=>t.rate).filter(v=>v!==undefined).join(" / ");const iva=round(taxes.reduce((a,t)=>a+t.value,0));rows.push([null,toDate(invoice.issueDate),null,invoice.businessName,null,null,null,d.description,d.quantity,d.unitPrice,d.discount,d.totalWithoutTax,rates?`${rates}%`:"",iva,round(d.totalWithoutTax+iva)]);ids.push([invoice.accessKey,invoice.ruc,invoice.documentNumber,d.mainCode||"",d.auxiliaryCode||""]);}if(rows.length){s.getRange(`A5:O${4+rows.length}`).values=rows;for(let i=0;i<rows.length;i++){const [key,ruc,doc,main,aux]=ids[i];s.getRange(`A${5+i}`).formulas=[[textFormula(key)]];s.getRange(`C${5+i}`).formulas=[[textFormula(ruc)]];s.getRange(`E${5+i}`).formulas=[[textFormula(doc)]];if(main)s.getRange(`F${5+i}`).formulas=[[textFormula(main)]];if(aux)s.getRange(`G${5+i}`).formulas=[[textFormula(aux)]];}s.getRange(`B5:B${4+rows.length}`).format.numberFormat="dd/mm/yyyy";s.getRange(`I5:L${4+rows.length}`).format.numberFormat="#,##0.000000";s.getRange(`N5:O${4+rows.length}`).format.numberFormat="#,##0.00";const t=s.tables.add(`A4:O${4+rows.length}`,true,"DetalleTable");t.style="TableStyleMedium4";t.showBandedRows=true;}s.freezePanes.freezeRows(4);widths(s,[52,13,16,34,22,18,18,42,13,16,14,14,13,12,14]);}
function buildAudit(){const s=auditSheet;s.showGridLines=false;const headers=["CLAVE DE ACCESO","ESTADO PROCESO","ARCHIVO XML","FECHA","BASE 0 REAL","NO OBJETO IVA","EXENTO IVA","BASE 12%","BASE 13%","BASE 14%","IVA 12%","IVA 13%","IVA 14%","IVA TOTAL XML"];title(s,"AUDITORÍA TRIBUTARIA Y TRAZABILIDAD",headers.length);s.getRange("A4:N4").values=[headers];styleHeader(s.getRange("A4:N4"));const rows=data.invoices.map(({invoice,process})=>[null,process.status,process.xmlPath||"",toDate(invoice.issueDate),invoice.vat.base0,invoice.vat.baseNotTaxable,invoice.vat.baseExempt,invoice.vat.base12,invoice.vat.base13,invoice.vat.base14,invoice.vat.vat12,invoice.vat.vat13,invoice.vat.vat14,invoice.vatTotal]);if(rows.length){s.getRange(`A5:N${4+rows.length}`).values=rows;for(let i=0;i<rows.length;i++)s.getRange(`A${5+i}`).formulas=[[textFormula(data.invoices[i].invoice.accessKey)]];s.getRange(`D5:D${4+rows.length}`).format.numberFormat="dd/mm/yyyy";s.getRange(`E5:N${4+rows.length}`).format.numberFormat="#,##0.00";const t=s.tables.add(`A4:N${4+rows.length}`,true,"AuditoriaTable");t.style="TableStyleMedium4";t.showBandedRows=true;}s.freezePanes.freezeRows(4);widths(s,[52,22,58,13,15,17,15,14,14,14,14,14,14,18]);}
function title(s,text,count){const end=columnName(count);s.getRange(`A1:${end}1`).merge();s.getRange("A1").values=[[text]];s.getRange(`A1:${end}1`).format={fill:green,font:{bold:true,color:"#FFFFFF",size:15},rowHeight:30,verticalAlignment:"center"};s.getRange(`A2:${end}2`).merge();s.getRange("A2").values=[[`Período: ${data.metadata.year||""}-${data.metadata.month||""} · ${data.metadata.businessName||"Sin razón social"}`]];s.getRange(`A2:${end}2`).format={fill:pale,font:{color:ink},rowHeight:24};}
function styleHeader(r){r.format={fill:green,font:{bold:true,color:"#FFFFFF",size:10},wrapText:true,rowHeight:32,verticalAlignment:"center",borders:{bottom:{style:"medium",color:green}}};}
function widths(s,values){values.forEach((v,i)=>s.getCell(0,i).format.columnWidth=v);}
function toDate(value){const [d,m,y]=String(value).split("/").map(Number);return new Date(Date.UTC(y,m-1,d));}
function round(v){return Math.round((v+Number.EPSILON)*100)/100;}
function textFormula(value){return `="​${String(value).replaceAll('"','""')}"`;}
function columnName(n){let value="";while(n){n--;value=String.fromCharCode(65+n%26)+value;n=Math.floor(n/26)}return value;}
