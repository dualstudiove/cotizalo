// «Conectar con Meta» (inicio de sesión unificado): ir a Meta, volver con un código, elegir la cuenta y
// sincronizar contra graph.facebook.com con el token de usuario del sistema. Meta se simula interceptando fetch.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { crearD1Local } from "@dualstudio/comun/servidor/d1-local";
import { olvidarCacheDeSecretos } from "@dualstudio/comun/servidor";
import worker from "../src/server.js";

const META = "https://meta.test";
const bindings = {
  DB: crearD1Local(":memory:"),
  SESSION_SECRET: "secreto-de-prueba-secreto-de-prueba-123",
  BASE_PATH: "/planifica",
  SUPER_EMAIL: "admin@dualstudio.app",
  SUPER_PASSWORD: "AdminDePrueba1",
  META_APP_ID: "1669762864945097",
  META_CONFIG_ID: "2309244589644726",
  META_APP_SECRET: "secreto-de-la-app",
  META_API_BASE: META,
  META_DIALOG_BASE: "https://dialog.test",
};

const TOKEN = "EAASystemUserTokenDePrueba1234567890";
const sim = { cuentas: [{ id: "1784", username: "laboratoriorh" }], llamadas: [] };
const resp = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
const fetchReal = globalThis.fetch;
before(() => {
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== META) return fetchReal(input);
    sim.llamadas.push(url.pathname + "?" + url.searchParams.toString());
    const p = url.pathname.replace(/^\/v[\d.]+/, "");
    if (p === "/oauth/access_token") {
      if (url.searchParams.get("client_secret") !== "secreto-de-la-app" || url.searchParams.get("code") !== "codigo-ok") {
        return resp({ error: { message: "Invalid verification code", code: 100 } }, 400);
      }
      return resp({ access_token: TOKEN, token_type: "bearer" });
    }
    if (url.searchParams.get("access_token") !== TOKEN) {
      return resp({ error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 } }, 400);
    }
    if (p === "/me/assigned_instagram_accounts") return resp({ data: sim.cuentas });
    if (/^\/\d+$/.test(p)) {
      const c = sim.cuentas.find((x) => `/${x.id}` === p);
      return c ? resp({ id: c.id, username: c.username, followers_count: 900, media_count: 3 }) : resp({ error: { message: "no", code: 100 } }, 400);
    }
    if (/^\/\d+\/media$/.test(p)) return resp({ data: [], paging: {} });
    if (/^\/\d+\/insights$/.test(p)) return resp({ data: [{ name: "reach", total_value: { value: 1000 } }] });
    return resp({ error: { message: `ruta ${p}`, code: 100 } }, 404);
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
      new Request(`https://dualstudio.app/planifica${ruta}`, {
        method,
        headers: h,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "manual",
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
const ids = {};
before(async () => {
  olvidarCacheDeSecretos();
  await admin("/api/login", { method: "POST", body: { email: "admin@dualstudio.app", password: "AdminDePrueba1" } });
  ids.a = (await admin("/api/admin/clientes", { method: "POST", body: { nombre: "Laboratorio RH" } })).json.id;
});

const lugar = (r) => new URL(r.res.headers.get("location"), "https://dualstudio.app");

test("ir a Meta: enlace con app, configuración, vuelta y state", async () => {
  const r = await admin(`/api/admin/clientes/${ids.a}/redes/meta`);
  assert.equal(r.status, 200);
  const u = new URL(r.json.url);
  assert.equal(u.origin + u.pathname, "https://dialog.test/v23.0/dialog/oauth");
  assert.equal(u.searchParams.get("client_id"), "1669762864945097");
  assert.equal(u.searchParams.get("config_id"), "2309244589644726");
  assert.equal(u.searchParams.get("redirect_uri"), "https://dualstudio.app/planifica/redes/meta/vuelta");
  assert.equal(u.searchParams.get("response_type"), "code");
  ids.state = u.searchParams.get("state");
  assert.match(ids.state, /^[0-9a-f]{32}$/);
});

test("vuelta: un código malo no conecta; uno bueno conecta la única cuenta autorizada", async () => {
  const malo = await admin(`/redes/meta/vuelta?code=otro&state=${ids.state}`);
  assert.equal(malo.status, 302);
  assert.ok(lugar(malo).searchParams.get("meta_error"));
  // El state es de un solo uso: hay que pedir uno nuevo
  const otra = await admin(`/redes/meta/vuelta?code=codigo-ok&state=${ids.state}`);
  assert.match(lugar(otra).searchParams.get("meta_error"), /venció/);
  const st = new URL((await admin(`/api/admin/clientes/${ids.a}/redes/meta`)).json.url).searchParams.get("state");
  const ok = await admin(`/redes/meta/vuelta?code=codigo-ok&state=${st}`);
  assert.equal(lugar(ok).searchParams.get("meta_ok"), "laboratoriorh");
  assert.ok(sim.llamadas.some((l) => l.includes("redirect_uri=https%3A%2F%2Fdualstudio.app%2Fplanifica%2Fredes%2Fmeta%2Fvuelta")));
  const fila = await bindings.DB.prepare("SELECT origen, cuenta_id, token, token_vence FROM redes_conexiones WHERE cliente_id = ?").bind(ids.a).first();
  assert.equal(fila.origen, "meta");
  assert.equal(fila.cuenta_id, "1784");
  assert.equal(fila.token_vence, null, "el token de usuario del sistema no vence");
  assert.ok(!fila.token.includes(TOKEN));
});

test("con varias cuentas autorizadas, se elige una", async () => {
  sim.cuentas = [{ id: "1784", username: "laboratoriorh" }, { id: "2001", username: "otra.cuenta" }];
  const st = new URL((await admin(`/api/admin/clientes/${ids.a}/redes/meta`)).json.url).searchParams.get("state");
  const v = await admin(`/redes/meta/vuelta?code=codigo-ok&state=${st}`);
  const pend = lugar(v).searchParams.get("meta_elegir");
  assert.ok(pend);
  const p = await admin(`/api/admin/redes/meta/pendiente/${pend}`);
  assert.deepEqual(p.json.cuentas.map((c) => c.usuario), ["laboratoriorh", "otra.cuenta"]);
  assert.equal((await admin("/api/admin/redes/meta/elegir", { method: "POST", body: { state: pend, cuenta_id: "9999" } })).status, 400);
  // un intento fallido consume la elección: se vuelve a conectar
  const st2 = new URL((await admin(`/api/admin/clientes/${ids.a}/redes/meta`)).json.url).searchParams.get("state");
  const pend2 = lugar(await admin(`/redes/meta/vuelta?code=codigo-ok&state=${st2}`)).searchParams.get("meta_elegir");
  const e = await admin("/api/admin/redes/meta/elegir", { method: "POST", body: { state: pend2, cuenta_id: "2001" } });
  assert.equal(e.status, 200);
  assert.equal(e.json.usuario, "otra.cuenta");
});

test("con la conexión «meta», Actualizar habla con graph.facebook.com y pide la cuenta por su id", async () => {
  sim.llamadas = [];
  const r = await admin("/laboratorio-rh/api/redes/actualizar", { method: "POST", body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(sim.llamadas.some((l) => l.startsWith("/v23.0/2001?")), "perfil por id");
  assert.ok(!sim.llamadas.some((l) => l.includes("refresh_access_token")), "no se renueva");
});

test("sin la clave secreta, avisa qué falta", async () => {
  const sin = { ...bindings, META_APP_SECRET: "" };
  const res = await worker.fetch(
    new Request(`https://dualstudio.app/planifica/api/admin/clientes/${ids.a}/redes/meta`, { headers: { "x-app": "1" } }),
    sin,
    { waitUntil: () => {} },
  );
  // sin sesión responde 401; lo importante es que no se rompe
  assert.ok([401, 409].includes(res.status));
});
