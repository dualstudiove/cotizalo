// Cifrado de los tokens de las redes (AES-GCM de 256 bits, Web Crypto). Un token guardado se ve así:
// «v1:<base64 de iv + texto cifrado>». La clave sale de TOKENS_KEY o, si no está, de SESSION_SECRET.
import { HttpError } from "@dualstudio/comun/servidor";
import { env } from "../env.js";

const claves = new Map();

async function clave() {
  const base = env.tokensKey || env.sessionSecret;
  if (!base) throw new HttpError(500, "Falta el secreto para cifrar los tokens (TOKENS_KEY).");
  const etiqueta = `planifica-redes|${base}`;
  if (!claves.has(etiqueta)) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(etiqueta));
    claves.set(
      etiqueta,
      await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]),
    );
  }
  return claves.get(etiqueta);
}

export async function cifrar(texto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await clave(), new TextEncoder().encode(texto)),
  );
  const todo = new Uint8Array(iv.length + ct.length);
  todo.set(iv);
  todo.set(ct, iv.length);
  return `v1:${Buffer.from(todo).toString("base64")}`;
}

/** El token descifrado, o null si no se puede (p. ej. cambió la clave). */
export async function descifrar(guardado) {
  if (typeof guardado !== "string" || !guardado.startsWith("v1:")) return null;
  try {
    const todo = Uint8Array.from(Buffer.from(guardado.slice(3), "base64"));
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: todo.slice(0, 12) },
      await clave(),
      todo.slice(12),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
