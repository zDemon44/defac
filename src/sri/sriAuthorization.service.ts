import type { Client } from "soap";

export interface SriMessage {
  identificador?: string;
  mensaje?: string;
  informacionAdicional?: string;
  tipo?: string;
}

export interface SriAuthorization {
  estado?: string;
  numeroAutorizacion?: string;
  fechaAutorizacion?: string | Date;
  ambiente?: string;
  comprobante?: string;
  mensajes?: { mensaje?: SriMessage | SriMessage[] };
}

export interface SriAuthorizationResponse {
  claveAccesoConsultada?: string;
  numeroComprobantes?: string;
  autorizaciones?: { autorizacion?: SriAuthorization | SriAuthorization[] };
}

export interface SriQueryResult {
  response: SriAuthorizationResponse;
  authorizations: SriAuthorization[];
  rawResponse: string;
}

export async function queryAuthorization(
  client: Client,
  accessKey: string,
): Promise<SriQueryResult> {
  const [result, rawResponse] = await client.autorizacionComprobanteAsync({
    claveAccesoComprobante: accessKey,
  }) as [
    { RespuestaAutorizacionComprobante?: SriAuthorizationResponse },
    string,
  ];

  const response = result.RespuestaAutorizacionComprobante;
  if (!response) {
    throw new Error("El SRI respondio sin RespuestaAutorizacionComprobante.");
  }

  const value = response.autorizaciones?.autorizacion;
  const authorizations = value ? (Array.isArray(value) ? value : [value]) : [];
  return { response, authorizations, rawResponse };
}
