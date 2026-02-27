// app/api/fmp/route.js
// Server-side proxy for Financial Modeling Prep (FMP) API.
// Runs server-side -- API key never exposed to the browser.
// Env var required: FMP_API_KEY

export const runtime = "nodejs";

const FMP_BASE = "https://financialmodelingprep.com/stable";

async function fetchWithRetry(url, retries = 3, baseDelayMs = 400) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json" },
    });
    if (res.status === 429) {
      if (attempt === retries) {
        return { ok: false, status: 429, body: null, error: "FMP rate limit (429)" };
      }
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      continue;
    }
    if (!res.ok) {
      let text = "";
      try { text = await res.text(); } catch {}
      return { ok: false, status: res.status, body: null, error: "FMP returned " + res.status + ": " + text.slice(0, 120) };
    }
    const body = await res.json();
    return { ok: true, status: res.status, body, error: null };
  }
}

export async function GET(request) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "FMP_API_KEY env var not set. Add it in Vercel > Settings > Environment Variables." },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "").toUpperCase().trim();
  if (!symbol || !/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    return Response.json({ error: "Missing or invalid symbol. Pass ?symbol=AAPL" }, { status: 400 });
  }

  const [quoteRes, profileRes, earningsRes] = await Promise.all([
    fetchWithRetry(FMP_BASE + "/quote?symbol=" + symbol + "&apikey=" + apiKey),
    fetchWithRetry(FMP_BASE + "/profile?symbol=" + symbol + "&apikey=" + apiKey),
    fetchWithRetry(FMP_BASE + "/earnings-surprises?symbol=" + symbol + "&apikey=" + apiKey),
  ]);

  for (const r of [quoteRes, profileRes, earningsRes]) {
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status === 429 ? 429 : 502 });
  }

  const quote             = quoteRes.body   || [];
  const profile           = profileRes.body  || [];
  const earningsSurprises = earningsRes.body || [];

  if (!quote.length && !profile.length) {
    return Response.json(
      { error: "Symbol " + symbol + " not found on FMP." },
      { status: 404 }
    );
  }

  return Response.json(
    { symbol, quote, profile, earningsSurprises, source: "FMP" },
    { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800" } }
  );
}
