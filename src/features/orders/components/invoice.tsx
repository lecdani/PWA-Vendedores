'use client';

import { useLanguage } from '@/shared/i18n/language-provider';

interface InvoiceItem {
  qty: number;
  code: string;
  description: string;
  price: number;
  amount: number;
}

interface InvoiceProps {
  invoiceNumber: string;
  date: string;
  vendorName: string;
  storeName: string;
  storeAddress: string;
  items: InvoiceItem[];
  comments?: string;
}

export function Invoice({
  invoiceNumber,
  date,
  vendorName,
  storeName,
  storeAddress,
  items,
  comments,
}: InvoiceProps) {
  const { t } = useLanguage();
  const totalPcs = items.reduce((sum, item) => sum + item.qty, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  const addressOnly = (storeAddress || '').replace(/,?\s*[0-9a-f-]{36}\s*$/i, '').replace(/,?\s*\d+\s*$/, '').trim();

  return (
    <div className="bg-white text-slate-800 max-w-3xl mx-auto shadow-sm print:shadow-none" id="invoice-print">
      <div className="p-8 md:p-12">
        <div className="border-b-2 border-slate-800 pb-5 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.2em] mb-1">Eternal Cosmetics</p>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">ETERNAL COSMETICS, LLC</h1>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-8">
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
              <tr className="bg-slate-800 text-white">
                <th className="text-left py-3 px-4 font-semibold w-14 text-center">{t('invoice_qty')}</th>
                <th className="text-left py-3 px-4 font-semibold">{t('invoice_description')}</th>
                <th className="text-right py-3 px-4 font-semibold w-24">{t('invoice_unit_price')}</th>
                <th className="text-right py-3 px-4 font-semibold w-28">{t('invoice_amount')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={index} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                  <td className="py-3 px-4 text-center text-slate-700">{item.qty}</td>
                  <td className="py-3 px-4 text-slate-900">{item.description || '—'}</td>
                  <td className="py-3 px-4 text-right text-slate-700">${Number(item.price).toFixed(2)}</td>
                  <td className="py-3 px-4 text-right font-medium text-slate-900">${Number(item.amount).toFixed(2)}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 px-4 text-center text-slate-400 text-sm">{t('invoice_no_items')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end mt-8">
          <div className="w-64 border-t-2 border-slate-200 pt-4">
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
  );
}
