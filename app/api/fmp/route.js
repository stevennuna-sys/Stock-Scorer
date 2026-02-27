export const runtime = "nodejs";

import { scoreFromFmp } from "../../../lib/scoring";

const FMP_BASE = "https://financialmodelingprep.com/stable";

async function fetchJSON(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) throw new Error("FMP " + res.status);
    return await res.json();
  } catch {
    throw new Error("FMP request failed");
  }
}

export async function GET(request) {
  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) {
    return Response.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "").toUpperCase().trim();

  if (!symbol || !/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    return Response.json({ error: "Invalid symbol" }, { status: 400 });
  }

  try {
    const [quote, profile, earningsSurprises] = await Promise.all([
      fetchJSON(`${FMP_BASE}/quote?symbol=${symbol}&apikey=${apiKey}`),
      fetchJSON(`${FMP_BASE}/profile?symbol=${symbol}&apikey=${apiKey}`),
      fetchJSON(`${FMP_BASE}/earnings-surprises?symbol=${symbol}&apikey=${apiKey}`),
    ]);

    const fmpData = { quote, profile, earningsSurprises };
    const scored = scoreFromFmp(fmpData);

    return Response.json({
      symbol,
      modelVersion: scored.modelVersion,
      companyName: scored.companyName,
      composite: scored.composite,
      factors: scored.factors,
      timestamp: scored.timestamp,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
