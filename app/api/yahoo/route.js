// app/api/yahoo/route.js
// Proxy for Yahoo Finance unofficial JSON endpoints.
// Runs server-side so CORS is never an issue.
// No API key required. Rate limit: ~2000 req/day per IP comfortably.

export const runtime = "edge";

const YAHOO_BASE = "https://query1.finance.yahoo.com/v10/finance/quoteSummary";

// Modules we need from Yahoo quoteSummary
const MODULES = [
  "assetProfile",         // sector, industry
  "defaultKeyStatistics", // forwardPE, 52wk data
  "financialData",        // currentPrice, revenueGrowth, earningsGrowth, debtToEquity, totalCash, totalDebt, ebitda
  "earningsTrend",        // EPS estimates current/next year and 7d-ago
  "calendarEvents",       // next earnings date
  "upgradeDowngradeHistory", // analyst upgrades/downgrades for revision proxy
  "earnings",             // actual vs estimate for EPS surprise
  "summaryDetail",        // averageVolume, volume, 200dma, 50dma, forwardPE
].join(",");

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") || "").toUpperCase().trim();

  if (!ticker || !/^[A-Z0-9.\-]{1,10}$/.test(ticker)) {
    return Response.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const url = `${YAHOO_BASE}/${ticker}?modules=${MODULES}&corsDomain=finance.yahoo.com`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; StockScorer/1.0)",
        "Accept": "application/json",
      },
      // 8 second timeout
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return Response.json(
        { error: `Yahoo returned ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const result = data?.quoteSummary?.result?.[0];

    if (!result) {
      return Response.json(
        { error: "Ticker not found or Yahoo returned empty result" },
        { status: 404 }
      );
    }

    // Return the raw modules. Client-side scoring.js will interpret them.
    return Response.json(result, {
      headers: {
        // Cache 15 minutes in Vercel Edge cache - Yahoo data doesn't move faster
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800",
      },
    });
  } catch (err) {
    const msg = err?.name === "TimeoutError" ? "Yahoo request timed out" : String(err);
    return Response.json({ error: msg }, { status: 502 });
  }
}
