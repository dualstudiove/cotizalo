// Promociones del panel de administración: crear, cambiar, pausar y borrar descuentos por periodo.
import { db, HttpError, nowIso, uuid } from "@dualstudio/comun/servidor";
import { hoy, placeholders } from "../util.js";
import { validarPromocion } from "../promociones.js";
import { sesionAdmin } from "./admin.js";

const A = { tenant: true, auth: sesionAdmin };
const TABLA = { examen: "examenes", perfil: "perfiles", categoria: "categorias" };

/** Comprueba que todo lo que abarca la promoción sea de este negocio. */
async function validarItems(negocioId, items) {
  for (const tipo of Object.keys(TABLA)) {
    const ids = [...new Set(items.filter((i) => i.tipo === tipo).map((i) => i.id))];
    for (let i = 0; i < ids.length; i += 90) {
      const trozo = ids.slice(i, i + 90);
      const n = await db.get(
        `SELECT COUNT(*) AS n FROM ${TABLA[tipo]} WHERE negocio_id = ? AND id IN (${
          placeholders(trozo)
        })`,
        [negocioId, ...trozo],
      );
      if (Number(n.n) !== trozo.length) {
        throw new HttpError(400, "Algún elemento de la promoción ya no existe.");
      }
    }
  }
}

async function guardar(negocioId, id, p, nueva) {
  await db.tx(async (t) => {
    if (nueva) {
      await t.run(
        "INSERT INTO promociones (id, negocio_id, nombre, porcentaje, desde, hasta, activo, creado_en) VALUES (?,?,?,?,?,?,?,?)",
        [id, negocioId, p.nombre, p.porcentaje, p.desde, p.hasta, p.activo ? 1 : 0, nowIso()],
      );
    } else {
      await t.run(
        "UPDATE promociones SET nombre = ?, porcentaje = ?, desde = ?, hasta = ?, activo = ? WHERE id = ? AND negocio_id = ?",
        [p.nombre, p.porcentaje, p.desde, p.hasta, p.activo ? 1 : 0, id, negocioId],
      );
      await t.run("DELETE FROM promocion_items WHERE promocion_id = ?", [id]);
    }
    const unicos = new Map(p.items.map((i) => [`${i.tipo}:${i.id}`, i]));
    for (const i of unicos.values()) {
      await t.run("INSERT INTO promocion_items (promocion_id, tipo, ref_id) VALUES (?,?,?)", [
        id,
        i.tipo,
        i.id,
      ]);
    }
  });
}

export function registrarPromociones(r) {
  r.add("GET", "/api/admin/promociones", A, async ({ negocio }) => {
    const promos = await db.all(
      "SELECT id, nombre, porcentaje, desde, hasta, activo FROM promociones WHERE negocio_id = ? ORDER BY hasta DESC, desde DESC",
      [negocio.id],
    );
    const items = await db.all(
      `SELECT pi.promocion_id, pi.tipo, pi.ref_id FROM promocion_items pi
         JOIN promociones p ON p.id = pi.promocion_id WHERE p.negocio_id = ?`,
      [negocio.id],
    );
    const dia = hoy();
    return {
      hoy: dia,
      promociones: promos.map((p) => ({
        ...p,
        activo: !!p.activo,
        // vigente: se está aplicando hoy · programada: empieza más adelante · terminada · pausada
        estado: !p.activo
          ? "pausada"
          : p.hasta < dia
          ? "terminada"
          : p.desde > dia
          ? "programada"
          : "vigente",
        items: items.filter((i) => i.promocion_id === p.id).map((i) => ({
          tipo: i.tipo,
          id: i.ref_id,
        })),
      })),
    };
  });

  r.add("POST", "/api/admin/promociones", A, async ({ negocio, body }) => {
    const p = validarPromocion(body);
    await validarItems(negocio.id, p.items);
    const id = uuid();
    await guardar(negocio.id, id, p, true);
    return { id };
  });

  r.add("PUT", "/api/admin/promociones/:id", A, async ({ negocio, params, body }) => {
    const actual = await db.get("SELECT * FROM promociones WHERE id = ? AND negocio_id = ?", [
      params.id,
      negocio.id,
    ]);
    if (!actual) throw new HttpError(404, "La promoción no existe.");
    // Pausar o reanudar sin tocar lo demás
    if (Object.keys(body).length === 1 && body.activo !== undefined) {
      await db.run("UPDATE promociones SET activo = ? WHERE id = ?", [
        body.activo ? 1 : 0,
        actual.id,
      ]);
      return { ok: true };
    }
    const p = validarPromocion(body);
    await validarItems(negocio.id, p.items);
    await guardar(negocio.id, actual.id, p, false);
    return { ok: true };
  });

  r.add("DELETE", "/api/admin/promociones/:id", A, async ({ negocio, params }) => {
    const res = await db.run("DELETE FROM promociones WHERE id = ? AND negocio_id = ?", [
      params.id,
      negocio.id,
    ]);
    if (!res.changes) throw new HttpError(404, "La promoción no existe.");
    return { ok: true };
  });
}
