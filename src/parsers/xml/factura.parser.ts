import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { InvoiceDetail, NormalizedInvoice, TaxAmount, VatSummary } from "../../models/invoice.js";
import { asArray } from "../../utils/collections.js";
import { parseDecimal, roundMoney } from "../../utils/numbers.js";

type XmlRecord = Record<string, any>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
});

export function parseInvoiceXml(xml: string): NormalizedInvoice {
  validateXml(xml, "XML proporcionado");
  const outer = parser.parse(xml) as XmlRecord;
  let authorizationNumber: string | undefined;
  let authorizationDate: string | undefined;
  let invoiceRoot: XmlRecord;

  if (outer.autorizacion) {
    const authorization = outer.autorizacion as XmlRecord;
    if (String(authorization.estado ?? "").trim().toUpperCase() !== "AUTORIZADO") {
      throw new Error("El XML de autorizacion no tiene estado AUTORIZADO.");
    }
    authorizationNumber = optionalText(authorization.numeroAutorizacion);
    authorizationDate = optionalText(authorization.fechaAutorizacion);
    const embedded = authorization.comprobante;
    if (typeof embedded !== "string" || embedded.trim() === "") {
      throw new Error("La autorizacion no contiene el XML de la factura.");
    }
    validateXml(embedded, "XML interno de factura");
    const inner = parser.parse(embedded) as XmlRecord;
    invoiceRoot = inner.factura as XmlRecord;
  } else {
    invoiceRoot = outer.factura as XmlRecord;
  }

  if (!invoiceRoot || typeof invoiceRoot !== "object") {
    throw new Error("El archivo no contiene un nodo factura.");
  }

  const taxInfo = requiredObject(invoiceRoot.infoTributaria, "infoTributaria");
  const invoiceInfo = requiredObject(invoiceRoot.infoFactura, "infoFactura");
  const accessKey = requiredText(taxInfo.claveAcceso, "infoTributaria.claveAcceso");
  if (authorizationNumber && authorizationNumber !== accessKey) {
    throw new Error("El numero de autorizacion no coincide con la clave de acceso de la factura.");
  }

  const taxes = asArray<XmlRecord>(invoiceInfo.totalConImpuestos?.totalImpuesto).map(parseTax);
  const vat = buildVatSummary(taxes);
  const details = asArray<XmlRecord>(invoiceRoot.detalles?.detalle).map(parseDetail);
  const establishment = requiredText(taxInfo.estab, "infoTributaria.estab");
  const emissionPoint = requiredText(taxInfo.ptoEmi, "infoTributaria.ptoEmi");
  const sequential = requiredText(taxInfo.secuencial, "infoTributaria.secuencial");

  return {
    type: "FACTURA",
    version: optionalText(invoiceRoot["@_version"]) ?? "",
    ruc: requiredText(taxInfo.ruc, "infoTributaria.ruc"),
    businessName: requiredText(taxInfo.razonSocial, "infoTributaria.razonSocial"),
    issueDate: requiredText(invoiceInfo.fechaEmision, "infoFactura.fechaEmision"),
    accessKey,
    ...(authorizationNumber ? { authorizationNumber } : {}),
    ...(authorizationDate ? { authorizationDate } : {}),
    establishment,
    emissionPoint,
    sequential,
    documentNumber: `${establishment}-${emissionPoint}-${sequential}`,
    subtotal: parseDecimal(invoiceInfo.totalSinImpuestos, "totalSinImpuestos"),
    discount: parseDecimal(invoiceInfo.totalDescuento, "totalDescuento"),
    tip: parseDecimal(invoiceInfo.propina, "propina"),
    total: parseDecimal(invoiceInfo.importeTotal, "importeTotal"),
    vatTotal: roundMoney(taxes.filter((tax) => tax.code === "2").reduce((sum, tax) => sum + tax.value, 0)),
    vat,
    paymentMethods: asArray<XmlRecord>(invoiceInfo.pagos?.pago)
      .map((payment) => optionalText(payment.formaPago))
      .filter((value): value is string => Boolean(value)),
    details,
  };
}

function parseDetail(detail: XmlRecord): InvoiceDetail {
  const mainCode = optionalText(detail.codigoPrincipal);
  const auxiliaryCode = optionalText(detail.codigoAuxiliar);
  return {
    ...(mainCode ? { mainCode } : {}),
    ...(auxiliaryCode ? { auxiliaryCode } : {}),
    description: requiredText(detail.descripcion, "detalle.descripcion"),
    quantity: parseDecimal(detail.cantidad, "detalle.cantidad"),
    unitPrice: parseDecimal(detail.precioUnitario, "detalle.precioUnitario"),
    discount: parseDecimal(detail.descuento, "detalle.descuento"),
    totalWithoutTax: parseDecimal(detail.precioTotalSinImpuesto, "detalle.precioTotalSinImpuesto"),
    taxes: asArray<XmlRecord>(detail.impuestos?.impuesto).map(parseTax),
  };
}

function parseTax(tax: XmlRecord): TaxAmount {
  const rateText = optionalText(tax.tarifa);
  return {
    code: requiredText(tax.codigo, "impuesto.codigo"),
    percentageCode: requiredText(tax.codigoPorcentaje, "impuesto.codigoPorcentaje"),
    ...(rateText !== undefined ? { rate: parseDecimal(rateText, "impuesto.tarifa") } : {}),
    taxableBase: parseDecimal(tax.baseImponible, "impuesto.baseImponible"),
    value: parseDecimal(tax.valor, "impuesto.valor"),
  };
}

function buildVatSummary(taxes: TaxAmount[]): VatSummary {
  const summary: VatSummary = {
    base0: 0, baseNotTaxable: 0, baseExempt: 0, base0Consolidated: 0,
    base5: 0, base12: 0, base13: 0, base14: 0, base15: 0, baseSpecial: 0,
    vat5: 0, vat12: 0, vat13: 0, vat14: 0, vat15: 0, vatSpecial: 0,
  };
  for (const tax of taxes.filter((item) => item.code === "2")) {
    const baseKey: Record<string, keyof VatSummary> = {
      "0": "base0", "2": "base12", "3": "base14", "4": "base15", "5": "base5",
      "6": "baseNotTaxable", "7": "baseExempt", "8": "baseSpecial", "10": "base13",
    };
    const vatKey: Record<string, keyof VatSummary> = {
      "2": "vat12", "3": "vat14", "4": "vat15", "5": "vat5", "8": "vatSpecial", "10": "vat13",
    };
    const base = baseKey[tax.percentageCode];
    const value = vatKey[tax.percentageCode];
    if (base) summary[base] = roundMoney(summary[base] + tax.taxableBase);
    if (value) summary[value] = roundMoney(summary[value] + tax.value);
  }
  summary.base0Consolidated = roundMoney(summary.base0 + summary.baseNotTaxable + summary.baseExempt);
  return summary;
}

function validateXml(xml: string, label: string): void {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error(`${label} invalido: ${validation.err.msg}`);
}

function requiredObject(value: unknown, field: string): XmlRecord {
  if (!value || typeof value !== "object") throw new Error(`Falta el nodo ${field}.`);
  return value as XmlRecord;
}

function requiredText(value: unknown, field: string): string {
  const text = optionalText(value);
  if (!text) throw new Error(`Falta el valor ${field}.`);
  return text;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}
