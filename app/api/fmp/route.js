export const runtime = "nodejs";

import { scoreFromFmp } from "../../../lib/scoring";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

async function fetchJSON(url) {
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error("Finnhub error: " + text);
  }

  return await res.json();
}

export async function GET(request) {
  const apiKey = process.env.FINNHUB_API_KEY;

  if (!apiKey) {
    return Response.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "").toUpperCase().trim();

  if (!symbol) {
    return Response.json({ error: "Invalid symbol" }, { status: 400 });
  }

  try {
    // ✅ Quote
    const quote = await fetchJSON(
      `${FINNHUB_BASE}/quote?symbol=${symbol}&token=${apiKey}`
    );

    // ✅ Company Profile
    const profile = await fetchJSON(
      `${FINNHUB_BASE}/stock/profile2?symbol=${symbol}&token=${apiKey}`
    );

    // ✅ Earnings Surprise
    const earnings = await fetchJSON(
      `${FINNHUB_BASE}/stock/earnings?symbol=${symbol}&token=${apiKey}`
    );

    // Normalize to match your existing scoring engine format
    const fmpCompatible = {
      quote: [
        {
          pe: quote.pe ?? null,
          priceEarningsRatio: quote.pe ?? null,
        },
      ],
      profile: [
        {
          sector: profile.finnhubIndustry || "Unknown",
          companyName: profile.name || null,
        },
      ],
      earningsSurprises:
        Array.isArray(earnings) && earnings.length > 0
          ? [
              {
                date: earnings[0].period,
                surprisePercentage: earnings[0].surprisePercent ?? null,
              },
            ]
          : [],
    };

    const scored = scoreFromFmp(fmpCompatible);

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
