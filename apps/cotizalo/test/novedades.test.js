// Novedades del catálogo: exámenes solo dentro de un perfil, indicaciones de perfiles, aviso de categorías,
// promociones por periodo, edición en lote, CSV, paleta de colores y fecha de precios puesta a mano.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { crearEntorno, levantar } from "./ayudas.js";

let server;
let port;
const admin = {};

async function pedir(path, { method = "GET", body, jar } = {}) {
  const headers = { "x-app": "1" };
  if (body) headers["content-type"] = "application/json";
  if (jar && Object.keys(jar).length) {
    headers.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  }
  const r = await fetch(`http://127.0.0.1:${port}/cotizalo/demo${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (jar) {
    for (const c of r.headers.getSetCookie()) {
      const [par] = c.split(";");
      const i = par.indexOf("=");
      jar[par.slice(0, i)] = par.slice(i + 1);
    }
  }
  const texto = await r.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch { /* no es JSON */ }
  return { status: r.status, json, texto, headers: r.headers };
}
const comoAdmin = (path, o = {}) => pedir(path, { ...o, jar: admin });
const catalogoAdmin = async () => (await comoAdmin("/api/admin/catalogo")).json;
const catalogoPublico = async () => (await pedir("/api/publico/catalogo")).json;
const hoyLocal = () => new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);

before(async () => {
  const bindings = await crearEntorno({ BASE_PATH: "/cotizalo" });
  const { configurarEnv } = await import("../src/env.js");
  const { bindD1 } = await import("@dualstudio/comun/servidor");
  configurarEnv(bindings);
  bindD1(bindings.DB);
  const { sembrar } = await import("../src/seed.js");
  await sembrar({ demo: true });
  const worker = (await import("../src/server.js")).default;
  ({ server, port } = await levantar(worker, bindings));
  const r = await pedir("/api/admin/login", {
    method: "POST",
    body: { email: "admin@demo.test", password: "Demo12345" },
    jar: admin,
  });
  assert.equal(r.status, 200);
});
after(() => server?.close());

test("un examen solo en perfil no aparece suelto, no tiene precio y sí va dentro del perfil", async () => {
  const c = await catalogoAdmin();
  const hdl = c.examenes.find((e) => e.nombre === "HDL colesterol");
  const r = await comoAdmin(`/api/admin/examenes/${hdl.id}`, {
    method: "PUT",
    body: { solo_en_perfil: true },
  });
  assert.equal(r.status, 200);
  const despues = (await catalogoAdmin()).examenes.find((e) => e.id === hdl.id);
  assert.equal(despues.solo_en_perfil, 1);
  assert.equal(despues.precio_cent, 0, "no tiene precio propio");
  const pub = await catalogoPublico();
  assert.ok(!pub.examenes.some((e) => e.id === hdl.id), "el paciente no lo ve suelto");
  const lipidico = pub.perfiles.find((p) => p.nombre === "Perfil lipídico");
  assert.ok(lipidico.examenes.some((m) => m.id === hdl.id), "sigue dentro del perfil");
  assert.ok(
    lipidico.examenes.every((m) => m.categoria_id),
    "los exámenes del perfil traen su categoría",
  );
  // No se puede pedir suelto
  const pres = await pedir("/api/publico/presupuesto", {
    method: "POST",
    body: { items: [{ tipo: "examen", id: hdl.id }] },
  });
  assert.equal(pres.status, 409);
  // Quitarle «solo en perfil» exige un precio
  const sinPrecio = await comoAdmin(`/api/admin/examenes/${hdl.id}`, {
    method: "PUT",
    body: { solo_en_perfil: false },
  });
  assert.equal(sinPrecio.status, 400);
  assert.match(sinPrecio.json.error, /necesita un precio/);
});

test("indicaciones de los perfiles: en el catálogo y en el presupuesto", async () => {
  const c = await catalogoAdmin();
  const p = c.perfiles.find((x) => x.nombre === "Perfil lipídico");
  await comoAdmin(`/api/admin/perfiles/${p.id}`, {
    method: "PUT",
    body: { indicaciones: "Ayuno de 12 horas" },
  });
  assert.equal(
    (await catalogoAdmin()).perfiles.find((x) => x.id === p.id).indicaciones,
    "Ayuno de 12 horas",
  );
  const pub = (await catalogoPublico()).perfiles.find((x) => x.id === p.id);
  assert.equal(pub.indicaciones, "Ayuno de 12 horas");
  const pres = await pedir("/api/publico/presupuesto", {
    method: "POST",
    body: { items: [{ tipo: "perfil", id: p.id }] },
  });
  assert.equal(pres.status, 200);
  assert.equal(pres.json.items[0].indicaciones, "Ayuno de 12 horas");
});

test("aviso propio de una categoría con exámenes repetibles", async () => {
  const c = await catalogoAdmin();
  const k = c.categorias[0];
  await comoAdmin(`/api/admin/categorias/${k.id}`, {
    method: "PUT",
    body: {
      max_por_examen: 3,
      aviso_repetible: "En exámenes patológicos se pueden analizar varias muestras.",
    },
  });
  const pub = (await catalogoPublico()).categorias.find((x) => x.id === k.id);
  assert.equal(pub.aviso_repetible, "En exámenes patológicos se pueden analizar varias muestras.");
});

test("promociones: la mayor gana, el presupuesto guarda el precio con descuento y respeta las fechas", async () => {
  const c = await catalogoAdmin();
  const tri = c.examenes.find((e) => e.nombre === "Triglicéridos");
  const hoy = hoyLocal();
  // 10 % a toda su categoría y 25 % al examen: se aplica el 25 %
  const a = await comoAdmin("/api/admin/promociones", {
    method: "POST",
    body: {
      nombre: "Mes de la química",
      porcentaje: 10,
      desde: hoy,
      hasta: hoy,
      items: [{ tipo: "categoria", id: tri.categoria_id }],
    },
  });
  const b = await comoAdmin("/api/admin/promociones", {
    method: "POST",
    body: {
      nombre: "Hoy triglicéridos",
      porcentaje: 25,
      desde: hoy,
      hasta: hoy,
      items: [{ tipo: "examen", id: tri.id }],
    },
  });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const pub = (await catalogoPublico()).examenes.find((e) => e.id === tri.id);
  assert.equal(pub.precio_lista_cent, tri.precio_cent);
  assert.equal(pub.precio_cent, Math.round(tri.precio_cent * 0.75));
  assert.equal(pub.promo.porcentaje, 25);
  const pres = await pedir("/api/publico/presupuesto", {
    method: "POST",
    body: { items: [{ tipo: "examen", id: tri.id }] },
  });
  assert.equal(pres.json.items[0].precio_cent, Math.round(tri.precio_cent * 0.75));
  assert.equal(pres.json.items[0].descuento_pct, 25);
  assert.equal(pres.json.items[0].promo_hasta, pub.promo.hasta); // el PDF muestra hasta cuándo dura
  assert.equal(pres.json.total_ref_cent, Math.round(tri.precio_cent * 0.75));
  // Pausada, deja de aplicarse
  await comoAdmin(`/api/admin/promociones/${b.json.id}`, {
    method: "PUT",
    body: { activo: false },
  });
  assert.equal(
    (await catalogoPublico()).examenes.find((e) => e.id === tri.id).promo.porcentaje,
    10,
  );
  // Una promoción que empieza mañana no se aplica hoy
  const manana = new Date(Date.now() + 20 * 3600_000).toISOString().slice(0, 10);
  const lista = (await comoAdmin("/api/admin/promociones")).json;
  assert.equal(lista.promociones.find((p) => p.id === b.json.id).estado, "pausada");
  await comoAdmin(`/api/admin/promociones/${a.json.id}`, {
    method: "PUT",
    body: {
      nombre: "Mes de la química",
      porcentaje: 10,
      desde: manana > hoy ? manana : "2999-01-01",
      hasta: "2999-12-31",
      items: [{ tipo: "categoria", id: tri.categoria_id }],
    },
  });
  assert.equal((await catalogoPublico()).examenes.find((e) => e.id === tri.id).promo, null);
  // Validaciones
  const mal = await comoAdmin("/api/admin/promociones", {
    method: "POST",
    body: {
      nombre: "x",
      porcentaje: 95,
      desde: hoy,
      hasta: hoy,
      items: [{ tipo: "examen", id: tri.id }],
    },
  });
  assert.equal(mal.status, 400);
  const ajena = await comoAdmin("/api/admin/promociones", {
    method: "POST",
    body: {
      nombre: "x",
      porcentaje: 10,
      desde: hoy,
      hasta: hoy,
      items: [{ tipo: "examen", id: "no-existe" }],
    },
  });
  assert.equal(ajena.status, 400);
  await comoAdmin(`/api/admin/promociones/${a.json.id}`, { method: "DELETE" });
  await comoAdmin(`/api/admin/promociones/${b.json.id}`, { method: "DELETE" });
});

test("edición en lote de exámenes: crea, actualiza, crea categorías y no guarda nada si una fila falla", async () => {
  const antes = await catalogoAdmin();
  const glic = antes.examenes.find((e) => e.nombre === "Glicemia");
  const sim = await comoAdmin("/api/admin/examenes/lote", {
    method: "POST",
    body: {
      simular: true,
      filas: [
        { id: glic.id, nombre: "Glicemia", precio_cent: 999 },
        { nombre: "Ferritina", categoria: "Hormonas", precio_cent: 1500 },
        { nombre: "Biopsia de piel", categoria: "Patología", precio_cent: 4000 },
      ],
    },
  });
  assert.deepEqual(
    {
      c: sim.json.creados,
      a: sim.json.actualizados,
      g: sim.json.guardado,
      n: sim.json.categorias_nuevas,
    },
    { c: 2, a: 1, g: false, n: ["Patología"] },
  );
  assert.equal((await catalogoAdmin()).examenes.length, antes.examenes.length, "simular no guarda");
  // Una fila mala: no se guarda ninguna
  const mala = await comoAdmin("/api/admin/examenes/lote", {
    method: "POST",
    body: {
      filas: [{ nombre: "Nuevo bueno", categoria: "Hormonas", precio_cent: 100 }, {
        nombre: "",
        categoria: "Hormonas",
        precio_cent: 100,
      }],
    },
  });
  assert.equal(mala.status, 400);
  assert.match(mala.json.error, /^Fila 2:/);
  assert.ok(!(await catalogoAdmin()).examenes.some((e) => e.nombre === "Nuevo bueno"));
  // Nombre repetido dentro del lote
  const dup = await comoAdmin("/api/admin/examenes/lote", {
    method: "POST",
    body: {
      filas: [{ nombre: "Uno", categoria: "Hormonas", precio_cent: 1 }, {
        nombre: "uno",
        categoria: "Hormonas",
        precio_cent: 2,
      }],
    },
  });
  assert.equal(dup.status, 409);
  // De verdad
  const ok = await comoAdmin("/api/admin/examenes/lote", {
    method: "POST",
    body: {
      filas: [
        { id: glic.id, nombre: "Glicemia", precio_cent: 999 },
        { nombre: "Ferritina", categoria: "Hormonas", precio_cent: 1500 },
        { nombre: "Biopsia de piel", categoria: "Patología", precio_cent: 4000 },
      ],
    },
  });
  assert.equal(ok.json.guardado, true);
  const c = await catalogoAdmin();
  assert.equal(c.examenes.find((e) => e.id === glic.id).precio_cent, 999);
  assert.ok(c.categorias.some((k) => k.nombre === "Patología"));
  assert.ok(c.examenes.some((e) => e.nombre === "Biopsia de piel"));
});

test("CSV: exportar exámenes y perfiles, e importar perfiles por nombre de examen", async () => {
  const ex = await comoAdmin("/api/admin/csv/examenes");
  assert.equal(ex.status, 200);
  assert.match(ex.headers.get("content-type"), /text\/csv/);
  assert.match(
    ex.texto,
    /Nombre;Categoría;Precio \(REF\);Indicaciones;Descripción;Solo en perfil;Activo/,
  );
  assert.match(ex.texto, /HDL colesterol;[^;\n]*;;/, "un examen solo en perfil no lleva precio");
  const pf = await comoAdmin("/api/admin/csv/perfiles");
  assert.match(pf.texto, /Perfil lipídico;[\d,]+;[^;]*HDL colesterol/);
  const imp = await comoAdmin("/api/admin/perfiles/lote", {
    method: "POST",
    body: {
      filas: [{ nombre: "Perfil hierro", precio_cent: 2500, examenes: ["Ferritina", "Glicemia"] }],
    },
  });
  assert.equal(imp.json.creados, 1);
  const c = await catalogoAdmin();
  const p = c.perfiles.find((x) => x.nombre === "Perfil hierro");
  assert.equal(p.examen_ids.length, 2);
  const malo = await comoAdmin("/api/admin/perfiles/lote", {
    method: "POST",
    body: { filas: [{ nombre: "Perfil x", precio_cent: 100, examenes: ["No existe"] }] },
  });
  assert.equal(malo.status, 400);
  assert.match(malo.json.error, /no existe/);
});

test("paleta de colores: solo se elige de la lista, y un color viejo se muestra con el más parecido", async () => {
  const cfg = (await comoAdmin("/api/admin/config")).json;
  assert.equal(cfg.paleta.length, 20);
  const libre = await comoAdmin("/api/admin/config", {
    method: "PUT",
    body: { color_principal: "#ffff00" },
  });
  assert.equal(libre.status, 400);
  const ok = await comoAdmin("/api/admin/config", {
    method: "PUT",
    body: { color_principal: "#6d3fd1" },
  });
  assert.equal(ok.status, 200);
  assert.equal((await pedir("/api/publico/config")).json.negocio.color, "#6d3fd1");
  // El color de ejemplo de antes (#0e7c86) no está en la paleta: el paciente ve el más parecido
  const { colorSeguro, esColorDePaleta } = await import("../src/paleta.js");
  assert.equal(esColorDePaleta("#0e7c86"), false);
  assert.equal(colorSeguro("#0e7c86"), "#0b707a");
  assert.equal(colorSeguro("no es color"), "#0b707a");
});
