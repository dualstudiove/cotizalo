// Colores principales que puede elegir un negocio. La paleta se diseñó en el editor «Paleta de Cotízalo»
// (artefacto de Claude): cada color trae tres tonos y dos decisiones.
//   color   el tono normal: rellenos (logo, botón principal, barra del carrito)
//   claro   fondos suaves (avisos, filtro elegido, botón secundario)
//   oscuro  el tono profundo
//   texto   el texto sobre el relleno: "claro" (blanco) u "oscuro"
//   acento  el tono de títulos, líneas e íconos: "claro", "normal" u "oscuro"
// En modo oscuro el sistema de diseño aclara el color solo (packages/diseno/tokens.css).
export const PALETA = [
  ["Rojo", "#ee2020", "#fde6e6", "#9c0c0c", "claro", "oscuro"],
  ["Naranja", "#f56a19", "#feefe6", "#a03f07", "claro", "normal"],
  ["Amarillo", "#feca71", "#ffefd6", "#a3660f", "oscuro", "oscuro"],
  ["Oliva", "#899301", "#f2f3e3", "#555b01", "claro", "normal"],
  ["Verde", "#0a8514", "#e4f2e5", "#06520c", "claro", "normal"],
  ["Cian", "#109d9b", "#e5f4f4", "#0a6160", "claro", "normal"],
  ["Celeste", "#a9e2fe", "#dbf3ff", "#1289c4", "oscuro", "oscuro"],
  ["Azul", "#3276ec", "#e8f0fd", "#0f45a2", "claro", "normal"],
  ["Morado", "#905dee", "#f3edfd", "#4e13ba", "claro", "normal"],
  ["Rosa", "#ff5ca3", "#ffedf5", "#d7005e", "claro", "oscuro"],
  ["Pizarra", "#697991", "#eff0f3", "#414b5a", "claro", "normal"],
].map(([nombre, color, claro, oscuro, texto, acento]) => ({
  nombre,
  color,
  claro,
  oscuro,
  texto,
  acento,
}));

export const COLOR_POR_DEFECTO = "#109d9b"; // Cian
const porColor = new Map(PALETA.map((p) => [p.color, p]));
export const esColorDePaleta = (c) => typeof c === "string" && porColor.has(c.toLowerCase());

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/**
 * El color que de verdad se usa: si el negocio tiene uno que ya no está en la paleta (elegido con un
 * selector libre o de una paleta anterior), se usa el más parecido. Lo guardado no se toca hasta que lo cambie.
 */
export function colorSeguro(c) {
  if (typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c)) return COLOR_POR_DEFECTO;
  const x = c.toLowerCase();
  if (porColor.has(x)) return x;
  // El turquesa de antes (y el color por defecto anterior) pasan a Cian
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

const TINTA = { claro: "#ffffff", oscuro: "#14161c" };
/** Lo que la app necesita para pintarse con el color del negocio (ver aplicarColor en public/js/common.js). */
export function temaDe(color) {
  const p = porColor.get(colorSeguro(color));
  return {
    color: p.color,
    claro: p.claro,
    tinta: TINTA[p.texto],
    acento: p.acento === "normal" ? p.color : p[p.acento],
  };
}
