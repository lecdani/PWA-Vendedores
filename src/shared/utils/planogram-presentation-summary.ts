import type { ProductForUI } from '@/shared/api/products-api';

/** Fila de resumen “Familias” = una familia (todas sus presentaciones agrupadas). */
export type PlanogramPresentationSummaryRow = {
  /** Clave interna de agrupación (p. ej. por código de familia). */
  presentationId: string;
  familyCode: string;
  familyName: string;
  /** Nombre de presentación (prioridad sobre familyName en UI). */
  presentationName?: string;
  volume?: number;
  unit?: string;
};

/**
 * Clave del resumen «Familias»: una fila por código de familia (suma todas las presentaciones).
 * Si no hay código, se usa id de familia; si no hay familia, id de presentación.
 */
export function getPresentationSummaryKey(p: ProductForUI | undefined): string | undefined {
  if (!p) return undefined;
  const fc = String(p.familyCode ?? '').trim().toLowerCase();
  if (fc) return `famc:${fc}`;
  const fid = String(p.familyId ?? p.categoryId ?? '').trim();
  if (fid) return `fami:${fid}`;
  const id = String(p.presentationId ?? '').trim();
  if (id) return `pres:${id}`;
  return undefined;
}

export function getProductFromMap(
  map: Map<string, ProductForUI>,
  productId: string | undefined
): ProductForUI | undefined {
  const pid = String(productId ?? '').trim();
  if (!pid) return undefined;
  return map.get(pid) ?? map.get(String(Number(pid)));
}

/**
 * Presentaciones que aparecen en al menos una celda con producto (planograma).
 */
/** Presentaciones que aparecen en líneas del pedido (cantidad > 0). */
export function collectPresentationRowsFromOrderLines<
  T extends { productId?: string; quantity?: number; toOrder?: number },
>(lines: T[], productMap: Map<string, ProductForUI>): PlanogramPresentationSummaryRow[] {
  const cells = lines
    .filter((l) => (Number(l.toOrder ?? l.quantity ?? 0) || 0) > 0)
    .map((l) => ({ productId: l.productId }));
  return collectPresentationRowsFromGrid(cells, productMap);
}

export function collectPresentationRowsFromGrid<
  T extends { productId?: string },
>(cells: T[], productMap: Map<string, ProductForUI>): PlanogramPresentationSummaryRow[] {
  const byPres = new Map<string, PlanogramPresentationSummaryRow>();
  for (const cell of cells) {
    const p = getProductFromMap(productMap, cell.productId);
    if (!p) continue;
    const key = getPresentationSummaryKey(p);
    if (!key) continue;
    if (!byPres.has(key)) {
      byPres.set(key, {
        presentationId: key,
        familyCode: String(p.familyCode ?? '').trim(),
        familyName: String(p.category ?? '').trim(),
        presentationName: undefined,
        volume: undefined,
        unit: undefined,
      });
    }
  }
  return [...byPres.values()].sort((a, b) => {
    const ka = [a.familyCode, a.familyName].join('\u0000');
    const kb = [b.familyCode, b.familyName].join('\u0000');
    return ka.localeCompare(kb, undefined, { sensitivity: 'base' });
  });
}

export function sumQtyForPresentation<
  T extends { productId?: string; toOrder?: number; quantity?: number },
>(cells: T[], productMap: Map<string, ProductForUI>, presentationKey: string): number {
  const pres = String(presentationKey).trim();
  if (!pres) return 0;
  let sum = 0;
  for (const cell of cells) {
    const p = getProductFromMap(productMap, cell.productId);
    const k = getPresentationSummaryKey(p);
    if (!p || k !== pres) continue;
    const q = Number(cell.toOrder ?? cell.quantity ?? 0) || 0;
    sum += q;
  }
  return sum;
}
