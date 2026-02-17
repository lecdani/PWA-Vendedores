'use client';

import { useState, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, Lock, Eye, EyeOff, KeyRound, CircleAlert } from 'lucide-react';
import { authApi } from '@/shared/api/auth-api';
import { validatePasswordStrength } from '@/shared/utils/password-validation';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

/** Extrae token y email solo desde URLSearchParams (evita hydration: mismo resultado en servidor y cliente) */
function parseFromSearchParams(searchParams: URLSearchParams): { token: string; email: string } {
  const token =
    searchParams.get('token') ??
    searchParams.get('code') ??
    searchParams.get('Token') ??
    searchParams.get('Code') ??
    '';
  const email =
    searchParams.get('email') ??
    searchParams.get('Email') ??
    searchParams.get('userName') ??
    '';
  try {
    return {
      token: token.trim(),
      email: email.trim() ? decodeURIComponent(email.trim()) : '',
    };
  } catch {
    return { token: token.trim(), email: email.trim() };
  }
}

/** En cliente: extrae token/email desde window.location (regex) por si la URL viene mal formada */
function parseFromWindow(): { token: string; email: string } {
  if (typeof window === 'undefined') return { token: '', email: '' };
  let token = '';
  let email = '';
  const raw = window.location.search.replace(/^\?/, '');
  const tokenMatch = raw.match(/(?:token|code)=([^&]*)/i);
  const emailMatch = raw.match(/(?:email|userName)=([^&]*)/i);
  if (tokenMatch) token = decodeURIComponent(tokenMatch[1].trim());
  if (emailMatch) email = decodeURIComponent(emailMatch[1].trim());
  if ((!token || !email) && window.location.href) {
    const tokenHref = window.location.href.match(/(?:token|code)=([^&\s#]*)/i);
    const emailHref = window.location.href.match(/(?:email|userName)=([^&\s#]*)/i);
    if (tokenHref && !token) token = decodeURIComponent(tokenHref[1].trim());
    if (emailHref && !email) email = decodeURIComponent(emailHref[1].trim());
  }
  return { token, email };
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [parsed, setParsed] = useState<{ token: string; email: string }>({ token: '', email: '' });

  // Tras el montaje en cliente: parsear desde searchParams y desde window para no fallar hydration
  useEffect(() => {
    const fromParams = parseFromSearchParams(searchParams);
    const fromWindow = parseFromWindow();
    setParsed({
      token: fromParams.token || fromWindow.token,
      email: fromParams.email || fromWindow.email,
    });
    setMounted(true);
  }, [searchParams]);

  const tokenFromUrl = parsed.token;
  const emailFromUrl = parsed.email;

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ newPassword?: string; confirmPassword?: string }>({});
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateForm = (): boolean => {
    const errors: { newPassword?: string; confirmPassword?: string } = {};

    if (!newPassword.trim()) {
      errors.newPassword = 'La nueva contraseña es obligatoria';
    } else {
      const strength = validatePasswordStrength(newPassword);
      if (!strength.isValid && strength.feedback.length > 0) {
        errors.newPassword = strength.feedback[0] ?? 'La contraseña no cumple los requisitos';
      }
    }

    if (!confirmPassword.trim()) {
      errors.confirmPassword = 'Debes confirmar la contraseña';
    } else if (newPassword !== confirmPassword) {
      errors.confirmPassword = 'Las contraseñas no coinciden';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Mismo contenido en servidor y cliente hasta después del mount (evita hydration mismatch)
  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-500 rounded-2xl shadow-lg mb-4">
            <ShoppingCart className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Eternal Cosmetics</h1>
          <div className="flex justify-center mt-8">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
          <p className="text-slate-600 mt-4">Cargando...</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    if (!validateForm()) return;
    if (!tokenFromUrl || !emailFromUrl) {
      setError('Falta el token o el correo de recuperación. Usa el link que te enviamos por correo.');
      return;
    }

    setIsSubmitting(true);
    try {
      await authApi.resetPassword(tokenFromUrl, emailFromUrl, newPassword);
      setSuccess(true);
      setTimeout(() => router.push('/login'), 3000);
    } catch (err: unknown) {
      const apiError = err as { message?: string };
      setError(apiError?.message ?? 'El enlace pudo haber expirado. Solicita uno nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Sin token o email: aviso para uso en pruebas o link inválido
  if (!tokenFromUrl || !emailFromUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-500 rounded-2xl shadow-lg mb-4">
              <ShoppingCart className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Eternal Cosmetics</h1>
          </div>
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200 text-center">
            <KeyRound className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900 mb-2">Link inválido o faltante</h2>
            <p className="text-slate-600 mb-6">
              Para restablecer tu contraseña debes usar el enlace que te enviamos por correo
              (desde “¿Olvidaste tu contraseña?”). Si llegaste aquí por error, vuelve al inicio de sesión.
            </p>
            <Link href="/login">
              <Button variant="outline" className="w-full">
                Volver al inicio de sesión
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Contraseña restablecida</h2>
            <p className="text-slate-600 mb-6">
              Ya puedes iniciar sesión con tu nueva contraseña.
            </p>
            <Link href="/login">
              <Button className="w-full">Ir al inicio de sesión</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-xl mb-3">
            <ShoppingCart className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-slate-800">Eternal Cosmetics</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-slate-900 text-center mb-1">
            Restablecer contraseña
          </h2>
          <p className="text-slate-500 text-sm text-center mb-5">
            Ingresa tu nueva contraseña y confírmala.
          </p>
          {emailFromUrl && (
            <p className="text-xs text-slate-400 text-center truncate px-2 mb-4" title={emailFromUrl}>
              {emailFromUrl}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="newPassword" className="text-slate-600 text-sm font-medium">
                Nueva contraseña
              </Label>
              <div className="relative mt-1">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="newPassword"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (fieldErrors.newPassword) setFieldErrors((p) => ({ ...p, newPassword: undefined }));
                    if (error) setError('');
                  }}
                  placeholder="Escribe tu contraseña"
                  className={`pl-9 pr-9 h-10 text-sm rounded-lg ${
                    fieldErrors.newPassword
                      ? 'border-red-300 focus:border-red-400 focus:ring-red-400/20'
                      : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500/20'
                  }`}
                  required
                  minLength={8}
                  maxLength={128}
                  disabled={isSubmitting}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  disabled={isSubmitting}
                  suppressHydrationWarning
                  aria-label={showNewPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {fieldErrors.newPassword && (
                <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                  <CircleAlert className="h-3.5 w-3.5 flex-shrink-0" />
                  {fieldErrors.newPassword}
                </p>
              )}
              <p className="mt-2 text-xs text-slate-400">
                Requisitos: 8 caracteres mín., mayúscula, minúscula, número y carácter especial.
              </p>
            </div>

            <div>
              <Label htmlFor="confirmPassword" className="text-slate-600 text-sm font-medium">
                Confirmar contraseña
              </Label>
              <div className="relative mt-1">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (fieldErrors.confirmPassword) setFieldErrors((p) => ({ ...p, confirmPassword: undefined }));
                    if (error) setError('');
                  }}
                  placeholder="Repetir contraseña"
                  className={`pl-9 pr-9 h-10 text-sm rounded-lg ${
                    fieldErrors.confirmPassword
                      ? 'border-red-300 focus:border-red-400 focus:ring-red-400/20'
                      : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500/20'
                  }`}
                  required
                  minLength={8}
                  disabled={isSubmitting}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  disabled={isSubmitting}
                  suppressHydrationWarning
                  aria-label={showConfirmPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {fieldErrors.confirmPassword && (
                <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                  <CircleAlert className="h-3.5 w-3.5 flex-shrink-0" />
                  {fieldErrors.confirmPassword}
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-lg bg-red-50/80 border border-red-100 text-red-700 px-3 py-2.5 text-sm flex items-start gap-2">
                <CircleAlert className="h-4 w-4 flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-10 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Guardando...' : 'Restablecer contraseña'}
            </Button>
          </form>

          <p className="text-center mt-5">
            <Link href="/login" className="text-sm text-slate-500 hover:text-slate-700 transition-colors">
              Volver al inicio de sesión
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
