import { NextResponse } from "next/server";

const BASE = "https://financialmodelingprep.com/stable";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  // Light retry for rate limits
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (res.status === 429 && attempt < 2) {
      await sleep(350 * (attempt + 1));
      continue;
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    return { ok: res.ok, status: res.status, data };
  }

  return { ok: false, status: 429, data: { error: "Rate limited" } };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = (searchParams.get("ticker") || "").trim().toUpperCase();

    if (!ticker) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing FMP_API_KEY env var on server" },
        { status: 500 }
      );
    }

    const quoteUrl = `${BASE}/quote?symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(apiKey)}`;
    const profileUrl = `${BASE}/profile?symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(apiKey)}`;

    const [quoteRes, profileRes] = await Promise.all([
      fetchJson(quoteUrl),
      fetchJson(profileUrl),
    ]);

    if (!quoteRes.ok) {
      return NextResponse.json(
        { error: "FMP quote failed", status: quoteRes.status, details: quoteRes.data },
        { status: 502 }
      );
    }

    // FMP returns arrays for many endpoints
    const quote = Array.isArray(quoteRes.data) ? quoteRes.data[0] : quoteRes.data;
    const profile = profileRes.ok
      ? (Array.isArray(profileRes.data) ? profileRes.data[0] : profileRes.data)
      : null;

    if (!quote) {
      return NextResponse.json(
        { error: "No quote data returned from FMP" },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        source: "fmp",
        ticker,
        quote,
        profile,
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: "Server error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
