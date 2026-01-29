'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ShoppingCart, Lock, Eye, EyeOff, KeyRound } from 'lucide-react';
import { authApi } from '@/shared/api/auth-api';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get('token') ?? '';
  const emailFromUrl = searchParams.get('email') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }
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
      setError(apiError.message || 'Error al restablecer la contraseña. Intenta de nuevo.');
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
            <h2 className="text-xl font-bold text-slate-900 mb-2">Contraseña actualizada</h2>
            <p className="text-slate-600 mb-6">
              Ya puedes iniciar sesión con tu nueva contraseña. Redirigiendo al login...
            </p>
            <Link href="/login">
              <Button className="w-full">Ir a iniciar sesión</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-500 rounded-2xl shadow-lg mb-4">
            <ShoppingCart className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Eternal Cosmetics</h1>
          <p className="text-slate-600">Restablecer contraseña</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
          <h2 className="text-2xl font-bold text-slate-900 mb-6 text-center">
            Nueva contraseña
          </h2>
          <p className="text-slate-600 text-sm text-center mb-6">
            Ingresa tu nueva contraseña y confírmala. Luego podrás iniciar sesión con ella.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="newPassword" className="text-slate-700 font-medium">
                Nueva contraseña
              </Label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock className="h-5 w-5" />
                </div>
                <Input
                  id="newPassword"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="pl-10 pr-10 h-11 bg-slate-50 border-slate-200 focus:border-blue-500 focus:ring-blue-500"
                  required
                  minLength={6}
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  disabled={isSubmitting}
                  suppressHydrationWarning
                >
                  {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-slate-700 font-medium">
                Confirmar contraseña
              </Label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock className="h-5 w-5" />
                </div>
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repite la contraseña"
                  className="pl-10 pr-10 h-11 bg-slate-50 border-slate-200 focus:border-blue-500 focus:ring-blue-500"
                  required
                  minLength={6}
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  disabled={isSubmitting}
                  suppressHydrationWarning
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-semibold rounded-lg shadow-lg"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Guardando...' : 'Restablecer contraseña'}
            </Button>
          </form>

          <p className="text-center mt-6">
            <Link href="/login" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
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
