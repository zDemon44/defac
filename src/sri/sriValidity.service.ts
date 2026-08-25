import type { Client } from "soap";
import type { SriMessage } from "./sriAuthorization.service.js";
import { asArray } from "../utils/collections.js";

interface ValidityResponse {
  estadoConsulta?: string;
  claveAcceso?: string;
  estadoAutorizacion?: string;
  tipoComprobante?: string;
  rucEmisor?: string;
  fechaAutorizacion?: string | Date;
  mensajes?: { mensaje?: SriMessage | SriMessage[] };
}

export interface ValidityResult {
  queryStatus?: string;
  authorizationStatus?: string;
  authorizationDate?: string;
  messages: SriMessage[];
  rawResponse: string;
}

export async function queryValidity(client: Client, accessKey: string): Promise<ValidityResult> {
  const [result, rawResponse] = await client.consultarEstadoAutorizacionComprobanteAsync({
    claveAcceso: accessKey,
  }) as [{ EstadoAutorizacionComprobante?: ValidityResponse }, string];
  const response = result.EstadoAutorizacionComprobante;
  if (!response) throw new Error("El SRI respondio sin EstadoAutorizacionComprobante.");
  return {
    ...(response.estadoConsulta ? { queryStatus: response.estadoConsulta } : {}),
    ...(response.estadoAutorizacion ? { authorizationStatus: response.estadoAutorizacion } : {}),
    ...(response.fechaAutorizacion ? { authorizationDate: String(response.fechaAutorizacion) } : {}),
    messages: asArray(response.mensajes?.mensaje),
    rawResponse,
  };
}
