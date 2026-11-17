// Tablas de Planifica. La app las crea sola en una base vacía (mecanismo de @dualstudio/comun).
// Para columnas nuevas más adelante, añádelas a COLUMNAS: [['tabla', 'columna', 'TIPO'], …].
//
// Multicliente: todo lo que se planifica cuelga de un cliente (cliente_id) y ninguna consulta cruza clientes.
// Las publicaciones y los objetivos guardan su contenido como JSON (datos) con campos permitidos y tamaño máximo
// (ver validar.js): así la interfaz puede evolucionar sin migraciones para cada campo nuevo.
import { crearEsquema } from "@dualstudio/comun/servidor";

export const ESQUEMA_BASE = `
CREATE TABLE IF NOT EXISTS usuarios (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  nombre         TEXT NOT NULL DEFAULT '',
  password_hash  TEXT NOT NULL,
  es_admin       INTEGER NOT NULL DEFAULT 0,  -- administrador de Dual Studio: ve todos los clientes y gestiona el equipo
  activo         INTEGER NOT NULL DEFAULT 1,
  sesion_version INTEGER NOT NULL DEFAULT 0,  -- al subirla, las sesiones abiertas dejan de valer
  creado_en      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clientes (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,           -- dirección: /planifica/<slug>
  nombre      TEXT NOT NULL,
  handle      TEXT,                           -- cuenta de Instagram, p. ej. @laboratoriorh
  activo      INTEGER NOT NULL DEFAULT 1,     -- 0 = archivado (solo lo ven los administradores)
  cambiado_en INTEGER NOT NULL DEFAULT 0,     -- marca de tiempo del último cambio (para refrescar sin descargar todo)
  creado_en   TEXT NOT NULL
);

-- Qué usuario ve qué cliente y con qué papel
CREATE TABLE IF NOT EXISTS accesos (
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  rol        TEXT NOT NULL CHECK (rol IN ('editor', 'lector')),
  PRIMARY KEY (usuario_id, cliente_id)
);

CREATE TABLE IF NOT EXISTS publicaciones (
  id              TEXT PRIMARY KEY,
  cliente_id      TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  datos           TEXT NOT NULL,                -- JSON: título, formato, fecha, estado, copy, tomas…
  creado_en       INTEGER NOT NULL,
  creado_por      TEXT,
  actualizado_en  INTEGER NOT NULL,
  actualizado_por TEXT
);
CREATE INDEX IF NOT EXISTS idx_publicaciones_cliente ON publicaciones (cliente_id);

-- Objetivos del mes (m-AAAA-MM) y del trimestre (q-AAAA-N)
CREATE TABLE IF NOT EXISTS objetivos (
  cliente_id      TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  clave           TEXT NOT NULL,
  datos           TEXT NOT NULL,
  creado_en       INTEGER NOT NULL,
  creado_por      TEXT,
  actualizado_en  INTEGER NOT NULL,
  actualizado_por TEXT,
  PRIMARY KEY (cliente_id, clave)
);

-- Imágenes de referencia. almacen dice dónde está el contenido: 'd1' (aquí mismo) o, más adelante, otro
-- almacenamiento (p. ej. Google Drive), con la misma tabla para los datos de la imagen.
CREATE TABLE IF NOT EXISTS imagenes (
  id         TEXT PRIMARY KEY,
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  almacen    TEXT NOT NULL DEFAULT 'd1',
  contenido  BLOB,
  creado_en  TEXT NOT NULL,
  creado_por TEXT
);
CREATE INDEX IF NOT EXISTS idx_imagenes_cliente ON imagenes (cliente_id);
`;

export const COLUMNAS = [];

// Métricas de redes (Instagram hoy; TikTok después). Tablas añadidas después del esquema base: se crean también
// en bases que ya existían. Ver src/redes/.
export const TABLAS_REDES = `
-- Una cuenta conectada por cliente y red. El token va cifrado (cifrado.js) y nunca sale del servidor.
CREATE TABLE IF NOT EXISTS redes_conexiones (
  cliente_id      TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  red             TEXT NOT NULL CHECK (red IN ('ig', 'tt')),
  cuenta_id       TEXT NOT NULL,                 -- id de la cuenta en la red
  usuario         TEXT NOT NULL DEFAULT '',      -- @usuario
  token           TEXT,                          -- cifrado
  token_creado    INTEGER,                       -- ms: Instagram no deja renovar un token de menos de 24 h
  token_vence     INTEGER,                       -- ms
  origen          TEXT NOT NULL DEFAULT 'token', -- 'token' (pegado a mano) | 'oauth' (botón «Conectar»)
  estado          TEXT NOT NULL DEFAULT 'ok',    -- 'ok' | 'error'
  error           TEXT,
  sincronizado_en INTEGER,                       -- ms de la última actualización correcta
  cuenta_dia      TEXT,                          -- día (local) en que ya se guardaron las cifras de la cuenta
  completo_dia    TEXT,                          -- día (local) en que ya se actualizaron todos sus posts
  manual_en       INTEGER,                       -- ms del último «Actualizar» (freno de 15 minutos)
  audiencia       TEXT,                          -- JSON: seguidores conectados por día de la semana y hora
  audiencia_en    INTEGER,
  conectado_en    INTEGER NOT NULL,
  conectado_por   TEXT,
  PRIMARY KEY (cliente_id, red)
);

-- Cifras diarias de la cuenta: seguidores (foto del día) y lo que pasó ese día (alcance, reproducciones…).
CREATE TABLE IF NOT EXISTS redes_cuenta_dia (
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  red        TEXT NOT NULL,
  dia        TEXT NOT NULL,                      -- AAAA-MM-DD (hora local)
  seguidores INTEGER,
  datos      TEXT,                               -- JSON: alcance, reproducciones, cuentas, interacciones
  PRIMARY KEY (cliente_id, red, dia)
);

-- Cada post de la parrilla vinculado a su publicación en la red, con sus métricas actuales.
CREATE TABLE IF NOT EXISTS redes_posts (
  publicacion_id TEXT NOT NULL REFERENCES publicaciones(id) ON DELETE CASCADE,
  red            TEXT NOT NULL,
  cliente_id     TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  link           TEXT NOT NULL,
  medio_id       TEXT,                           -- id en la red (null: aún sin encontrar)
  tipo           TEXT,                           -- REELS, FEED, CAROUSEL_ALBUM…
  publicado_en   TEXT,                           -- fecha y hora real de publicación (ISO)
  metricas       TEXT,                           -- JSON: likes, comentarios, compartidos, guardados, alcance…
  dia            TEXT,                           -- día (local) de la última actualización
  actualizado_en INTEGER,
  error          TEXT,
  miniatura_url  TEXT,                           -- dirección que da la red (vence); de ahí sale la miniatura propia
  miniatura_id   TEXT,                           -- imagen propia (tabla imagenes), WebP de 320 px
  PRIMARY KEY (publicacion_id, red)
);
CREATE INDEX IF NOT EXISTS idx_redes_posts_cliente ON redes_posts (cliente_id, red);

-- Historial: una foto por post y día, solo cuando algo cambió.
CREATE TABLE IF NOT EXISTS redes_posts_dia (
  publicacion_id TEXT NOT NULL REFERENCES publicaciones(id) ON DELETE CASCADE,
  red            TEXT NOT NULL,
  dia            TEXT NOT NULL,
  metricas       TEXT NOT NULL,
  PRIMARY KEY (publicacion_id, red, dia)
);
`;

export const asegurarEsquema = crearEsquema({
  base: ESQUEMA_BASE,
  testigo: "usuarios",
  columnas: COLUMNAS,
  tablas: TABLAS_REDES,
});
