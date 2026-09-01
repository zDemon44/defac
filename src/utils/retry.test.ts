import { describe, expect, it, vi } from "vitest";
import { withRetry } from "./retry.js";

describe("withRetry", () => {
  it("reintenta errores temporales de certificado del endpoint SRI", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "Hostname/IP does not match certificate's altnames: IP: 181.113.227.222",
        ),
      )
      .mockResolvedValue("AUTORIZADO");
    await expect(withRetry(operation, 2, 1)).resolves.toBe("AUTORIZADO");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
