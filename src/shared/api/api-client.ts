const API_BASE_URL = 'http://192.168.0.113:5107';

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
        
        // Detectar si el usuario no está registrado
        if (response.status === 404 || 
            lowerMessage.includes('no encontrado') || 
            lowerMessage.includes('not found') ||
            lowerMessage.includes('no existe') ||
            lowerMessage.includes('no registrado') ||
            lowerMessage.includes('usuario no encontrado') ||
            lowerMessage.includes('user not found') ||
            errorCode.includes('USER_NOT_FOUND') ||
            errorCode.includes('NOT_FOUND')) {
          errorType = 'user_not_registered';
          errorMessage = 'Este email no está registrado en el sistema';
        }
        // Detectar credenciales incorrectas
        else if (response.status === 401 || 
                 lowerMessage.includes('incorrect') ||
                 lowerMessage.includes('invalid') ||
                 lowerMessage.includes('wrong') ||
                 lowerMessage.includes('credenciales') ||
                 lowerMessage.includes('contraseña') ||
                 lowerMessage.includes('password') ||
                 errorCode.includes('INVALID_CREDENTIALS') ||
                 errorCode.includes('UNAUTHORIZED')) {
          errorType = 'invalid_credentials';
          // Si el mensaje no es específico, usar uno genérico
          if (!lowerMessage.includes('email') && !lowerMessage.includes('contraseña') && !lowerMessage.includes('password')) {
            errorMessage = 'Email o contraseña incorrectos';
          }
        }
        // Otros errores 401
        else if (response.status === 401) {
          errorType = 'unauthorized';
          errorMessage = errorMessage || 'No autorizado';
        }
        // Error 404 genérico
        else if (response.status === 404) {
          errorMessage = errorMessage || 'Endpoint no encontrado';
        }
        // Error 500
        else if (response.status === 500) {
          errorMessage = errorMessage || 'Error interno del servidor';
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

  async post<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
