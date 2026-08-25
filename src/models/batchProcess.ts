export type BatchStatus =
  | "DESCARGADO"
  | "YA_DESCARGADO"
  | "XML_CARGADO_MANUAL"
  | "FUERA_DE_RANGO"
  | "NO_ENCONTRADO"
  | "NO_AUTORIZADO"
  | "PENDIENTE"
  | "ERROR";

export interface BatchItemResult {
  accessKey: string;
  documentNumber: string;
  issuerBusinessName: string;
  status: BatchStatus;
  authorizationNumber?: string;
  authorizationDate?: string;
  xmlPath?: string;
  message?: string;
  processedAt: string;
}

export interface BatchSummary {
  total: number;
  downloaded: number;
  existing: number;
  manual: number;
  outsideRange: number;
  notFound: number;
  notAuthorized: number;
  pending: number;
  errors: number;
}

export interface BatchLog {
  startedAt: string;
  finishedAt: string;
  environment: "test" | "production";
  inputFile: string;
  summary: BatchSummary;
  results: BatchItemResult[];
}
