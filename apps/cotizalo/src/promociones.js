// Promociones por periodo: un porcentaje de descuento sobre exámenes, perfiles o categorías elegidos, entre dos
// fechas (inclusive, en la fecha local del negocio). Si a algo le tocan varias promociones (p. ej. la suya y la
// de su categoría), se aplica la mayor: nunca se suman.
import { db, HttpError } from "@dualstudio/comun/servidor";

export const TABLAS_PROMOCIONES = `
CREATE TABLE IF NOT EXISTS promociones (
  id          TEXT PRIMARY KEY,
  negocio_id  TEXT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  porcentaje  INTEGER NOT NULL CHECK (porcentaje BETWEEN 1 AND 90),
  desde       TEXT NOT NULL,                -- AAAA-MM-DD (fecha local, inclusive)
  hasta       TEXT NOT NULL,                -- AAAA-MM-DD (fecha local, inclusive)
  activo      INTEGER NOT NULL DEFAULT 1,
  creado_en   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promociones_negocio ON promociones (negocio_id, hasta);
CREATE TABLE IF NOT EXISTS promocion_items (
  promocion_id TEXT NOT NULL REFERENCES promociones(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('examen', 'perfil', 'categoria')),
  ref_id       TEXT NOT NULL,
  PRIMARY KEY (promocion_id, tipo, ref_id)
);
`;

/** Promociones activas de un negocio en un día, con lo que abarcan. */
export async function promocionesDelDia(negocioId, dia, t = db) {
  const promos = await t.all(
    "SELECT id, nombre, porcentaje, desde, hasta FROM promociones WHERE negocio_id = ? AND activo = 1 AND desde <= ? AND hasta >= ?",
    [negocioId, dia, dia],
  );
  if (!promos.length) return [];
  const items = await t.all(
    `SELECT pi.promocion_id, pi.tipo, pi.ref_id FROM promocion_items pi
       JOIN promociones p ON p.id = pi.promocion_id
      WHERE p.negocio_id = ? AND p.activo = 1 AND p.desde <= ? AND p.hasta >= ?`,
    [negocioId, dia, dia],
  );
  return promos.map((p) => ({
    ...p,
    items: new Set(
      items.filter((i) => i.promocion_id === p.id).map((i) => `${i.tipo}:${i.ref_id}`),
    ),
  }));
}

/**
 * La mejor promoción para un examen (por su id o por su categoría) o un perfil (por su id).
 * cosa: { tipo: 'examen' | 'perfil', id, categoria_id? }
 */
export function mejorPromocion(cosa, promos) {
  let mejor = null;
  for (const p of promos) {
    const toca = p.items.has(`${cosa.tipo}:${cosa.id}`) ||
      (cosa.tipo === "examen" && cosa.categoria_id &&
        p.items.has(`categoria:${cosa.categoria_id}`));
    if (toca && (!mejor || p.porcentaje > mejor.porcentaje)) mejor = p;
  }
  return mejor;
}

/** Precio con el descuento aplicado (céntimos, redondeado). */
export const conDescuento = (precio, porcentaje) => Math.round(precio * (100 - porcentaje) / 100);

/** Deja en el objeto el precio con promoción (precio_cent) y el de lista (precio_lista_cent) si aplica. */
export function aplicarPromocion(obj, cosa, promos) {
  const p = mejorPromocion(cosa, promos);
  if (!p) return { ...obj, promo: null };
  return {
    ...obj,
    precio_lista_cent: obj.precio_cent,
    precio_cent: conDescuento(obj.precio_cent, p.porcentaje),
    promo: { porcentaje: p.porcentaje, nombre: p.nombre, hasta: p.hasta },
  };
}

export function validarPromocion(body) {
  const nombre = typeof body.nombre === "string" ? body.nombre.trim().slice(0, 80) : "";
  if (!nombre) {
    throw new HttpError(400, "Ponle un nombre a la promoción (p. ej. «Semana del corazón»).");
  }
  const porcentaje = Number(body.porcentaje);
  if (!Number.isInteger(porcentaje) || porcentaje < 1 || porcentaje > 90) {
    throw new HttpError(400, "El descuento debe ser un número entero entre 1 y 90 %.");
  }
  const esDia = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!esDia(body.desde) || !esDia(body.hasta)) {
    throw new HttpError(400, "Elige las fechas de inicio y fin.");
  }
  if (body.hasta < body.desde) {
    throw new HttpError(400, "La fecha de fin no puede ser antes que la de inicio.");
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new HttpError(400, "Elige al menos un examen, perfil o categoría.");
  if (items.length > 300) throw new HttpError(400, "La promoción abarca demasiados elementos.");
  for (const i of items) {
    if (!i || !["examen", "perfil", "categoria"].includes(i.tipo) || typeof i.id !== "string") {
      throw new HttpError(400, "Algún elemento de la promoción no es válido.");
    }
  }
  return {
    nombre,
    porcentaje,
    desde: body.desde,
    hasta: body.hasta,
    items,
    activo: body.activo !== false,
  };
}
