'use client';

import { useState } from 'react';
import { 
  User, 
  Mail, 
  Phone, 
  Lock, 
  Globe,
  Edit,
  Save,
  ChevronRight,
  LogOut
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/language-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Separator } from '@/shared/ui/separator';

export function Profile() {
  const { t, language } = useLanguage();
  const [isEditing, setIsEditing] = useState(false);
  const [userData, setUserData] = useState({
    name: 'Carlos Rodríguez',
    email: 'carlos.rodriguez@eternalcosmetics.com',
    phone: '+1 (305) 555-0123',
    territory: 'Miami - South Florida'
  });

  const handleSave = () => {
    setIsEditing(false);
    // Aquí iría la lógica para guardar en la API
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
            <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-blue-500 rounded-full flex items-center justify-center text-white text-2xl">
              {userData.name.charAt(0)}
            </div>
            <div className="flex-1">
              <p className="text-slate-900">{userData.name}</p>
              <p className="text-sm text-slate-500">{t('sales_representative')}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(!isEditing)}
            >
              {isEditing ? <Save className="h-4 w-4" /> : <Edit className="h-4 w-4" />}
            </Button>
          </div>

          <Separator className="my-4" />

          {/* Personal Information */}
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-slate-500 mb-1">{t('full_name')}</Label>
              {isEditing ? (
                <Input
                  value={userData.name}
                  onChange={(e) => setUserData({ ...userData, name: e.target.value })}
                  className="h-9"
                />
              ) : (
                <div className="flex items-center gap-2 py-2">
                  <User className="h-4 w-4 text-slate-400" />
                  <span className="text-sm text-slate-900">{userData.name}</span>
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs text-slate-500 mb-1">{t('email')}</Label>
              {isEditing ? (
                <Input
                  type="email"
                  value={userData.email}
                  onChange={(e) => setUserData({ ...userData, email: e.target.value })}
                  className="h-9"
                />
              ) : (
                <div className="flex items-center gap-2 py-2">
                  <Mail className="h-4 w-4 text-slate-400" />
                  <span className="text-sm text-slate-900">{userData.email}</span>
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
                />
              ) : (
                <div className="flex items-center gap-2 py-2">
                  <Phone className="h-4 w-4 text-slate-400" />
                  <span className="text-sm text-slate-900">{userData.phone}</span>
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs text-slate-500 mb-1">{t('territory')}</Label>
              <div className="flex items-center gap-2 py-2">
                <Globe className="h-4 w-4 text-slate-400" />
                <span className="text-sm text-slate-900">{userData.territory}</span>
              </div>
            </div>
          </div>

          {isEditing && (
            <Button 
              className="w-full mt-4 bg-blue-600 hover:bg-blue-700"
              onClick={handleSave}
            >
              {t('save_changes')}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Settings */}
      <Card className="mb-4 border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{t('settings')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <button className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Globe className="h-4 w-4 text-blue-600" />
              </div>
              <div className="text-left">
                <p className="text-sm text-slate-900">{t('language')}</p>
                <p className="text-xs text-slate-500">
                  {language === 'es' ? 'Español' : 'English'}
                </p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </button>

          <Separator />

          <button className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
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

      {/* Logout Button */}
      <Button
        variant="outline"
        className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
      >
        <LogOut className="h-4 w-4 mr-2" />
        {t('logout')}
      </Button>
    </div>
  );
}
