import { apiClient } from './api-client';
import { getBackendAssetUrl } from './api-client';

const IMAGES_UPLOAD = '/images/upload';

export interface UploadImageResponse {
  fileName: string;
}

/**
 * Sube un archivo de imagen al servidor (S3). POST /images/upload.
 * Devuelve el fileName para enviarlo al guardar POD o producto.
 */
export async function uploadImage(file: File): Promise<UploadImageResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiClient.postFormData<UploadImageResponse>(IMAGES_UPLOAD, formData);
  const raw: any = res && typeof res === 'object' ? res : {};
  const fileName = [
    raw?.fileName,
    raw?.FileName,
    raw?.file_name,
    raw?.data?.fileName,
    typeof res === 'string' ? String(res).trim() : '',
  ].find((v) => v != null && String(v).trim() !== '');
  const value = fileName ? String(fileName).trim() : '';
  if (!value) throw new Error('El servidor no devolvió fileName');
  return { fileName: value };
}

/**
 * URL para mostrar una imagen subida por fileName (mismo endpoint que productos).
 */
export function getImageDisplayUrl(fileName: string | null | undefined): string {
  if (!fileName?.trim()) return '';
  return getBackendAssetUrl('images/url/' + fileName.trim().replace(/^\/+/, ''));
}
