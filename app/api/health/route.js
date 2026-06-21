// GET /api/health → cheap reachability + configuration probe.
//
// The mobile app's "Can't reach the server" message tells users to verify the
// API is running and that EXPO_PUBLIC_API_BASE_URL is correct. This endpoint
// gives the client (and humans) a dependency-light way to confirm exactly that:
// it returns 200 the moment the server is reachable, and reports whether the
// critical env is configured — without touching the database or signing anyone in.
export function GET() {
  const configured = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  return Response.json({
    ok: true,
    service: 'max-api',
    configured,
    time: new Date().toISOString(),
  })
}
