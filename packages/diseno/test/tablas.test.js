// Orden de las tablas (js/tablas.js): cómo se comparan los valores de las celdas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { comoNumero, compararValores } from "../js/tablas.js";

test("los precios y cantidades se leen como números", () => {
  assert.equal(comoNumero("4,50 REF"), 4.5);
  assert.equal(comoNumero("1.234,56 Bs."), 1234.56);
  assert.equal(comoNumero("12"), 12);
  assert.equal(comoNumero("−25 %"), -25);
  assert.equal(comoNumero("Hematología"), null);
});

test("se ordena como número, en español y con los vacíos al final", () => {
  const orden = (xs) => xs.slice().sort(compararValores);
  assert.deepEqual(orden(["10,00 REF", "9,50 REF", "100"]), ["9,50 REF", "10,00 REF", "100"]);
  assert.deepEqual(orden(["Zinc", "ácido úrico", "Bilirrubina"]), [
    "ácido úrico",
    "Bilirrubina",
    "Zinc",
  ]);
  assert.deepEqual(orden(["", "B", "A"]), ["A", "B", ""]);
  assert.deepEqual(orden(["Perfil 10", "Perfil 9"]), ["Perfil 9", "Perfil 10"]);
});
