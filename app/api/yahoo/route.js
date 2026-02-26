// app/api/yahoo/route.js

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = (searchParams.get("ticker") || "").trim().toUpperCase();

    if (!ticker) {
      return new Response(JSON.stringify({ error: "Missing ticker" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
      ticker
    )}`;

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://finance.yahoo.com/",
    };

    const res = await fetch(quoteUrl, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return new Response(
        JSON.stringify({
          error: `Yahoo returned ${res.status}`,
          details: text?.slice(0, 500) || "",
        }),
        {
          status: res.status,
          headers: { "content-type": "application/json" },
        }
      );
    }

    const data = await res.json();

    const result = data?.quoteResponse?.result?.[0];
    if (!result) {
      return new Response(JSON.stringify({ error: "No data for ticker" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ticker, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Server error",
        message: err?.message || String(err),
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }
}
