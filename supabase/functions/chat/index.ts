// Supabase Edge Function: customer-support chat assistant.
// The AI key stays server-side as a secret. Deploy with:
//   supabase functions deploy chat
//   supabase secrets set ANTHROPIC_API_KEY=... SITE_URL=https://your-domain.com
// Optional: CHAT_MODEL=<model id>  (defaults below)
// Tracking-number lookups are answered by the website itself from your database; this function only
// handles general questions.

const SITE_URL = Deno.env.get('SITE_URL') ?? '';
const API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const MODEL = Deno.env.get('CHAT_MODEL') ?? 'claude-haiku-5-5';

const SYSTEM = `You are the customer-support assistant for Broutelogistics, a freight and parcel logistics company.
Services: Air Freight, Ocean Freight and Express (door-to-door parcels).
Rules:
- Keep answers short, polite and plain text.
- You cannot see shipment data. For shipment status, tell the customer to enter their tracking number (format BRT-XXXXXXXXXX) in the tracking box on the website.
- Never invent prices, delivery times, policies, addresses, phone numbers or emails. If you do not know, suggest using the contact form on the website.
- Politely decline requests unrelated to Broutelogistics or logistics.`;

const hits = new Map<string, { n: number; reset: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) { hits.set(ip, { n: 1, reset: now + 60_000 }); return false; }
  h.n += 1;
  return h.n > 10; // 10 messages / minute / IP (per instance)
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  const cors = {
    'Access-Control-Allow-Origin': SITE_URL || '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (SITE_URL && origin !== SITE_URL) return json({ error: 'Forbidden' }, 403);
  if (!API_KEY) return json({ error: 'Chat is not configured' }, 503);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (limited(ip)) return json({ error: 'Too many messages. Please wait a moment.' }, 429);

  let message = '';
  try {
    const body = await req.json();
    message = typeof body?.message === 'string' ? body.message.trim() : '';
  } catch { /* fall through */ }
  if (message.length < 1 || message.length > 500) return json({ error: 'Invalid message' }, 400);

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, system: SYSTEM, messages: [{ role: 'user', content: message }] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return json({ error: 'Assistant unavailable' }, 502);
    const data = await r.json();
    const reply = Array.isArray(data?.content) ? data.content.map((c: { text?: string }) => c.text ?? '').join('').trim() : '';
    if (!reply) return json({ error: 'Assistant unavailable' }, 502);
    return json({ reply });
  } catch {
    return json({ error: 'Assistant unavailable' }, 502);
  }
});
