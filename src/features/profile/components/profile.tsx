'use client';

import { useState } from 'react';
import { 
  User, 
  Mail, 
  Phone, 
  Lock, 
  Edit,
  Save,
  ChevronRight,
  LogOut,
  Key,
  Eye,
  EyeOff,
  X
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { useAuth } from '@/shared/auth/auth-provider';
import { authApi } from '@/shared/api/auth-api';
import { validatePasswordStrength } from '@/shared/utils/password-validation';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Separator } from '@/shared/ui/separator';

export function Profile() {
  const { t } = useLanguage();
  const { user, logout, updateUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [userData, setUserData] = useState({
    name: '',
    lastName: '',
    email: '',
    phone: ''
  });

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false });

  const fullName = (n: string | undefined, ln: string | undefined) =>
    [n?.trim(), ln?.trim()].filter(Boolean).join(' ') || '—';
  const displayName =
    (isEditing ? fullName(userData.name, userData.lastName) : null) ??
    fullName(user?.name, user?.lastName) ??
    user?.email?.split('@')[0] ??
    '—';
  const displayEmail = (isEditing ? userData.email : null) ?? user?.email ?? '—';
  const displayPhone = (isEditing ? userData.phone : null) ?? user?.phone ?? userData.phone ?? '—';

  const startEditing = () => {
    setProfileError('');
    setUserData({
      name: user?.name ?? '',
      lastName: user?.lastName ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? userData.phone ?? ''
    });
    setIsEditing(true);
  };

  const handleSave = async () => {
    setProfileError('');
    if (!userData.name?.trim()) {
      setProfileError('El nombre es obligatorio.');
      return;
    }
    if (!userData.email?.trim()) {
      setProfileError('El correo es obligatorio.');
      return;
    }
    const idToUse =
      user?.id && !String(user.id).includes('@')
        ? user.id
        : typeof window !== 'undefined'
          ? await authApi.getUserIdByEmail(
              localStorage.getItem('auth_token') ?? '',
              user?.email ?? ''
            )
          : null;
    if (!idToUse) {
      setProfileError('No se pudo identificar tu cuenta. Cierra sesión e inicia de nuevo.');
      return;
    }
    setProfileSaving(true);
    try {
      await authApi.updateUser(idToUse, {
        name: userData.name.trim(),
        lastName: userData.lastName?.trim() || undefined,
        email: userData.email.trim(),
        phone: userData.phone.trim() || undefined
      });
      updateUser({
        name: userData.name.trim(),
        lastName: userData.lastName?.trim() || undefined,
        email: userData.email.trim(),
        phone: userData.phone.trim() || undefined
      });
      setIsEditing(false);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Error al guardar. Intenta de nuevo.';
      setProfileError(msg);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    const current = passwordData.currentPassword.trim();
    const newPass = passwordData.newPassword.trim();
    const confirm = passwordData.confirmPassword.trim();

    if (!current) {
      setPasswordError('Escribe tu contraseña actual para continuar.');
      return;
    }
    if (!newPass || !confirm) {
      setPasswordError('Completa la nueva contraseña y repítela en el siguiente campo.');
      return;
    }
    if (newPass !== confirm) {
      setPasswordError('La nueva contraseña y la confirmación no coinciden. Verifica que sean iguales.');
      return;
    }
    const strength = validatePasswordStrength(newPass);
    if (!strength.isValid) {
      const reqMsg = strength.feedback?.length
        ? `La nueva contraseña debe cumplir: ${strength.feedback.join('. ')}`
        : 'La nueva contraseña no cumple los requisitos de seguridad.';
      setPasswordError(reqMsg);
      return;
    }

    const email = user?.email ?? '';
    if (!email) {
      setPasswordError('No se pudo identificar tu cuenta. Cierra sesión e inicia de nuevo.');
      return;
    }

    setPasswordSaving(true);
    setPasswordError('');
    try {
      await authApi.changePassword({
        email,
        currentPassword: current,
        newPassword: newPass
      });
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordSuccess(true);
      setTimeout(() => {
        setShowChangePassword(false);
        setPasswordSuccess(false);
      }, 2000);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      const msg = (err as { message?: string })?.message ?? '';
      const msgLower = String(msg).toLowerCase();
      const isWrongCurrent =
        status === 400 ||
        msgLower.includes('contraseña actual') ||
        msgLower.includes('current password') ||
        msgLower.includes('no coincide');
      const displayMsg = isWrongCurrent
        ? 'La contraseña actual no es correcta. Revísala e inténtalo de nuevo.'
        : (msg || 'No se pudo cambiar la contraseña. Inténtalo más tarde.');
      setPasswordError(displayMsg);
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="px-4 py-4">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-slate-900 text-lg mb-1">{t('profile')}</h2>
        <p className="text-sm text-slate-500">{t('profile_subtitle')}</p>
      </div>

      {/* Profile Card */}
      <Card className="mb-4 border-slate-200">
        <CardContent className="p-4">
            <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-500 rounded-full flex items-center justify-center text-white text-2xl font-semibold">
              {(displayName !== '—' ? displayName : 'V').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-slate-900 truncate">{displayName}</p>
              <p className="text-sm text-slate-500">{t('sales_representative')}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => isEditing ? handleSave() : startEditing()}
            >
              {isEditing ? <Save className="h-4 w-4" /> : <Edit className="h-4 w-4" />}
            </Button>
          </div>

          <Separator className="my-4" />

          {/* Personal Information */}
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-slate-500 mb-1">{t('first_name')}</Label>
              {isEditing ? (
                <Input
                  value={userData.name}
                  onChange={(e) => setUserData({ ...userData, name: e.target.value })}
                  className="h-9"
                  placeholder={t('first_name')}
                />
              ) : (
                <div className="flex items-center gap-2 py-2">
                  <User className="h-4 w-4 text-slate-400" />
                  <span className="text-sm text-slate-900">{user?.name ?? '—'}</span>
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1">{t('last_name')}</Label>
              {isEditing ? (
                <Input
                  value={userData.lastName}
                  onChange={(e) => setUserData({ ...userData, lastName: e.target.value })}
                  className="h-9"
                  placeholder={t('last_name')}
                />
              ) : (
                <div className="flex items-center gap-2 py-2">
                  <User className="h-4 w-4 text-slate-400" />
                  <span className="text-sm text-slate-900">{user?.lastName ?? '—'}</span>
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs text-slate-500 mb-1">{t('email')}</Label>
              {isEditing ? (
                <>
                  <Input
                    type="email"
                    value={userData.email}
                    onChange={(e) => setUserData({ ...userData, email: e.target.value })}
                    className="h-9"
                    placeholder="correo@ejemplo.com"
                  />
                  <p className="text-xs text-slate-500 mt-1">Puedes dejarlo igual o cambiarlo; solo no puede estar en uso por otra cuenta.</p>
                </>
              ) : (
                <div className="flex items-center gap-2 py-2">
                  <Mail className="h-4 w-4 text-slate-400" />
                  <span className="text-sm text-slate-900 break-all">{displayEmail}</span>
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs text-slate-500 mb-1">{t('phone')}</Label>
              {isEditing ? (
                <Input
                  type="tel"
                  value={userData.phone}
                  onChange={(e) => setUserData({ ...userData, phone: e.target.value })}
                  className="h-9"
                  placeholder={t('phone')}
                />
              ) : (
                <div className="flex items-center gap-2 py-2">
                  <Phone className="h-4 w-4 text-slate-400" />
                  <span className="text-sm text-slate-900">{displayPhone}</span>
                </div>
              )}
            </div>
          </div>

          {profileError && (
            <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-100 text-red-700 text-sm">
              {profileError}
            </div>
          )}
          {isEditing && (
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setIsEditing(false); setProfileError(''); }}
                disabled={profileSaving}
              >
                {t('cancel')}
              </Button>
              <Button 
                className="flex-1 bg-blue-600 hover:bg-blue-700"
                onClick={handleSave}
                disabled={profileSaving}
              >
                {profileSaving ? 'Guardando...' : t('save_changes')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settings - Cambiar contraseña */}
      <Card className="mb-4 border-slate-200">
        <CardHeader className="px-4 pt-4 pb-2">
          <CardTitle className="text-sm">{t('settings')}</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <button
            type="button"
            className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors border border-slate-100"
            onClick={() => { setShowChangePassword(true); setPasswordError(''); setPasswordSuccess(false); setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' }); }}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-50 rounded-lg">
                <Lock className="h-4 w-4 text-amber-600" />
              </div>
              <div className="text-left">
                <p className="text-sm text-slate-900">{t('change_password')}</p>
                <p className="text-xs text-slate-500">{t('security_settings')}</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </button>
        </CardContent>
      </Card>

      {/* Modal Cambiar contraseña */}
      {showChangePassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => !passwordSaving && setShowChangePassword(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Key className="h-5 w-5" />
                {t('change_password')}
              </h3>
              <button type="button" className="p-1 hover:bg-slate-100 rounded" onClick={() => !passwordSaving && setShowChangePassword(false)} aria-label="Cerrar">
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              Para mayor seguridad, escribe primero tu contraseña actual y luego la nueva dos veces.
            </p>

            {passwordSuccess && (
              <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm flex items-center gap-2">
                <span className="text-green-600">✓</span>
                Contraseña actualizada correctamente. Puedes cerrar esta ventana.
              </div>
            )}

            <div className="space-y-4">
              <div>
                <Label className="text-slate-700">Contraseña actual</Label>
                <div className="relative mt-1">
                  <Input
                    type={showPasswords.current ? 'text' : 'password'}
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData((p) => ({ ...p, currentPassword: e.target.value }))}
                    className="pr-9 h-10"
                    placeholder="Contraseña actual"
                    disabled={passwordSaving}
                  />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setShowPasswords((p) => ({ ...p, current: !p.current }))}>
                    {showPasswords.current ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-slate-700">Nueva contraseña</Label>
                <div className="relative mt-1">
                  <Input
                    type={showPasswords.new ? 'text' : 'password'}
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData((p) => ({ ...p, newPassword: e.target.value }))}
                    className="pr-9 h-10"
                    placeholder="Nueva contraseña"
                    disabled={passwordSaving}
                  />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setShowPasswords((p) => ({ ...p, new: !p.new }))}>
                    {showPasswords.new ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-slate-700">Confirmar nueva contraseña</Label>
                <div className="relative mt-1">
                  <Input
                    type={showPasswords.confirm ? 'text' : 'password'}
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData((p) => ({ ...p, confirmPassword: e.target.value }))}
                    className="pr-9 h-10"
                    placeholder="Repetir contraseña"
                    disabled={passwordSaving}
                  />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setShowPasswords((p) => ({ ...p, confirm: !p.confirm }))}>
                    {showPasswords.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {passwordError && (
              <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-100 text-red-700 text-sm">
                {passwordError}
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowChangePassword(false)} disabled={passwordSaving}>
                {t('cancel')}
              </Button>
              <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={handleChangePassword} disabled={passwordSaving}>
                {passwordSaving ? 'Guardando...' : t('change_password')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Logout Button */}
      <Button
        variant="outline"
        className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
        onClick={() => logout()}
      >
        <LogOut className="h-4 w-4 mr-2" />
        {t('logout')}
      </Button>
    </div>
  );
}
