import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importSriTxt } from "./txtImport.service.js";

describe("importSriTxt", () => {
  it("importa el archivo tabulado del SRI", () => {
    const content = readFileSync(path.resolve("ejemplo-txt-sri.txt.txt"), "utf8");
    const result = importSriTxt(content);
    expect(result.rows).toHaveLength(17);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.documentNumber).toBe("001-012-023285010");
    expect(result.rows[16]?.reportedTotal).toBe(34.81);
  });
});
