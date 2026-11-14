// Colores principales que un negocio puede elegir. Los 20 pasan WCAG AA (contraste 4,5:1 o más) con texto
// blanco encima, como texto sobre el fondo claro y sobre su propio tinte claro; en modo oscuro el sistema de
// diseño los aclara y también cumplen. Así la app del paciente siempre se lee bien.
export const PALETA = [
  ["Rojo", "#b42318"],
  ["Tomate", "#c4320a"],
  ["Naranja", "#b54708"],
  ["Ámbar", "#93560a"],
  ["Oliva", "#5c6b0f"],
  ["Verde", "#2a7330"],
  ["Esmeralda", "#067647"],
  ["Turquesa", "#0b707a"],
  ["Verde azulado", "#0f766e"],
  ["Cian", "#0e7490"],
  ["Celeste", "#0369a1"],
  ["Azul", "#175cd3"],
  ["Índigo", "#3342e8"],
  ["Añil", "#3538cd"],
  ["Violeta", "#5925dc"],
  ["Morado", "#6d3fd1"],
  ["Fucsia", "#a21caf"],
  ["Magenta", "#c11574"],
  ["Rosa", "#be123c"],
  ["Pizarra", "#475467"],
].map(([nombre, color]) => ({ nombre, color }));

export const COLOR_POR_DEFECTO = "#0b707a";
const enPaleta = new Set(PALETA.map((p) => p.color));
export const esColorDePaleta = (c) => typeof c === "string" && enPaleta.has(c.toLowerCase());

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/**
 * El color que de verdad se usa: si el negocio tiene uno de antes que no está en la paleta (elegido cuando el
 * selector era libre), se usa el más parecido de la paleta. Lo guardado no se toca hasta que lo cambie.
 */
export function colorSeguro(c) {
  if (typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c)) return COLOR_POR_DEFECTO;
  const x = c.toLowerCase();
  if (enPaleta.has(x)) return x;
  // El color por defecto de antes: su versión con buen contraste es Turquesa (casi igual a la vista)
  if (x === "#0e7c86") return COLOR_POR_DEFECTO;
  const [r, g, b] = rgb(x);
  let mejor = COLOR_POR_DEFECTO;
  let d = Infinity;
  for (const { color } of PALETA) {
    const [r2, g2, b2] = rgb(color);
    // Distancia ponderada (más sensible al verde, como el ojo)
    const dist = 2 * (r - r2) ** 2 + 4 * (g - g2) ** 2 + 3 * (b - b2) ** 2;
    if (dist < d) {
      d = dist;
      mejor = color;
    }
  }
  return mejor;
}
