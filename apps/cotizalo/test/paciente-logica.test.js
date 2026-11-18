// Lógica pura de la app del paciente (sin navegador): la búsqueda tolerante a errores y la frase del anuncio
// de promociones.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aliasEncontrado,
  buscar,
  coincide,
  distancia,
  palabrasBuscadas,
  pidePerfiles,
} from "../public/js/busqueda.js";
import { enLista, frasePromo, sinPerfil } from "../public/js/frase-promo.js";

const nombres = (lista) => lista.map((x) => x.nombre);
const EXAMENES = [
  { nombre: "Hematología completa", alias: "hemograma" },
  { nombre: "Glicemia", alias: "glucemia, glucosa" },
  { nombre: "Glicemia post-prandeal" },
  { nombre: "Colesterol total" },
  { nombre: "HDL colesterol" },
  { nombre: "Urea" },
];
const buscarEx = (q) =>
  nombres(buscar(EXAMENES, palabrasBuscadas(q), (e) => [e.nombre, ...(e.alias || "").split(",")]));

test("búsqueda: sin acentos ni mayúsculas, palabras en cualquier orden", () => {
  assert.deepEqual(buscarEx("HEMATOLOGIA"), ["Hematología completa"]);
  assert.deepEqual(buscarEx("colesterol hdl"), ["HDL colesterol"]);
  assert.deepEqual(buscarEx(""), nombres(EXAMENES), "sin búsqueda, todo y en el mismo orden");
});

test("búsqueda: una letra equivocada, de más, de menos o cambiada de lugar", () => {
  assert.deepEqual(buscarEx("hemotologia"), ["Hematología completa"]);
  assert.deepEqual(buscarEx("colesterl"), ["Colesterol total", "HDL colesterol"]);
  assert.deepEqual(
    buscarEx("glicmeia"),
    ["Glicemia", "Glicemia post-prandeal"],
    "letras cambiadas",
  );
  assert.deepEqual(buscarEx("post prandial"), ["Glicemia post-prandeal"]);
  assert.deepEqual(buscarEx("hemotol"), ["Hematología completa"], "a medio escribir");
  // Palabras cortas: sin tolerancia (si no, «ure» encontraría cualquier cosa)
  assert.deepEqual(buscarEx("ure"), ["Urea"]);
  assert.deepEqual(buscarEx("ura"), []);
  assert.equal(distancia("hematologia", "hemotologia", 2), 1);
  assert.equal(distancia("abcdef", "uvwxyz", 2), 3, "corta al pasar del máximo");
});

test("búsqueda: lo que coincide tal cual va antes que lo que tiene un error", () => {
  assert.equal(coincide(["glicemia"], "Glicemia"), 2);
  assert.equal(coincide(["glisemia"], "Glicemia"), 1);
  assert.equal(coincide(["xyz"], "Glicemia"), 0);
  const lista = [{ nombre: "Glisemia rara" }, { nombre: "Glicemia" }];
  assert.deepEqual(
    nombres(buscar(lista, ["glicemia"], (x) => [x.nombre])),
    ["Glicemia", "Glisemia rara"],
  );
});

test("búsqueda: otros nombres, y cuándo decir «También llamado…»", () => {
  // «pandrial» está a tres cambios de «prandeal»: solo lo encuentra un otro nombre
  assert.deepEqual(buscarEx("post pandrial"), []);
  const conAlias = [{ nombre: "Glicemia post-prandeal", alias: "post-pandrial" }];
  assert.deepEqual(
    nombres(buscar(conAlias, palabrasBuscadas("post pandrial"), (e) => [e.nombre, e.alias])),
    ["Glicemia post-prandeal"],
  );
  assert.deepEqual(buscarEx("hemograma"), ["Hematología completa"]);
  assert.deepEqual(buscarEx("glucosa"), ["Glicemia"]);
  const glicemia = EXAMENES[1];
  assert.equal(aliasEncontrado(glicemia, ["glucemia"]), "glucemia", "coincide mejor que el nombre");
  assert.equal(aliasEncontrado(glicemia, ["glicemia"]), null, "el nombre ya coincide tal cual");
  assert.equal(aliasEncontrado(glicemia, []), null);
});

test("búsqueda: «perfil» pasa a la pestaña Perfiles y no se busca", () => {
  assert.equal(pidePerfiles("perfil lipid"), true);
  assert.equal(pidePerfiles("Perfiles"), true);
  assert.equal(pidePerfiles("perfilado"), false);
  assert.deepEqual(palabrasBuscadas("Perfil Lipídico"), ["lipidico"]);
});

// ─────────────── Frase del anuncio de promociones ───────────────
const CAT = {
  categorias: [
    { id: "hor", nombre: "hormonas" },
    { id: "coa", nombre: "Coagulación" },
    { id: "pat", nombre: "Patología" },
  ],
  examenes: new Map([
    ["gli", { nombre: "Glicemia", categoria_id: "qui" }],
    ["ure", { nombre: "urea", categoria_id: "qui" }],
    ["tsh", { nombre: "TSH", categoria_id: "hor" }],
  ]),
  perfiles: new Map([
    ["bas", { nombre: "Perfil básico" }],
    ["che", { nombre: "Chequeo ejecutivo" }],
    ["lip", { nombre: "Perfil de lípidos" }],
  ]),
};
const frase = (p) => {
  const f = frasePromo({ porcentaje: 20, categorias: [], perfiles: [], examenes: [], ...p }, CAT);
  return f && `${f.pct} ${f.texto}`;
};

test("anuncio: una frase por tipo de promoción, con mayúscula inicial y punto final", () => {
  assert.equal(frase({ examenes: ["gli"] }), "−20% en el examen: Glicemia.");
  assert.equal(frase({ examenes: ["gli", "ure"] }), "−20% en 2 exámenes.");
  assert.equal(frase({ categorias: ["hor"] }), "−20% en todos los exámenes de Hormonas.");
  assert.equal(
    frase({ categorias: ["hor", "coa", "pat"] }),
    "−20% en todos los exámenes de Hormonas, Coagulación y Patología.",
  );
  assert.equal(frase({ perfiles: ["bas"] }), "−20% en el perfil: Básico.");
  assert.equal(
    frase({ perfiles: ["bas", "che"] }),
    "−20% en los perfiles: Básico y Chequeo ejecutivo.",
  );
});

test("anuncio: mixto en orden categorías, perfiles, exámenes", () => {
  assert.equal(
    frase({ categorias: ["hor"], perfiles: ["bas"], examenes: ["gli", "ure"] }),
    "−20% en todos los exámenes de Hormonas, el perfil Básico y 2 exámenes más.",
  );
  assert.equal(
    frase({ perfiles: ["lip"], examenes: ["gli"] }),
    "−20% en el perfil Lípidos y el examen Glicemia.",
    "sin categorías y con un solo examen, se nombra",
  );
  // Un examen de una categoría que ya está en la promoción no se cuenta aparte
  assert.equal(
    frase({ categorias: ["hor"], examenes: ["tsh"] }),
    "−20% en todos los exámenes de Hormonas.",
  );
});

test("anuncio: lo que el paciente no ve no cuenta", () => {
  assert.equal(frase({ examenes: ["borrado"] }), null);
  assert.equal(frase({ examenes: ["borrado", "gli"] }), "−20% en el examen: Glicemia.");
  assert.equal(enLista([]), "");
  assert.equal(sinPerfil("Perfil"), "Perfil", "si el nombre es solo «Perfil», queda igual");
});
