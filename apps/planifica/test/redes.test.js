// Métricas de Instagram: conectar con un token, vincular posts, actualizar (tarea de la mañana y botón),
// miniaturas, resultados y aislamiento. Instagram se simula interceptando fetch.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { crearD1Local } from "@dualstudio/comun/servidor/d1-local";
import { olvidarCacheDeSecretos } from "@dualstudio/comun/servidor";
import worker, { scheduled } from "../src/server.js";

const IG = "https://graph.test";
const bindings = {
  DB: crearD1Local(":memory:"),
  SESSION_SECRET: "secreto-de-prueba-secreto-de-prueba-123",
  BASE_PATH: "/planifica",
  SUPER_EMAIL: "admin@dualstudio.app",
  SUPER_PASSWORD: "AdminDePrueba1",
  IG_API_BASE: IG,
};

// ── Instagram simulado ──
const TOKEN = "IGAAtokenDePrueba1234567890abcdef";
const sim = {
  llamadas: [],
  seguidores: 1200,
  medios: [
    { id: "m1", shortcode: "DfvUhXsG4qa", media_type: "VIDEO", media_product_type: "REELS", timestamp: "2026-11-10T22:00:00+0000", thumbnail_url: `${IG}/img/m1.jpg`, permalink: "https://www.instagram.com/reel/DfvUhXsG4qa/" },
    { id: "m2", shortcode: "Abc123xyz", media_type: "IMAGE", media_product_type: "FEED", timestamp: "2026-11-05T15:00:00+0000", media_url: `${IG}/img/m2.jpg`, permalink: "https://www.instagram.com/p/Abc123xyz/" },
  ],
  likes: { m1: 40, m2: 12 },
  tokenMalo: false,
};
const respuesta = (j, status = 200) =>
  new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
const fetchReal = globalThis.fetch;

before(() => {
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== IG) return fetchReal(input);
    sim.llamadas.push(url.pathname);
    const token = url.searchParams.get("access_token");
    if (url.pathname.startsWith("/img/")) {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    }
    if (sim.tokenMalo || (token && !token.startsWith("IGAA"))) {
      return respuesta({ error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 } }, 400);
    }
    const p = url.pathname.replace(/^\/v[\d.]+/, "");
    if (p === "/me") {
      return respuesta({ user_id: "1784", username: "laboratoriorh", followers_count: sim.seguidores, media_count: 2 });
    }
    if (p === "/1784/media") return respuesta({ data: sim.medios, paging: {} });
    const mi = /^\/(m\d+)\/insights$/.exec(p);
    if (mi) {
      const id = mi[1];
      const metric = url.searchParams.get("metric");
      if (id === "m2" && metric.includes("views")) {
        return respuesta({ error: { message: "views no está disponible", type: "OAuthException", code: 100 } }, 400);
      }
      const v = { reach: 900, views: 2000, likes: sim.likes[id], comments: 5, shares: 3, saved: 7, total_interactions: sim.likes[id] + 15 };
      return respuesta({
        data: metric.split(",").map((name) => ({ name, values: [{ value: v[name] }] })),
      });
    }
    if (p === "/1784/insights") {
      if (url.searchParams.get("metric") === "online_followers") {
        return respuesta({ data: [{ name: "online_followers", values: [{ value: { 0: 10, 12: 50 }, end_time: "2026-11-16T08:00:00+0000" }] }] });
      }
      return respuesta({
        data: [
          { name: "reach", total_value: { value: 3000 } },
          { name: "views", total_value: { value: 5000 } },
          { name: "accounts_engaged", total_value: { value: 120 } },
          { name: "total_interactions", total_value: { value: 300 } },
        ],
      });
    }
    return respuesta({ error: { message: `ruta desconocida ${p}`, code: 100 } }, 404);
  };
});
after(() => {
  globalThis.fetch = fetchReal;
});

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
let ids = {};

before(async () => {
  olvidarCacheDeSecretos();
  await admin("/api/login", { method: "POST", body: { email: "admin@dualstudio.app", password: "AdminDePrueba1" } });
  ids.a = (await admin("/api/admin/clientes", { method: "POST", body: { nombre: "Laboratorio RH" } })).json.id;
  ids.b = (await admin("/api/admin/clientes", { method: "POST", body: { nombre: "Otro" } })).json.id;
  for (const [k, email, rol] of [["ed", "ana@x.co", "editor"], ["lec", "luis@x.co", "lector"]]) {
    ids[k] = (await admin("/api/admin/usuarios", { method: "POST", body: { email, nombre: k, password: "Clave12345" } })).json.id;
    await admin("/api/admin/accesos", { method: "PUT", body: { usuario_id: ids[k], cliente_id: ids.a, rol } });
  }
  await editora("/api/login", { method: "POST", body: { email: "ana@x.co", password: "Clave12345" } });
  await lectora("/api/login", { method: "POST", body: { email: "luis@x.co", password: "Clave12345" } });
});

test("conectar Instagram: solo administradores, token comprobado y nunca visible", async () => {
  const ruta = `/api/admin/clientes/${ids.a}/redes/ig`;
  assert.equal((await editora(ruta, { method: "PUT", body: { token: TOKEN } })).status, 403);
  assert.equal((await admin(ruta, { method: "PUT", body: { token: "corto" } })).status, 400);
  assert.equal((await admin(ruta, { method: "PUT", body: { token: "XXXXtokenQueInstagramRechaza123456" } })).status, 400);
  const r = await admin(ruta, { method: "PUT", body: { token: TOKEN } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.usuario, "laboratoriorh");
  const fila = await bindings.DB.prepare("SELECT token FROM redes_conexiones WHERE cliente_id = ?").bind(ids.a).first();
  assert.match(fila.token, /^v1:/);
  assert.ok(!fila.token.includes(TOKEN), "el token se guarda cifrado");
  const d = await lectora("/laboratorio-rh/api/datos");
  assert.equal(d.json.redes.ig.usuario, "laboratoriorh");
  assert.ok(!JSON.stringify(d.json).includes(TOKEN));
  const res = await admin("/api/admin/resumen");
  assert.equal(res.json.clientes.find((c) => c.id === ids.a).instagram.usuario, "laboratoriorh");
  assert.ok(!JSON.stringify(res.json).includes(TOKEN));
});

test("vincular un post por su link y traer sus métricas", async () => {
  const p = await editora("/laboratorio-rh/api/publicaciones", {
    method: "POST",
    body: { datos: { title: "Reel", format: "reel", date: "2026-11-10", status: "publicado" } },
  });
  ids.p1 = p.json.id;
  await editora(`/laboratorio-rh/api/publicaciones/${ids.p1}`, {
    method: "PATCH",
    body: { cambios: { igLink: "https://www.instagram.com/p/DfvUhXsG4qa/?utm_source=ig_web_copy_link" } },
  });
  assert.equal((await lectora("/laboratorio-rh/api/redes/vincular", { method: "POST", body: { publicacion_id: ids.p1, red: "ig" } })).status, 403);
  const v = await editora("/laboratorio-rh/api/redes/vincular", { method: "POST", body: { publicacion_id: ids.p1, red: "ig" } });
  assert.equal(v.status, 200);
  assert.equal(v.json.ok, true);
  const d = await lectora("/laboratorio-rh/api/datos");
  const m = d.json.metricas[ids.p1].ig;
  assert.equal(m.encontrado, true);
  assert.equal(m.tipo, "REELS");
  assert.deepEqual(
    [m.m.likes, m.m.comentarios, m.m.compartidos, m.m.guardados, m.m.alcance, m.m.reproducciones],
    [40, 5, 3, 7, 900, 2000],
  );
  assert.equal(m.falta_miniatura, true);

  // Un post de foto: Meta no acepta «views» y se reintenta con las básicas.
  const p2 = await editora("/laboratorio-rh/api/publicaciones", {
    method: "POST",
    body: { datos: { title: "Foto", format: "foto", igLink: "instagram.com/p/Abc123xyz" } },
  });
  ids.p2 = p2.json.id;
  await editora("/laboratorio-rh/api/redes/vincular", { method: "POST", body: { publicacion_id: ids.p2, red: "ig" } });
  const m2 = (await editora("/laboratorio-rh/api/datos")).json.metricas[ids.p2].ig;
  assert.equal(m2.m.likes, 12);
  assert.equal(m2.m.reproducciones, undefined);

  // Un link que no es de la cuenta
  const p3 = await editora("/laboratorio-rh/api/publicaciones", {
    method: "POST",
    body: { datos: { title: "Ajeno", igLink: "https://www.instagram.com/p/NoExiste99/" } },
  });
  await editora("/laboratorio-rh/api/redes/vincular", { method: "POST", body: { publicacion_id: p3.json.id, red: "ig" } });
  const m3 = (await editora("/laboratorio-rh/api/datos")).json.metricas[p3.json.id].ig;
  assert.equal(m3.encontrado, false);
  assert.match(m3.error, /No encontramos ese post en @laboratoriorh/);

  // Quitar el link desvincula
  await editora(`/laboratorio-rh/api/publicaciones/${p3.json.id}`, { method: "PATCH", body: { cambios: { igLink: "" } } });
  assert.equal((await editora("/laboratorio-rh/api/datos")).json.metricas[p3.json.id], undefined);
});

test("miniatura propia: se descarga por el Worker, se sube y se borra con el post", async () => {
  const r = await editora(`/laboratorio-rh/api/redes/miniatura-remota/${ids.p1}?red=ig`);
  assert.equal(r.status, 200);
  assert.equal(r.res.headers.get("content-type"), "image/jpeg");
  const WEBP = "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";
  const s = await editora("/laboratorio-rh/api/redes/miniatura", {
    method: "POST",
    body: { publicacion_id: ids.p1, red: "ig", datos: `data:image/webp;base64,${WEBP}` },
  });
  assert.equal(s.status, 200);
  const m = (await lectora("/laboratorio-rh/api/datos")).json.metricas[ids.p1].ig;
  assert.equal(m.miniatura, s.json.id);
  assert.equal(m.falta_miniatura, false);
  assert.equal((await lectora(`/laboratorio-rh/api/imagenes/${s.json.id}`)).status, 200);
});

test("tarea de la mañana: cifras de la cuenta, posts del día y no repite", async () => {
  sim.likes.m1 = 55;
  sim.seguidores = 1250;
  // Simula que llegó la mañana siguiente: lo actualizado al vincular ya es de ayer.
  await bindings.DB.prepare("UPDATE redes_posts SET dia = '2000-01-01'").run();
  sim.llamadas = [];
  let tarea;
  await scheduled({}, bindings, { waitUntil: (p) => (tarea = p) });
  await tarea;
  const tras = sim.llamadas.length;
  assert.ok(tras > 0);
  const { tareaDiaria } = await import("../src/redes/sync.js");
  await tareaDiaria();
  assert.equal(sim.llamadas.length, tras, "un cliente completo no se vuelve a pedir el mismo día");
  const d = await lectora("/laboratorio-rh/api/datos");
  assert.equal(d.json.metricas[ids.p1].ig.m.likes, 55);
  const meses = Object.values(d.json.cuentaMes.ig);
  assert.ok(meses.some((x) => x.seguidores === 1250));
  assert.ok(meses.some((x) => x.alcance === 3000));
  const conAudiencia = await bindings.DB.prepare("SELECT audiencia FROM redes_conexiones WHERE cliente_id = ?").bind(ids.a).first();
  assert.equal(JSON.parse(conAudiencia.audiencia).length, 7);
});

test("botón Actualizar: solo editores y con freno de 15 minutos", async () => {
  assert.equal((await lectora("/laboratorio-rh/api/redes/actualizar", { method: "POST", body: {} })).status, 403);
  sim.likes.m1 = 60;
  const r = await editora("/laboratorio-rh/api/redes/actualizar", { method: "POST", body: {} });
  assert.equal(r.status, 200);
  assert.equal((await editora("/laboratorio-rh/api/datos")).json.metricas[ids.p1].ig.m.likes, 60);
  const otra = await editora("/laboratorio-rh/api/redes/actualizar", { method: "POST", body: {} });
  assert.equal(otra.status, 429);
  assert.match(otra.json.error, /15 min/);
});

test("resultados: cifras diarias del periodo, para cualquiera con acceso", async () => {
  const r = await lectora("/laboratorio-rh/api/resultados?red=ig&desde=2020-01-01&hasta=2100-01-01");
  assert.equal(r.status, 200);
  assert.ok(r.json.dias.some((d) => d.alcance === 3000));
  assert.ok(r.json.dias.some((d) => d.seguidores === 1250));
  assert.equal(r.json.audiencia.length, 7);
  assert.equal((await lectora("/laboratorio-rh/api/resultados?red=ig&desde=x&hasta=y")).status, 400);
});

test("token revocado: queda en error y la tarea no lo reintenta", async () => {
  sim.tokenMalo = true;
  await bindings.DB.prepare("UPDATE redes_conexiones SET manual_en = 0").run();
  const r = await editora("/laboratorio-rh/api/redes/actualizar", { method: "POST", body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, false);
  const d = await editora("/laboratorio-rh/api/datos");
  assert.equal(d.json.redes.ig.estado, "error");
  assert.match(d.json.redes.ig.error, /volver a conectarlo/);
  sim.tokenMalo = false;
  // Volver a pegar el token la arregla
  await admin(`/api/admin/clientes/${ids.a}/redes/ig`, { method: "PUT", body: { token: TOKEN } });
  assert.equal((await editora("/laboratorio-rh/api/datos")).json.redes.ig.estado, "ok");
});

test("aislamiento y desconectar", async () => {
  const ajeno = navegador();
  await admin("/api/admin/usuarios", { method: "POST", body: { email: "otra@x.co", nombre: "o", password: "Clave12345" } });
  await ajeno("/api/login", { method: "POST", body: { email: "otra@x.co", password: "Clave12345" } });
  assert.equal((await ajeno("/laboratorio-rh/api/resultados?red=ig&desde=2020-01-01&hasta=2030-01-01")).status, 404);
  assert.equal((await admin(`/api/admin/clientes/${ids.a}/redes/ig`, { method: "DELETE" })).status, 200);
  const d = await editora("/laboratorio-rh/api/datos");
  assert.equal(d.json.redes.ig, undefined);
  assert.ok(d.json.metricas[ids.p1].ig.m, "el historial de métricas se conserva");
  // Borrar el post se lleva su miniatura
  await editora(`/laboratorio-rh/api/publicaciones/${ids.p1}`, { method: "DELETE" });
  const n = await bindings.DB.prepare("SELECT COUNT(*) AS n FROM redes_posts WHERE publicacion_id = ?").bind(ids.p1).first();
  assert.equal(n.n, 0);
});
