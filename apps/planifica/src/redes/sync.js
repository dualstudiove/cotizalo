// Sincronización de métricas de Instagram (TikTok se sumará aquí con su propio cliente).
//
// Tres caminos, con el mismo código:
//  · La tarea de cada mañana (tareaDiaria): recorre los clientes conectados que aún no se actualizaron hoy.
//  · El botón «Actualizar» (forzar): todo un cliente, con un freno de 15 minutos.
//  · Vincular un post (soloPost): encuentra la publicación de su link y trae sus métricas al momento.
//
// Ahorro en el plan gratuito de Cloudflare: cada ejecución tiene un presupuesto de llamadas externas (el tope es 50).
// Si se acaba, lo que faltó queda para la siguiente ejecución (la tarea corre cada 10 minutos en la ventana de la
// mañana) y nada se pierde: cada post guarda el día de su última actualización.
// En la base solo se escribe lo que cambió.
import { db, HttpError, hoy, sumarDias } from "@dualstudio/comun/servidor";
import { env } from "../env.js";
import { tocar } from "../cambios.js";
import { borrarImagenes } from "../almacen.js";
import { cifrar, descifrar } from "./cifrado.js";
import * as ig from "./instagram.js";

export { presupuesto, SinPresupuesto } from "./instagram.js";

const DIA = 86_400_000;
export const FRENO_MANUAL_MS = 15 * 60_000;
export const PRESUPUESTO_EJECUCION = 45; // de las 50 llamadas externas que permite el plan gratuito
const RENOVAR_ANTES = 10 * DIA; // el token de Instagram dura 60 días; se renueva cuando le quedan menos de 10
const PAGINAS_MAX = 4; // para encontrar un link se revisan como mucho 200 publicaciones de la cuenta

const json = (t) => {
  try {
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
};

/** Inicio del día local `dia` (AAAA-MM-DD) en segundos Unix. */
const inicioDia = (dia) => Math.floor((Date.parse(`${dia}T00:00:00Z`) - env.tzOffsetMin * 60_000) / 1000);

export const conexionDe = (clienteId, red = "ig") =>
  db.get("SELECT * FROM redes_conexiones WHERE cliente_id = ? AND red = ?", [clienteId, red]);

// ── Conectar / desconectar ──

/**
 * Comprueba la cuenta con Instagram y guarda la conexión del cliente.
 *  · origen «token»: token pegado a mano (inicio de sesión de Instagram); dura 60 días y se renueva solo.
 *  · origen «meta»: «Conectar con Meta» (inicio de sesión unificado); token de usuario del sistema que no vence,
 *    y la cuenta de Instagram elegida (cuentaId).
 */
export async function conectarInstagram({ clienteId, token, usuarioId, origen = "token", cuentaId = null }) {
  token = String(token || "").trim();
  if (!/^[A-Za-z0-9._|-]{20,1024}$/.test(token)) {
    throw new HttpError(400, "Ese token no parece válido. Cópialo completo desde la app de Meta.");
  }
  let per;
  try {
    per = await ig.perfil(ig.usarConexion(ig.presupuesto(2), origen), token, cuentaId);
  } catch (e) {
    if (e instanceof ig.ErrorRed) {
      throw new HttpError(400, e.token ? "Meta no aceptó la conexión. Vuelve a conectar la cuenta." : e.message);
    }
    throw e;
  }
  if (!per.id) throw new HttpError(400, "Instagram no devolvió la cuenta.");
  const antes = await conexionDe(clienteId, "ig");
  const ahora = Date.now();
  await db.run(
    `INSERT INTO redes_conexiones (cliente_id, red, cuenta_id, usuario, token, token_creado, token_vence, origen, estado,
                                   error, cuenta_dia, completo_dia, conectado_en, conectado_por)
     VALUES (?, 'ig', ?, ?, ?, ?, ?, ?, 'ok', NULL, NULL, NULL, ?, ?)
     ON CONFLICT (cliente_id, red) DO UPDATE SET cuenta_id = excluded.cuenta_id, usuario = excluded.usuario,
       token = excluded.token, token_creado = excluded.token_creado, token_vence = excluded.token_vence,
       origen = excluded.origen, estado = 'ok', error = NULL, cuenta_dia = NULL, completo_dia = NULL,
       conectado_en = excluded.conectado_en, conectado_por = excluded.conectado_por`,
    [
      clienteId,
      per.id,
      per.usuario,
      await cifrar(token),
      ahora,
      origen === "meta" ? null : ahora + 60 * DIA,
      origen,
      ahora,
      usuarioId || null,
    ],
  );
  // Si cambió la cuenta, los links ya vinculados se vuelven a buscar en la nueva.
  if (antes && antes.cuenta_id !== per.id) {
    await db.run(
      "UPDATE redes_posts SET medio_id = NULL, error = NULL, dia = NULL WHERE cliente_id = ? AND red = 'ig'",
      [clienteId],
    );
  }
  if (per.seguidores !== null) await guardarDiaCuenta(clienteId, "ig", hoy(), { seguidores: per.seguidores });
  await tocar(clienteId);
  return { usuario: per.usuario, cuenta_id: per.id };
}

export async function desconectar(clienteId, red) {
  await db.run("DELETE FROM redes_conexiones WHERE cliente_id = ? AND red = ?", [clienteId, red]);
  await tocar(clienteId);
}

// ── Links de los posts ──

/** Al cambiar el link de un post (campo igLink): se registra para buscarlo; vacío = se desvincula. */
export async function alCambiarLink(clienteId, publicacionId, red, link) {
  link = typeof link === "string" ? link.trim() : "";
  const antes = await db.get("SELECT link, miniatura_id FROM redes_posts WHERE publicacion_id = ? AND red = ?", [
    publicacionId,
    red,
  ]);
  if (antes && antes.link === link) return;
  if (antes?.miniatura_id) await borrarImagenes(clienteId, [antes.miniatura_id]);
  if (!link) {
    await db.run("DELETE FROM redes_posts WHERE publicacion_id = ? AND red = ?", [publicacionId, red]);
    await db.run("DELETE FROM redes_posts_dia WHERE publicacion_id = ? AND red = ?", [publicacionId, red]);
    return;
  }
  await db.run(
    `INSERT INTO redes_posts (publicacion_id, red, cliente_id, link) VALUES (?, ?, ?, ?)
     ON CONFLICT (publicacion_id, red) DO UPDATE SET link = excluded.link, medio_id = NULL, tipo = NULL,
       publicado_en = NULL, metricas = NULL, dia = NULL, actualizado_en = NULL, error = NULL,
       miniatura_url = NULL, miniatura_id = NULL`,
    [publicacionId, red, clienteId, link],
  );
  await db.run("DELETE FROM redes_posts_dia WHERE publicacion_id = ? AND red = ?", [publicacionId, red]);
}

// ── Guardar ──

async function guardarDiaCuenta(clienteId, red, dia, { seguidores, datos }) {
  const f = await db.get("SELECT seguidores, datos FROM redes_cuenta_dia WHERE cliente_id = ? AND red = ? AND dia = ?", [
    clienteId,
    red,
    dia,
  ]);
  const s = seguidores ?? f?.seguidores ?? null;
  const d = datos ? JSON.stringify({ ...(json(f?.datos) || {}), ...datos }) : f?.datos ?? null;
  if (f && f.seguidores === s && f.datos === d) return;
  await db.run(
    `INSERT INTO redes_cuenta_dia (cliente_id, red, dia, seguidores, datos) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (cliente_id, red, dia) DO UPDATE SET seguidores = excluded.seguidores, datos = excluded.datos`,
    [clienteId, red, dia, s, d],
  );
}

async function guardarMetricasPost(post, metricas) {
  const dia = hoy();
  const m = { ...metricas };
  if (m.interacciones === undefined) {
    m.interacciones = ["likes", "comentarios", "compartidos", "guardados"].reduce((a, k) => a + (m[k] || 0), 0);
  }
  const texto = JSON.stringify(m);
  await db.run(
    "UPDATE redes_posts SET metricas = ?, dia = ?, actualizado_en = ?, error = NULL WHERE publicacion_id = ? AND red = ?",
    [texto, dia, Date.now(), post.publicacion_id, post.red],
  );
  // Historial: solo si cambió respecto a la foto anterior.
  const ultima = await db.get(
    "SELECT metricas FROM redes_posts_dia WHERE publicacion_id = ? AND red = ? ORDER BY dia DESC LIMIT 1",
    [post.publicacion_id, post.red],
  );
  if (ultima?.metricas !== texto) {
    await db.run(
      `INSERT INTO redes_posts_dia (publicacion_id, red, dia, metricas) VALUES (?, ?, ?, ?)
       ON CONFLICT (publicacion_id, red, dia) DO UPDATE SET metricas = excluded.metricas`,
      [post.publicacion_id, post.red, dia, texto],
    );
  }
}

const errorPost = (post, mensaje) =>
  db.run("UPDATE redes_posts SET error = ?, dia = ? WHERE publicacion_id = ? AND red = ?", [
    mensaje,
    hoy(),
    post.publicacion_id,
    post.red,
  ]);

// ── Pasos ──

async function tokenVigente(p, con) {
  const token = await descifrar(con.token);
  if (!token) {
    throw new ig.ErrorRed("No se pudo leer el token guardado: vuelve a conectar la cuenta.", { token: true });
  }
  if (con.origen === "meta") return token; // el token de usuario del sistema no vence
  const ahora = Date.now();
  if (con.token_vence && con.token_vence - ahora > RENOVAR_ANTES) return token;
  if (con.token_creado && ahora - con.token_creado < DIA) return token;
  const r = await ig.renovar(p, token);
  if (!r.token) return token;
  await db.run(
    "UPDATE redes_conexiones SET token = ?, token_creado = ?, token_vence = ? WHERE cliente_id = ? AND red = ?",
    [await cifrar(r.token), ahora, r.vence, con.cliente_id, con.red],
  );
  return r.token;
}

/** Seguidores de hoy, cifras de ayer y, una vez por semana, a qué horas está conectada la audiencia. */
async function pasoCuenta(p, con, token) {
  const dia = hoy();
  const per = await ig.perfil(p, token, con.cuenta_id);
  if (per.usuario && per.usuario !== con.usuario) {
    await db.run("UPDATE redes_conexiones SET usuario = ? WHERE cliente_id = ? AND red = ?", [
      per.usuario,
      con.cliente_id,
      con.red,
    ]);
  }
  if (per.seguidores !== null) await guardarDiaCuenta(con.cliente_id, "ig", dia, { seguidores: per.seguidores });
  const ayer = sumarDias(dia, -1);
  try {
    const cifras = await ig.cifrasDelDia(p, token, con.cuenta_id, inicioDia(ayer), inicioDia(dia));
    if (Object.keys(cifras).length) await guardarDiaCuenta(con.cliente_id, "ig", ayer, { datos: cifras });
  } catch (e) {
    if (!(e instanceof ig.ErrorRed) || e.token) throw e; // sin permiso de métricas: el resto sigue
  }
  if (!con.audiencia_en || Date.now() - con.audiencia_en > 7 * DIA) {
    try {
      const a = await ig.audiencia(p, token, con.cuenta_id);
      await db.run("UPDATE redes_conexiones SET audiencia = ?, audiencia_en = ? WHERE cliente_id = ? AND red = ?", [
        JSON.stringify(a),
        Date.now(),
        con.cliente_id,
        con.red,
      ]);
    } catch (e) {
      if (!(e instanceof ig.ErrorRed) || e.token) throw e;
    }
  }
  await db.run("UPDATE redes_conexiones SET cuenta_dia = ? WHERE cliente_id = ? AND red = ?", [
    dia,
    con.cliente_id,
    con.red,
  ]);
}

/**
 * Recorre las publicaciones de la cuenta (las más recientes primero) para encontrar los links pendientes y, de
 * paso, refrescar tipo, fecha y miniatura de los posts ya vinculados que aparezcan.
 */
async function pasoLinks(p, con, token, posts, { siempre }) {
  const pendientes = new Map();
  for (const post of posts) {
    if (post.medio_id) continue;
    const codigo = ig.codigoDeLink(post.link);
    if (!codigo) await errorPost(post, "Ese link no parece de un post de Instagram.");
    else pendientes.set(codigo, post);
  }
  if (!pendientes.size && !siempre) return;
  const porMedio = new Map(posts.filter((x) => x.medio_id).map((x) => [x.medio_id, x]));
  let siguiente = null;
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const r = await ig.medios(p, token, con.cuenta_id, siguiente);
    for (const m of r.medios) {
      const post = pendientes.get(m.codigo) || porMedio.get(m.id);
      if (!post) continue;
      pendientes.delete(m.codigo);
      await db.run(
        `UPDATE redes_posts SET medio_id = ?, tipo = ?, publicado_en = ?, miniatura_url = COALESCE(?, miniatura_url),
                error = NULL WHERE publicacion_id = ? AND red = ?`,
        [m.id, m.tipo, m.publicado_en, m.miniatura, post.publicacion_id, post.red],
      );
      post.medio_id = m.id;
    }
    siguiente = r.siguiente;
    if (!siguiente || !pendientes.size) break;
  }
  for (const post of pendientes.values()) {
    await errorPost(post, `No encontramos ese post en @${con.usuario}. Revisa que el link sea de esta cuenta.`);
  }
}

async function pasoPost(p, token, post) {
  try {
    await guardarMetricasPost(post, await ig.metricasDeMedio(p, token, post.medio_id));
  } catch (e) {
    if (!(e instanceof ig.ErrorRed) || e.token) throw e;
    await errorPost(post, e.message);
  }
}

/**
 * Actualiza un cliente. opciones: forzar (botón Actualizar: también lo ya actualizado hoy), soloPost (vincular).
 * Lanza SinPresupuesto si se acabaron las llamadas: lo que faltó queda para la próxima ejecución.
 */
export async function sincronizar(con, p, { forzar = false, soloPost = null } = {}) {
  ig.usarConexion(p, con.origen);
  const dia = hoy();
  try {
    const token = await tokenVigente(p, con);
    if (!soloPost && (forzar || con.cuenta_dia !== dia)) await pasoCuenta(p, con, token);
    const filtro = soloPost ? " AND publicacion_id = ?" : "";
    const leer = () =>
      db.all(`SELECT * FROM redes_posts WHERE cliente_id = ? AND red = ?${filtro}`, [
        con.cliente_id,
        con.red,
        ...(soloPost ? [soloPost] : []),
      ]);
    await pasoLinks(p, con, token, await leer(), { siempre: !soloPost });
    const posts = (await leer())
      .filter((x) => x.medio_id && (forzar || x.dia !== dia))
      .sort((a, b) => (a.actualizado_en || 0) - (b.actualizado_en || 0));
    for (const post of posts) await pasoPost(p, token, post);
    await db.run(
      `UPDATE redes_conexiones SET estado = 'ok', error = NULL, sincronizado_en = ?${soloPost ? "" : ", completo_dia = ?"}
        WHERE cliente_id = ? AND red = ?`,
      [Date.now(), ...(soloPost ? [] : [dia]), con.cliente_id, con.red],
    );
  } catch (e) {
    if (e instanceof ig.ErrorRed) {
      await db.run("UPDATE redes_conexiones SET estado = ?, error = ? WHERE cliente_id = ? AND red = ?", [
        e.token ? "error" : "ok",
        e.message,
        con.cliente_id,
        con.red,
      ]);
      if (!e.token && !soloPost) {
        // Un error pasajero no frena el día: se marca para no repetirlo en cada ejecución de la mañana.
        await db.run("UPDATE redes_conexiones SET completo_dia = ? WHERE cliente_id = ? AND red = ?", [
          dia,
          con.cliente_id,
          con.red,
        ]);
      }
      return { ok: false, error: e.message };
    }
    throw e;
  } finally {
    await tocar(con.cliente_id);
  }
  return { ok: true };
}

/** La tarea de cada mañana: los clientes que aún no se actualizaron hoy, hasta agotar el presupuesto. */
export async function tareaDiaria() {
  const p = ig.presupuesto(PRESUPUESTO_EJECUCION);
  const pendientes = await db.all(
    `SELECT r.* FROM redes_conexiones r JOIN clientes c ON c.id = r.cliente_id
      WHERE c.activo = 1 AND r.red = 'ig' AND r.token IS NOT NULL AND r.estado = 'ok'
        AND (r.completo_dia IS NULL OR r.completo_dia <> ?)
      ORDER BY COALESCE(r.sincronizado_en, 0)`,
    [hoy()],
  );
  let hechos = 0;
  for (const con of pendientes) {
    try {
      await sincronizar(con, p);
      hechos++;
    } catch (e) {
      if (e instanceof ig.SinPresupuesto) break;
      console.error("[redes] error al sincronizar", con.cliente_id, e);
    }
  }
  return { pendientes: pendientes.length, hechos, llamadas: PRESUPUESTO_EJECUCION - p.n };
}
