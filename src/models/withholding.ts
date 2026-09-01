export type WithholdingTaxType = "INCOME_TAX" | "VAT";
export interface WithholdingLine {
  taxType: WithholdingTaxType;
  taxCode: string;
  withholdingCode: string;
  taxableBase: number;
  percentage: number;
  value: number;
}
export interface WithholdingDocument {
  supportDocumentCode: string;
  supportDocumentNumber: string;
  supportAuthorizationNumber?: string;
  supportIssueDate?: string;
  lines: WithholdingLine[];
}
export interface NormalizedWithholding {
  version: string;
  accessKey: string;
  authorizationNumber: string;
  authorizationDate?: string;
  issueDate: string;
  issuerTaxId: string;
  issuerBusinessName: string;
  retainedSubjectId: string;
  retainedSubjectName: string;
  establishment: string;
  emissionPoint: string;
  sequential: string;
  documentNumber: string;
  documents: WithholdingDocument[];
  incomeTaxWithheld: number;
  vatWithheld: number;
  totalWithheld: number;
}
export interface StoredWithholding {
  id: number;
  accessKey: string;
  authorizationNumber: string;
  issueDate: string;
  documentNumber: string;
  issuerTaxId: string;
  issuerBusinessName: string;
  supportDocuments: string;
  incomeTaxWithheld: number;
  vatWithheld: number;
  totalWithheld: number;
  lineCount: number;
  documentCount: number;
  linkedDocumentCount: number;
}
export interface InvoiceWithholdingTotal {
  documentNumber: string;
  incomeTaxWithheld: number;
  vatWithheld: number;
}
