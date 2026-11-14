// Tablas ordenables: al pulsar un encabezado de un `table.t` se ordenan sus filas por esa columna
// (ascendente → descendente → orden original). Su aspecto está en componentes.css (.th-orden).
//
//   ordenable(tabla, { clave: "examenes" })
//
// - El valor de cada celda es su `data-v` si lo tiene; si no, su texto. Los números («4,50 REF», «12»)
//   se comparan como números y el texto en español sin distinguir mayúsculas ni tildes.
// - Las celdas vacías van siempre al final.
// - No se ordenan los encabezados vacíos (acciones) ni los que tienen `data-sin-orden`.
// - Si las filas se vuelven a pintar (un filtro, una búsqueda), se reordenan solas.
// - Con `clave`, el orden elegido se recuerda mientras la página siga abierta.

const recordados = new Map();
const comparador = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/** «1.234,56 REF» → 1234.56; «12» → 12; lo que no empieza por una cifra → null. */
export function comoNumero(txt) {
  const m = String(txt).trim().match(/^[−-]?\d[\d.]*(,\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace("−", "-").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Compara dos valores de celda: números como números, texto con el orden del español. */
export function compararValores(a, b) {
  const va = String(a ?? "").trim();
  const vb = String(b ?? "").trim();
  if (!va || !vb) return va ? -1 : vb ? 1 : 0; // vacíos al final (también al invertir: ver ordenar)
  const na = comoNumero(va);
  const nb = comoNumero(vb);
  if (na !== null && nb !== null) return na - nb;
  if (na !== null || nb !== null) return na !== null ? -1 : 1;
  return comparador.compare(va, vb);
}

const valor = (tr, i) => {
  const td = tr.cells[i];
  return td ? (td.dataset.v ?? td.textContent) : "";
};

export function ordenable(tabla, { clave } = {}) {
  if (!tabla?.tHead || !tabla.tBodies[0]) return;
  const tbody = tabla.tBodies[0];
  const ths = [...tabla.tHead.rows[0].cells];
  let estado = (clave && recordados.get(clave)) || { col: -1, dir: 0 };

  ths.forEach((th, i) => {
    if (!th.textContent.trim() || "sinOrden" in th.dataset) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "th-orden";
    b.title = "Ordenar por esta columna";
    b.append(...th.childNodes);
    th.append(b);
    b.addEventListener("click", () => {
      const dir = estado.col !== i ? 1 : estado.dir === 1 ? -1 : 0;
      estado = { col: dir ? i : -1, dir };
      if (clave) recordados.set(clave, estado);
      aplicar();
    });
  });

  const filas = () => [...tbody.rows];
  const soloAviso = (rs) =>
    rs.length < 2 || rs.some((r) => r.cells.length === 1 && r.cells[0].colSpan > 1);

  let observando = false;
  const obs = new MutationObserver(() => aplicar(true));
  const observar = (si) => {
    if (si && !observando) obs.observe(tbody, { childList: true });
    if (!si && observando) obs.disconnect();
    observando = si;
  };

  function aplicar(repintadas = false) {
    observar(false);
    const rs = filas();
    // Las filas recién pintadas traen el orden original; lo guardamos para poder volver a él
    rs.forEach((r, i) => {
      if (repintadas || r.dataset.ordenOriginal === undefined) r.dataset.ordenOriginal = i;
    });
    if (!soloAviso(rs)) {
      const { col, dir } = estado;
      const ordenadas = rs.slice().sort((a, b) => {
        if (dir) {
          const va = valor(a, col);
          const vb = valor(b, col);
          const vacio = !String(va).trim() - !String(vb).trim();
          if (vacio) return vacio; // vacíos al final en los dos sentidos
          const c = compararValores(va, vb) * dir;
          if (c) return c;
        }
        return a.dataset.ordenOriginal - b.dataset.ordenOriginal;
      });
      if (ordenadas.some((r, i) => r !== rs[i])) tbody.append(...ordenadas);
    }
    ths.forEach((th, i) => {
      if (!th.querySelector(".th-orden")) return;
      if (estado.col === i) {
        th.setAttribute("aria-sort", estado.dir === 1 ? "ascending" : "descending");
      } else th.removeAttribute("aria-sort");
    });
    observar(true);
  }
  aplicar();
}
