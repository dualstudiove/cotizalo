// Ads: presupuesto mensual e impulsos (registro manual), permisos, validación y aislamiento entre clientes.
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { crearD1Local } from "@dualstudio/comun/servidor/d1-local";
import { olvidarCacheDeSecretos } from "@dualstudio/comun/servidor";
import worker from "../src/server.js";

const bindings = {
  DB: crearD1Local(":memory:"),
  SESSION_SECRET: "secreto-de-prueba-secreto-de-prueba-123",
  BASE_PATH: "/planifica",
  SUPER_EMAIL: "admin@dualstudio.app",
  SUPER_PASSWORD: "AdminDePrueba1",
};

function navegador() {
  const jar = {};
  return async function pedir(ruta, { method = "GET", body } = {}) {
    const h = { "x-app": "1" };
    if (body !== undefined) h["content-type"] = "application/json";
    if (Object.keys(jar).length) h.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await worker.fetch(
      new Request(`http://localhost/planifica${ruta}`, {
        method,
        headers: h,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
      bindings,
      { waitUntil: () => {} },
    );
    for (const c of res.headers.getSetCookie()) {
      const [par] = c.split(";");
      const i = par.indexOf("=");
      jar[par.slice(0, i)] = par.slice(i + 1);
    }
    const tipo = res.headers.get("content-type") || "";
    return { status: res.status, json: tipo.includes("json") ? await res.json() : null, res };
  };
}

const admin = navegador();
const editora = navegador();
const lectora = navegador();
const ajena = navegador();
const ids = {};

before(async () => {
  olvidarCacheDeSecretos();
  await admin("/api/login", { method: "POST", body: { email: "admin@dualstudio.app", password: "AdminDePrueba1" } });
  ids.a = (await admin("/api/admin/clientes", { method: "POST", body: { nombre: "Laboratorio" } })).json.id;
  ids.b = (await admin("/api/admin/clientes", { method: "POST", body: { nombre: "Otro" } })).json.id;
  for (const [k, email, rol, cli] of [["ed", "ana@x.co", "editor", ids.a], ["lec", "luis@x.co", "lector", ids.a], ["otra", "o@x.co", "editor", ids.b]]) {
    ids[k] = (await admin("/api/admin/usuarios", { method: "POST", body: { email, nombre: k, password: "Clave12345" } })).json.id;
    await admin("/api/admin/accesos", { method: "PUT", body: { usuario_id: ids[k], cliente_id: cli, rol } });
  }
  await editora("/api/login", { method: "POST", body: { email: "ana@x.co", password: "Clave12345" } });
  await lectora("/api/login", { method: "POST", body: { email: "luis@x.co", password: "Clave12345" } });
  await ajena("/api/login", { method: "POST", body: { email: "o@x.co", password: "Clave12345" } });
  ids.p = (await editora("/laboratorio/api/publicaciones", {
    method: "POST",
    body: { datos: { title: "Reel", format: "reel", date: "2026-11-10", status: "publicado" } },
  })).json.id;
  ids.pb = (await ajena("/otro/api/publicaciones", { method: "POST", body: { datos: { title: "Ajeno" } } })).json.id;
});

test("presupuesto del mes: guardar, cambiar, quitar; solo editores", async () => {
  const ruta = "/laboratorio/api/ads/presupuestos/2026-11";
  assert.equal((await lectora(ruta, { method: "PUT", body: { monto: 150 } })).status, 403);
  assert.equal((await editora("/laboratorio/api/ads/presupuestos/2026-13", { method: "PUT", body: { monto: 1 } })).status, 400);
  assert.equal((await editora(ruta, { method: "PUT", body: { monto: -5 } })).status, 400);
  assert.equal((await editora(ruta, { method: "PUT", body: { monto: "150,5", notas: "Aprobado el 1 nov" } })).status, 200);
  let d = await lectora("/laboratorio/api/datos");
  assert.deepEqual(d.json.ads.presupuestos["2026-11"], { monto: 150.5, notas: "Aprobado el 1 nov" });
  assert.equal((await editora(ruta, { method: "PUT", body: { monto: "" } })).status, 200);
  d = await lectora("/laboratorio/api/datos");
  assert.equal(d.json.ads.presupuestos["2026-11"], undefined);
  await editora(ruta, { method: "PUT", body: { monto: 150 } });
});

test("impulsos: registrar, editar, validar y borrar", async () => {
  const base = "/laboratorio/api/ads/impulsos";
  const ok = { publicacion_id: ids.p, inicio: "2026-11-10", fin: "2026-11-17", gastado: "35,5", objetivo: "mensajes", resultados: { alcance: 12400, clics: 86, mensajes: "41" }, notas: "Caracas" };
  assert.equal((await lectora(base, { method: "POST", body: ok })).status, 403);
  assert.equal((await editora(base, { method: "POST", body: { ...ok, publicacion_id: ids.pb } })).status, 400, "post de otro cliente");
  assert.equal((await editora(base, { method: "POST", body: { ...ok, fin: "2026-11-01" } })).status, 400, "fin antes de inicio");
  assert.equal((await editora(base, { method: "POST", body: { ...ok, objetivo: "ventas" } })).status, 400);
  assert.equal((await editora(base, { method: "POST", body: { ...ok, resultados: { alcance: -1 } } })).status, 400);
  const r = await editora(base, { method: "POST", body: ok });
  assert.equal(r.status, 200);
  ids.i = r.json.id;
  let d = await lectora("/laboratorio/api/datos");
  const i = d.json.ads.impulsos.find((x) => x.id === ids.i);
  assert.equal(i.gastado, 35.5);
  assert.deepEqual(i.resultados, { alcance: 12400, clics: 86, mensajes: 41 });
  assert.equal(i.origen, "manual");
  // Actualizar el gasto y un resultado mientras el impulso sigue activo
  assert.equal((await editora(`${base}/${ids.i}`, { method: "PATCH", body: { gastado: 40, resultados: { alcance: 15000, clics: 99 } } })).status, 200);
  assert.equal((await editora(`${base}/${ids.i}`, { method: "PATCH", body: { fin: "2026-11-01" } })).status, 400);
  d = await lectora("/laboratorio/api/datos");
  assert.deepEqual(d.json.ads.impulsos.find((x) => x.id === ids.i).resultados, { alcance: 15000, clics: 99 });
  // Otro cliente no lo ve ni lo toca
  assert.equal((await ajena(`/otro/api/ads/impulsos/${ids.i}`, { method: "PATCH", body: { gastado: 1 } })).status, 404);
  assert.equal((await ajena("/laboratorio/api/datos")).status, 404);
  assert.equal((await editora(`${base}/${ids.i}`, { method: "DELETE" })).status, 200);
  d = await lectora("/laboratorio/api/datos");
  assert.equal(d.json.ads.impulsos.length, 0);
});

test("borrar el post se lleva sus impulsos", async () => {
  await editora("/laboratorio/api/ads/impulsos", {
    method: "POST",
    body: { publicacion_id: ids.p, inicio: "2026-11-20", gastado: 10 },
  });
  await editora(`/laboratorio/api/publicaciones/${ids.p}`, { method: "DELETE" });
  const d = await lectora("/laboratorio/api/datos");
  assert.equal(d.json.ads.impulsos.length, 0);
});

test("vista del cliente: /<cliente>/preview existe", async () => {
  // En las pruebas no hay archivos estáticos (ASSETS): basta con que la ruta exista y no sea una dirección reservada.
  assert.notEqual((await editora("/laboratorio/preview")).status, 404);
  assert.equal((await editora("/admin/preview")).status, 404);
});
