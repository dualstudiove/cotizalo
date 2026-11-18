// Exportación del presupuesto: vista previa, texto, PDF (escrito a mano, sin librerías) e imagen PNG.
// El PDF sale del motor de maquetación (layoutDoc); la imagen es vertical y más sencilla, para estados y chats.
import { bs, diaLocal, esc, fmtFecha, fmtTasa, icon, ref } from "./common.js";
import { CLARO } from "../_ds/diseno/js/tokens.js";
import { ICONOS } from "../_ds/diseno/js/iconos.js";

const COLOR_POR_DEFECTO = "#109d9b"; // Cian, el de src/paleta.js

/** Arma el documento a exportar a partir de la respuesta del servidor + datos opcionales del paciente. */
export function buildDoc({ res, negocio, paciente = {}, enlace = null }) {
  const limpio = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return {
    nombre: res.negocio.nombre,
    rif: res.negocio.rif || negocio.rif || null, // los presupuestos guardados antes del RIF lo toman de la config actual
    telefono: res.negocio.telefono,
    direccion: res.negocio.direccion,
    horario: res.negocio.horario,
    pie: res.negocio.pie,
    logo: negocio.logo || null,
    color: negocio.color || COLOR_POR_DEFECTO,
    colorAcento: negocio.tema?.acento || negocio.color || COLOR_POR_DEFECTO,
    colorTinta: negocio.tema?.tinta || null, // texto sobre el color del negocio
    enlace, // página del negocio, sin «https://» (va en la imagen)
    codigo: res.codigo,
    emision: res.dia,
    vigencia: res.vigencia_hasta,
    precios: res.precios_actualizados_en ? diaLocal(res.precios_actualizados_en) : null,
    paciente: {
      nombre: limpio(paciente.nombre),
      cedula: limpio(paciente.cedula),
      telefono: limpio(paciente.telefono),
      medico: limpio(paciente.medico),
    },
    // «Biopsia ×3»: la cantidad va en el nombre y el precio es el total de la línea (igual en pantalla, PDF, imagen y texto)
    // Debajo de cada línea: lo que incluye (perfiles), la promoción aplicada y las indicaciones previas.
    items: res.items.map((it) => ({
      ...it,
      nombre: it.cantidad > 1 ? `${it.nombre} ×${it.cantidad}` : it.nombre,
      // Precio especial: se marca con su porcentaje y hasta cuándo dura, para que no se tome como el precio regular
      promo: it.descuento_pct
        ? {
          pct: it.descuento_pct,
          hasta: it.promo_hasta || null,
          nombre: it.promo_nombre || null,
          antes: (it.precio_lista_unit_cent || 0) * (it.cantidad || 1),
        }
        : null,
      detalle: [
        it.incluye?.length ? `Incluye: ${it.incluye.join(", ")}` : null,
        it.indicaciones ? `Indicaciones: ${it.indicaciones}` : null,
      ].filter(Boolean),
    })),
    totalRef: res.total_ref_cent,
    totalBs: res.total_bs_cent,
    tasa: res.tasa,
  };
}

/** «PROMOCIÓN −25 % · HASTA EL 14/11/2026» */
/** dd/mm/aaaa → dd/mm/aa */
const fechaCorta = (dia) => fmtFecha(dia).replace(/\/\d{2}(\d{2})$/, "/$1");
/** «Semana del corazón −25 % · hasta el 30/11/26» (sin nombre: «Promoción −25 % · …») */
export const textoPromo = (p) =>
  `${p.nombre || "Promoción"} −${p.pct} %${p.hasta ? ` · hasta el ${fechaCorta(p.hasta)}` : ""}`;
const hayPromos = (d) => d.items.some((it) => it.promo);
export const NOTA_PROMO =
  "Los precios marcados como promoción son especiales y solo se respetan hasta la fecha indicada en cada uno. Después de esa fecha aplican los precios regulares, aunque el presupuesto siga vigente.";

const NOTA =
  "Los precios están expresados en REF (referencial). El monto en bolívares se calcula con la tasa indicada y puede variar según la tasa vigente al momento del pago.";

export const tasaTexto = (d) =>
  !d.tasa
    ? "Tasa de cambio no disponible en este momento."
    : d.tasa.manual
    ? `Tasa aplicada: ${fmtTasa(d.tasa.valor)} Bs. por REF`
    : `Tasa BCV: ${fmtTasa(d.tasa.valor)} Bs. por REF (${fmtFecha(d.tasa.fecha_valor)})`;

const datosPaciente = (d) =>
  [
    ["Paciente", d.paciente.nombre],
    ["C.I.", d.paciente.cedula],
    ["Teléfono", d.paciente.telefono],
    ["Médico referente", d.paciente.medico],
  ].filter(([, v]) => v);
const contacto = (d) =>
  [d.rif && `RIF ${d.rif}`, d.telefono && `Tel. ${d.telefono}`, d.direccion, d.horario].filter(
    Boolean,
  );

// ─────────────────────────── Texto ───────────────────────────
// Lista sencilla para pegar en un chat: los exámenes con su precio, los totales, la tasa, la fecha de los
// precios y el enlace para armar otro presupuesto. El resto (negocio, código, paciente…) va en el PDF y la imagen.
export function toText(d) {
  const L = d.items.map((it) => `${it.nombre}: ${ref(it.precio_cent)}`);
  L.push("", `Total: ${ref(d.totalRef)}`);
  if (d.tasa) L.push(`Total en bolívares: ${bs(d.totalBs)}`, "", tasaTexto(d));
  if (d.precios) L.push("", `Precios actualizados el ${fmtFecha(d.precios)}.`);
  if (d.enlace) L.push("", `Haz tu presupuesto en: https://${d.enlace}`);
  return L.join("\n");
}

// ─────────────────────────── Vista previa (HTML) ───────────────────────────
export function paperHTML(d) {
  const pac = datosPaciente(d);
  return `
  <div class="ph">
    ${d.logo ? `<img src="${esc(d.logo)}" alt="">` : ""}
    <div><h2>${esc(d.nombre)}</h2><div class="muted xs">${
    contacto(d).map(esc).join("<br>")
  }</div></div>
    <div class="code"><span class="xs muted">PRESUPUESTO</span><b>${esc(d.codigo)}</b></div>
  </div>
  <div class="meta2"><span>Emisión: <b>${fmtFecha(d.emision)}</b></span><span>Válido hasta: <b>${
    fmtFecha(d.vigencia)
  }</b></span>${
    d.precios ? `<span>Precios actualizados: <b>${fmtFecha(d.precios)}</b></span>` : ""
  }</div>
  ${
    pac.length
      ? `<div class="pac">${
        pac.map(([k, v]) => `<span class="nowrap"><b>${esc(k)}:</b> ${esc(v)}</span>`).join(
          " &nbsp;·&nbsp; ",
        )
      }</div>`
      : ""
  }
  <table><thead><tr><th>Descripción</th><th style="text-align:right">Precio</th></tr></thead><tbody>
    ${
    d.items.map((it) =>
      `<tr><td><b>${esc(it.nombre)}</b>${
        it.promo ? `<span class="promo-pdf">${esc(textoPromo(it.promo))}</span>` : ""
      }${it.detalle.map((x) => `<span class="inc">${esc(x)}</span>`).join("")}</td><td class="p">${
        ref(it.precio_cent)
      }${it.promo ? `<s class="antes">${ref(it.promo.antes)}</s>` : ""}</td></tr>`
    ).join("")
  }
  </tbody></table>
  ${
    hayPromos(d)
      ? `<div class="notice info nota-promo">${icon("info")}<div>${esc(NOTA_PROMO)}</div></div>`
      : ""
  }
  <div class="tot">
    <div class="muted small">Total en REF</div><div class="big">${ref(d.totalRef)}</div>
    ${
    d.tasa
      ? `<div class="muted small" style="margin-top:8px">Total en bolívares</div><div class="big">${
        bs(d.totalBs)
      }</div>`
      : ""
  }
    <div class="muted xs" style="margin-top:6px">${esc(tasaTexto(d))}</div>
  </div>
  ${d.pie ? `<p class="small" style="margin-top:14px">${esc(d.pie)}</p>` : ""}
  <p class="note">${esc(NOTA)}</p>`;
}

// ─────────────────────────── Métricas Helvetica (AFM, en milésimas de em) ───────────────────────────
const WR = [
  278,
  278,
  355,
  556,
  556,
  889,
  667,
  191,
  333,
  333,
  389,
  584,
  278,
  333,
  278,
  278,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  278,
  278,
  584,
  584,
  584,
  556,
  1015,
  667,
  667,
  722,
  722,
  667,
  611,
  778,
  722,
  278,
  500,
  667,
  556,
  833,
  722,
  778,
  667,
  778,
  722,
  667,
  611,
  722,
  667,
  944,
  667,
  667,
  611,
  278,
  278,
  278,
  469,
  556,
  333,
  556,
  556,
  500,
  556,
  556,
  278,
  556,
  556,
  222,
  222,
  500,
  222,
  833,
  556,
  556,
  556,
  556,
  333,
  500,
  278,
  556,
  500,
  722,
  500,
  500,
  500,
  334,
  260,
  334,
  584,
];
const WB = [
  278,
  333,
  474,
  556,
  556,
  889,
  722,
  238,
  333,
  333,
  389,
  584,
  278,
  333,
  278,
  278,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  333,
  333,
  584,
  584,
  584,
  611,
  975,
  722,
  722,
  722,
  722,
  667,
  611,
  778,
  722,
  278,
  556,
  722,
  611,
  833,
  722,
  778,
  667,
  778,
  722,
  667,
  611,
  722,
  667,
  944,
  667,
  667,
  611,
  333,
  278,
  333,
  584,
  556,
  333,
  556,
  611,
  556,
  611,
  556,
  333,
  611,
  611,
  278,
  278,
  556,
  278,
  889,
  611,
  611,
  611,
  611,
  389,
  556,
  333,
  611,
  556,
  778,
  556,
  556,
  500,
  389,
  280,
  389,
  584,
];

/** Deja solo caracteres Latin-1 (los que el PDF puede mostrar con la fuente estándar). */
function lat1(s) {
  return String(s ?? "").normalize("NFC").replace(/\s+/g, " ")
    .replace(/[–—−]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/…/g, "...").replace(/[•·]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}
function charW(ch, bold) {
  const t = bold ? WB : WR;
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return t[c - 32];
  const base = ch.normalize("NFD")[0];
  const b = base.charCodeAt(0);
  if (b >= 32 && b <= 126 && base !== ch) return t[b - 32];
  if (ch === "¿") return bold ? 611 : 556;
  if (ch === "¡") return 333;
  if (ch === "°") return 400;
  return 556;
}
const textW = (s, bold, size) => {
  let w = 0;
  for (const ch of s) w += charW(ch, bold);
  return (w * size) / 1000;
};

// ─────────────────────────── Motor de maquetación ───────────────────────────
/**
 * Devuelve páginas de comandos de dibujo en unidades (pt). Origen arriba-izquierda.
 *  { t:'text', s, x, y(línea base), size, bold, color, align } · { t:'rect' } · { t:'line' } · { t:'img' }
 */
export function layoutDoc(d, { width, margin, pageH, measure }) {
  const iw = width - margin * 2;
  // Colores del sistema de diseño (modo claro: un documento impreso siempre va en claro).
  // El texto secundario usa --ink-2 y no --ink-3: en letra pequeña --ink-3 no llega a AA sobre el tinte.
  const primary = d.color || COLOR_POR_DEFECTO;
  const C = {
    ink: CLARO.ink,
    muted: CLARO["ink-2"],
    line: CLARO.line,
    lineSoft: CLARO["line-2"],
    paper: CLARO.surface,
    primary, // relleno: la raya bajo el encabezado
    acento: d.colorAcento || primary, // títulos (el código), como en la app
    panel: CLARO.bg, // caja del paciente
    promo: CLARO.info,
    promoBg: CLARO["info-bg"],
  };
  const pages = [[]];
  let y = margin;
  const cur = () => pages[pages.length - 1];
  const salto = (h) => {
    if (pageH && y + h > pageH - margin) {
      pages.push([]);
      y = margin;
    }
  };
  const text = (s, x, size, { bold = false, color = C.ink, align = "l" } = {}) =>
    cur().push({ t: "text", s, x, y: y + size * 0.95, size, bold, color, align });
  const rect = (x, yy, w, h, color, r = 0) => cur().push({ t: "rect", x, y: yy, w, h, color, r });
  const hline = (yy, color = C.line, w = 0.6) =>
    cur().push({ t: "line", x1: margin, y1: yy, x2: width - margin, y2: yy, color, w });
  const wrap = (s, size, bold, maxW) => {
    const out = [];
    for (const par of String(s).split("\n")) {
      let line = "";
      for (const w of par.split(/\s+/).filter(Boolean)) {
        const cand = line ? `${line} ${w}` : w;
        if (measure(cand, bold, size) <= maxW) {
          line = cand;
          continue;
        }
        if (line) out.push(line);
        let rest = w;
        while (measure(rest, bold, size) > maxW && rest.length > 1) {
          let k = rest.length;
          while (k > 1 && measure(rest.slice(0, k), bold, size) > maxW) k--;
          out.push(rest.slice(0, k));
          rest = rest.slice(k);
        }
        line = rest;
      }
      out.push(line);
    }
    return out;
  };

  // Encabezado: logo + negocio a la izquierda, código a la derecha
  const top = y;
  const rx = width - margin;
  const logo = d._logo;
  const logoH = 44;
  const logoW = logo ? Math.min(90, (logo.w / logo.h) * logoH) : 0;
  // Como la vista previa de la app: «PRESUPUESTO» apagado y el código en el color del negocio
  text("PRESUPUESTO", rx, 8, { bold: true, color: C.muted, align: "r" });
  y = top + 12;
  text(d.codigo, rx, 15, { bold: true, color: C.acento, align: "r" });
  y = top;
  let x0 = margin;
  if (logo) {
    cur().push({ t: "img", x: margin, y: top, w: logoW, h: logoH });
    x0 = margin + logoW + 10;
  }
  const leftW = rx - x0 - 130;
  for (const l of wrap(d.nombre, 17, true, leftW)) {
    text(l, x0, 17, { bold: true });
    y += 20;
  }
  for (const c of contacto(d)) {
    for (const l of wrap(c, 8.5, false, leftW)) {
      text(l, x0, 8.5, { color: C.muted });
      y += 11.5;
    }
  }
  y = Math.max(y, top + logoH) + 10;
  rect(margin, y, iw, 1.6, C.primary);
  y += 12;

  // Fechas: etiqueta apagada y valor en negrita, una tras otra
  {
    let x = margin;
    const fechas = [["Emisión: ", d.emision], ["Válido hasta: ", d.vigencia]];
    if (d.precios) fechas.push(["Precios actualizados: ", d.precios]);
    for (const [k, v] of fechas) {
      const val = fmtFecha(v);
      if (x > margin && x + measure(k + val, true, 9) > rx) {
        x = margin;
        y += 13;
      }
      text(k, x, 9, { color: C.muted });
      x += measure(k, false, 9);
      text(val, x, 9, { bold: true });
      x += measure(val, true, 9) + 14;
    }
    y += 22;
  }

  const pac = datosPaciente(d);
  if (pac.length) {
    // «Paciente:» en negrita y el dato normal; los pares pasan a otra línea si no caben
    const sep = "     ·     ";
    const filas = [[]];
    let ancho = 0;
    for (const [k, v] of pac) {
      const par = [`${k}: `, v];
      const w = measure(par[0], true, 10) + measure(v, false, 10);
      const extra = filas.at(-1).length ? measure(sep, false, 10) : 0;
      if (filas.at(-1).length && ancho + extra + w > iw - 20) {
        filas.push([]);
        ancho = 0;
      }
      ancho += (filas.at(-1).length ? measure(sep, false, 10) : 0) + w;
      filas.at(-1).push(par);
    }
    const h = filas.length * 14 + 14;
    salto(h + 10);
    rect(margin, y, iw, h, C.panel, 8);
    y += 7;
    for (const fila of filas) {
      let x = margin + 10;
      fila.forEach(([k, v], i) => {
        if (i) {
          text(sep, x, 10);
          x += measure(sep, false, 10);
        }
        text(k, x, 10, { bold: true });
        x += measure(k, true, 10);
        text(v, x, 10);
        x += measure(v, false, 10);
      });
      y += 14;
    }
    y += 14;
  }

  // Tabla
  salto(70);
  y += 2;
  text("DESCRIPCIÓN", margin, 8, { bold: true, color: C.muted });
  text("PRECIO", rx, 8, { bold: true, color: C.muted, align: "r" });
  y += 14;
  hline(y, C.line, 0.8);
  const priceW = 100;
  const nameW = iw - priceW - 16;
  for (const it of d.items) {
    const nl = wrap(it.nombre, 11, true, nameW);
    const inc = it.detalle.flatMap((x) => wrap(x, 8.6, false, nameW));
    const chip = it.promo ? textoPromo(it.promo).toUpperCase() : null;
    const cw = chip ? measure(chip, true, 7.4) + 14 : 0;
    // El chip va junto al nombre si cabe en la misma línea; si no, debajo
    const chipAlLado = chip && nl.length === 1 &&
      measure(nl[0], true, 11) + 5 + cw <= nameW;
    const chipAbajo = chip && !chipAlLado;
    const altoDesc = nl.length * 14 + (chipAbajo ? 16.5 : 0) +
      (inc.length ? 3 + inc.length * 11.2 : 0);
    const altoPrecio = chip ? 26 : 14;
    const alto = Math.max(altoDesc, altoPrecio);
    salto(alto + 15);
    y += 7;
    const top = y;
    // Precio (centrado en la fila): el de promoción en tinta y debajo el regular tachado
    y = top + (alto - altoPrecio) / 2;
    text(ref(it.precio_cent), rx, 11, { bold: true, align: "r" });
    if (chip) {
      const antes = ref(it.promo.antes);
      y += 16;
      text(antes, rx, 8.6, { color: C.muted, align: "r" });
      const wa = measure(antes, false, 8.6);
      cur().push({
        t: "line",
        x1: rx - wa,
        y1: y + 5.2,
        x2: rx,
        y2: y + 5.2,
        color: C.muted,
        w: 0.7,
      });
    }
    // Descripción a la izquierda, centrada en vertical en la fila
    y = top + (alto - altoDesc) / 2;
    const pintarChip = (x, yy) => {
      rect(x, yy, cw, 13.5, C.promoBg, 6.75);
      const y0 = y;
      y = yy + 3.3;
      text(chip, x + 7, 7.4, { bold: true, color: C.promo });
      y = y0;
    };
    for (const l of nl) {
      text(l, margin, 11, { bold: true });
      if (chipAlLado) pintarChip(margin + measure(l, true, 11) + 5, y + 0.4);
      y += 14;
    }
    if (chipAbajo) {
      pintarChip(margin, y + 3);
      y += 16.5;
    }
    if (inc.length) y += 3;
    for (const l of inc) {
      text(l, margin, 8.6, { color: C.muted });
      y += 11.2;
    }
    y = top + alto + 8;
    hline(y, C.lineSoft, 0.8);
  }

  if (hayPromos(d)) {
    // Aviso con fondo y el ícono de información a la izquierda (como .notice del sistema de diseño)
    const pad = 9;
    const ico = 10;
    const lineas = wrap(NOTA_PROMO, 8.4, false, iw - pad * 2 - ico - 8);
    const h = lineas.length * 11 + pad * 2 - 2;
    y += 10;
    salto(h);
    rect(margin, y, iw, h, C.promoBg, 6);
    const cx = margin + pad + ico / 2;
    const cy = y + pad + ico / 2;
    cur().push({ t: "circle", cx, cy, r: ico / 2 - 0.5, color: C.promo, w: 1 });
    cur().push({ t: "line", x1: cx, y1: cy - 0.4, x2: cx, y2: cy + 2.6, color: C.promo, w: 1.1 });
    cur().push({ t: "circle", cx, cy: cy - 2.3, r: 0.65, color: C.promo, fill: true });
    y += pad - 1;
    for (const l of lineas) {
      text(l, margin + pad + ico + 8, 8.4, { color: C.promo });
      y += 11;
    }
    y += pad - 1;
  }

  // Totales: alineados a la derecha, sin caja (como la vista previa)
  const tasaLines = wrap(tasaTexto(d), 8.4, false, 300);
  const th = 13 + 24 + (d.tasa ? 13 + 24 + 6 : 0) + tasaLines.length * 11;
  y += hayPromos(d) ? 16 : 14;
  salto(th + 60);
  text("Total en REF", rx, 9, { color: C.muted, align: "r" });
  y += 13;
  text(ref(d.totalRef), rx, 18, { bold: true, align: "r" });
  y += 24;
  if (d.tasa) {
    y += 6;
    text("Total en bolívares", rx, 9, { color: C.muted, align: "r" });
    y += 13;
    text(bs(d.totalBs), rx, 18, { bold: true, align: "r" });
    y += 24;
  }
  y += 2;
  for (const l of tasaLines) {
    text(l, rx, 8.4, { color: C.muted, align: "r" });
    y += 11;
  }
  y += 16;

  if (d.pie) {
    for (const l of wrap(d.pie, 9.2, false, iw)) {
      salto(14);
      text(l, margin, 9.2);
      y += 12.5;
    }
  }
  y += 8;
  for (const l of wrap(NOTA, 8, false, iw)) {
    salto(12);
    text(l, margin, 8, { color: C.muted });
    y += 11;
  }

  return { pages, alto: y + margin };
}

// ─────────────────────────── Logo ───────────────────────────
async function prepararLogo(d) {
  if (d._logo !== undefined) return;
  d._logo = null;
  if (!d.logo || !d.logo.startsWith("data:image/jpeg;base64,")) return;
  try {
    const img = new Image();
    img.src = d.logo;
    await img.decode();
    const bin = atob(d.logo.split(",")[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    d._logo = { img, w: img.naturalWidth, h: img.naturalHeight, bytes };
  } catch {
    d._logo = null;
  }
}

// ─────────────────────────── PDF ───────────────────────────
const bytesLatin1 = (s) => {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
  return u;
};

export async function toPdfBlob(d) {
  await prepararLogo(d);
  const W = 595.28;
  const H = 841.89;
  const { pages } = layoutDoc(d, {
    width: W,
    margin: 42,
    pageH: H,
    measure: (s, b, z) => textW(lat1(s), b, z),
  });
  const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)).join(" ");
  };
  const pesc = (s) => s.replace(/[\\()]/g, "\\$&");
  const f = (n) => n.toFixed(2);

  const contenidos = pages.map((cmds) => {
    let c = "";
    for (const m of cmds) {
      if (m.t === "rect" && m.r) {
        // Rectángulo con esquinas redondeadas: cuatro curvas de Bézier (k ≈ 0,5523)
        const r = m.r;
        const k = r * 0.5523;
        const x0 = m.x;
        const x1 = m.x + m.w;
        const y1 = H - m.y;
        const y0 = y1 - m.h;
        c += `${rgb(m.color)} rg ${f(x0 + r)} ${f(y0)} m ${f(x1 - r)} ${f(y0)} l ` +
          `${f(x1 - r + k)} ${f(y0)} ${f(x1)} ${f(y0 + r - k)} ${f(x1)} ${f(y0 + r)} c ` +
          `${f(x1)} ${f(y1 - r)} l ${f(x1)} ${f(y1 - r + k)} ${f(x1 - r + k)} ${f(y1)} ${
            f(x1 - r)
          } ${f(y1)} c ` +
          `${f(x0 + r)} ${f(y1)} l ${f(x0 + r - k)} ${f(y1)} ${f(x0)} ${f(y1 - r + k)} ${f(x0)} ${
            f(y1 - r)
          } c ` +
          `${f(x0)} ${f(y0 + r)} l ${f(x0)} ${f(y0 + r - k)} ${f(x0 + r - k)} ${f(y0)} ${
            f(x0 + r)
          } ${f(y0)} c f\n`;
      } else if (m.t === "rect") {
        c += `${rgb(m.color)} rg ${f(m.x)} ${f(H - m.y - m.h)} ${f(m.w)} ${f(m.h)} re f\n`;
      } else if (m.t === "circle") {
        // Círculo con cuatro curvas de Bézier: relleno (f) o solo contorno (S)
        const k = m.r * 0.5523;
        const cx = m.cx;
        const cy = H - m.cy;
        const r = m.r;
        c += `${rgb(m.color)} ${m.fill ? "rg" : `RG ${m.w} w`} ${f(cx + r)} ${f(cy)} m ` +
          `${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c ` +
          `${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c ` +
          `${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c ` +
          `${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c ${
            m.fill ? "f" : "S"
          }\n`;
      } else if (m.t === "line") {
        c += `${rgb(m.color)} RG ${m.w} w ${f(m.x1)} ${f(H - m.y1)} m ${f(m.x2)} ${
          f(H - m.y2)
        } l S\n`;
      } else if (m.t === "img") {
        c += `q ${f(m.w)} 0 0 ${f(m.h)} ${f(m.x)} ${f(H - m.y - m.h)} cm /Im1 Do Q\n`;
      } else {
        const s = lat1(m.s);
        const w = textW(s, m.bold, m.size);
        const x = m.align === "r" ? m.x - w : m.x;
        c += `${rgb(m.color)} rg BT /${m.bold ? "F2" : "F1"} ${m.size} Tf ${f(x)} ${
          f(H - m.y)
        } Td (${pesc(s)}) Tj ET\n`;
      }
    }
    return c;
  });

  const logo = d._logo;
  const primera = logo ? 6 : 5;
  const objs = [];
  objs[1] = ["<< /Type /Catalog /Pages 2 0 R >>"];
  objs[2] = [
    `<< /Type /Pages /Kids [${
      pages.map((_, i) => `${primera + 2 * i} 0 R`).join(" ")
    }] /Count ${pages.length} >>`,
  ];
  objs[3] = ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"];
  objs[4] = [
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  if (logo) {
    objs[5] = [
      `<< /Type /XObject /Subtype /Image /Width ${logo.w} /Height ${logo.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.length} >>\nstream\n`,
      logo.bytes,
      "\nendstream",
    ];
  }
  pages.forEach((_, i) => {
    const pn = primera + 2 * i;
    const cb = bytesLatin1(contenidos[i]);
    objs[pn] = [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${
        logo ? " /XObject << /Im1 5 0 R >>" : ""
      } >> /Contents ${pn + 1} 0 R >>`,
    ];
    objs[pn + 1] = [`<< /Length ${cb.length} >>\nstream\n`, cb, "\nendstream"];
  });

  const out = [];
  let pos = 0;
  const add = (p) => {
    const u = typeof p === "string" ? bytesLatin1(p) : p;
    out.push(u);
    pos += u.length;
  };
  add("%PDF-1.4\n%âãÏÓ\n");
  const offs = [];
  for (let n = 1; n < objs.length; n++) {
    offs[n] = pos;
    add(`${n} 0 obj\n`);
    objs[n].forEach(add);
    add("\nendobj\n");
  }
  const xref = pos;
  add(`xref\n0 ${objs.length}\n0000000000 65535 f \n`);
  for (let n = 1; n < objs.length; n++) add(`${String(offs[n]).padStart(10, "0")} 00000 n \n`);
  add(
    `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info << /Title (${
      pesc(lat1(`Presupuesto ${d.codigo}`))
    }) >> >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  return new Blob(out, { type: "application/pdf" });
}

// ─────────────────────────── Imagen vertical (estados de Instagram y WhatsApp) ───────────────────────────
// Formato propio, más sencillo que el PDF: 1080 px de ancho y al menos 1920 de alto (9:16). Lleva lo que el
// paciente necesita ver de un vistazo: el negocio y su RIF, el código, los exámenes con su precio y el total.
// Si la lista no cabe en 1920 px, la imagen crece hacia abajo en vez de achicar la letra.
const STORY_W = 1080;
const STORY_H = 1920;
const F_TEXTO = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const F_TITULO = '"Space Grotesk", "Inter", system-ui, -apple-system, "Segoe UI", Arial, sans-serif';

/** Espera las fuentes de la página (si no cargan, el lienzo usa las del sistema). */
async function fuentesListas() {
  try {
    await Promise.all([
      document.fonts.load(`700 40px ${F_TITULO}`),
      document.fonts.load(`600 40px ${F_TEXTO}`),
      document.fonts.load(`400 40px ${F_TEXTO}`),
    ]);
  } catch { /* sin fuentes web: se dibuja con las del sistema */ }
}

/** Dibuja la imagen en `g` y devuelve el alto que ocupó el contenido. */
function dibujarStory(d, g, H, dy = 0) {
  const M = 72; // margen lateral
  const W = STORY_W;
  const color = d.color || COLOR_POR_DEFECTO;
  const C = {
    fondo: CLARO.bg, // el gris claro de la página
    ink: CLARO.ink,
    muted: CLARO["ink-2"],
    linea: CLARO["line-2"],
    tarjeta: CLARO.surface,
    color,
    tinta: d.colorTinta || CLARO["accent-ink"],
    acento: d.colorAcento || color,
    promo: CLARO.info,
  };
  const font = (peso, px, fam = F_TEXTO) => `${peso} ${px}px ${fam}`;
  const medir = (s, f) => {
    g.font = f;
    return g.measureText(s).width;
  };
  const texto = (s, x, y, f, col, align = "left") => {
    g.font = f;
    g.fillStyle = col;
    g.textAlign = align;
    g.fillText(s, x, y);
  };
  const caja = (x, y, w, h, r, col) => {
    g.fillStyle = col;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  };
  const partir = (s, f, max) => {
    const out = [];
    let linea = "";
    for (const w of String(s).split(/\s+/).filter(Boolean)) {
      const cand = linea ? `${linea} ${w}` : w;
      if (!linea || medir(cand, f) <= max) linea = cand;
      else {
        out.push(linea);
        linea = w;
      }
    }
    if (linea) out.push(linea);
    return out;
  };

  g.textBaseline = "alphabetic";
  g.fillStyle = C.fondo;
  g.fillRect(0, 0, W, H);
  g.translate(0, dy); // contenido centrado en vertical cuando sobra alto

  // Encabezado: logo, nombre del negocio y RIF
  let y = 96;
  const logo = d._logo;
  if (logo) {
    const lh = 120;
    const lw = Math.min(260, (logo.w / logo.h) * lh);
    caja(M, y, lw + 24, lh + 24, 28, C.tarjeta);
    g.drawImage(logo.img, M + 12, y + 12, lw, lh);
    y += lh + 24 + 40;
  }
  const fNombre = font(700, 60, F_TITULO);
  for (const l of partir(d.nombre, fNombre, W - M * 2)) {
    y += 60;
    texto(l, M, y, fNombre, C.ink);
    y += 10;
  }
  const datos = [d.rif && `RIF ${d.rif}`, d.telefono && `Tel. ${d.telefono}`].filter(Boolean);
  if (datos.length) {
    y += 46;
    texto(datos.join("   ·   "), M, y, font(500, 32), C.muted);
  }

  // Código del presupuesto y vigencia
  y += 72;
  texto("PRESUPUESTO", M, y, font(700, 26), C.muted);
  y += 70;
  texto(d.codigo, M, y, font(700, 72, F_TITULO), C.acento);
  y += 52;
  texto(
    `Emitido el ${fmtFecha(d.emision)}  ·  Válido hasta el ${fmtFecha(d.vigencia)}`,
    M,
    y,
    font(400, 30),
    C.muted,
  );
  if (d.paciente.nombre) {
    y += 46;
    const pac = [d.paciente.nombre, d.paciente.cedula && `C.I. ${d.paciente.cedula}`]
      .filter(Boolean).join("  ·  ");
    texto(`Paciente: ${pac}`, M, y, font(600, 30), C.ink);
  }

  // Tarjeta blanca con los exámenes: nombre a la izquierda y precio a la derecha
  y += 52;
  const pad = 44;
  const xi = M + pad;
  const xd = W - M - pad;
  const fItem = font(600, 36);
  const fPrecio = font(700, 36);
  const fPromo = font(600, 26);
  const fAntes = font(500, 28);
  const filas = d.items.map((it) => {
    const precio = ref(it.precio_cent);
    const ancho = xd - xi - medir(precio, fPrecio) - 32;
    const lineas = partir(it.nombre, fItem, ancho);
    // En promoción: debajo, el nombre de la promo a la izquierda y el precio de antes tachado a la derecha
    const antes = it.promo ? ref(it.promo.antes) : null;
    const promo = it.promo
      ? partir(textoPromo(it.promo), fPromo, xd - xi - medir(antes, fAntes) - 28)
      : [];
    return { precio, lineas, promo, antes, alto: lineas.length * 46 + promo.length * 38 + (promo.length ? 6 : 0) };
  });
  const sep = 40;
  const altoTarjeta = pad * 2 + filas.reduce((s, f) => s + f.alto, 0) +
    Math.max(0, filas.length - 1) * sep;
  caja(M, y, W - M * 2, altoTarjeta, 36, C.tarjeta);
  let yi = y + pad;
  filas.forEach((f, i) => {
    if (i) {
      g.fillStyle = C.linea;
      g.fillRect(xi, yi + sep / 2 - 1, xd - xi, 2);
      yi += sep;
    }
    texto(f.precio, xd, yi + 36, fPrecio, C.ink, "right");
    for (const l of f.lineas) {
      texto(l, xi, yi + 36, fItem, C.ink);
      yi += 46;
    }
    if (f.antes) {
      yi += 6;
      const ya = yi + 30;
      texto(f.antes, xd, ya, fAntes, C.muted, "right");
      const wa = medir(f.antes, fAntes);
      g.fillStyle = C.muted;
      g.fillRect(xd - wa, ya - 10, wa, 2.5); // tachado
      for (const l of f.promo) {
        texto(l, xi, yi + 30, fPromo, C.promo);
        yi += 38;
      }
    }
  });
  y += altoTarjeta + 32;

  // Total en el color del negocio
  const altoTotal = d.tasa ? 290 : 222;
  caja(M, y, W - M * 2, altoTotal, 36, C.color);
  let yt = y + 72;
  texto("TOTAL", xi, yt, font(700, 28), C.tinta);
  yt += 92;
  texto(ref(d.totalRef), xi, yt, font(700, 88, F_TITULO), C.tinta);
  if (d.tasa) {
    yt += 66;
    texto(bs(d.totalBs), xi, yt, font(600, 46, F_TITULO), C.tinta);
  }
  y += altoTotal;

  // Pie: tasa usada y aviso sobre el bolívar
  y += 56;
  texto(tasaTexto(d), M, y, font(400, 28), C.muted);
  y += 42;
  for (
    const l of partir(
      "El monto en bolívares puede variar según la tasa del día del pago.",
      font(400, 28),
      W - M * 2,
    )
  ) {
    texto(l, M, y, font(400, 28), C.muted);
    y += 40;
  }
  if (hayPromos(d)) {
    for (
      const l of partir(
        "Los precios en promoción se respetan solo hasta la fecha indicada.",
        font(400, 28),
        W - M * 2,
      )
    ) {
      texto(l, M, y, font(400, 28), C.muted);
      y += 40;
    }
  }
  // Tarjeta final: ícono y enlace a la página del negocio, para que otros armen su propio presupuesto
  if (d.enlace) {
    y += 40;
    const alto = 168;
    const lado = 104;
    caja(M, y, W - M * 2, alto, 36, C.tarjeta);
    const ix = M + 32;
    const iy = y + (alto - lado) / 2;
    let xt;
    if (logo) {
      const lw = Math.min(lado * 2, (logo.w / logo.h) * lado);
      g.drawImage(logo.img, ix, iy, lw, lado);
      xt = ix + lw + 28;
    } else {
      // El matraz sobre el color del negocio, como en la cabecera de la página del paciente
      caja(ix, iy, lado, lado, 26, C.color);
      g.save();
      g.translate(ix + lado * 0.2, iy + lado * 0.2);
      g.scale((lado * 0.6) / 24, (lado * 0.6) / 24);
      g.strokeStyle = C.tinta;
      g.lineWidth = 2;
      g.lineCap = "round";
      g.lineJoin = "round";
      for (const [, p] of ICONOS.flask.matchAll(/d="([^"]+)"/g)) g.stroke(new Path2D(p));
      g.restore();
      xt = ix + lado + 28;
    }
    const maxT = W - M - 32 - xt;
    texto("Haz tu presupuesto en", xt, y + 72, font(500, 28), C.muted);
    // El enlace entero si cabe (achicando la letra hasta 24 px); si no, recortado con «…»
    const fUrl = (px) => font(700, px, F_TITULO);
    let px = 38;
    while (px > 24 && medir(d.enlace, fUrl(px)) > maxT) px -= 2;
    let url = d.enlace;
    for (let n = d.enlace.length; n > 8 && medir(url, fUrl(px)) > maxT; n--) {
      url = `${d.enlace.slice(0, n)}…`;
    }
    texto(url, xt, y + 72 + 50, fUrl(px), C.acento);
    y += alto;
  }
  return y + 56;
}

export async function toPngBlob(d) {
  await Promise.all([prepararLogo(d), fuentesListas()]);
  // Primera pasada para saber cuánto alto hace falta; la segunda dibuja de verdad
  const prueba = document.createElement("canvas");
  prueba.width = STORY_W;
  prueba.height = 10;
  const contenido = Math.ceil(dibujarStory(d, prueba.getContext("2d"), 10));
  const alto = Math.max(STORY_H, contenido);
  const c = document.createElement("canvas");
  c.width = STORY_W;
  c.height = alto;
  dibujarStory(d, c.getContext("2d"), alto, Math.round((alto - contenido) / 2));
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("No se pudo crear la imagen."))),
      "image/png",
    )
  );
}

// ─────────────────────────── Descargar / compartir / copiar ───────────────────────────
export function descargar(blob, nombre) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const puedeCompartir = () => typeof navigator.share === "function";

/** Abre el menú de compartir del teléfono (con el archivo si el sistema lo permite, o con el texto). */
export async function compartir({ blob, nombre, titulo, texto }) {
  if (blob) {
    const file = new File([blob], nombre, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: titulo });
      return true;
    }
  }
  await navigator.share({ title: titulo, text: texto });
  return true;
}

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
