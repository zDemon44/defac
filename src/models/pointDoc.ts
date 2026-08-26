export interface PointDocSaleRow {
  rowNumber: number;
  issueDate: string;
  documentNumber: string;
  recipientIdentification: string;
  recipientBusinessName: string;
  accessKey: string;
  authorizationDate: string;
  subtotal5: number;
  subtotal12: number;
  subtotal13: number;
  subtotal15: number;
  subtotal0: number;
  subtotalNotTaxable: number;
  subtotalExempt: number;
  subtotalIce: number;
  subtotal: number;
  vat5: number;
  vat12: number;
  vat13: number;
  vat15: number;
  ice: number;
  total: number;
  description?: string;
  sourcePath?: string;
}
