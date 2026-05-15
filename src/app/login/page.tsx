'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/shared/auth/auth-provider';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { useLanguage } from '@/shared/i18n/language-provider';

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading } = useAuth();
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Redirigir si ya está autenticado
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, isLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const result = await login(email, password);
      
      if (result.success) {
        router.push('/');
      } else {
        setError(result.error || 'Email o contraseña incorrectos');
      }
    } catch (err) {
      setError('Error al iniciar sesión. Intenta nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  };


  // Mostrar loading mientras verifica autenticación
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">Cargando...</p>
        </div>
      </div>
    );
  }

  // Si ya está autenticado, no mostrar el formulario (será redirigido)
  if (isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        {/* Logo ETERNAL (contenedor mismo color que sistema web: indigo/purple) y título */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4 rounded-lg p-2 shadow-lg" style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}>
            <Image
              src="/logo-eternal.png"
              alt="ETERNAL COSMETICS LLC"
              width={100}
              height={53}
              className="h-auto w-[100px] max-w-full object-contain"
              priority
            />
          </div>
          <p className="text-slate-600">{t('seller_portal')}</p>
        </div>

        {/* Card de login */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
          <h2 className="text-2xl font-bold text-slate-900 mb-6 text-center">
            Iniciar Sesión
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5" autoComplete="off">
            {/* Campo Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-700 font-medium">
                Email
              </Label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <Mail className="h-5 w-5" />
                </div>
                <Input
                  id="email"
                  name="vendor_login_email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Ingresa tu email"
                  className="pl-10 h-11 bg-slate-50 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500"
                  required
                  disabled={isSubmitting || isLoading}
                  autoComplete="username"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </div>
            </div>

            {/* Campo Contraseña */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-700 font-medium">
                Contraseña
              </Label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock className="h-5 w-5" />
                </div>
                <Input
                  id="password"
                  name="vendor_login_password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ingresa tu contraseña"
                  className="pl-10 pr-10 h-11 bg-slate-50 border-slate-200 focus:border-indigo-500 focus:ring-indigo-500"
                  required
                  disabled={isSubmitting || isLoading}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  disabled={isSubmitting || isLoading}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            {/* Olvidé mi contraseña: va a la ventana donde ingresa el correo y se envía el link de recuperación por email */}
            <div className="flex justify-end">
              <Link
                href="/forgot-password"
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>

            {/* Botón de login */}
            <Button
              type="submit"
              className="w-full h-11 text-white font-semibold rounded-lg shadow-lg transition-all"
              style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
              disabled={isSubmitting || isLoading}
            >
              {isSubmitting ? 'Iniciando sesión...' : 'Iniciar Sesión'}
            </Button>
          </form>

        </div>

        {/* Footer y créditos (igual que sistema web) */}
        <footer className="text-center text-sm text-slate-500 mt-6 space-y-1">
          <p>© {new Date().getFullYear()} ETERNAL COSMETICS LLC. Desarrollado por Daniela Echezuría y Andrés Uribe.</p>
          <p className="text-xs">
            <a href="https://www.linkedin.com/in/daniela-echezuria-9287b3202/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Daniela Echezuría</a>
            {' · '}
            <a href="https://www.linkedin.com/in/aeuribe24/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Andrés Uribe</a>
          </p>
        </footer>
      </div>
    </div>
  );
}
