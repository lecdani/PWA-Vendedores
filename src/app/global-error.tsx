'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body>
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
          <div className="text-center max-w-md">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Error del sistema</h2>
            <p className="text-sm text-slate-600 mb-4">{error?.message || 'Error inesperado'}</p>
            <button
              onClick={() => reset()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Intentar de nuevo
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
