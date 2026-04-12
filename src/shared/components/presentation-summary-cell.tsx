import type { PlanogramPresentationSummaryRow } from '@/shared/utils/planogram-presentation-summary';

/** Misma columna “Familias” del planograma: código familia — nombre — vol unidad */
export function PresentationSummaryCell({ row }: { row: PlanogramPresentationSummaryRow }) {
  const code = (row.familyCode || '').trim();
  const name = (row.presentationName || row.familyName || '').trim();
  const vol =
    row.volume != null && Number.isFinite(Number(row.volume)) ? String(row.volume) : '';
  const unit = (row.unit || '').trim();
  const volUnit = [vol, unit].filter(Boolean).join(' ');

  const head = code && name ? `${code} - ${name}` : code || name || '—';
  const line = volUnit ? `${head} · ${volUnit}` : head;

  if (!code && !name && !volUnit) {
    return <div className="text-sm text-slate-400">—</div>;
  }

  return (
    <div className="min-w-0 py-1">
      <p className="text-sm text-slate-900 break-words" title={line}>
        {head}
        {volUnit ? (
          <>
            {' '}
            <span className="text-slate-600 font-normal">· {volUnit}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
