import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

/**
 * Ruta base en disco: C:\Users\danie\OneDrive (en la BD solo está la ubicación relativa).
 * La carpeta real en OneDrive es "Imágenes" (con tilde); en la BD suele venir "imagenes".
 */
const POD_FILE_BASE_PATH = process.env.POD_FILE_BASE_PATH?.trim() || 'C:\\Users\\danie\\OneDrive';

/** Carpeta real donde están las fotos en OneDrive (con tilde). Variable: POD_IMAGES_FOLDER */
const POD_IMAGES_FOLDER = process.env.POD_IMAGES_FOLDER?.trim() || 'Imágenes';

/**
 * Convierte la ruta que viene de la BD (ej. imagenes/cedula_mama.png) a la ruta real en disco
 * (C:\Users\danie\OneDrive\Imágenes\cedula_mama.png).
 */
function pathFromDbToDisk(relativePath: string): string {
  const withoutLeading = relativePath.replace(/^[/\\]+/, '').replace(/\//g, path.sep).replace(/\\+/g, path.sep);
  const parts = withoutLeading.split(path.sep);
  if (parts.length > 0 && parts[0].toLowerCase() === 'imagenes') {
    parts[0] = POD_IMAGES_FOLDER;
  }
  return parts.join(path.sep);
}

/**
 * Sirve la imagen del POD leyendo desde la ruta local (ej. C:\Users\danie\OneDrive\Imágenes\cedula_mama.png).
 * GET /api/pod-image?path=imagenes/cedula_mama.png → lee OneDrive\Imágenes\cedula_mama.png
 */
export async function GET(request: NextRequest) {
  const pathParam = request.nextUrl.searchParams.get('path');
  if (!pathParam || typeof pathParam !== 'string') {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }
  const trimmed = pathParam.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const baseResolved = path.resolve(POD_FILE_BASE_PATH);
  let fullPath: string;

  if (path.isAbsolute(trimmed)) {
    fullPath = path.resolve(trimmed.replace(/\//g, path.sep));
  } else {
    const diskRelative = pathFromDbToDisk(trimmed);
    fullPath = path.resolve(POD_FILE_BASE_PATH, diskRelative);
  }

  const relative = path.relative(baseResolved, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    const buffer = await readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentType =
      ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/png';
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[pod-image] read error:', fullPath, err);
    return new NextResponse(null, { status: 404 });
  }
}
