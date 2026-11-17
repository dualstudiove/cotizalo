// Marca de cambios de un cliente (clientes.cambiado_en): la parrilla abierta pide los datos de nuevo solo
// cuando esta marca cambió (ver /api/datos?desde=).
import { db } from "@dualstudio/comun/servidor";

/** Marca que el cliente cambió: quien tenga la parrilla abierta lo verá en su próximo refresco. */
export async function tocar(clienteId) {
  await db.run("UPDATE clientes SET cambiado_en = MAX(cambiado_en + 1, ?) WHERE id = ?", [
    Date.now(),
    clienteId,
  ]);
}
