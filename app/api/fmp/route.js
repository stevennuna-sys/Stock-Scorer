// app/api/fmp/route.js
export const runtime = "nodejs";

const FMP_BASE = "https://financialmodelingprep.com/stable";

async function fetchWithRetry(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      clearTimeout(timeout);

      if (res.status === 429) {
        if (attempt === retries) {
          return { ok: false, status: 429, error: "FMP rate limit exceeded." };
        }
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }

      if (!res.ok) {
        return { ok: false, status: res.status, error: `FMP ${res.status}` };
      }

      const json = await res.json();
      return { ok: true, body: json };
    } catch (err) {
      if (attempt === retries) {
        return { ok: false, status: 502, error: "FMP request failed." };
      }
    }
  }
}

export async function GET(request) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "FMP_API_KEY not configured." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "").toUpperCase().trim();

  if (!symbol || !/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    return Response.json({ error: "Invalid symbol." }, { status: 400 });
  }

  const endpoints = [
    `${FMP_BASE}/quote?symbol=${symbol}&apikey=${apiKey}`,
    `${FMP_BASE}/profile?symbol=${symbol}&apikey=${apiKey}`,
    `${FMP_BASE}/earnings-surprises?symbol=${symbol}&apikey=${apiKey}`,
  ];

  const [quoteRes, profileRes, earningsRes] = await Promise.all(
    endpoints.map(fetchWithRetry)
  );

  for (const r of [quoteRes, profileRes, earningsRes]) {
    if (!r.ok) {
      return Response.json({ error: r.error }, { status: r.status || 502 });
    }
  }

  return Response.json(
    {
      symbol,
      quote: quoteRes.body || [],
      profile: profileRes.body || [],
      earningsSurprises: earningsRes.body || [],
      source: "FMP",
    },
    {
      headers: {
        "Cache-Control":
          "public, s-maxage=900, stale-while-revalidate=1800",
      },
    }
  );
}
