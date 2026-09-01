import { XMLParser, XMLValidator } from "fast-xml-parser";
import type {
  NormalizedWithholding,
  WithholdingDocument,
  WithholdingLine,
} from "../../models/withholding.js";
import { asArray } from "../../utils/collections.js";
import { parseDecimal, roundMoney } from "../../utils/numbers.js";
type XmlRecord = Record<string, any>;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
});
const text = (value: unknown, field: string) => {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`Falta ${field} en la retención.`);
  return result;
};
const optional = (value: unknown) => {
  const result = String(value ?? "").trim();
  return result || undefined;
};
const documentNumber = (value: unknown) => {
  const digits = text(value, "numDocSustento").replace(/\D/g, "");
  if (digits.length !== 15)
    throw new Error(`numDocSustento inválido: ${digits}.`);
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};
const line = (value: XmlRecord): WithholdingLine => {
  const code = text(value.codigo, "codigo");
  if (code !== "1" && code !== "2")
    throw new Error(`Tipo de retención no soportado: ${code}.`);
  return {
    taxType: code === "1" ? "INCOME_TAX" : "VAT",
    taxCode: code,
    withholdingCode: text(value.codigoRetencion, "codigoRetencion"),
    taxableBase: parseDecimal(value.baseImponible, "baseImponible"),
    percentage: parseDecimal(value.porcentajeRetener, "porcentajeRetener"),
    value: parseDecimal(value.valorRetenido, "valorRetenido"),
  };
};

export function parseWithholdingXml(xml: string): NormalizedWithholding {
  const validation = XMLValidator.validate(xml);
  if (validation !== true)
    throw new Error(`XML de retención inválido: ${validation.err.msg}`);
  const outer = parser.parse(xml) as XmlRecord;
  let root: XmlRecord;
  let authorizationNumber: string | undefined;
  let authorizationDate: string | undefined;
  if (outer.autorizacion) {
    const authorization = outer.autorizacion as XmlRecord;
    if (text(authorization.estado, "estado").toUpperCase() !== "AUTORIZADO")
      throw new Error("La retención no está AUTORIZADA.");
    authorizationNumber = optional(authorization.numeroAutorizacion);
    authorizationDate = optional(authorization.fechaAutorizacion);
    const embedded = authorization.comprobante;
    if (typeof embedded !== "string")
      throw new Error("La autorización no contiene el XML de retención.");
    root = (parser.parse(embedded) as XmlRecord).comprobanteRetencion;
  } else root = outer.comprobanteRetencion;
  if (!root) throw new Error("El XML no contiene comprobanteRetencion.");
  const tax = root.infoTributaria as XmlRecord;
  const info = root.infoCompRetencion as XmlRecord;
  const accessKey = text(tax.claveAcceso, "claveAcceso");
  if (text(tax.codDoc, "codDoc") !== "07")
    throw new Error("El XML no es un comprobante de retención.");
  if (authorizationNumber && authorizationNumber !== accessKey)
    throw new Error(
      "La autorización no coincide con la clave de la retención.",
    );
  const documents = new Map<string, WithholdingDocument>();
  const add = (
    codeValue: unknown,
    numberValue: unknown,
    auth: unknown,
    date: unknown,
    lines: WithholdingLine[],
  ) => {
    const code = text(codeValue, "codDocSustento").padStart(2, "0");
    if (code !== "01") return;
    const number = documentNumber(numberValue);
    const key = `${code}:${number}`;
    const current = documents.get(key) ?? {
      supportDocumentCode: code,
      supportDocumentNumber: number,
      ...(optional(auth)
        ? { supportAuthorizationNumber: optional(auth)! }
        : {}),
      ...(optional(date) ? { supportIssueDate: optional(date)! } : {}),
      lines: [],
    };
    current.lines.push(...lines);
    documents.set(key, current);
  };
  for (const doc of asArray<XmlRecord>(root.docsSustento?.docSustento))
    add(
      doc.codDocSustento,
      doc.numDocSustento,
      doc.numAutDocSustento,
      doc.fechaEmisionDocSustento,
      asArray<XmlRecord>(doc.retenciones?.retencion).map(line),
    );
  for (const item of asArray<XmlRecord>(root.impuestos?.impuesto))
    add(
      item.codDocSustento,
      item.numDocSustento,
      item.numAutDocSustento,
      item.fechaEmisionDocSustento,
      [line(item)],
    );
  const linked = [...documents.values()].filter((doc) => doc.lines.length);
  if (!linked.length)
    throw new Error(
      "La retención no está vinculada a una factura (codDocSustento 01 con numDocSustento).",
    );
  const lines = linked.flatMap((doc) => doc.lines);
  const income = roundMoney(
    lines
      .filter((item) => item.taxType === "INCOME_TAX")
      .reduce((sum, item) => sum + item.value, 0),
  );
  const vat = roundMoney(
    lines
      .filter((item) => item.taxType === "VAT")
      .reduce((sum, item) => sum + item.value, 0),
  );
  const estab = text(tax.estab, "estab"),
    point = text(tax.ptoEmi, "ptoEmi"),
    sequential = text(tax.secuencial, "secuencial");
  return {
    version: optional(root["@_version"]) ?? "",
    accessKey,
    authorizationNumber: authorizationNumber ?? accessKey,
    ...(authorizationDate ? { authorizationDate } : {}),
    issueDate: text(info.fechaEmision, "fechaEmision"),
    issuerTaxId: text(tax.ruc, "ruc"),
    issuerBusinessName: text(tax.razonSocial, "razonSocial"),
    retainedSubjectId: text(
      info.identificacionSujetoRetenido,
      "identificacionSujetoRetenido",
    ),
    retainedSubjectName: text(
      info.razonSocialSujetoRetenido,
      "razonSocialSujetoRetenido",
    ),
    establishment: estab,
    emissionPoint: point,
    sequential,
    documentNumber: `${estab}-${point}-${sequential}`,
    documents: linked,
    incomeTaxWithheld: income,
    vatWithheld: vat,
    totalWithheld: roundMoney(income + vat),
  };
}
