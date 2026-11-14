// Panel de administración de UN negocio. Todas las consultas filtran por negocio_id.
import { env } from "../env.js";
import {
  cerrarOtrasSesiones,
  comprobarPassword,
  credenciales,
  db,
  frenoDeIntentos,
  hashPassword,
  Raw,
  tipoDeSesion,
  verifyPassword,
} from "@dualstudio/comun/servidor";
import { getConfig, invalidarNegocios } from "../negocio.js";
import { colorSeguro, esColorDePaleta, PALETA } from "../paleta.js";
import {
  datosExamen,
  datosPerfil,
  escribirExamen,
  escribirPerfil,
  loteExamenes,
  lotePerfiles,
} from "../catalogo.js";
import { calcularDashboard, csvDashboard } from "../dashboard.js";
import { tasaGlobal } from "../bcv.js";
import { superDe } from "./super.js";
import {
  csv,
  entero,
  esDia,
  hoy,
  HttpError,
  nowIso,
  optStr,
  placeholders,
  precioCent,
  str,
  sumarDias,
  uuid,
  validarLogo,
  validarPassword,
} from "../util.js";

// La sesión del administrador vive solo bajo <base>/<negocio> (p. ej. /cotizalo/demo).
const rutaNegocio = (negocio) => `${env.basePath}/${negocio.slug}`;

/** Cookie de sesión del administrador de un negocio (sv = versión de sesión, ver «Cerrar sesión en los demás dispositivos»). */
export const SESION_ADMIN = tipoDeSesion({ cookie: "sid_admin", tipo: "a", horas: 12 });
export const cookieSesionAdmin = (u, negocio) =>
  SESION_ADMIN.emitir(u, { datos: { nid: negocio.id }, path: rutaNegocio(negocio) });

/**
 * Quién administra: el administrador del negocio o, si no hay sesión de ese negocio, el superadministrador,
 * que puede entrar a cualquier negocio. En ese caso el usuario lleva super: true.
 */
export async function sesionAdmin(ctx) {
  const tok = SESION_ADMIN.leer(ctx.cookies);
  if (tok && tok.nid === ctx.negocio.id) {
    const u = await db.get(
      "SELECT id, email, nombre, password_hash, activo, sesion_version FROM usuarios_admin WHERE id = ? AND negocio_id = ?",
      [tok.uid, ctx.negocio.id],
    );
    if (u && u.activo && SESION_ADMIN.vigente(tok, u)) return u;
  }
  const s = await superDe(ctx.cookies);
  if (s) return { id: null, email: s.email, nombre: "Superadministrador", super: true };
  throw new HttpError(
    401,
    tok ? "Tu sesión expiró. Inicia sesión de nuevo." : "Inicia sesión para continuar.",
  );
}

/** RIF: se guarda en mayúsculas y sin espacios (p. ej. J-12345678-9). Vacío = sin RIF. */
function rif(v) {
  const s = str(v, 20).toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  if (!/^[A-Z0-9-]{4,20}$/.test(s)) {
    throw new HttpError(
      400,
      "El RIF solo puede tener letras, números y guiones (por ejemplo J-12345678-9).",
    );
  }
  return s;
}

/** Veces que se puede pedir un mismo examen de la categoría: vacío, 0 o 1 = una sola vez; hasta 99. */
function maxPorExamen(v) {
  if (v === null || v === undefined || v === "" || v === 0 || v === "0" || v === 1 || v === "1") {
    return null;
  }
  const n = entero(v);
  if (n === null || n < 2 || n > 99) {
    throw new HttpError(
      400,
      "Las veces que se puede pedir un mismo examen deben ser un número entre 2 y 99.",
    );
  }
  return n;
}

const nombreUnico = async (tabla, nid, nombre, excluirId = null) => {
  const fila = await db.get(
    `SELECT id FROM ${tabla} WHERE negocio_id = ? AND LOWER(nombre) = LOWER(?)`,
    [nid, nombre],
  );
  return fila && fila.id !== excluirId;
};

export function registrarAdmin(r) {
  const A = { tenant: true, auth: sesionAdmin };

  // ── Sesión ──
  r.add("POST", "/api/admin/login", { tenant: true }, async (ctx) => {
    const { email, password } = credenciales(ctx.body);
    const freno = frenoDeIntentos(`a|${ctx.negocio.id}|${email}|${ctx.ip}`, ctx.ip);
    const u = await db.get(
      "SELECT id, email, nombre, password_hash, activo, sesion_version FROM usuarios_admin WHERE negocio_id = ? AND email = ?",
      [ctx.negocio.id, email],
    );
    if (!(await comprobarPassword(password, u?.password_hash)) || !u.activo) {
      freno.fallo();
      throw new HttpError(401, "Correo o contraseña incorrectos.");
    }
    freno.exito();
    // La sesión vive solo bajo /<negocio>: cada negocio tiene su propia cookie aunque compartan dominio.
    ctx.setCookies.push(cookieSesionAdmin(u, ctx.negocio));
    return { email: u.email, nombre: u.nombre };
  });

  r.add("POST", "/api/admin/logout", { tenant: true }, async (ctx) => {
    ctx.setCookies.push(SESION_ADMIN.cerrar({ path: rutaNegocio(ctx.negocio) }));
    return { ok: true };
  });

  r.add("GET", "/api/admin/me", A, async ({ usuario, negocio }) => ({
    email: usuario.email,
    nombre: usuario.nombre,
    super: !!usuario.super,
    negocio: { slug: negocio.slug, nombre: negocio.nombre, activo: !!negocio.activo },
  }));

  r.add("POST", "/api/admin/password", A, async ({ usuario, body, setCookies, negocio }) => {
    if (usuario.super) {
      throw new HttpError(
        403,
        "Como superadministrador no tienes contraseña en este negocio. Para cambiar la del administrador usa «Credenciales» en el panel general.",
      );
    }
    if (!(await verifyPassword(String(body.actual || ""), usuario.password_hash))) {
      throw new HttpError(400, "La contraseña actual no es correcta.");
    }
    const hash = await hashPassword(validarPassword(body.nueva));
    await db.run("UPDATE usuarios_admin SET password_hash = ? WHERE id = ?", [hash, usuario.id]);
    setCookies.push(cookieSesionAdmin({ ...usuario, password_hash: hash }, negocio));
    return { ok: true };
  });

  // Cierra la sesión en todos los demás navegadores (p. ej. si alguien pudo copiar la cookie). Esta sigue abierta.
  r.add("POST", "/api/admin/sesiones/cerrar", A, async ({ usuario, setCookies, negocio }) => {
    if (usuario.super) {
      throw new HttpError(
        403,
        "Como superadministrador, cierra tus sesiones desde «Tu cuenta» en el panel general.",
      );
    }
    const sv = await cerrarOtrasSesiones("usuarios_admin", usuario);
    setCookies.push(cookieSesionAdmin({ ...usuario, sesion_version: sv }, negocio));
    return { ok: true };
  });

  // ── Catálogo completo (categorías, exámenes y perfiles, incluidos los inactivos) ──
  r.add("GET", "/api/admin/catalogo", A, async ({ negocio }) => {
    const nid = negocio.id;
    const categorias = await db.all(
      `SELECT c.id, c.nombre, c.orden, c.activo, c.max_por_examen, c.aviso_repetible, (SELECT COUNT(*) FROM examenes e WHERE e.categoria_id = c.id) AS examenes
         FROM categorias c WHERE c.negocio_id = ? ORDER BY c.orden, c.nombre`,
      [nid],
    );
    const examenes = await db.all(
      `SELECT e.id, e.nombre, e.categoria_id, c.nombre AS categoria, e.precio_cent, e.descripcion, e.indicaciones, e.activo, e.solo_en_perfil, e.actualizado_en
         FROM examenes e JOIN categorias c ON c.id = e.categoria_id WHERE e.negocio_id = ? ORDER BY e.nombre`,
      [nid],
    );
    const perfiles = await db.all(
      "SELECT id, nombre, descripcion, indicaciones, precio_cent, activo, actualizado_en FROM perfiles WHERE negocio_id = ? ORDER BY nombre",
      [nid],
    );
    const miembros = await db.all(
      `SELECT pe.perfil_id, pe.examen_id FROM perfil_examenes pe JOIN perfiles p ON p.id = pe.perfil_id WHERE p.negocio_id = ?`,
      [nid],
    );
    const map = new Map();
    for (const m of miembros) {
      if (!map.has(m.perfil_id)) map.set(m.perfil_id, []);
      map.get(m.perfil_id).push(m.examen_id);
    }
    return {
      categorias,
      examenes,
      perfiles: perfiles.map((p) => ({ ...p, examen_ids: map.get(p.id) || [] })),
    };
  });

  // ── Categorías ──
  r.add("POST", "/api/admin/categorias", A, async ({ negocio, body }) => {
    const nombre = str(body.nombre, 80);
    if (!nombre) throw new HttpError(400, "El nombre es obligatorio.");
    if (await nombreUnico("categorias", negocio.id, nombre)) {
      throw new HttpError(409, "Ya existe una categoría con ese nombre.");
    }
    const id = uuid();
    const orden = entero(body.orden) ?? 99;
    await db.run(
      "INSERT INTO categorias (id, negocio_id, nombre, orden, activo, max_por_examen, aviso_repetible) VALUES (?,?,?,?,1,?,?)",
      [
        id,
        negocio.id,
        nombre,
        orden,
        maxPorExamen(body.max_por_examen),
        optStr(body.aviso_repetible, 200),
      ],
    );
    return { id };
  });

  r.add("PUT", "/api/admin/categorias/:id", A, async ({ negocio, params, body }) => {
    const c = await db.get("SELECT * FROM categorias WHERE id = ? AND negocio_id = ?", [
      params.id,
      negocio.id,
    ]);
    if (!c) throw new HttpError(404, "La categoría no existe.");
    const nombre = body.nombre !== undefined ? str(body.nombre, 80) : c.nombre;
    if (!nombre) throw new HttpError(400, "El nombre es obligatorio.");
    if (await nombreUnico("categorias", negocio.id, nombre, c.id)) {
      throw new HttpError(409, "Ya existe una categoría con ese nombre.");
    }
    await db.run(
      "UPDATE categorias SET nombre = ?, orden = ?, activo = ?, max_por_examen = ?, aviso_repetible = ? WHERE id = ?",
      [
        nombre,
        body.orden !== undefined ? entero(body.orden) ?? c.orden : c.orden,
        body.activo !== undefined ? (body.activo ? 1 : 0) : c.activo,
        body.max_por_examen !== undefined ? maxPorExamen(body.max_por_examen) : c.max_por_examen,
        body.aviso_repetible !== undefined ? optStr(body.aviso_repetible, 200) : c.aviso_repetible,
        c.id,
      ],
    );
    return { ok: true };
  });

  r.add("DELETE", "/api/admin/categorias/:id", A, async ({ negocio, params }) => {
    const n = await db.get(
      "SELECT COUNT(*) AS n FROM examenes WHERE categoria_id = ? AND negocio_id = ?",
      [params.id, negocio.id],
    );
    if (Number(n.n) > 0) {
      throw new HttpError(
        409,
        `No se puede eliminar: tiene ${n.n} examen(es). Muévelos a otra categoría o desactiva esta.`,
      );
    }
    const res = await db.run("DELETE FROM categorias WHERE id = ? AND negocio_id = ?", [
      params.id,
      negocio.id,
    ]);
    if (!res.changes) throw new HttpError(404, "La categoría no existe.");
    return { ok: true };
  });

  // ── Exámenes ──
  const validarCategoria = async (nid, id) => {
    if (
      typeof id !== "string" ||
      !(await db.get("SELECT id FROM categorias WHERE id = ? AND negocio_id = ?", [id, nid]))
    ) {
      throw new HttpError(400, "Elige una categoría válida.");
    }
  };

  r.add("POST", "/api/admin/examenes", A, async ({ negocio, body }) => {
    const d = datosExamen(body);
    await validarCategoria(negocio.id, d.categoria_id);
    if (await nombreUnico("examenes", negocio.id, d.nombre)) {
      throw new HttpError(409, "Ya existe un examen con ese nombre.");
    }
    const id = uuid();
    await db.tx((t) => escribirExamen(t, negocio.id, id, d, true));
    return { id };
  });
  r.add("PUT", "/api/admin/examenes/:id", A, async ({ negocio, params, body }) => {
    const e = await db.get("SELECT * FROM examenes WHERE id = ? AND negocio_id = ?", [
      params.id,
      negocio.id,
    ]);
    if (!e) throw new HttpError(404, "El examen no existe.");
    const d = datosExamen(body, e);
    if (body.categoria_id !== undefined) await validarCategoria(negocio.id, d.categoria_id);
    if (await nombreUnico("examenes", negocio.id, d.nombre, e.id)) {
      throw new HttpError(409, "Ya existe un examen con ese nombre.");
    }
    await db.tx((t) => escribirExamen(t, negocio.id, e.id, d, false));
    return { ok: true };
  });
  // Edición rápida en tabla e importación de CSV: { filas: [...], simular }
  r.add(
    "POST",
    "/api/admin/examenes/lote",
    { ...A, maxBody: 2_000_000 },
    ({ negocio, body }) => loteExamenes(negocio.id, body.filas, { simular: !!body.simular }),
  );
  r.add("DELETE", "/api/admin/examenes/:id", A, async ({ negocio, params }) => {
    const res = await db.run("DELETE FROM examenes WHERE id = ? AND negocio_id = ?", [
      params.id,
      negocio.id,
    ]);
    if (!res.changes) throw new HttpError(404, "El examen no existe.");
    return { ok: true };
  });

  // ── Perfiles ──
  const validarMiembros = async (nid, ids) => {
    if (
      !Array.isArray(ids) || !ids.length || ids.length > 300 ||
      ids.some((x) => typeof x !== "string")
    ) {
      throw new HttpError(400, "Elige al menos un examen para el perfil.");
    }
    const unicos = [...new Set(ids)];
    let hallados = 0;
    for (let i = 0; i < unicos.length; i += 90) { // D1 admite 100 parámetros por consulta
      const trozo = unicos.slice(i, i + 90);
      const n = await db.get(
        `SELECT COUNT(*) AS n FROM examenes WHERE negocio_id = ? AND id IN (${
          placeholders(trozo)
        })`,
        [nid, ...trozo],
      );
      hallados += Number(n.n);
    }
    if (hallados !== unicos.length) throw new HttpError(400, "Algún examen elegido no existe.");
    return unicos;
  };

  r.add("POST", "/api/admin/perfiles", A, async ({ negocio, body }) => {
    const d = datosPerfil(body);
    const ids = await validarMiembros(negocio.id, body.examen_ids);
    if (await nombreUnico("perfiles", negocio.id, d.nombre)) {
      throw new HttpError(409, "Ya existe un perfil con ese nombre.");
    }
    const id = uuid();
    await db.tx((t) => escribirPerfil(t, negocio.id, id, d, true, ids));
    return { id };
  });
  r.add("PUT", "/api/admin/perfiles/:id", A, async ({ negocio, params, body }) => {
    const p = await db.get("SELECT * FROM perfiles WHERE id = ? AND negocio_id = ?", [
      params.id,
      negocio.id,
    ]);
    if (!p) throw new HttpError(404, "El perfil no existe.");
    const d = datosPerfil(body, p);
    const ids = body.examen_ids !== undefined
      ? await validarMiembros(negocio.id, body.examen_ids)
      : null;
    if (await nombreUnico("perfiles", negocio.id, d.nombre, p.id)) {
      throw new HttpError(409, "Ya existe un perfil con ese nombre.");
    }
    await db.tx((t) => escribirPerfil(t, negocio.id, p.id, d, false, ids));
    return { ok: true };
  });
  // ── Exportar a CSV (se abre en Excel; «;» como separador) ──
  r.add("GET", "/api/admin/csv/:tipo", A, async ({ negocio, params }) => {
    const sino = (v) => (v ? "sí" : "no");
    const precio = (c) => (c / 100).toFixed(2).replace(".", ",");
    let contenido;
    if (params.tipo === "examenes") {
      const filas = await db.all(
        `SELECT e.*, c.nombre AS categoria FROM examenes e JOIN categorias c ON c.id = e.categoria_id
          WHERE e.negocio_id = ? ORDER BY c.orden, c.nombre, e.nombre`,
        [negocio.id],
      );
      contenido = csv(filas, [
        { titulo: "Nombre", valor: "nombre" },
        { titulo: "Categoría", valor: "categoria" },
        { titulo: "Precio (REF)", valor: (f) => (f.solo_en_perfil ? "" : precio(f.precio_cent)) },
        { titulo: "Indicaciones", valor: "indicaciones" },
        { titulo: "Descripción", valor: "descripcion" },
        { titulo: "Solo en perfil", valor: (f) => sino(f.solo_en_perfil) },
        { titulo: "Activo", valor: (f) => sino(f.activo) },
      ]);
    } else if (params.tipo === "perfiles") {
      const perfiles = await db.all("SELECT * FROM perfiles WHERE negocio_id = ? ORDER BY nombre", [
        negocio.id,
      ]);
      const miembros = await db.all(
        `SELECT pe.perfil_id, e.nombre FROM perfil_examenes pe JOIN examenes e ON e.id = pe.examen_id
           JOIN perfiles p ON p.id = pe.perfil_id WHERE p.negocio_id = ? ORDER BY e.nombre`,
        [negocio.id],
      );
      contenido = csv(perfiles, [
        { titulo: "Nombre", valor: "nombre" },
        { titulo: "Precio (REF)", valor: (f) => precio(f.precio_cent) },
        {
          titulo: "Exámenes (separados por |)",
          valor: (f) =>
            miembros.filter((m) => m.perfil_id === f.id).map((m) => m.nombre).join(" | "),
        },
        { titulo: "Indicaciones", valor: "indicaciones" },
        { titulo: "Descripción", valor: "descripcion" },
        { titulo: "Activo", valor: (f) => sino(f.activo) },
      ]);
    } else throw new HttpError(404, "No encontrado.");
    return new Raw(contenido, "text/csv; charset=utf-8", {
      "content-disposition": `attachment; filename="${negocio.slug}-${params.tipo}.csv"`,
    });
  });

  // Importación de CSV: { filas: [{ nombre, precio_cent, examenes: [nombres], … }], simular }
  r.add(
    "POST",
    "/api/admin/perfiles/lote",
    { ...A, maxBody: 2_000_000 },
    ({ negocio, body }) => lotePerfiles(negocio.id, body.filas, { simular: !!body.simular }),
  );
  r.add("DELETE", "/api/admin/perfiles/:id", A, async ({ negocio, params }) => {
    const res = await db.run("DELETE FROM perfiles WHERE id = ? AND negocio_id = ?", [
      params.id,
      negocio.id,
    ]);
    if (!res.changes) throw new HttpError(404, "El perfil no existe.");
    return { ok: true };
  });

  // ── Actualización masiva de precios ──
  r.add("POST", "/api/admin/precios/masivo", A, async ({ negocio, body }) => {
    const pct = Number(body.porcentaje);
    if (!Number.isFinite(pct) || pct < -90 || pct > 500 || pct === 0) {
      throw new HttpError(400, "Indica un porcentaje válido (distinto de 0, entre -90 y 500).");
    }
    const alcance = body.alcance;
    if (!["categoria", "examenes", "perfiles", "todo"].includes(alcance)) {
      throw new HttpError(400, "Elige a qué aplicar el ajuste.");
    }
    const nid = negocio.id;
    let examenes = [];
    let perfiles = [];
    if (alcance === "categoria") {
      await validarCategoria(nid, body.categoria_id);
      examenes = await db.all(
        "SELECT id, nombre, precio_cent FROM examenes WHERE negocio_id = ? AND categoria_id = ?",
        [nid, body.categoria_id],
      );
    }
    if (alcance === "examenes" || alcance === "todo") {
      examenes = await db.all("SELECT id, nombre, precio_cent FROM examenes WHERE negocio_id = ?", [
        nid,
      ]);
    }
    if (alcance === "perfiles" || alcance === "todo") {
      perfiles = await db.all("SELECT id, nombre, precio_cent FROM perfiles WHERE negocio_id = ?", [
        nid,
      ]);
    }
    const nuevo = (c) => Math.max(0, Math.round(c * (1 + pct / 100)));
    const cambios = [
      ...examenes.map((x) => ({ ...x, tabla: "examenes" })),
      ...perfiles.map((x) => ({ ...x, tabla: "perfiles" })),
    ]
      .map((x) => ({ ...x, despues: nuevo(x.precio_cent) }))
      .filter((x) => x.despues !== x.precio_cent);
    if (body.simular) {
      return {
        afectados: cambios.length,
        ejemplos: cambios.slice(0, 8).map((x) => ({
          nombre: x.nombre,
          antes: x.precio_cent,
          despues: x.despues,
        })),
      };
    }
    const ahora = nowIso();
    await db.tx(async (t) => {
      for (const c of cambios) {
        await t.run(
          `UPDATE ${c.tabla} SET precio_cent = ?, actualizado_en = ? WHERE id = ? AND negocio_id = ?`,
          [c.despues, ahora, c.id, nid],
        );
      }
    });
    return { afectados: cambios.length };
  });

  // ── Borrar los datos de estadísticas (presupuestos generados y visitas) hasta una fecha ──
  // { hasta: 'AAAA-MM-DD', simular: true } solo cuenta; sin simular, borra. El catálogo y la configuración no se tocan.
  r.add("POST", "/api/admin/datos/borrar", A, async ({ negocio, body }) => {
    const hasta = body.hasta;
    if (!esDia(hasta)) throw new HttpError(400, "Elige una fecha válida.");
    if (hasta > hoy()) throw new HttpError(400, "La fecha no puede ser posterior a hoy.");
    const nid = negocio.id;
    const cuenta = async (tabla) =>
      Number(
        (await db.get(`SELECT COUNT(*) AS n FROM ${tabla} WHERE negocio_id = ? AND dia <= ?`, [
          nid,
          hasta,
        ])).n,
      );
    const res = {
      hasta,
      presupuestos: await cuenta("presupuestos"),
      visitas: await cuenta("visitas"),
    };
    if (body.simular || (!res.presupuestos && !res.visitas)) return { ...res, borrado: false };
    const maxSec = Number(
      (await db.get(
        "SELECT COALESCE(MAX(secuencia), 0) AS n FROM presupuestos WHERE negocio_id = ? AND dia <= ?",
        [nid, hasta],
      )).n,
    );
    await db.tx(async (t) => {
      // Los códigos de presupuesto siguen desde el último usado, aunque se borren los presupuestos.
      await t.run(
        "UPDATE configuracion_negocio SET secuencia_base = MAX(COALESCE(secuencia_base, 0), ?) WHERE negocio_id = ?",
        [maxSec, nid],
      );
      for (
        const tabla of ["presupuesto_examenes", "presupuesto_items", "presupuestos", "visitas"]
      ) {
        await t.run(`DELETE FROM ${tabla} WHERE negocio_id = ? AND dia <= ?`, [nid, hasta]);
      }
    });
    return { ...res, borrado: true };
  });

  // ── Configuración del negocio ──
  r.add("GET", "/api/admin/config", A, async ({ negocio }) => {
    const cfg = await getConfig(negocio.id);
    const origenes = await db.all(
      "SELECT id, nombre, orden, activo FROM origenes WHERE negocio_id = ? ORDER BY orden, nombre",
      [negocio.id],
    );
    const g = await tasaGlobal();
    return {
      config: cfg,
      // Los 20 colores que se pueden elegir y el que de verdad se ve (si el guardado es de antes de la paleta)
      paleta: PALETA,
      color_en_uso: colorSeguro(cfg.color_principal),
      origenes,
      tasa_auto: g
        ? {
          valor: g.valor,
          fecha_valor: g.fecha_valor,
          fuente: g.fuente,
          desactualizada: g.desactualizada,
        }
        : null,
      slug: negocio.slug,
    };
  });

  r.add("PUT", "/api/admin/config", A, async ({ negocio, body }) => {
    const cur = await getConfig(negocio.id);
    const nombre = body.nombre_publico !== undefined
      ? str(body.nombre_publico, 80)
      : cur.nombre_publico;
    if (!nombre) throw new HttpError(400, "El nombre del negocio es obligatorio.");
    const color = body.color_principal !== undefined
      ? String(body.color_principal).toLowerCase()
      : cur.color_principal;
    // Solo colores de la paleta (buen contraste); el guardado de antes se respeta mientras no se cambie.
    if (color !== cur.color_principal && !esColorDePaleta(color)) {
      throw new HttpError(400, "Elige uno de los colores de la paleta.");
    }
    // «Precios actualizados el …»: la pone el administrador (AAAA-MM-DD). Ya no cambia sola con cada ajuste.
    let preciosEn = cur.precios_actualizados_en;
    if (body.precios_actualizados_en !== undefined) {
      if (!esDia(body.precios_actualizados_en)) {
        throw new HttpError(400, "La fecha de los precios no es válida.");
      }
      if (body.precios_actualizados_en > hoy()) {
        throw new HttpError(400, "La fecha de los precios no puede ser futura.");
      }
      preciosEn = body.precios_actualizados_en;
    }
    const dias = body.dias_vigencia !== undefined ? entero(body.dias_vigencia) : cur.dias_vigencia;
    if (dias === null || dias < 1 || dias > 365) {
      throw new HttpError(400, "La vigencia debe estar entre 1 y 365 días.");
    }
    const prefijo = body.prefijo_codigo !== undefined
      ? str(body.prefijo_codigo, 5).toUpperCase()
      : cur.prefijo_codigo;
    if (!/^[A-Z0-9]{2,5}$/.test(prefijo)) {
      throw new HttpError(400, "El prefijo del código debe tener entre 2 y 5 letras o números.");
    }
    const usarManual = body.usar_tasa_manual !== undefined
      ? (body.usar_tasa_manual ? 1 : 0)
      : cur.usar_tasa_manual;
    let tasaManual = cur.tasa_manual;
    if (body.tasa_manual !== undefined) {
      if (body.tasa_manual === null || body.tasa_manual === "") tasaManual = null;
      else {
        const n = Number(body.tasa_manual);
        if (!Number.isFinite(n) || n <= 0 || n > 1e7) {
          throw new HttpError(400, "La tasa manual no es válida.");
        }
        tasaManual = Math.round(n * 10000) / 10000;
      }
    }
    if (usarManual && !(tasaManual > 0)) {
      throw new HttpError(400, "Indica el valor de la tasa manual para poder usarla.");
    }
    await db.run(
      `UPDATE configuracion_negocio SET nombre_publico = ?, logo = ?, color_principal = ?, rif = ?, telefono = ?, direccion = ?, horario = ?,
              pie_presupuesto = ?, dias_vigencia = ?, prefijo_codigo = ?, tasa_manual = ?, usar_tasa_manual = ?, precios_actualizados_en = ? WHERE negocio_id = ?`,
      [
        nombre,
        body.logo !== undefined ? validarLogo(body.logo) : cur.logo,
        color,
        body.rif !== undefined ? rif(body.rif) : cur.rif,
        body.telefono !== undefined ? optStr(body.telefono, 40) : cur.telefono,
        body.direccion !== undefined ? optStr(body.direccion, 200) : cur.direccion,
        body.horario !== undefined ? optStr(body.horario, 200) : cur.horario,
        body.pie_presupuesto !== undefined
          ? optStr(body.pie_presupuesto, 500)
          : cur.pie_presupuesto,
        dias,
        prefijo,
        tasaManual,
        usarManual,
        preciosEn,
        negocio.id,
      ],
    );
    invalidarNegocios();
    return { ok: true };
  });

  // ── Orígenes ("¿cómo se enteró de nosotros?") ──
  r.add("POST", "/api/admin/origenes", A, async ({ negocio, body }) => {
    const nombre = str(body.nombre, 80);
    if (!nombre) throw new HttpError(400, "El nombre es obligatorio.");
    if (await nombreUnico("origenes", negocio.id, nombre)) {
      throw new HttpError(409, "Esa opción ya existe.");
    }
    const id = uuid();
    const max = await db.get(
      "SELECT COALESCE(MAX(orden), 0) + 1 AS n FROM origenes WHERE negocio_id = ?",
      [negocio.id],
    );
    await db.run(
      "INSERT INTO origenes (id, negocio_id, nombre, orden, activo) VALUES (?,?,?,?,1)",
      [id, negocio.id, nombre, Number(max.n)],
    );
    return { id };
  });

  // Nuevo orden de las opciones de «¿Cómo se enteró?»: { ids: [...] } en el orden deseado (todas las del negocio).
  r.add("POST", "/api/admin/origenes/orden", A, async ({ negocio, body }) => {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const actuales = (await db.all("SELECT id FROM origenes WHERE negocio_id = ?", [negocio.id]))
      .map((o) => o.id);
    if (
      ids.length !== actuales.length || new Set(ids).size !== ids.length ||
      !ids.every((id) => actuales.includes(id))
    ) {
      throw new HttpError(
        400,
        "La lista de opciones no coincide. Recarga la página e inténtalo de nuevo.",
      );
    }
    await db.tx(async (t) => {
      for (const [i, id] of ids.entries()) {
        await t.run("UPDATE origenes SET orden = ? WHERE id = ? AND negocio_id = ?", [
          i,
          id,
          negocio.id,
        ]);
      }
    });
    return { ok: true };
  });

  r.add("PUT", "/api/admin/origenes/:id", A, async ({ negocio, params, body }) => {
    const o = await db.get("SELECT * FROM origenes WHERE id = ? AND negocio_id = ?", [
      params.id,
      negocio.id,
    ]);
    if (!o) throw new HttpError(404, "La opción no existe.");
    const nombre = body.nombre !== undefined ? str(body.nombre, 80) : o.nombre;
    if (!nombre) throw new HttpError(400, "El nombre es obligatorio.");
    if (await nombreUnico("origenes", negocio.id, nombre, o.id)) {
      throw new HttpError(409, "Esa opción ya existe.");
    }
    await db.run("UPDATE origenes SET nombre = ?, activo = ? WHERE id = ?", [
      nombre,
      body.activo !== undefined ? (body.activo ? 1 : 0) : o.activo,
      o.id,
    ]);
    return { ok: true };
  });

  r.add("DELETE", "/api/admin/origenes/:id", A, async ({ negocio, params }) => {
    const res = await db.run("DELETE FROM origenes WHERE id = ? AND negocio_id = ?", [
      params.id,
      negocio.id,
    ]);
    if (!res.changes) throw new HttpError(404, "La opción no existe.");
    return { ok: true };
  });

  // ── Dashboard ──
  const rango = (q) => {
    const hasta = q.hasta ? q.hasta : hoy();
    const desde = q.desde ? q.desde : sumarDias(hasta, -6);
    if (!esDia(desde) || !esDia(hasta) || desde > hasta) {
      throw new HttpError(400, "El rango de fechas no es válido.");
    }
    if (desde < sumarDias(hasta, -366)) throw new HttpError(400, "El rango máximo es de un año.");
    return { desde, hasta };
  };

  r.add("GET", "/api/admin/dashboard", A, async ({ negocio, query }) => {
    const { desde, hasta } = rango(query);
    return calcularDashboard(negocio.id, desde, hasta);
  });

  r.add("GET", "/api/admin/dashboard/csv", A, async ({ negocio, query }) => {
    const { desde, hasta } = rango(query);
    const tipo = String(query.tipo || "");
    const contenido = csvDashboard(tipo, await calcularDashboard(negocio.id, desde, hasta));
    if (contenido === null) throw new HttpError(400, "Tipo de reporte no válido.");
    return new Raw(contenido, "text/csv; charset=utf-8", {
      "content-disposition": `attachment; filename="${negocio.slug}-${tipo}-${desde}_${hasta}.csv"`,
    });
  });
}
