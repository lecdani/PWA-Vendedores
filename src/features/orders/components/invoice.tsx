'use client';

import { useMemo } from 'react';
import { useLanguage } from '@/shared/i18n/language-provider';

interface InvoiceItem {
  qty: number;
  code: string;
  description: string;
  price: number;
  amount: number;
  familyId?: string;
  familyName?: string;
  familyCode?: string;
  familySku?: string;
}

interface InvoiceProps {
  invoiceNumber: string;
  date: string;
  vendorName: string;
  storeName: string;
  storeAddress: string;
  items: InvoiceItem[];
  comments?: string;
  viewMode?: 'product' | 'family';
  printLayout?: 'normal' | 'ticket';
}

export function Invoice({
  invoiceNumber,
  date,
  vendorName,
  storeName,
  storeAddress,
  items,
  comments,
  viewMode = 'product',
  printLayout = 'normal',
}: InvoiceProps) {
  const { t } = useLanguage();
  const productRows = useMemo(() => {
    // Agrupar por SKU/descripcion/precio para no repetir productos en la factura visual.
    // (Los productos pueden venir duplicados por celdas del planograma.)
    const byKey = new Map<
      string,
      { qty: number; code: string; description: string; price: number; amount: number; familyId?: string; familyName?: string; familyCode?: string; familySku?: string }
    >();
    items.forEach((it) => {
      const code = String(it.code || '').trim();
      const desc = String(it.description || '').trim();
      const price = Number(it.price) || 0;
      const key = `${code}||${desc}||${price}`;
      if (!byKey.has(key)) {
        byKey.set(key, { ...it, qty: 0, amount: 0 });
      }
      const row = byKey.get(key)!;
      row.qty += Number(it.qty) || 0;
      row.amount += Number(it.amount) || 0;
    });
    return [...byKey.values()].filter((x) => x.qty !== 0 || x.amount !== 0);
  }, [items]);

  const totalPcs = items.reduce((sum, item) => sum + item.qty, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  const addressOnly = (storeAddress || '').replace(/,?\s*[0-9a-f-]{36}\s*$/i, '').replace(/,?\s*\d+\s*$/, '').trim();

  const familyRows = useMemo(() => {
    const byFamily = new Map<
      string,
      { familyId: string; sku: string; code: string; familyName: string; qty: number; amount: number }
    >();
    items.forEach((item) => {
      const familyId = String(item.familyId || '').trim();
      const familyName = (item.familyName || '').trim() || (t('invoice_no_family') || 'Sin familia');
      const familySku = String(item.familySku || '').trim();
      const familyCode = String(item.familyCode || '').trim();
      const key = (familyId || familySku || familyCode || familyName).toLowerCase();
      if (!byFamily.has(key)) {
        byFamily.set(key, {
          familyId,
          sku: familySku,
          code: familyCode,
          familyName,
          qty: 0,
          amount: 0,
        });
      }
      const row = byFamily.get(key)!;
      if (!row.sku && familySku) row.sku = familySku;
      if (!row.code && familyCode) row.code = familyCode;
      if ((!row.familyName || row.familyName === (t('invoice_no_family') || 'Sin familia')) && familyName) {
        row.familyName = familyName;
      }
      row.qty += Number(item.qty) || 0;
      row.amount += Number(item.amount) || 0;
    });
    return [...byFamily.values()].sort((a, b) => b.qty - a.qty || b.amount - a.amount);
  }, [items, t]);

  if (printLayout === 'ticket') {
    const rows =
      viewMode === 'family'
        ? familyRows.map((r) => ({
            left: `${r.sku || '—'} ${r.code ? `(${r.code})` : ''} ${r.familyName || ''}`.trim(),
            qty: r.qty,
            amount: r.amount,
          }))
        : productRows.map((it) => ({
            left: `${it.code || '—'} ${it.description || ''}`.trim(),
            qty: Number(it.qty) || 0,
            amount: Number(it.amount) || 0,
          }));

    const ticketUnits = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    const ticketTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const ticketStore = String(storeName || '').trim() || '—';
    const ticketVendor = String(vendorName || '').trim() || '—';
    const ticketAddress = String(addressOnly || '').trim();

    return (
      <>
        <style>{`
          @media print {
            #invoice-print.ticket-print {
              width: 58mm !important;
              max-width: 58mm !important;
              margin: 0 auto !important;
              box-shadow: none !important;
              border: 0 !important;
            }
          }
        `}</style>
        <div id="invoice-print" className="ticket-print bg-white text-black" style={{ fontFamily: 'monospace', fontSize: 11, padding: 6 }}>
          <div style={{ textAlign: 'center', marginBottom: 6 }}>
            <div style={{ fontWeight: 700 }}>ETERNAL COSMETICS</div>
            <div>{invoiceNumber || '—'}</div>
            <div>{date}</div>
          </div>
          <div style={{ marginBottom: 4 }}>
            <div><strong>TDA:</strong> {ticketStore}</div>
            <div><strong>VND:</strong> {ticketVendor}</div>
            {ticketAddress ? <div style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{ticketAddress}</div> : null}
          </div>
          <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>{viewMode === 'family' ? 'SKU/FAM' : 'SKU/ITEM'}</span>
            <span>CNT  IMP</span>
          </div>
          <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
          {rows.map((r, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <div style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{r.left}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>x{r.qty}</span>
                <span>${Number(r.amount).toFixed(2)}</span>
              </div>
            </div>
          ))}
          <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{t('invoice_total_units')}</span>
            <strong>{ticketUnits}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>{t('invoice_total')}</span>
            <span>${ticketTotal.toFixed(2)}</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          #invoice-print.ticket-print {
            width: 80mm !important;
            max-width: 80mm !important;
            margin: 0 auto !important;
            box-shadow: none !important;
          }
          #invoice-print.ticket-print .invoice-inner {
            padding: 8px !important;
          }
          #invoice-print.ticket-print .invoice-store-grid {
            grid-template-columns: 1fr !important;
            gap: 8px !important;
          }
          #invoice-print.ticket-print .invoice-header-title {
            font-size: 16px !important;
            line-height: 1.2 !important;
          }
          #invoice-print.ticket-print table th,
          #invoice-print.ticket-print table td {
            padding: 6px 4px !important;
            font-size: 11px !important;
          }
          #invoice-print.ticket-print .invoice-total-box {
            width: 100% !important;
          }
        }
      `}</style>
    <div
      className={`bg-white text-slate-800 max-w-3xl mx-auto shadow-sm print:shadow-none ${printLayout === 'ticket' ? 'ticket-print' : ''}`}
      id="invoice-print"
    >
      <div className="p-8 md:p-12 invoice-inner">
        <div className="border-b-2 border-slate-800 pb-5 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.2em] mb-1">Eternal Cosmetics</p>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight invoice-header-title">ETERNAL COSMETICS, LLC</h1>
              <p className="text-sm text-slate-600 mt-2">7NW 84TH ST, MIAMI, FL 33166</p>
              <p className="text-sm text-slate-600">TEL: (305) 12345678</p>
            </div>
            <div className="text-right sm:text-right">
              <div className="inline-block px-3 py-1 bg-slate-900 text-white text-xs font-semibold uppercase tracking-wider rounded-sm">{t('invoice_label')}</div>
              <p className="text-sm font-medium text-slate-900 mt-3">{invoiceNumber || '—'}</p>
              <p className="text-sm text-slate-600">{t('invoice_date')}: {date}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-8 invoice-store-grid">
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('invoice_client_store')}</p>
            <p className="text-sm font-semibold text-slate-900">{storeName || '—'}</p>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">{addressOnly || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('invoice_vendor')}</p>
            <p className="text-sm font-semibold text-slate-900">{vendorName || '—'}</p>
          </div>
        </div>

        <div className="overflow-hidden border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              {viewMode === 'product' ? (
                <tr className="bg-slate-800 text-white">
                  <th className="text-left py-3 px-4 font-semibold w-14 text-center">{t('invoice_qty')}</th>
                  <th className="text-left py-3 px-4 font-semibold w-24">{t('invoice_sku') || 'SKU'}</th>
                  <th className="text-left py-3 px-4 font-semibold">{t('invoice_description')}</th>
                  <th className="text-right py-3 px-4 font-semibold w-24">{t('invoice_unit_price')}</th>
                  <th className="text-right py-3 px-4 font-semibold w-28">{t('invoice_amount')}</th>
                </tr>
              ) : (
                <tr className="bg-slate-800 text-white">
                  <th className="text-left py-3 px-4 font-semibold w-24">{t('invoice_sku') || 'SKU'}</th>
                  <th className="text-left py-3 px-4 font-semibold">{t('invoice_description')}</th>
                  <th className="text-right py-3 px-4 font-semibold w-24">{t('invoice_qty')}</th>
                  <th className="text-right py-3 px-4 font-semibold w-28">{t('invoice_amount')}</th>
                </tr>
              )}
            </thead>
            <tbody>
              {viewMode === 'product'
                ? productRows.map((item, index) => (
                    <tr key={index} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                      <td className="py-3 px-4 text-center text-slate-700">{item.qty}</td>
                      <td className="py-3 px-4 text-slate-700">{item.code || '—'}</td>
                      <td className="py-3 px-4 text-slate-900">{item.description || '—'}</td>
                      <td className="py-3 px-4 text-right text-slate-700">${Number(item.price).toFixed(2)}</td>
                      <td className="py-3 px-4 text-right font-medium text-slate-900">${Number(item.amount).toFixed(2)}</td>
                    </tr>
                  ))
                : familyRows.map((row, index) => (
                    <tr key={`f-${index}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                      <td className="py-3 px-4 text-slate-700">{row.sku || '—'}</td>
                      <td className="py-3 px-4 text-slate-900">
                        <span className="inline-flex items-center gap-2">
                          {row.code ? (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                              {row.code}
                            </span>
                          ) : null}
                          <span>{row.familyName || (t('invoice_no_family') || 'Sin familia')}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-700">{row.qty}</td>
                      <td className="py-3 px-4 text-right font-medium text-slate-900">${Number(row.amount).toFixed(2)}</td>
                    </tr>
                  ))}
              {(viewMode === 'product' ? items.length === 0 : familyRows.length === 0) && (
                <tr>
                  <td colSpan={viewMode === 'product' ? 5 : 4} className="py-8 px-4 text-center text-slate-400 text-sm">{t('invoice_no_items')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end mt-8">
          <div className="w-64 border-t-2 border-slate-200 pt-4 invoice-total-box">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-600">{t('invoice_total_units')}</span>
              <span className="font-medium text-slate-800">{totalPcs}</span>
            </div>
            <div className="flex justify-between text-lg font-bold text-slate-900 mt-3 pt-2 border-t border-slate-100">
              <span>{t('invoice_total')}</span>
              <span>${totalAmount.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {comments && (
          <div className="mt-8 pt-6 border-t border-slate-200">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('invoice_observations')}</p>
            <p className="text-sm text-slate-700">{comments}</p>
          </div>
        )}

        <div className="mt-10 pt-4 border-t border-slate-100 text-center">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider">{t('invoice_footer')}</p>
        </div>
      </div>
    </div>
    </>
  );
}
