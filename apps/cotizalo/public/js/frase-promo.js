// Frase del anuncio de promociones del paciente: qué abarca cada promoción, dicho en una línea.
// Sin dependencias, para probarla en Node (test/paciente-logica.test.js).

/** «a», «a y b», «a, b y c» */
export const enLista = (xs) =>
  xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`;

/** Primera letra en mayúscula. */
export const capital = (t) => (t ? t[0].toLocaleUpperCase("es") + t.slice(1) : t);

/** Nombre de un perfil sin «perfil» al inicio: «Perfil básico» → «Básico», «Perfil de tiroides» → «Tiroides». */
export const sinPerfil = (n) => capital(n.replace(/^perfil(\s+de)?\s+/i, "") || n);

/**
 * Lo que abarca una promoción, en una frase que termina en punto. Devuelve { pct: "−20%", texto: "en …." }
 * (el porcentaje va aparte para ponerlo en negrita) o null si no abarca nada que el paciente pueda ver.
 * Orden: categorías, perfiles, exámenes.
 *  · exámenes sueltos: «−20% en 5 exámenes.» (uno: «en el examen: Glicemia.»)
 *  · categorías: «−20% en todos los exámenes de Hormonas, Coagulación y Patología.»
 *  · perfiles: «−20% en el perfil: Básico.» / «en los perfiles: Básico y Chequeo ejecutivo.»
 *  · mixto: «−20% en todos los exámenes de Hormonas, el perfil Básico y 2 exámenes más.»
 *    (sin categorías y con un solo examen, se nombra: «en el perfil Lipídico y el examen Glicemia.»)
 *
 * p: { porcentaje, categorias: [id], perfiles: [id], examenes: [id] } (del catálogo público)
 * cat: { categorias: [{ id, nombre }], examenes: Map(id → examen), perfiles: Map(id → perfil) }, solo lo publicado
 */
export function frasePromo(p, cat) {
  const cats = p.categorias.map((id) => cat.categorias.find((c) => c.id === id)).filter(Boolean);
  const enCat = new Set(cats.map((c) => c.id));
  // Los exámenes de una categoría ya incluida no se cuentan aparte
  const exs = p.examenes.map((id) => cat.examenes.get(id))
    .filter((e) => e && !enCat.has(e.categoria_id));
  const pfs = p.perfiles.map((id) => cat.perfiles.get(id)).filter(Boolean);
  const nombresCat = enLista(cats.map((c) => capital(c.nombre)));
  const nombresPf = enLista(pfs.map((x) => sinPerfil(x.nombre)));
  const solo = [cats.length, exs.length, pfs.length].filter(Boolean).length === 1;
  let resto;
  if (solo && cats.length) resto = `todos los exámenes de ${nombresCat}`;
  else if (solo && pfs.length) {
    resto = pfs.length === 1 ? `el perfil: ${nombresPf}` : `los perfiles: ${nombresPf}`;
  } else if (solo && exs.length) {
    resto = exs.length === 1 ? `el examen: ${capital(exs[0].nombre)}` : `${exs.length} exámenes`;
  } else {
    const partes = [];
    if (cats.length) partes.push(`todos los exámenes de ${nombresCat}`);
    if (pfs.length) {
      partes.push(pfs.length === 1 ? `el perfil ${nombresPf}` : `los perfiles ${nombresPf}`);
    }
    if (exs.length === 1 && !cats.length) partes.push(`el examen ${capital(exs[0].nombre)}`);
    else if (exs.length) {
      partes.push(
        `${exs.length} ${exs.length === 1 ? "examen" : "exámenes"}${cats.length ? " más" : ""}`,
      );
    }
    resto = enLista(partes);
  }
  return resto ? { pct: `−${p.porcentaje}%`, texto: `en ${resto}.` } : null;
}
