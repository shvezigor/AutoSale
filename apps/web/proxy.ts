import { NextRequest, NextResponse } from 'next/server';

const authPaths = ['/login', '/register', '/verify-email', '/forgot-password', '/reset-password', '/invite', '/onboarding/google'];
const publicPaths = ['/privacy', '/terms'];

export async function proxy(request: NextRequest) {
  const isAuthPath = authPaths.some((path) => request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`));
  const isPublicPath = publicPaths.some((path) => request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`));
  const session = await resolveSession(request);
  
  if (!session && !isAuthPath && !isPublicPath) {
    const login = new URL('/login', request.url); login.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`); return NextResponse.redirect(login);
  }
  if (session && isAuthPath) return NextResponse.redirect(new URL(session.platformRole === 'PLATFORM_ADMIN' ? '/admin' : '/conversations', request.url));
  if (session?.platformRole === 'PLATFORM_ADMIN' && !request.nextUrl.pathname.startsWith('/admin')) return NextResponse.redirect(new URL('/admin', request.url));
  if (session?.platformRole !== 'PLATFORM_ADMIN' && request.nextUrl.pathname.startsWith('/admin')) return NextResponse.redirect(new URL('/conversations', request.url));
  if (session?.membershipRole === 'MANAGER' && request.nextUrl.pathname.startsWith('/team')) return NextResponse.redirect(new URL('/conversations', request.url));
  return NextResponse.next();
}

async function resolveSession(request: NextRequest): Promise<{ platformRole: string; membershipRole: string | null } | null> {
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/api/auth/session`, { headers: { cookie: request.headers.get('cookie') ?? '' }, cache: 'no-store' });
    return response.ok ? await response.json() as { platformRole: string; membershipRole: string | null } : null;
  } catch { return null; }
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico|health).*)'] };
