import type { CategoryForUI } from '@/shared/api/categories-api';

export function FamilySummaryCell({
  cat,
}: {
  cat: CategoryForUI;
  labels?: any;
}) {
  const familyCode = (cat.code || '').trim();
  const displayShort = (cat.shortName || '').trim();

  const hasAny = !!(familyCode || displayShort);

  if (!hasAny) return <div className="text-sm text-slate-400">—</div>;

  const line = [familyCode, displayShort].filter(Boolean).join(' · ');

  return (
    <div className="min-w-0 py-1">
      <p className="text-sm text-slate-900 truncate whitespace-nowrap" title={line}>
        {line}
      </p>
    </div>
  );
}
