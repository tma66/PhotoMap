// TEMPORARY (debugging a white screen on mobile Safari): browser errors
// reported by the inline script in layout.tsx land in the server log.
export async function POST(request: Request) {
  const text = (await request.text()).slice(0, 4000);
  console.error(
    "[client-log]",
    request.headers.get("user-agent")?.slice(0, 120),
    text,
  );
  return new Response(null, { status: 204 });
}
