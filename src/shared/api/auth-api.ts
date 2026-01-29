import { apiClient, ApiError } from './api-client';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  success?: boolean;
  token?: string;
  accessToken?: string;
  jwt?: string;
  user?: {
    id: string;
    email: string;
    name: string;
    role: 'vendedor' | 'admin';
  };
  data?: {
    id: string;
    email: string;
    name: string;
    role: 'vendedor' | 'admin';
  };
  message?: string;
  error?: string;
}

export const authApi = {
  async login(email: string, password: string): Promise<LoginResponse> {
    try {
      const response = await apiClient.post<LoginResponse>('/auth/login', {
        email,
        password,
      });
      return response;
    } catch (error) {
      const apiError = error as ApiError;
      throw {
        message: apiError.message || 'Error al iniciar sesión',
        status: apiError.status,
      } as ApiError;
    }
  },

  async forgotPassword(email: string): Promise<{ success: boolean; message: string }> {
    try {
      const response = await apiClient.post<{ success: boolean; message: string }>(
        '/auth/forgot-password',
        { email }
      );
      return response;
    } catch (error) {
      const apiError = error as ApiError;
      throw {
        message: apiError.message || 'Error al solicitar recuperación de contraseña',
        status: apiError.status,
      } as ApiError;
    }
  },

  /**
   * Restablece la contraseña usando el token y email del link de recuperación (correo).
   * La API espera POST /auth/reset-password con { token, email, newPassword }.
   */
  async resetPassword(
    token: string,
    email: string,
    newPassword: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const response = await apiClient.post<{ success: boolean; message: string }>(
        '/auth/reset-password',
        { token, email, newPassword }
      );
      return response;
    } catch (error) {
      const apiError = error as ApiError;
      throw {
        message: apiError.message || 'Error al restablecer la contraseña',
        status: apiError.status,
      } as ApiError;
    }
  },
};
