// Configuración de Planifica: la común (BASE_PATH, SESSION_SECRET, ENVIRONMENT, TZ_OFFSET_MIN, PBKDF2_ITER,
// SUPER_EMAIL/SUPER_PASSWORD para recuperar el acceso de administrador) y la de las métricas de redes:
//  · TOKENS_KEY (secreto, opcional): clave para cifrar los tokens de Instagram y TikTok. Si falta, se deriva de
//    SESSION_SECRET (si cambias SESSION_SECRET, hay que volver a pegar los tokens).
//  · IG_API_BASE (opcional): dirección de la API de Instagram. Solo se cambia en pruebas.
import { configurarEnv as configurarComun, env } from "@dualstudio/comun/servidor";

export { env };

export function configurarEnv(b = {}) {
  return configurarComun(b, (b, env) => {
    env.tokensKey = b.TOKENS_KEY || "";
    env.igApiBase = String(b.IG_API_BASE || "https://graph.instagram.com").replace(/\/+$/, "");
  });
}
