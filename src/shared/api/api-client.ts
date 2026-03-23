export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://100.127.113.86:5107';

/** Si true, las URLs de imágenes (y assets) se sirven por /api/proxy para evitar CORS. */
const USE_PROXY = process.env.NEXT_PUBLIC_USE_API_PROXY !== 'false';

/** URL para mostrar imágenes del backend (productos, POD). Acepta path relativo o absoluto. Con proxy evita CORS. */
export function getBackendAssetUrl(path: string | null | undefined): string {
  if (!path || path.startsWith('data:') || path.startsWith('http')) return path ?? '';
  const clean = path.replace(/^\//, '');
  if (USE_PROXY) return `/api/proxy/${clean}`;
  const base = API_BASE_URL.replace(/\/$/, '');
  return `${base}/${clean}`;
}

export interface ApiError {
  message: string;
  status?: number;
  code?: string;
  type?: 'not_found' | 'unauthorized' | 'invalid_credentials' | 'user_not_registered';
}

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const defaultHeaders: HeadersInit = {
      'Content-Type': 'application/json',
    };

    // Agregar token si existe
    const token = typeof window !== 'undefined' 
      ? localStorage.getItem('auth_token') 
      : null;
    
    if (token) {
      defaultHeaders['Authorization'] = `Bearer ${token}`;
    }

    const config: RequestInit = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);
      
      // Intentar parsear la respuesta siempre
      let data: any;
      const contentType = response.headers.get('content-type');
      
      try {
        if (contentType && contentType.includes('application/json')) {
          data = await response.json();
        } else {
          const text = await response.text();
          if (text) {
            try {
              data = JSON.parse(text);
            } catch {
              data = { message: text || response.statusText };
            }
          } else {
            data = { message: response.statusText || 'Error en la solicitud' };
          }
        }
      } catch (parseError) {
        data = { message: response.statusText || 'Error en la solicitud' };
      }
      
      // Si la respuesta no es OK, lanzar error
      // PERO: si es un 401 y hay datos (token/user), puede ser que la API use 401 para indicar algo
      // En ese caso, devolvemos los datos y dejamos que el auth-provider decida
      if (!response.ok) {
        // Si es 401 pero hay token o user en la respuesta, devolver los datos
        // (algunas APIs usan 401 incluso cuando hay token)
        if (response.status === 401 && (data.token || data.accessToken || data.jwt || data.user || data.data)) {
          return data as T;
        }
        
        let errorMessage = data.message || 
                          data.error || 
                          data.errorMessage ||
                          data.detail ||
                          response.statusText ||
                          'Error en la solicitud';
        
        // Detectar el tipo de error basado en el mensaje o código
        let errorType: ApiError['type'] = undefined;
        const errorCode = data.code || data.errorCode || '';
        const lowerMessage = errorMessage.toLowerCase();
        
        // "Usuario no registrado" solo en login; en perfil/otros mostrar el mensaje real del servidor
        const isLoginRequest = url.includes('/auth/login');
        if (isLoginRequest && (response.status === 404 ||
            lowerMessage.includes('no encontrado') ||
            lowerMessage.includes('not found') ||
            lowerMessage.includes('no existe') ||
            lowerMessage.includes('no registrado') ||
            lowerMessage.includes('usuario no encontrado') ||
            lowerMessage.includes('user not found') ||
            errorCode.includes('USER_NOT_FOUND') ||
            errorCode.includes('NOT_FOUND'))) {
          errorType = 'user_not_registered';
          errorMessage = 'Este email no está registrado en el sistema';
        }
        // Detectar credenciales incorrectas solo en 401; en 500 no mostrar "email/contraseña incorrectos"
        else if (response.status === 401) {
          const isAuthRequest = url.includes('/auth/') || url.includes('/login');
          errorType = isAuthRequest ? 'invalid_credentials' : 'unauthorized';
          if (isAuthRequest && (lowerMessage.includes('incorrect') || lowerMessage.includes('invalid') || lowerMessage.includes('wrong') || lowerMessage.includes('credenciales') || lowerMessage.includes('contraseña') || lowerMessage.includes('password') || errorCode.includes('INVALID_CREDENTIALS') || errorCode.includes('UNAUTHORIZED'))) {
            errorMessage = 'Email o contraseña incorrectos';
          } else {
            errorMessage = errorMessage || 'No autorizado';
          }
        }
        // 500/502/503: mantener mensaje del servidor o genérico (no mapear a credenciales)
        else if (response.status >= 500) {
          errorMessage = errorMessage || 'Error del servidor. Intenta más tarde.';
        }
        // Error 404 genérico (solo si no fue tratado como user_not_registered)
        else if (response.status === 404) {
          errorMessage = errorMessage || 'Recurso no encontrado';
        }
        // 400 Bad Request: mantener mensaje del servidor (ej. "El correo ya está en uso")
        else if (response.status === 400) {
          errorMessage = errorMessage || 'Datos inválidos. Revisa los campos.';
        }
        
        throw {
          message: errorMessage,
          status: response.status,
          code: errorCode,
          type: errorType,
        } as ApiError;
      }

      return data as T;
    } catch (error) {
      if (error && typeof error === 'object' && 'message' in error && 'status' in error) {
        throw error as ApiError;
      }
      throw {
        message: 'Error de conexión. Verifica tu conexión a internet.',
        status: 0,
      } as ApiError;
    }
  }

  async get<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  /** GET usando un token explícito (p. ej. recién obtenido en login) sin usar localStorage */
  async getWithToken<T>(endpoint: string, token: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
    const response = await fetch(url, { method: 'GET', headers });
    const contentType = response.headers.get('content-type');
    let data: any;
    const text = await response.text();
    if (contentType?.includes('application/json') && text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    } else {
      data = text ? { message: text } : {};
    }
    if (!response.ok) {
      throw {
        message: data?.message || data?.error || response.statusText || 'Error en la solicitud',
        status: response.status,
      } as ApiError;
    }
    return data as T;
  }

  async post<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /** POST con FormData (upload de archivos). No envía Content-Type para que el navegador ponga multipart/form-data. */
  async postFormData<T = any>(endpoint: string, formData: FormData): Promise<T> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    const headers: HeadersInit = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });
    const contentType = response.headers.get('content-type') || '';
    let data: any;
    const text = await response.text();
    if (contentType.includes('application/json') && text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    } else {
      data = text ? { message: text } : {};
    }
    if (!response.ok) {
      throw {
        message: data?.message || data?.error || response.statusText || 'Error en la solicitud',
        status: response.status,
      } as ApiError;
    }
    return data as T;
  }

  async put<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /** PUT con cuerpo JSON ya serializado (evita doble stringify y controla el payload exacto). */
  async putBody<T>(endpoint: string, jsonBody: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: jsonBody,
    });
  }

  async patch<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /** PATCH con body en texto plano (string). Content-Type: text/plain */
  async patchText<T = any>(endpoint: string, bodyText: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      headers: {
        'Content-Type': 'text/plain',
        ...options?.headers,
      },
      body: bodyText,
    });
  }

  async delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
