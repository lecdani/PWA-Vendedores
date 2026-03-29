'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/shared/api/auth-api';
import type { ApiError } from '@/shared/api/api-client';

/** Obtiene el rol del usuario: del body o del payload del JWT (igual que Sistema Web Admin) */
function getRoleFromLoginResponse(response: Record<string, unknown>): string {
  const fromBody = (response?.role ?? response?.Role ?? '').toString().trim();
  if (fromBody) return fromBody;
  const token = (response?.token ?? response?.accessToken ?? response?.jwt ?? response?.Token) as string | undefined;
  if (!token || typeof token !== 'string') return '';
  try {
    const parts = token.split('.');
    if (parts.length < 2) return '';
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const roleClaim =
      payload.role ??
      payload.Role ??
      payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'];
    return (roleClaim ?? '').toString().trim();
  } catch {
    return '';
  }
}

interface User {
  id: string;
  email: string;
  role: 'vendedor' | 'admin';
  name: string;
  lastName?: string;
  phone?: string;
  sellerCode?: string;
  baseCityId?: string;
  salesRouteId?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  updateUser: (data: Partial<User>) => void;
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
      const response = (await authApi.login(email, password)) as Record<string, unknown>;
      
      if (response.success === false || response.error) {
        return {
          success: false,
          error: (response.message as string) || (response.error as string) || 'Credenciales incorrectas',
        };
      }

      const token = (response.token ?? response.accessToken ?? response.jwt) as string | undefined;
      if (!token) {
        return {
          success: false,
          error: (response.message as string) || 'Token no recibido del servidor',
        };
      }

      // Usuario: respuesta plana (token, email, name, id) o anidada (user/data)
      const flat = response as { id?: string; email?: string; name?: string };
      const nested = (response.user ?? response.data) as { id?: string; email?: string; name?: string } | undefined;
      const id = (nested?.id ?? flat.id ?? email) as string;
      const userEmail = (nested?.email ?? flat.email ?? email) as string;
      const userName = (nested?.name ?? flat.name ?? userEmail?.split('@')[0] ?? 'Usuario') as string;

      // Rol, estado activo y datos (teléfono, nombre) desde la API (BD) = fuente de verdad.
      let roleRaw = '';
      let isActive = true;
      let apiPhone: string | undefined;
      let apiName: string | undefined;
      let apiLastName: string | undefined;
      let apiUserId: string | undefined;
      let apiSellerCode: string | undefined;
      let apiBaseCityId: string | undefined;
      let apiSalesRouteId: string | undefined;
      try {
        const apiUser = await authApi.getCurrentUserFromApi(token, id !== email ? id : undefined, userEmail);
        roleRaw = apiUser.role;
        isActive = apiUser.isActive;
        apiPhone = apiUser.phone;
        apiName = apiUser.name;
        apiLastName = apiUser.lastName;
        apiUserId = apiUser.id;
        apiSellerCode = apiUser.sellerCode;
        apiBaseCityId = apiUser.baseCityId;
        apiSalesRouteId = apiUser.salesRouteId;
      } catch {
        roleRaw = getRoleFromLoginResponse(response);
      }
      if (!roleRaw) {
        roleRaw = getRoleFromLoginResponse(response);
      }
      if (!isActive) {
        return {
          success: false,
          error: 'Su cuenta está inactiva. Contacte al administrador del sistema.',
        };
      }
      const roleNorm = roleRaw.toLowerCase().trim();
      const isAdmin = roleNorm === 'admin' || roleNorm === 'administrator';
      if (isAdmin) {
        return {
          success: false,
          error: 'Solo los usuarios vendedores pueden acceder a este sistema. Los administradores deben usar el sistema de administración.',
        };
      }

      const user: User = {
        id: apiUserId ?? String(id),
        email: userEmail,
        name: apiName ?? userName,
        lastName: apiLastName,
        role: 'vendedor',
        phone: apiPhone,
        sellerCode: apiSellerCode,
        baseCityId: apiBaseCityId,
        salesRouteId: apiSalesRouteId,
      };
      localStorage.setItem('auth_token', token);
      localStorage.setItem('auth_user', JSON.stringify(user));
      setUser(user);
      return { success: true };
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

  const updateUser = (data: Partial<User>) => {
    if (!user) return;
    const next = { ...user, ...data };
    setUser(next);
    localStorage.setItem('auth_user', JSON.stringify(next));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        login,
        logout,
        updateUser,
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
