// Búsqueda del paciente: tolerante a errores de tipeo y a medio escribir, con los otros nombres de los exámenes.
// Sin dependencias, para probarla en Node (test/paciente-logica.test.js).
//
// Cada palabra escrita tiene que aparecer en el texto. Si no aparece tal cual, se acepta con una letra
// equivocada, de más o de menos (dos en palabras de 8 letras o más; ninguna en las de menos de 4):
// «hemotologia» encuentra «Hematología». La palabra «perfil» no se busca: lleva a la pestaña Perfiles.

/** Sin acentos y en minúsculas (igual que norm de @dualstudio/comun, copiado para no depender de _ds/). */
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const ES_PERFIL = /^perfil(es)?$/;
const PARTIR = /[^a-z0-9ñ]+/;

/** Palabras de una búsqueda, normalizadas: «Perfil Lipídico» → ["perfil", "lipidico"]. */
export const palabrasDe = (q) => norm(q).split(PARTIR).filter(Boolean);
/** Las palabras que se buscan (sin «perfil»). */
export const palabrasBuscadas = (q) => palabrasDe(q).filter((p) => !ES_PERFIL.test(p));
/** ¿La búsqueda pide la pestaña Perfiles? */
export const pidePerfiles = (q) => palabrasDe(q).some((p) => ES_PERFIL.test(p));

/** Otros nombres de un examen (los pone el administrador): «glucemia, glucosa» → ["glucemia", "glucosa"]. */
export const aliasDe = (e) =>
  String(e?.alias || "").split(",").map((x) => x.trim()).filter(Boolean);

/** Distancia de edición (con letras intercambiadas) entre a y b; corta en cuanto pasa de max. */
export function distancia(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let ant2 = null;
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(ant[j] + 1, fila[j - 1] + 1, ant[j - 1] + c);
      if (ant2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, ant2[j - 2] + 1);
      }
      fila.push(v);
      menor = Math.min(menor, v);
    }
    if (menor > max) return max + 1;
    ant2 = ant;
    ant = fila;
  }
  return ant[b.length];
}

/**
 * 2 = todas las palabras aparecen tal cual · 1 = alguna con un error de tipeo · 0 = no coincide.
 * Una palabra a medio escribir vale: «hemotol» se compara con el comienzo de «hematologia».
 */
export function coincide(palabras, texto) {
  if (!palabras.length) return 2;
  const t = norm(texto);
  const enTexto = t.split(PARTIR).filter(Boolean);
  let nota = 2;
  for (const p of palabras) {
    if (t.includes(p)) continue;
    const max = p.length >= 8 ? 2 : p.length >= 4 ? 1 : 0;
    const casi = max &&
      enTexto.some((w) =>
        distancia(p, w, max) <= max || distancia(p, w.slice(0, p.length), max) <= max
      );
    if (!casi) return 0;
    nota = 1;
  }
  return nota;
}

/**
 * Filtra y ordena: primero lo que coincide tal cual, después lo que tiene un error de tipeo; a igualdad, el
 * orden en que llegó (el catálogo viene con lo más pedido primero). textos(x) da los textos donde buscar.
 */
export function buscar(lista, palabras, textos) {
  if (!palabras.length) return lista;
  return lista.map((x, i) => ({
    x,
    i,
    n: Math.max(...textos(x).map((t) => coincide(palabras, t))),
  }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((r) => r.x);
}

/** El otro nombre por el que se encontró un examen, si coincide mejor que su nombre («glucemia» → Glicemia). */
export function aliasEncontrado(e, palabras) {
  if (!palabras.length) return null;
  const porNombre = coincide(palabras, `${e.nombre} ${e.descripcion || ""}`);
  return aliasDe(e).find((a) => coincide(palabras, a) > porNombre) || null;
}
