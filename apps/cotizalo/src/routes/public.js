// Rutas públicas (pacientes). Solo lectura del catálogo + generación de presupuestos.
import { cuotaDiaria, db, limite } from "@dualstudio/comun/servidor";
import { refrescarSiHaceFalta, tasaGlobal } from "../bcv.js";
import { crearPresupuesto, esOrigenOtro, getConfig, resolverTasa } from "../negocio.js";
import { hoy, HttpError, nowIso, parteFecha, sumarDias, uuid } from "../util.js";
import { colorSeguro, temaDe } from "../paleta.js";
import { aplicarPromocion, promocionesDelDia } from "../promociones.js";

// Topes diarios por negocio, guardados en la base (valen para todas las instancias del Worker). Frenan un abuso
// de estas rutas sin sesión antes de que agote la cuota gratuita de la cuenta de Cloudflare, que es de todas las apps.
export const TOPE_VISITAS_DIA = 5000;
export const TOPE_PRESUPUESTOS_DIA = 1000;

// «Más pedidos»: cuántas veces se eligió cada examen o perfil en los presupuestos de los últimos 90 días. El
// catálogo del paciente sale ordenado así. Se guarda 10 minutos por negocio en cada instancia del Worker.
export const DIAS_POPULARIDAD = 90;
const popularidadCache = new Map();
async function popularidad(negocioId) {
  const c = popularidadCache.get(negocioId);
  if (c && Date.now() - c.t < 10 * 60_000) return c.m;
  const filas = await db.all(
    `SELECT ref_id, COUNT(*) AS n FROM presupuesto_items
      WHERE negocio_id = ? AND dia >= ? AND ref_id IS NOT NULL GROUP BY ref_id`,
    [negocioId, sumarDias(hoy(), -DIAS_POPULARIDAD)],
  );
  const m = new Map(filas.map((f) => [f.ref_id, f.n]));
  popularidadCache.set(negocioId, { t: Date.now(), m });
  return m;
}
/** Más pedidos primero; a igual cantidad, por nombre (el orden en que llegan). */
const porPopularidad = (lista, pop) =>
  lista.map((x) => ({ ...x, pedidos: pop.get(x.id) || 0 }))
    .sort((a, b) => b.pedidos - a.pedidos);

export function registrarPublicas(r) {
  r.add("GET", "/api/publico/config", { tenant: true }, async ({ negocio }) => {
    const cfg = await getConfig(negocio.id);
    refrescarSiHaceFalta(await tasaGlobal());
    const tasa = await resolverTasa(cfg);
    const origenes = (await db.all(
      "SELECT id, nombre FROM origenes WHERE negocio_id = ? AND activo = 1 ORDER BY orden, nombre",
      [negocio.id],
    ))
      .map((o) => ({ ...o, pide_detalle: esOrigenOtro(o.nombre) }));
    return {
      negocio: {
        slug: negocio.slug,
        nombre: cfg.nombre_publico,
        rif: cfg.rif || null,
        logo: cfg.logo,
        // Siempre un color de la paleta (con buen contraste), aunque el guardado sea de antes
        color: colorSeguro(cfg.color_principal),
        tema: temaDe(cfg.color_principal),
        telefono: cfg.telefono,
        direccion: cfg.direccion,
        horario: cfg.horario,
        pie: cfg.pie_presupuesto,
        dias_vigencia: cfg.dias_vigencia,
      },
      origenes,
      tasa: tasa
        ? {
          valor: tasa.valor,
          fecha_valor: tasa.fecha_valor,
          fuente: tasa.fuente,
          manual: tasa.manual,
          desactualizada: tasa.desactualizada,
        }
        : null,
      precios_actualizados_en: cfg.precios_actualizados_en,
    };
  });

  r.add("GET", "/api/publico/catalogo", { tenant: true }, async ({ negocio }) => {
    const categorias = await db.all(
      "SELECT id, nombre, max_por_examen, aviso_repetible FROM categorias WHERE negocio_id = ? AND activo = 1 ORDER BY orden, nombre",
      [negocio.id],
    );
    const examenes = await db.all(
      `SELECT e.id, e.nombre, e.categoria_id, e.precio_cent, e.descripcion, e.indicaciones, e.alias
         FROM examenes e JOIN categorias c ON c.id = e.categoria_id
        WHERE e.negocio_id = ? AND e.activo = 1 AND c.activo = 1 AND e.solo_en_perfil = 0 ORDER BY e.nombre`,
      [negocio.id],
    );
    const perfiles = await db.all(
      "SELECT id, nombre, descripcion, indicaciones, precio_cent FROM perfiles WHERE negocio_id = ? AND activo = 1 ORDER BY nombre",
      [negocio.id],
    );
    const miembros = await db.all(
      `SELECT pe.perfil_id, e.id, e.nombre, e.categoria_id, e.alias
         FROM perfil_examenes pe
         JOIN perfiles p ON p.id = pe.perfil_id
         JOIN examenes e ON e.id = pe.examen_id
        WHERE p.negocio_id = ? ORDER BY e.nombre`,
      [negocio.id],
    );
    const porPerfil = new Map();
    for (const m of miembros) {
      if (!porPerfil.has(m.perfil_id)) porPerfil.set(m.perfil_id, []);
      porPerfil.get(m.perfil_id).push({
        id: m.id,
        nombre: m.nombre,
        categoria_id: m.categoria_id,
        alias: m.alias || null, // el buscador encuentra el perfil también por los otros nombres
      });
    }
    // Promociones de hoy: precio_cent ya trae el descuento; precio_lista_cent es el de antes.
    const promos = await promocionesDelDia(negocio.id, hoy());
    const pop = await popularidad(negocio.id);
    return {
      categorias,
      examenes: porPopularidad(examenes, pop).map((e) =>
        aplicarPromocion(e, { tipo: "examen", id: e.id, categoria_id: e.categoria_id }, promos)
      ),
      perfiles: porPopularidad(perfiles, pop)
        .map((p) =>
          aplicarPromocion({ ...p, examenes: porPerfil.get(p.id) || [] }, {
            tipo: "perfil",
            id: p.id,
          }, promos)
        )
        .filter((p) => p.examenes.length > 0),
    };
  });

  r.add("POST", "/api/publico/visita", { tenant: true }, async ({ negocio, body, ip }) => {
    if (!limite(`visita|${ip}`, 60, 60_000)) throw new HttpError(429, "Demasiadas solicitudes.");
    // Pasado el tope del día, la visita no se cuenta, sin molestar al paciente.
    try {
      await cuotaDiaria(`visitas|${negocio.id}`, TOPE_VISITAS_DIA);
    } catch (e) {
      if (e.status === 429) return { ok: true, contada: false };
      throw e;
    }
    const { dia, hora, dow } = parteFecha();
    await db.run(
      "INSERT INTO visitas (id, negocio_id, creado_en, dia, hora, dow, dispositivo) VALUES (?,?,?,?,?,?,?)",
      [
        uuid(),
        negocio.id,
        nowIso(),
        dia,
        hora,
        dow,
        body.dispositivo === "escritorio" ? "escritorio" : "movil",
      ],
    );
    return { ok: true };
  });

  r.add("POST", "/api/publico/presupuesto", { tenant: true }, async ({ negocio, body, ip }) => {
    if (!limite(`presupuesto|${ip}`, 30, 60_000)) {
      throw new HttpError(429, "Demasiados presupuestos en poco tiempo. Espera un momento.");
    }
    await cuotaDiaria(
      `presupuestos|${negocio.id}`,
      TOPE_PRESUPUESTOS_DIA,
      "Hoy ya se generaron demasiados presupuestos en este negocio. Intenta de nuevo mañana o comunícate con el laboratorio.",
    );
    const res = await crearPresupuesto(negocio, body);
    popularidadCache.delete(negocio.id); // el orden de «más pedidos» se recalcula en la próxima carga
    return res;
  });
}
