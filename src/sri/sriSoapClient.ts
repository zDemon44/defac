import * as soap from "soap";
import type { Client } from "soap";

export async function createSriAuthorizationClient(
  wsdlUrl: string,
  timeoutMs: number,
): Promise<Client> {
  return soap.createClientAsync(wsdlUrl, {
    disableCache: true,
    wsdl_options: { timeout: timeoutMs },
  });
}
