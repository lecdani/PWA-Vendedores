import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://100.127.113.86:5107';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const resolvedParams = await params;
  return handleProxyRequest(request, resolvedParams, 'GET');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const resolvedParams = await params;
  return handleProxyRequest(request, resolvedParams, 'POST');
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const resolvedParams = await params;
  return handleProxyRequest(request, resolvedParams, 'PATCH');
}

async function handleProxyRequest(
  request: NextRequest,
  params: { path: string[] },
  method: string
) {
  try {
    const path = Array.isArray(params.path) ? params.path.join('/') : params.path;
    const base = API_BASE_URL.replace(/\/$/, '');
    const url = `${base}/${path}`;
    const searchParams = request.nextUrl.searchParams;
    const queryString = searchParams.toString();
    const fullUrl = queryString ? `${url}?${queryString}` : url;

    const headers: HeadersInit = { Accept: 'application/json' };
    const authHeader = request.headers.get('authorization');
    if (authHeader) headers['Authorization'] = authHeader;

    let body: BodyInit | undefined;
    if (method !== 'GET') {
      const contentType = request.headers.get('content-type') ?? '';
      if (contentType.toLowerCase().startsWith('multipart/form-data')) {
        body = request.body ?? undefined;
        headers['Content-Type'] = contentType;
      } else {
        const textBody = await request.text();
        body = textBody || undefined;
        if (textBody) headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(fullUrl, {
      method,
      headers,
      body,
      duplex: method !== 'GET' && body ? 'half' : undefined,
    } as RequestInit);

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const responseContentType = response.headers.get('content-type') || '';
    const isImageUrlResolverPath = path.toLowerCase().startsWith('images/url/');

    // Respuestas binarias (imágenes): reenviar sin leer como texto
    if (
      responseContentType.includes('image/') ||
      responseContentType.includes('application/octet-stream')
    ) {
      const buffer = await response.arrayBuffer();
      return new NextResponse(buffer, {
        status: response.status,
        headers: {
          'Content-Type': responseContentType,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // Algunos backends devuelven una URL (texto/json) en /images/url/{fileName}
    // en lugar de la imagen binaria. En ese caso, resolver y retransmitir la imagen.
    if (isImageUrlResolverPath && method === 'GET') {
      const bodyText = await response.text();
      let candidateUrl = '';
      if (responseContentType.includes('application/json')) {
        try {
          const parsed = bodyText ? JSON.parse(bodyText) : {};
          candidateUrl = String(
            parsed?.url ??
              parsed?.Url ??
              parsed?.imageUrl ??
              parsed?.ImageUrl ??
              parsed?.data?.url ??
              parsed?.data?.Url ??
              ''
          ).trim();
        } catch {
          candidateUrl = bodyText.trim().replace(/^"|"$/g, '');
        }
      } else {
        candidateUrl = bodyText.trim().replace(/^"|"$/g, '');
      }

      if (/^https?:\/\//i.test(candidateUrl)) {
        try {
          const imgResponse = await fetch(candidateUrl);
          const imgContentType = imgResponse.headers.get('content-type') || '';
          if (imgResponse.ok && (imgContentType.includes('image/') || imgContentType.includes('application/octet-stream'))) {
            const imgBuffer = await imgResponse.arrayBuffer();
            return new NextResponse(imgBuffer, {
              status: 200,
              headers: {
                'Content-Type': imgContentType,
                'Cache-Control': 'public, max-age=3600',
              },
            });
          }
        } catch {
          // Si falla resolver la URL remota, devolver respuesta original abajo.
        }
      }

      // Si no se pudo resolver la URL remota, mantener compatibilidad devolviendo texto.
      return new NextResponse(bodyText, {
        status: response.status,
        headers: { 'Content-Type': responseContentType || 'text/plain' },
      });
    }

    const text = await response.text();
    let data: any;
    if (responseContentType.includes('application/json')) {
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = text;
      }
    } else {
      data = text;
    }

    if (typeof data === 'string') {
      return new NextResponse(data, {
        status: response.status,
        headers: { 'Content-Type': responseContentType || 'text/plain' },
      });
    }

    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    console.error('[PWA Proxy] Error:', error);
    return NextResponse.json(
      { message: error.message || 'Error al conectar con el servidor' },
      { status: 500 }
    );
  }
}
