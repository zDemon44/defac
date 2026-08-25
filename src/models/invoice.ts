export interface TaxAmount {
  code: string;
  percentageCode: string;
  rate?: number;
  taxableBase: number;
  value: number;
}

export interface InvoiceDetail {
  mainCode?: string;
  auxiliaryCode?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  totalWithoutTax: number;
  taxes: TaxAmount[];
}

export interface VatSummary {
  base0: number;
  baseNotTaxable: number;
  baseExempt: number;
  base0Consolidated: number;
  base5: number;
  base12: number;
  base13: number;
  base14: number;
  base15: number;
  baseSpecial: number;
  vat5: number;
  vat12: number;
  vat13: number;
  vat14: number;
  vat15: number;
  vatSpecial: number;
}

export interface NormalizedInvoice {
  type: "FACTURA";
  version: string;
  ruc: string;
  businessName: string;
  recipientIdentification: string;
  recipientBusinessName?: string;
  issueDate: string;
  accessKey: string;
  authorizationNumber?: string;
  authorizationDate?: string;
  establishment: string;
  emissionPoint: string;
  sequential: string;
  documentNumber: string;
  subtotal: number;
  discount: number;
  tip: number;
  total: number;
  vatTotal: number;
  taxes: TaxAmount[];
  vat: VatSummary;
  paymentMethods: string[];
  details: InvoiceDetail[];
}
