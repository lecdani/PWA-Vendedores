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
