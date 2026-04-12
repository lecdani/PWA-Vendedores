const ETERNAL_BRAND_NAME_RE = /eternal/i;

export function findEternalBrandId(
  brands: readonly { id: string; name: string }[]
): string | undefined {
  const b = brands.find((x) => ETERNAL_BRAND_NAME_RE.test(String(x.name || '').trim()));
  return b?.id;
}

export function categoryBelongsToBrandId(
  category: { brandId?: string } | null | undefined,
  brandId: string | undefined
): boolean {
  if (!category || !brandId) return false;
  const cid = String(category.brandId ?? '').trim();
  const target = String(brandId).trim();
  if (!cid || !target) return false;
  if (cid === target) return true;
  const nc = Number(cid);
  const nt = Number(target);
  if (!Number.isNaN(nc) && !Number.isNaN(nt) && nc === nt) return true;
  return false;
}

const ETERNAL_FAMILY_NAME_RE = /eternal/i;

/**
 * Familias permitidas en resúmenes de **planograma**: por brandId si existe; si no hay match,
 * por nombre que contenga "Eternal" (respaldo cuando la API no envía brandId en familias).
 */
export function filterEternalFamiliesForPlanogram<T extends { name?: string; brandId?: string }>(
  families: T[],
  eternalBrandId: string | undefined
): T[] {
  if (eternalBrandId) {
    const byBrand = families.filter((c) => categoryBelongsToBrandId(c, eternalBrandId));
    if (byBrand.length > 0) return byBrand;
  }
  const byName = families.filter((c) => ETERNAL_FAMILY_NAME_RE.test(String(c.name || '').trim()));
  return byName.length > 0 ? byName : [];
}
