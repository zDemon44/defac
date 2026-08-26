import type { NormalizedInvoice, TaxAmount } from "../../models/invoice.js";
import type { PointDocSaleRow } from "../../models/pointDoc.js";

export function normalizePointDocSale(
  row: PointDocSaleRow,
  companyTaxId: string,
  companyBusinessName: string,
): NormalizedInvoice {
  const [establishment, emissionPoint, sequential] =
    row.documentNumber.split("-");
  if (!establishment || !emissionPoint || !sequential)
    throw new Error(`Fila ${row.rowNumber}: número de documento inválido.`);
  const taxes: TaxAmount[] = [
    {
      code: "2",
      percentageCode: "5",
      rate: 5,
      taxableBase: row.subtotal5,
      value: row.vat5,
    },
    {
      code: "2",
      percentageCode: "2",
      rate: 12,
      taxableBase: row.subtotal12,
      value: row.vat12,
    },
    {
      code: "2",
      percentageCode: "10",
      rate: 13,
      taxableBase: row.subtotal13,
      value: row.vat13,
    },
    {
      code: "2",
      percentageCode: "4",
      rate: 15,
      taxableBase: row.subtotal15,
      value: row.vat15,
    },
    {
      code: "2",
      percentageCode: "0",
      rate: 0,
      taxableBase: row.subtotal0,
      value: 0,
    },
    {
      code: "2",
      percentageCode: "6",
      taxableBase: row.subtotalNotTaxable,
      value: 0,
    },
    {
      code: "2",
      percentageCode: "7",
      taxableBase: row.subtotalExempt,
      value: 0,
    },
  ].filter((tax) => tax.taxableBase !== 0 || tax.value !== 0);
  return {
    type: "FACTURA",
    version: "PUNTO_DOC_EXCEL",
    ruc: companyTaxId,
    businessName: companyBusinessName,
    recipientIdentification: row.recipientIdentification,
    recipientBusinessName: row.recipientBusinessName,
    issueDate: row.issueDate,
    accessKey: row.accessKey,
    authorizationNumber: row.accessKey,
    authorizationDate: row.authorizationDate,
    establishment,
    emissionPoint,
    sequential,
    documentNumber: row.documentNumber,
    subtotal: row.subtotal,
    discount: 0,
    tip: 0,
    total: row.total,
    vatTotal: row.vat5 + row.vat12 + row.vat13 + row.vat15,
    taxes,
    vat: {
      base0: row.subtotal0,
      baseNotTaxable: row.subtotalNotTaxable,
      baseExempt: row.subtotalExempt,
      base0Consolidated:
        row.subtotal0 + row.subtotalNotTaxable + row.subtotalExempt,
      base5: row.subtotal5,
      base12: row.subtotal12,
      base13: row.subtotal13,
      base14: 0,
      base15: row.subtotal15,
      baseSpecial: 0,
      vat5: row.vat5,
      vat12: row.vat12,
      vat13: row.vat13,
      vat14: 0,
      vat15: row.vat15,
      vatSpecial: 0,
    },
    paymentMethods: [],
    details: [
      {
        description: row.description || "Resumen importado desde Excel",
        quantity: 1,
        unitPrice: row.subtotal,
        discount: 0,
        totalWithoutTax: row.subtotal,
        taxes,
      },
    ],
  };
}
