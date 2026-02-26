export const runtime = "nodejs";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();

    if (!symbol) return json({ error: "Missing symbol" }, 400);

    const apiKey = process.env.FMP_KEY;
    if (!apiKey) return json({ error: "Missing FMP_KEY in environment variables" }, 500);

    const url = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(symbol)}?apikey=${apiKey}`;

    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    if (!res.ok) {
      return json(
        { error: "FMP request failed", status: res.status, body: text.slice(0, 500) },
        502
      );
    }

    let arr;
    try {
      arr = JSON.parse(text);
    } catch {
      return json({ error: "Bad JSON from FMP", body: text.slice(0, 500) }, 502);
    }

    const q = Array.isArray(arr) ? arr[0] : null;
    if (!q) return json({ error: "No data for symbol", symbol }, 404);

    return json({
      symbol: q.symbol,
      price: q.price,
      change: q.change,
      changesPercentage: q.changesPercentage,
      previousClose: q.previousClose,
      open: q.open,
      dayLow: q.dayLow,
      dayHigh: q.dayHigh,
      yearLow: q.yearLow,
      yearHigh: q.yearHigh,
      marketCap: q.marketCap,
      pe: q.pe,
      eps: q.eps,
      volume: q.volume,
      avgVolume: q.avgVolume,
      earningsAnnouncement: q.earningsAnnouncement
    });
  } catch (e) {
    return json({ error: "Server error", message: String(e?.message || e) }, 500);
  }
}
