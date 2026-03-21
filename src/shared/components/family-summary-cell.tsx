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

  // Separador con mucho más aire y centrado perfecto
  const Separator = () => (
    <span className="mx-3 select-none text-slate-300 font-bold"></span>
  );

  return (
    <div className="min-w-0 py-1">
      {/* items-center: Obliga a que el SKU grande y el Vol pequeño 
          estén alineados por su centro, no por el suelo. 
      */}
      <div className="flex flex-wrap items-center text-left leading-none">
        
        {/* 1. SKU - Resaltado */}
        {sku && (
          <span className="text-base font-bold tabular-nums text-slate-900 px-1">
            {sku}
          </span>
        )}

        {sku && showCode && <Separator />}

        {/* 2. Código - Un poco más pequeño pero centrado */}
        {showCode && (
          <span className="text-sm font-medium tabular-nums text-slate-600 px-1">
            {code}
          </span>
        )}

        {(sku || showCode) && name && <Separator />}

        {/* 3. Nombre */}
        {name && (
          <span className="text-sm font-bold text-slate-900 px-0.5">
            {name}
          </span>
        )}

        {/* 4. Volumen - Separado con un margen extra grande */}
        {vol && (
          <span className="ml-6 text-xs font-semibold text-slate-500 bg-slate-100 px-1 py-0.5 rounded">
            {vol}
          </span>
        )}
      </div>
    </div>
  );
}