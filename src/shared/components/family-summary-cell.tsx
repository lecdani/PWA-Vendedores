import type { CategoryForUI } from '@/shared/api/categories-api';

function formatFamilyVolume(cat: CategoryForUI): string | null {
  const unit = (cat.unit || '').trim();
  const raw = cat.volume;
  if (raw == null && !unit) return null;
  if (raw != null && String(raw).trim() !== '' && unit) return `${raw} ${unit}`.trim();
  if (raw != null && String(raw).trim() !== '') return String(raw);
  return unit || null;
}

export function FamilySummaryCell({
  cat,
}: {
  cat: CategoryForUI;
  labels?: any; // Ignorado según tu código anterior
}) {
  const vol = formatFamilyVolume(cat);
  const sku = (cat.sku || '').trim();
  const code = (cat.code || '').trim();
  const name = (cat.name || '').trim();

  const showCode = !!(code && code !== sku);
  const hasAny = !!(sku || showCode || name || vol);

  if (!hasAny) return <div className="text-sm text-slate-400">—</div>;

  return (
    <div className="min-w-0 py-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-left leading-none">
        
        {/* 1. SKU - Resaltado */}
        {sku && (
          <span className="text-base font-bold tabular-nums text-slate-900 px-2">
            {sku}
          </span>
        )}

        {/* 2. Código - Un poco más pequeño pero centrado */}
        {showCode && (
          <span className="text-sm font-medium tabular-nums text-slate-600 px-2">
            {code}
          </span>
        )}

        {/* 3. Nombre */}
        {name && (
          <span className="text-sm font-bold text-slate-900 px-2">
            {name}
          </span>
        )}

        {/* 4. Volumen - Separado con un margen extra grande */}
        {vol && (
          <span className="ml-3 text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded">
            {vol}
          </span>
        )}
      </div>
    </div>
  );
}