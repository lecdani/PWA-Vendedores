'use client';

import { useEffect } from 'react';
import { Button } from '@/shared/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="text-center max-w-md">
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Algo salió mal</h2>
        <p className="text-sm text-slate-600 mb-4">{error.message || 'Error inesperado'}</p>
        <Button onClick={reset} className="bg-indigo-600 hover:bg-indigo-700">
          Intentar de nuevo
        </Button>
      </div>
    </div>
  );
}
