export function parseDecimal(value: unknown, field: string): number {
  if (value === undefined || value === null || value === "") return 0;
  const normalized = String(value).trim().replace(",", ".");
  const number = Number(normalized);
  if (!Number.isFinite(number)) {
    throw new Error(`Valor numerico invalido en ${field}: ${String(value)}`);
  }
  return number;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
