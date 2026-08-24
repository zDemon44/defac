export function validateAccessKey(value: string): string {
  const key = value.trim();
  if (!/^\d{49}$/.test(key)) {
    throw new Error("La clave de acceso debe contener exactamente 49 digitos numericos.");
  }

  const expectedDigit = calculateModulo11(key.slice(0, 48));
  const actualDigit = Number(key[48]);
  if (actualDigit !== expectedDigit) {
    throw new Error(
      `La clave no supera la validacion modulo 11 (digito esperado: ${expectedDigit}).`,
    );
  }
  return key;
}

function calculateModulo11(first48Digits: string): number {
  let factor = 2;
  let sum = 0;
  for (let index = first48Digits.length - 1; index >= 0; index -= 1) {
    sum += Number(first48Digits[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const result = 11 - (sum % 11);
  return result === 11 ? 0 : result === 10 ? 1 : result;
}
