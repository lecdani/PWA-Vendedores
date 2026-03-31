import Dexie, { type Table } from 'dexie';

export type OfflineJobType =
  | 'CREATE_ORDER'
  | 'UPDATE_ORDER'
  | 'ENSURE_INVOICE'
  | 'UPDATE_STATUS'
  | 'CANCEL_ORDER'
  | 'POD_UPLOAD_FILE';

export interface OfflineJob {
  id?: number;
  type: OfflineJobType;
  payload: any;
  status: 'pending' | 'processing' | 'failed';
  attempts: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LocalOrderDraft {
  id: string;
  userId: string;
  data: any;
  dirty: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface IdMapRow {
  key: string;
  value: string;
}

export interface PodMediaRow {
  id: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  createdAt: number;
}

export interface CacheRow {
  key: string;
  value: any;
  updatedAt: number;
}

export interface PodUploadPayload {
  invoiceId: string;
  orderId: string;
  mediaId: string;
  notes?: string;
}

export interface CreateOrderPayload {
  localOrderId: string;
  input: any;
}

export interface UpdateOrderPayload {
  orderId: string;
  input: any;
  optionalInvoiceId?: string | number | null;
}

export interface EnsureInvoicePayload {
  orderId: string;
  deliveredItems?: any[];
  options?: { podFileName?: string; notes?: string };
}

export interface UpdateStatusPayload {
  orderId: string;
  isInvoiced: boolean;
}

class SellersOfflineDexie extends Dexie {
  offlineJobs!: Table<OfflineJob, number>;
  localOrders!: Table<LocalOrderDraft, string>;
  idMap!: Table<IdMapRow, string>;
  podMedia!: Table<PodMediaRow, string>;
  appCache!: Table<CacheRow, string>;

  constructor() {
    super('sellers-offline-db-v1');
    this.version(1).stores({
      offlineJobs: '++id, status, type, createdAt, updatedAt',
      localOrders: '&id, userId, dirty, updatedAt',
      idMap: '&key',
      podMedia: '&id, createdAt',
      appCache: '&key, updatedAt',
    });
  }
}

export const offlineDb = new SellersOfflineDexie();

