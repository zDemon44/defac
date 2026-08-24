export interface ImportedInvoiceRow {
  rowNumber: number;
  issuerRuc: string;
  issuerBusinessName: string;
  documentType: string;
  documentNumber: string;
  accessKey: string;
  authorizationDate: string;
  issueDate: string;
  recipientIdentification: string;
  reportedSubtotal: number;
  reportedVat: number;
  reportedTotal: number;
  modifiedDocumentNumber: string;
  validationError?: string;
}

export interface TxtImportResult {
  rows: ImportedInvoiceRow[];
  errors: string[];
}
