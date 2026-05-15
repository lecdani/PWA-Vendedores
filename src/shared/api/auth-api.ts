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
  async validateProfileUniqueness(params: {
    token: string;
    email: string;
    phone?: string;
    currentUserId?: string | null;
    currentEmail?: string | null;
  }): Promise<{ emailDuplicate: boolean; phoneDuplicate: boolean }> {
    const token = String(params.token || '').trim();
    if (!token) return { emailDuplicate: false, phoneDuplicate: false };
    try {
      const list = await apiClient.getWithToken<unknown>('/users/users', token);
      const items = Array.isArray(list)
        ? list
        : (list as Record<string, unknown>)?.data ?? (list as Record<string, unknown>)?.items ?? [];

      const targetEmail = String(params.email || '').trim().toLowerCase();
      const targetPhone = String(params.phone || '').trim();
      const currentId = String(params.currentUserId || '').trim().toLowerCase();
      const currentEmail = String(params.currentEmail || '').trim().toLowerCase();

      let emailDuplicate = false;
      let phoneDuplicate = false;

      for (const raw of items as Record<string, unknown>[]) {
        const id = String(raw?.id ?? raw?.Id ?? '').trim().toLowerCase();
        const email = String(raw?.email ?? raw?.Email ?? '').trim().toLowerCase();
        const phone = String(raw?.phone ?? raw?.Phone ?? '').trim();

        const sameById = !!currentId && id === currentId;
        const sameByEmail = !!currentEmail && email === currentEmail;
        if (sameById || sameByEmail) continue;

        if (targetEmail && email === targetEmail) emailDuplicate = true;
        if (targetPhone && phone && phone === targetPhone) phoneDuplicate = true;
        if (emailDuplicate && phoneDuplicate) break;
      }

      return { emailDuplicate, phoneDuplicate };
    } catch {
      return { emailDuplicate: false, phoneDuplicate: false };
    }
  },

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
        { email, AppType: 'Vendedor' }
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

  /**
   * Obtiene rol, estado activo, teléfono y nombre del usuario desde la API (BD = fuente de verdad).
   */
  async getCurrentUserFromApi(
    token: string,
    userId: string | undefined,
    email: string
  ): Promise<{
    id?: string;
    role: string;
    isActive: boolean;
    phone?: string;
    name?: string;
    lastName?: string;
    sellerCode?: string;
    /** Código legible de la ruta si viene en el usuario o en salesRoute anidado. */
    salesRouteCode?: string;
    baseCityId?: string;
    salesRouteId?: string;
  }> {
    const rawId = (raw: Record<string, unknown>) =>
      raw?.id != null ? String(raw.id) : raw?.Id != null ? String(raw.Id) : undefined;
    const rawRole = (raw: Record<string, unknown>) =>
      String(raw?.rol ?? raw?.Rol ?? raw?.role ?? raw?.Role ?? '').trim();
    const rawIsActive = (raw: Record<string, unknown>) => {
      if (typeof raw?.isActive === 'boolean') return raw.isActive;
      if (typeof raw?.IsActive === 'boolean') return raw.IsActive;
      return true;
    };
    const rawPhone = (raw: Record<string, unknown>) =>
      String(raw?.phone ?? raw?.Phone ?? '').trim() || undefined;
    const rawName = (raw: Record<string, unknown>) =>
      String(raw?.name ?? raw?.Name ?? raw?.firstName ?? raw?.FirstName ?? '').trim() || undefined;
    const rawLastName = (raw: Record<string, unknown>) =>
      String(raw?.lastName ?? raw?.LastName ?? '').trim() || undefined;
    const rawSellerCode = (raw: Record<string, unknown>) =>
      String(raw?.sellerCode ?? raw?.SellerCode ?? raw?.seller_code ?? raw?.SELLER_CODE ?? '').trim() || undefined;
    const rawBaseCityId = (raw: Record<string, unknown>) =>
      (raw?.baseCityId ?? raw?.BaseCityId ?? raw?.base_city_id ?? raw?.BASE_CITY_ID) != null
        ? String(raw?.baseCityId ?? raw?.BaseCityId ?? raw?.base_city_id ?? raw?.BASE_CITY_ID).trim() || undefined
        : undefined;
    const rawSalesRouteId = (raw: Record<string, unknown>) => {
      const v =
        raw?.salesRouteId ??
        raw?.SalesRouteId ??
        raw?.sales_route_id ??
        raw?.Sales_Route_Id ??
        (raw?.salesRoute as Record<string, unknown> | undefined)?.id ??
        (raw?.SalesRoute as Record<string, unknown> | undefined)?.Id;
      return v != null && String(v).trim() !== '' ? String(v).trim() : undefined;
    };

    const rawSalesRouteCode = (raw: Record<string, unknown>) => {
      const nested = (raw?.salesRoute ?? raw?.SalesRoute) as Record<string, unknown> | undefined;
      const fromNested =
        nested &&
        String(
          nested.code ??
            nested.Code ??
            nested.routeCode ??
            nested.RouteCode ??
            ''
        ).trim();
      if (fromNested) return fromNested;
      return (
        String(
          raw?.salesRouteCode ??
            raw?.SalesRouteCode ??
            raw?.routeCode ??
            raw?.RouteCode ??
            ''
        ).trim() || undefined
      );
    };

    const mapUser = (raw: Record<string, unknown>) => ({
      id: rawId(raw),
      role: rawRole(raw),
      isActive: rawIsActive(raw),
      phone: rawPhone(raw),
      name: rawName(raw),
      lastName: rawLastName(raw),
      sellerCode: rawSellerCode(raw),
      salesRouteCode: rawSalesRouteCode(raw),
      baseCityId: rawBaseCityId(raw),
      salesRouteId: rawSalesRouteId(raw),
    });

    if (userId && !String(userId).includes('@')) {
      try {
        const user = await apiClient.getWithToken<Record<string, unknown>>(
          `/users/users/${encodeURIComponent(userId)}`,
          token
        );
        return mapUser(user);
      } catch {
        // 404 o error: intentar por lista
      }
    }
    try {
      const list = await apiClient.getWithToken<unknown>('/users/users', token);
      const items = Array.isArray(list)
        ? list
        : (list as Record<string, unknown>)?.data ?? (list as Record<string, unknown>)?.items ?? [];
      const emailLower = email.toLowerCase();
      const found = (items as Record<string, unknown>[]).find(
        (u) => (String(u?.email ?? u?.Email ?? '')).toLowerCase() === emailLower
      );
      if (found) return mapUser(found);
    } catch {
      // fallback
    }
    return { role: '', isActive: false };
  },

  /** Obtiene el id del usuario por email (para actualizar perfil cuando user.id es el email). */
  async getUserIdByEmail(token: string, email: string): Promise<string | null> {
    try {
      const list = await apiClient.getWithToken<unknown>('/users/users', token);
      const items = Array.isArray(list)
        ? list
        : (list as Record<string, unknown>)?.data ?? (list as Record<string, unknown>)?.items ?? [];
      const emailLower = email.toLowerCase();
      const found = (items as Record<string, unknown>[]).find(
        (u) => (String(u?.email ?? u?.Email ?? '')).toLowerCase() === emailLower
      );
      if (found && (found.id != null || found.Id != null)) {
        return String(found.id ?? found.Id);
      }
    } catch {
      // ignore
    }
    return null;
  },

  /**
   * Actualiza el usuario por ID (PUT /users/users/{id}), igual que Sistema Web Admin.
   * Usar este endpoint en lugar de /users/profile para evitar 404.
   */
  async updateUser(
    id: string,
    data: { name?: string; lastName?: string; email?: string; phone?: string }
  ): Promise<void> {
    const payload: Record<string, string> = {
      id,
      name: data.name?.trim() ?? '',
      lastName: data.lastName?.trim() ?? '',
      email: data.email?.trim() ?? '',
      phone: data.phone?.trim() ?? '',
      rol: 'Vendedor',
    };
    await apiClient.put(`/users/users/${encodeURIComponent(id)}`, payload);
  },

  /** Cambia la contraseña (POST /auth/change-password) - como Sistema Web Admin */
  async changePassword(params: {
    email: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const body = {
      email: params.email.trim(),
      currentPassword: params.currentPassword,
      newPassword: params.newPassword,
      Email: params.email.trim(),
      CurrentPassword: params.currentPassword,
      NewPassword: params.newPassword,
    };
    await apiClient.post('/auth/change-password', body);
  },
};
