'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, LoginResponse } from '@/shared/api/auth-api';
import type { ApiError } from '@/shared/api/api-client';

interface User {
  id: string;
  email: string;
  role: 'vendedor' | 'admin';
  name: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // Cargar usuario del localStorage al iniciar
  useEffect(() => {
    const storedUser = localStorage.getItem('auth_user');
    const storedToken = localStorage.getItem('auth_token');
    
    if (storedUser && storedToken) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (error) {
        localStorage.removeItem('auth_user');
        localStorage.removeItem('auth_token');
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response: LoginResponse = await authApi.login(email, password);
      
      // Si la API responde con success: false explícitamente
      if (response.success === false || response.error) {
        return { 
          success: false, 
          error: response.message || response.error || 'Credenciales incorrectas' 
        };
      }
      
      // Extraer token de diferentes campos posibles
      const token = response.token || response.accessToken || response.jwt;
      
      // Extraer user de diferentes campos posibles
      const userData = response.user || response.data;
      
      // Si hay token y user, considerar éxito
      if (token && userData) {
        // Mapear el usuario al formato esperado
        const user: User = {
          id: userData.id || '',
          email: userData.email || email,
          name: userData.name || userData.email || 'Usuario',
          role: userData.role || 'vendedor',
        };
        
        // Guardar token y usuario
        localStorage.setItem('auth_token', token);
        localStorage.setItem('auth_user', JSON.stringify(user));
        setUser(user);
        return { success: true };
      }
      
      // Si solo hay token (sin user), intentar extraer info del token o usar email
      if (token) {
        const user: User = {
          id: userData?.id || email,
          email: email,
          name: userData?.name || email.split('@')[0] || 'Usuario',
          role: userData?.role || 'vendedor',
        };
        
        localStorage.setItem('auth_token', token);
        localStorage.setItem('auth_user', JSON.stringify(user));
        setUser(user);
        return { success: true };
      }
      
      // Si viene success: true pero falta token
      if (response.success === true) {
        return { 
          success: false, 
          error: 'Token no recibido del servidor' 
        };
      }
      
      // Si no hay ningún indicador claro, asumir error
      return { 
        success: false, 
        error: response.message || response.error || 'Credenciales incorrectas' 
      };
    } catch (error) {
      const apiError = error as ApiError;
      
      // Usar el mensaje de error específico si está disponible
      if (apiError.type === 'user_not_registered') {
        return { 
          success: false, 
          error: 'Este email no está registrado en el sistema' 
        };
      }
      
      if (apiError.type === 'invalid_credentials') {
        return { 
          success: false, 
          error: apiError.message || 'Email o contraseña incorrectos' 
        };
      }
      
      // Si es un 401 sin tipo específico, asumir credenciales incorrectas
      if (apiError.status === 401) {
        return { 
          success: false, 
          error: apiError.message || 'Email o contraseña incorrectos' 
        };
      }
      
      // Si es un 404, puede ser usuario no encontrado
      if (apiError.status === 404) {
        const lowerMessage = (apiError.message || '').toLowerCase();
        if (lowerMessage.includes('usuario') || lowerMessage.includes('user') || lowerMessage.includes('email')) {
          return { 
            success: false, 
            error: 'Este email no está registrado en el sistema' 
          };
        }
      }
      
      return { 
        success: false, 
        error: apiError.message || 'Error al conectar con el servidor' 
      };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('auth_user');
    localStorage.removeItem('auth_token');
    router.push('/login');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        login,
        logout,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
