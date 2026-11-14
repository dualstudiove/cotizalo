// Colores principales que puede elegir un negocio: vivos, de marca. El contraste no depende de que sean
// oscuros: el sistema de diseño (packages/diseno/js/color.js) saca de cada uno el texto que va encima del
// relleno (blanco u oscuro) y un tono para textos, bordes y foco que pasa WCAG AA en claro y en oscuro.
// Las pruebas comprueban los 20.
export const PALETA = [
  ["Rojo", "#ef4444"],
  ["Coral", "#fb7185"],
  ["Naranja", "#f97316"],
  ["Ámbar", "#f59e0b"],
  ["Amarillo", "#facc15"],
  ["Lima", "#84cc16"],
  ["Verde", "#22c55e"],
  ["Esmeralda", "#10b981"],
  ["Turquesa", "#14b8a6"],
  ["Cian", "#06b6d4"],
  ["Celeste", "#0ea5e9"],
  ["Azul", "#3b82f6"],
  ["Índigo", "#4f46e5"],
  ["Violeta", "#7c3aed"],
  ["Morado", "#a855f7"],
  ["Fucsia", "#d946ef"],
  ["Rosa", "#ec4899"],
  ["Frambuesa", "#e11d48"],
  ["Café", "#b45309"],
  ["Pizarra", "#64748b"],
].map(([nombre, color]) => ({ nombre, color }));

export const COLOR_POR_DEFECTO = "#14b8a6"; // Turquesa
const enPaleta = new Set(PALETA.map((p) => p.color));
export const esColorDePaleta = (c) => typeof c === "string" && enPaleta.has(c.toLowerCase());

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/**
 * El color que de verdad se usa: si el negocio tiene uno de antes que no está en la paleta (elegido cuando el
 * selector era libre o de la paleta anterior), se usa el más parecido de la paleta. Lo guardado no se toca hasta que lo cambie.
 */
export function colorSeguro(c) {
  if (typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c)) return COLOR_POR_DEFECTO;
  const x = c.toLowerCase();
  if (enPaleta.has(x)) return x;
  // El color por defecto de antes, y el Turquesa de la paleta anterior, siguen siendo Turquesa
  if (x === "#0e7c86" || x === "#0b707a") return COLOR_POR_DEFECTO;
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
