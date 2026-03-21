function normName(s: string): string {
  return s.trim().normalize('NFC');
}

/**
 * Indica si una línea de pedido pertenece a una familia/categoría.
 * - Con `familyId`/`categoryId` en el ítem: solo coincide por id (nunca por nombre).
 * - Sin id: solo por nombre, y solo si ese nombre es único en el catálogo (evita familias homónimas).
 */
export function orderItemMatchesFamily(
  item: { category?: string; familyId?: string; categoryId?: string },
  cat: { id: string; name: string },
  allCategories?: readonly { id: string; name: string }[]
): boolean {
  const fid = String(item.familyId ?? item.categoryId ?? '').trim();
  const cid = String(cat.id).trim();

  if (fid !== '') {
    if (fid === cid) return true;
    const nf = Number(fid);
    const nc = Number(cid);
    if (!Number.isNaN(nf) && !Number.isNaN(nc) && nf === nc) return true;
    return false;
  }

  const a = normName(item.category || '');
  const b = normName(cat.name || '');
  if (!a || a !== b) return false;
  if (!allCategories?.length) return true;
  const sameNameCount = allCategories.filter((c) => normName(c.name) === a).length;
  return sameNameCount === 1;
}
