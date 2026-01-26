'use client';

import { Card, CardContent } from '@/shared/ui/card';
import { LucideIcon, ChevronRight } from 'lucide-react';

interface ModuleCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  color: string;
  iconBg: string;
  onClick: () => void;
}

export function ModuleCard({ title, description, icon: Icon, color, iconBg, onClick }: ModuleCardProps) {
  return (
    <Card 
      className="border-slate-200 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer active:scale-98"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-lg ${iconBg}`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-900 mb-0.5 truncate">{title}</p>
            <p className="text-xs text-slate-500 truncate">{description}</p>
          </div>
          <ChevronRight className="h-5 w-5 text-slate-400 flex-shrink-0" />
        </div>
      </CardContent>
    </Card>
  );
}
