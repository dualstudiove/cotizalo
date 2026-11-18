// Exámenes y perfiles: validación y guardado, compartidos por el formulario de uno en uno, la edición rápida en
// tabla y la importación de CSV. Así las reglas son las mismas en todos lados.
import { db, HttpError, nowIso, optStr, str, uuid } from "@dualstudio/comun/servidor";
import { precioCent } from "./util.js";

const bool = (v, def) => (v === undefined ? def : v === true || v === 1 || v === "1");
const clave = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Otros nombres de un examen: llegan como texto («glucemia, glucosa») o lista y se guardan separados por «, »,
 * sin repetidos ni vacíos. Hasta 15 nombres de 60 caracteres. Vacío = null.
 */
export function aliasDe(v) {
  const partes = Array.isArray(v) ? v : String(v ?? "").split(/[,;|\n]/);
  const vistos = new Set();
  const out = [];
  for (const p of partes) {
    const a = String(p ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!a || vistos.has(a.toLowerCase())) continue;
    vistos.add(a.toLowerCase());
    out.push(a);
    if (out.length === 15) break;
  }
  return out.length ? out.join(", ") : null;
}

/**
 * Datos de un examen a partir de lo enviado (y de lo que ya tenía, al editar).
 * Un examen «solo en perfil» no se ofrece suelto al paciente y no tiene precio propio (se guarda 0).
 */
export function datosExamen(body, actual = null) {
  const nombre = body.nombre !== undefined ? str(body.nombre, 120) : actual?.nombre;
  if (!nombre) throw new HttpError(400, "El nombre es obligatorio.");
  const soloEnPerfil = bool(body.solo_en_perfil, actual ? !!actual.solo_en_perfil : false);
  let precio;
  if (soloEnPerfil) precio = 0;
  else if (body.precio_cent !== undefined && body.precio_cent !== null && body.precio_cent !== "") {
    precio = precioCent(body.precio_cent);
  } else if (actual && !actual.solo_en_perfil) precio = actual.precio_cent;
  else {throw new HttpError(
      400,
      `«${nombre}» necesita un precio (o márcalo como «solo dentro de un perfil»).`,
    );}
  return {
    nombre,
    categoria_id: body.categoria_id !== undefined ? body.categoria_id : actual?.categoria_id,
    precio_cent: precio,
    descripcion: body.descripcion !== undefined
      ? optStr(body.descripcion, 500)
      : actual?.descripcion ?? null,
    indicaciones: body.indicaciones !== undefined
      ? optStr(body.indicaciones, 300)
      : actual?.indicaciones ?? null,
    alias: body.alias !== undefined ? aliasDe(body.alias) : actual?.alias ?? null,
    activo: bool(body.activo, actual ? !!actual.activo : true) ? 1 : 0,
    solo_en_perfil: soloEnPerfil ? 1 : 0,
  };
}

/** Datos de un perfil (sin sus exámenes). */
export function datosPerfil(body, actual = null) {
  const nombre = body.nombre !== undefined ? str(body.nombre, 120) : actual?.nombre;
  if (!nombre) throw new HttpError(400, "El nombre es obligatorio.");
  const precio = body.precio_cent !== undefined
    ? precioCent(body.precio_cent)
    : actual?.precio_cent;
  if (precio === undefined) throw new HttpError(400, `«${nombre}» necesita un precio.`);
  return {
    nombre,
    precio_cent: precio,
    descripcion: body.descripcion !== undefined
      ? optStr(body.descripcion, 500)
      : actual?.descripcion ?? null,
    indicaciones: body.indicaciones !== undefined
      ? optStr(body.indicaciones, 300)
      : actual?.indicaciones ?? null,
    activo: bool(body.activo, actual ? !!actual.activo : true) ? 1 : 0,
  };
}

/** Inserta o actualiza un examen dentro de una transacción (t). */
export async function escribirExamen(t, negocioId, id, d, nuevo) {
  const ahora = nowIso();
  if (nuevo) {
    await t.run(
      `INSERT INTO examenes (id, negocio_id, categoria_id, nombre, precio_cent, descripcion, indicaciones, alias, activo, solo_en_perfil, creado_en, actualizado_en)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        negocioId,
        d.categoria_id,
        d.nombre,
        d.precio_cent,
        d.descripcion,
        d.indicaciones,
        d.alias,
        d.activo,
        d.solo_en_perfil,
        ahora,
        ahora,
      ],
    );
  } else {
    await t.run(
      `UPDATE examenes SET nombre = ?, categoria_id = ?, precio_cent = ?, descripcion = ?, indicaciones = ?, alias = ?, activo = ?, solo_en_perfil = ?, actualizado_en = ?
        WHERE id = ? AND negocio_id = ?`,
      [
        d.nombre,
        d.categoria_id,
        d.precio_cent,
        d.descripcion,
        d.indicaciones,
        d.alias,
        d.activo,
        d.solo_en_perfil,
        ahora,
        id,
        negocioId,
      ],
    );
  }
}

/** Inserta o actualiza un perfil (y, si se indican, sus exámenes) dentro de una transacción (t). */
export async function escribirPerfil(t, negocioId, id, d, nuevo, examenIds = null) {
  const ahora = nowIso();
  if (nuevo) {
    await t.run(
      "INSERT INTO perfiles (id, negocio_id, nombre, descripcion, indicaciones, precio_cent, activo, creado_en, actualizado_en) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        id,
        negocioId,
        d.nombre,
        d.descripcion,
        d.indicaciones,
        d.precio_cent,
        d.activo,
        ahora,
        ahora,
      ],
    );
  } else {
    await t.run(
      "UPDATE perfiles SET nombre = ?, descripcion = ?, indicaciones = ?, precio_cent = ?, activo = ?, actualizado_en = ? WHERE id = ? AND negocio_id = ?",
      [d.nombre, d.descripcion, d.indicaciones, d.precio_cent, d.activo, ahora, id, negocioId],
    );
  }
  if (examenIds) {
    if (!nuevo) await t.run("DELETE FROM perfil_examenes WHERE perfil_id = ?", [id]);
    for (const eid of examenIds) {
      await t.run("INSERT INTO perfil_examenes (perfil_id, examen_id) VALUES (?,?)", [id, eid]);
    }
  }
}

/**
 * Varios exámenes de una vez (edición rápida e importación de CSV).
 * filas: [{ id?, nombre, categoria_id? | categoria?, precio_cent, indicaciones, descripcion, alias, activo, solo_en_perfil }]
 *  · Con id se actualiza ese examen; sin id, se busca por nombre (sin distinguir mayúsculas) y si no existe, se crea.
 *  · categoria (texto): si no existe una categoría con ese nombre, se crea.
 * simular: true → solo cuenta lo que haría. Si una fila no es válida, nada se guarda y se dice cuál.
 */
export async function loteExamenes(negocioId, filas, { simular = false } = {}) {
  if (!Array.isArray(filas) || !filas.length) {
    throw new HttpError(400, "No hay filas para guardar.");
  }
  if (filas.length > 1000) {
    throw new HttpError(400, "Son demasiadas filas de una vez (máximo 1000).");
  }
  const actuales = await db.all("SELECT * FROM examenes WHERE negocio_id = ?", [negocioId]);
  const porId = new Map(actuales.map((e) => [e.id, e]));
  const porNombre = new Map(actuales.map((e) => [clave(e.nombre), e]));
  const cats = await db.all("SELECT id, nombre FROM categorias WHERE negocio_id = ?", [negocioId]);
  const catPorId = new Map(cats.map((c) => [c.id, c]));
  const catPorNombre = new Map(cats.map((c) => [clave(c.nombre), c]));
  const catsNuevas = new Map();
  const plan = [];
  const nombresUsados = new Map(actuales.map((e) => [clave(e.nombre), e.id]));

  for (const [i, f] of filas.entries()) {
    const fila = `Fila ${i + 1}`;
    try {
      if (!f || typeof f !== "object") throw new HttpError(400, "no es válida.");
      const actual = f.id ? porId.get(f.id) : porNombre.get(clave(f.nombre));
      if (f.id && !actual) throw new HttpError(404, "ese examen ya no existe.");
      let categoriaId = f.categoria_id;
      if (!categoriaId && f.categoria !== undefined && f.categoria !== "") {
        const nombreCat = str(f.categoria, 80);
        const existente = catPorNombre.get(clave(nombreCat)) || catsNuevas.get(clave(nombreCat));
        if (existente) categoriaId = existente.id;
        else {
          const nueva = { id: uuid(), nombre: nombreCat };
          catsNuevas.set(clave(nombreCat), nueva);
          categoriaId = nueva.id;
        }
      }
      const d = datosExamen({ ...f, categoria_id: categoriaId }, actual);
      if (
        !d.categoria_id ||
        (!catPorId.has(d.categoria_id) &&
          ![...catsNuevas.values()].some((c) => c.id === d.categoria_id))
      ) {
        throw new HttpError(400, "elige una categoría válida.");
      }
      const id = actual ? actual.id : uuid();
      const dueño = nombresUsados.get(clave(d.nombre));
      if (dueño && dueño !== id) {
        throw new HttpError(409, `ya hay otro examen llamado «${d.nombre}».`);
      }
      if (actual) nombresUsados.delete(clave(actual.nombre));
      nombresUsados.set(clave(d.nombre), id);
      const cambia = !actual ||
        [
          "nombre",
          "categoria_id",
          "precio_cent",
          "descripcion",
          "indicaciones",
          "alias",
          "activo",
          "solo_en_perfil",
        ]
          .some((k) => (actual[k] ?? null) !== (d[k] ?? null));
      if (cambia) plan.push({ id, d, nuevo: !actual });
    } catch (e) {
      if (e instanceof HttpError) throw new HttpError(e.status, `${fila}: ${e.message}`);
      throw e;
    }
  }
  const resumen = {
    creados: plan.filter((p) => p.nuevo).length,
    actualizados: plan.filter((p) => !p.nuevo).length,
    sin_cambios: filas.length - plan.length,
    categorias_nuevas: [...catsNuevas.values()].map((c) => c.nombre),
  };
  if (simular || !plan.length) return { ...resumen, guardado: false };
  await db.tx(async (t) => {
    let orden = 100;
    for (const c of catsNuevas.values()) {
      await t.run(
        "INSERT INTO categorias (id, negocio_id, nombre, orden, activo) VALUES (?,?,?,?,1)",
        [c.id, negocioId, c.nombre, orden++],
      );
    }
    for (const p of plan) await escribirExamen(t, negocioId, p.id, p.d, p.nuevo);
  });
  return { ...resumen, guardado: true };
}

/**
 * Varios perfiles de una vez (importación de CSV). Se identifican por nombre.
 * filas: [{ nombre, precio_cent, descripcion, indicaciones, activo, examenes: ['Colesterol', …] }]
 * Los exámenes se buscan por nombre y deben existir (impórtalos primero).
 */
export async function lotePerfiles(negocioId, filas, { simular = false } = {}) {
  if (!Array.isArray(filas) || !filas.length) {
    throw new HttpError(400, "No hay filas para guardar.");
  }
  if (filas.length > 500) throw new HttpError(400, "Son demasiadas filas de una vez (máximo 500).");
  const actuales = await db.all("SELECT * FROM perfiles WHERE negocio_id = ?", [negocioId]);
  const porNombre = new Map(actuales.map((p) => [clave(p.nombre), p]));
  const examenes = await db.all("SELECT id, nombre FROM examenes WHERE negocio_id = ?", [
    negocioId,
  ]);
  const exPorNombre = new Map(examenes.map((e) => [clave(e.nombre), e.id]));
  const miembros = await db.all(
    "SELECT pe.perfil_id, pe.examen_id FROM perfil_examenes pe JOIN perfiles p ON p.id = pe.perfil_id WHERE p.negocio_id = ?",
    [negocioId],
  );
  const plan = [];
  const vistos = new Set();
  for (const [i, f] of filas.entries()) {
    const fila = `Fila ${i + 1}`;
    try {
      const actual = porNombre.get(clave(f?.nombre));
      const d = datosPerfil(f || {}, actual);
      if (vistos.has(clave(d.nombre))) {
        throw new HttpError(409, `«${d.nombre}» está repetido en el archivo.`);
      }
      vistos.add(clave(d.nombre));
      const nombres = Array.isArray(f.examenes)
        ? f.examenes.map((x) => String(x).trim()).filter(Boolean)
        : [];
      if (!nombres.length) throw new HttpError(400, `«${d.nombre}» no tiene exámenes.`);
      const ids = [];
      for (const n of nombres) {
        const id = exPorNombre.get(clave(n));
        if (!id) {
          throw new HttpError(400, `el examen «${n}» no existe (impórtalo o créalo primero).`);
        }
        if (!ids.includes(id)) ids.push(id);
      }
      const antes = actual
        ? miembros.filter((m) => m.perfil_id === actual.id).map((m) => m.examen_id).sort().join()
        : "";
      const cambia = !actual || antes !== [...ids].sort().join() ||
        ["nombre", "precio_cent", "descripcion", "indicaciones", "activo"].some((k) =>
          (actual[k] ?? null) !== (d[k] ?? null)
        );
      if (cambia) plan.push({ id: actual ? actual.id : uuid(), d, nuevo: !actual, ids });
    } catch (e) {
      if (e instanceof HttpError) throw new HttpError(e.status, `${fila}: ${e.message}`);
      throw e;
    }
  }
  const resumen = {
    creados: plan.filter((p) => p.nuevo).length,
    actualizados: plan.filter((p) => !p.nuevo).length,
    sin_cambios: filas.length - plan.length,
  };
  if (simular || !plan.length) return { ...resumen, guardado: false };
  await db.tx(async (t) => {
    for (const p of plan) await escribirPerfil(t, negocioId, p.id, p.d, p.nuevo, p.ids);
  });
  return { ...resumen, guardado: true };
}
