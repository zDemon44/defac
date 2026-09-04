import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, validPassword } from "./password.js";

describe("contraseñas", () => {
  it("valida longitud sin truncar la contraseña", () => {
    expect(validPassword("corta")).toBe(false);
    expect(validPassword("x".repeat(129))).toBe(false);
    expect(validPassword("una frase larga para la demo")).toBe(true);
  });
  it("usa sal aleatoria y rechaza contraseñas incorrectas", async () => {
    const password = "Frase de prueba no real 12345";
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).not.toContain(password);
    expect(first).not.toBe(second);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword("otra frase incorrecta", first)).toBe(false);
    expect(await verifyPassword(password, "invalid")).toBe(false);
  }, 15000);
});
