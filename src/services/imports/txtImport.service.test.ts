import { describe, expect, it } from "vitest";
import { importSriTxt } from "./txtImport.service.js";

describe("importSriTxt", () => {
  it("importa el archivo tabulado del SRI", () => {
    const content = "RUC_EMISOR\tRAZON_SOCIAL_EMISOR\tTIPO_COMPROBANTE\tSERIE_COMPROBANTE\tCLAVE_ACCESO\tFECHA_AUTORIZACION\tFECHA_EMISION\tIDENTIFICACION_RECEPTOR\tVALOR_SIN_IMPUESTOS\tIVA\tIMPORTE_TOTAL\n1791287541001\tPROVEEDOR SA\tFactura\t001-012-023285010\t0107202601179128754100120010120232850101030934210\t01/07/2026 02:15:28\t01/07/2026\t0912340486\t35.99\t5.40\t41.39";
    const result = importSriTxt(content);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.documentNumber).toBe("001-012-023285010");
    expect(result.rows[0]?.reportedTotal).toBe(41.39);
  });
});
