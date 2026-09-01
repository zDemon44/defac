import { validateAccessKey } from "../../utils/accessKey.js";
export function importWithholdingKeys(contents: string): string[] {
  const lines = contents
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2)
    throw new Error("El TXT de retenciones no contiene registros.");
  const headers = lines[0]!.split("\t").map((value) => value.trim());
  const keyIndex = headers.indexOf("CLAVE_ACCESO");
  if (keyIndex < 0)
    throw new Error("El TXT no contiene la columna CLAVE_ACCESO.");
  const keys = lines.slice(1).map((line, index) => {
    const key = line.split("\t")[keyIndex]?.trim() ?? "";
    try {
      validateAccessKey(key);
    } catch (error) {
      throw new Error(
        `Fila ${index + 2}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (key.slice(8, 10) !== "07")
      throw new Error(
        `Fila ${index + 2}: la clave no corresponde a un comprobante de retención (07).`,
      );
    return key;
  });
  return [...new Set(keys)];
}
