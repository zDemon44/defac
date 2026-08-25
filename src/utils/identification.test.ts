import { describe, expect, it } from "vitest";
import { identificationsMatch } from "./identification.js";

describe("identificationsMatch", () => {
  it("acepta una cédula y su RUC natural terminado en 001", () => {
    expect(identificationsMatch("0912340486", "0912340486001")).toBe(true);
  });

  it("rechaza identificaciones de contribuyentes distintos", () => {
    expect(identificationsMatch("0912340486", "0999999999001")).toBe(false);
  });
});
