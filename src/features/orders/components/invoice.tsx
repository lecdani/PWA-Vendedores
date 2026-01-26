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
  vendorNumber: string;
  storeName: string;
  storeAddress: string;
  items: InvoiceItem[];
  comments?: string;
}

export function Invoice({ 
  invoiceNumber, 
  date, 
  vendorNumber, 
  storeName, 
  storeAddress,
  items,
  comments 
}: InvoiceProps) {
  const { t } = useLanguage();

  const totalPcs = items.reduce((sum, item) => sum + item.qty, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="bg-white p-6 max-w-4xl mx-auto" id="invoice-print">
      {/* Header */}
      <div className="border-2 border-black mb-4">
        <div className="grid grid-cols-2 border-b-2 border-black">
          <div className="p-3 border-r-2 border-black">
            <h1 className="text-lg tracking-wide mb-2">ETERNAL COSMETICS, LLC</h1>
            <p className="text-xs">7NW 84TH ST, MIAMI, FL 33166, PHONE: (305) 12345678</p>
            <p className="text-xs mt-1">STORE:</p>
          </div>
          <div className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-12 h-12 flex items-center justify-center">
                <div className="text-3xl">∞</div>
              </div>
            </div>
            <div className="border border-black p-1 mb-2">
              <div className="text-xs">INVOICE #: {invoiceNumber}</div>
            </div>
            <div className="border border-black p-1">
              <div className="text-xs">DATE: {date}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 border-b-2 border-black">
          <div className="p-3 border-r-2 border-black">
            <p className="text-xs mb-1">ADDRESS:</p>
            <p className="text-xs">{storeName}</p>
            <p className="text-xs">{storeAddress}</p>
          </div>
          <div className="p-3">
            <div className="border border-black p-1">
              <div className="text-xs">VENDOR Nº:</div>
              <div className="text-xs text-right pr-2">{vendorNumber}</div>
            </div>
          </div>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 border-b-2 border-black bg-white text-xs">
          <div className="col-span-1 p-2 border-r border-black text-center">QTY</div>
          <div className="col-span-2 p-2 border-r border-black text-center">CODE</div>
          <div className="col-span-5 p-2 border-r border-black text-center">DESCRIPTION</div>
          <div className="col-span-2 p-2 border-r border-black text-center">PRICE</div>
          <div className="col-span-2 p-2 text-center">AMOUNT</div>
        </div>

        {/* Items */}
        <div className="min-h-[300px]">
          {items.map((item, index) => (
            <div key={index} className="grid grid-cols-12 border-b border-black text-xs">
              <div className="col-span-1 p-2 border-r border-black text-center">{item.qty}</div>
              <div className="col-span-2 p-2 border-r border-black">{item.code}</div>
              <div className="col-span-5 p-2 border-r border-black">{item.description}</div>
              <div className="col-span-2 p-2 border-r border-black text-right">${item.price.toFixed(2)}</div>
              <div className="col-span-2 p-2 text-right">${item.amount.toFixed(2)}</div>
            </div>
          ))}
          
          {/* Empty rows to fill space */}
          {Array.from({ length: Math.max(0, 8 - items.length) }).map((_, index) => (
            <div key={`empty-${index}`} className="grid grid-cols-12 border-b border-black text-xs h-8">
              <div className="col-span-1 p-2 border-r border-black"></div>
              <div className="col-span-2 p-2 border-r border-black"></div>
              <div className="col-span-5 p-2 border-r border-black"></div>
              <div className="col-span-2 p-2 border-r border-black"></div>
              <div className="col-span-2 p-2"></div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="grid grid-cols-12 border-b-2 border-black text-xs">
          <div className="col-span-1 p-2 border-r-2 border-black"></div>
          <div className="col-span-2 p-2 border-r-2 border-black">TOTAL PCS</div>
          <div className="col-span-5 p-2 border-r-2 border-black text-center">{totalPcs}</div>
          <div className="col-span-2 p-2 border-r-2 border-black text-right">TOTAL:</div>
          <div className="col-span-2 p-2 text-right">${totalAmount.toFixed(2)}</div>
        </div>

        {/* Comments */}
        <div className="p-3">
          <p className="text-xs mb-2">COMMENTS:</p>
          <p className="text-xs min-h-[60px]">{comments || ''}</p>
        </div>
      </div>
    </div>
  );
}
