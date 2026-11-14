// Acento de marca con buen contraste. Un negocio elige un color vivo y de él salen:
//   --accent       el color tal cual, para rellenos (botones, barras, gráficos)
//   --accent-ink   el texto encima del relleno: blanco u oscuro, el que contraste más
//   --accent-text  el mismo tono, oscurecido (o aclarado en modo oscuro) lo justo para leerse como
//                  texto o enlace sobre la superficie, el fondo y su tinte (tinta oscura si es cálido)
//   --accent-line  bordes de selección: el color con el contraste mínimo de un borde (3:1)
//   (el foco del teclado usa --accent-text, que siempre contrasta)
//   --accent-bg    el tinte para fondos suaves
//   --accent-hover el relleno al pasar el ratón
// Así los colores pueden ser brillantes sin que la interfaz se vuelva ilegible.
import { CLARO, mezclar, OSCURO } from "./tokens.js";

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const aHex = (c) =>
  `#${
    c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join(
      "",
    )
  }`;

/** Luminancia relativa (WCAG 2). */
export function luminancia(h) {
  const [r, g, b] = rgb(h).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Contraste WCAG entre dos colores #rrggbb (de 1 a 21). */
export function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function aHsl(h) {
  const [r, g, b] = rgb(h);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r
    ? (g - b) / d + (g < b ? 6 : 0)
    : max === g
    ? (b - r) / d + 2
    : (r - g) / d + 4;
  return [hue / 6, s, l];
}
function deHsl([h, s, l]) {
  if (!s) return aHex([l, l, l]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return aHex([canal(h + 1 / 3), canal(h), canal(h - 1 / 3)]);
}

/** Oscurece (sentido −1) o aclara (+1) el color, sin cambiar su tono, hasta contrastar ≥ min con todos los fondos. */
export function ajustarContraste(color, fondos, sentido, min = 4.5) {
  const [h, s, l] = aHsl(color);
  let x = color;
  for (let k = 0; k <= 100; k++) {
    x = deHsl([h, s, Math.max(0, Math.min(1, l + sentido * k * 0.01))]);
    if (fondos.every((f) => contraste(x, f) >= min)) return x;
  }
  return x;
}

/** El texto sobre un relleno del color: blanco u oscuro, el que más contraste. */
export const tintaSobre = (color) =>
  contraste("#ffffff", color) >= contraste(CLARO.ink, color) ? "#ffffff" : CLARO.ink;

/**
 * Los colores claros y cálidos (naranja, ámbar, amarillo, lima: tono entre 20° y 100° con texto oscuro
 * encima) se vuelven ocre o marrón si se oscurecen. Con ellos el texto va en tinta oscura sobre un tinte
 * más presente, y el color se queda vivo en rellenos y bordes.
 */
export const esCalido = (color) => {
  const tono = aHsl(color)[0] * 360;
  return tintaSobre(color) !== "#ffffff" && tono >= 20 && tono <= 100;
};

/** Todo lo que el sistema de diseño necesita de un color de marca. */
export function derivarAcento(color) {
  const calido = esCalido(color);
  const fondo = mezclar(color, CLARO.surface, calido ? 0.7 : 0.89);
  const fondoOscuro = mezclar(color, OSCURO.surface, 0.74);
  return {
    color,
    calido,
    tinta: tintaSobre(color),
    // Tinte para fondos suaves (botones secundarios, filtros elegidos, avisos)
    fondo,
    fondoOscuro,
    // Texto, enlaces e íconos: el tono con contraste AA (o tinta oscura en los cálidos)
    texto: calido ? CLARO.ink : ajustarContraste(color, [CLARO.surface, CLARO.bg, fondo], -1),
    textoOscuro: ajustarContraste(color, [OSCURO.surface, OSCURO.bg, fondoOscuro], 1),
    // Relleno al pasar el ratón: se aclara si el texto encima es oscuro y se oscurece si es blanco
    // (así nunca se ensucia hacia el marrón y el texto gana contraste)
    hover: tintaSobre(color) === "#ffffff"
      ? mezclar(color, "#000000", 0.14)
      : mezclar(color, "#ffffff", 0.2),
    // Bordes de selección: el color con 3:1 (WCAG 1.4.11), así casi no cambia; en los cálidos, el color
    // tal cual (oscurecerlo lo vuelve mostaza; lo elegido se marca además con el botón relleno)
    linea: calido ? color : ajustarContraste(color, [CLARO.surface, CLARO.bg], -1, 3),
  };
}
