/**
 * Asignación tienda: puede venir por vendedor (legacy) o por ruta de ventas (ERD).
 */
export function assignmentBelongsToSeller(
  a: { salespersonId?: string; salesRouteId?: string },
  user: { id?: string; salesRouteId?: string }
): boolean {
  const uid = String(user?.id ?? '').trim();
  const routeId = String(user?.salesRouteId ?? '').trim();
  const sp = String(a?.salespersonId ?? '').trim();
  const sr = String(a?.salesRouteId ?? '').trim();
  if (uid && sp !== '' && sp === uid) return true;
  if (routeId && sr && sr === routeId) return true;
  return false;
}
