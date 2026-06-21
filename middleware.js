// Global CORS handling for the max API.
//
// Why this exists: the max clients (mobile + any web/Expo-web build) call this
// API from a different origin. Without CORS headers — and without answering the
// browser's OPTIONS preflight — those cross-origin requests are rejected at the
// transport layer before any route code runs, which surfaces in the app as the
// dreaded "Can't reach the server." This middleware makes every /api/* route
// answer preflights and echo CORS headers, so reachability never depends on a
// per-route author remembering to add them.
import { NextResponse } from 'next/server'

function corsHeaders(origin) {
  // Reflect the caller's origin (required when credentials are allowed — the
  // wildcard '*' is rejected by browsers alongside Allow-Credentials). Native
  // app requests have no Origin header; '*' is a safe default for them.
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Vary': 'Origin',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}

export function middleware(request) {
  const origin = request.headers.get('origin')
  const headers = corsHeaders(origin)

  // Short-circuit the preflight so it never reaches a route that lacks an
  // OPTIONS handler (which would 405 and fail the real request).
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers })
  }

  const res = NextResponse.next()
  for (const [key, value] of Object.entries(headers)) res.headers.set(key, value)
  return res
}

// Only run for API routes — page rendering doesn't need CORS.
export const config = {
  matcher: '/api/:path*',
}
