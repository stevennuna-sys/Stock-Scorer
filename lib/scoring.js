// lib/scoring.js

// Core scoring helpers
export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function scoreBucket(value, buckets) {
  // buckets: [{ max: number, index: number }, ...] assumes ascending max
  for (const b of buckets) {
    if (value <= b.max) return b.index;
  }
  return buckets[buckets.length - 1]?.index ?? 0;
}

export function scoreEpsSurprise(yahooData) {
  const q = yahooData?.earnings?.earningsChart?.quarterly?.[0];
  const actual = q?.actual;
  const estimate = q?.estimate;
  if (typeof actual !== "number" || typeof estimate !== "number" || estimate === 0) {
    return { index: null, confidence: 0, raw: null };
  }
  const surprisePct = ((actual - estimate) / Math.abs(estimate)) * 100;

  let index = 2;
  if (surprisePct >= 15) index = 4;
  else if (surprisePct >= 7) index = 3;
  else if (surprisePct <= -10) index = 0;
  else if (surprisePct <= -3) index = 1;

  return { index, confidence: 0.7, raw: { surprisePct, actual, estimate } };
}

export function scoreRevisionLevel(yahooData) {
  // Placeholder: Yahoo revisions are messy in public endpoints
  return { index: null, confidence: 0, raw: null };
}

export function scoreRevisionAcceleration(yahooData) {
  return { index: null, confidence: 0, raw: null };
}

export function scoreSectorTailwind(yahooData) {
  return { index: null, confidence: 0, raw: null };
}

export function scoreValuation(yahooData) {
  const pe = yahooData?.summaryDetail?.trailingPE;
  if (typeof pe !== "number" || !Number.isFinite(pe) || pe <= 0) {
    return { index: null, confidence: 0, raw: null };
  }

  // Lower P/E is better, loosely mapped into 0..4
  let index = 2;
  if (pe <= 12) index = 4;
  else if (pe <= 18) index = 3;
  else if (pe >= 35) index = 0;
  else if (pe >= 26) index = 1;

  return { index, confidence: 0.6, raw: { pe } };
}

export function scorePriceTrend(yahooData) {
  return { index: null, confidence: 0, raw: null };
}

export function scoreVolumePattern(yahooData) {
  return { index: null, confidence: 0, raw: null };
}

export function scoreBinaryRisk(yahooData) {
  return { index: null, confidence: 0, raw: null };
}

export function scoreIVRank(yahooData) {
  return { index: null, confidence: 0, raw: null };
}

// Existing Yahoo interpreter (kept so nothing else breaks)
export function interpretYahooData(yahooData) {
  return {
    eps_surprise: scoreEpsSurprise(yahooData),
    revisions: scoreRevisionLevel(yahooData),
    revision_accel: scoreRevisionAcceleration(yahooData),
    sector_tailwind: scoreSectorTailwind(yahooData),
    valuation: scoreValuation(yahooData),
    chart_trend: scorePriceTrend(yahooData),
    volume_pattern: scoreVolumePattern(yahooData),
    binary_risk: scoreBinaryRisk(yahooData),
    iv_rank: scoreIVRank(yahooData),
  };
}

// New FMP interpreter
export function interpretFmpData(fmpData) {
  // fmpData shape from /api/fmp:
  // { symbol, quote, profile, earningsSurprises, source }
  const out = {};

  const quote = Array.isArray(fmpData?.quote) ? fmpData.quote[0] : fmpData?.quote;
  const profile = Array.isArray(fmpData?.profile) ? fmpData.profile[0] : fmpData?.profile;
  const surprises = Array.isArray(fmpData?.earningsSurprises) ? fmpData.earningsSurprises : [];

  // EPS surprise magnitude
  const sp =
    surprises?.[0]?.surprisePercentage ??
    surprises?.[0]?.surprisePercent ??
    null;

  if (typeof sp === "number" && Number.isFinite(sp)) {
    let index = 2;
    if (sp >= 15) index = 4;
    else if (sp >= 7) index = 3;
    else if (sp <= -10) index = 0;
    else if (sp <= -3) index = 1;

    out.eps_surprise = {
      index,
      confidence: 0.7,
      raw: { surprisePct: sp },
    };
  }

  // Valuation proxy using P/E if present
  const pe =
    (typeof quote?.pe === "number" && Number.isFinite(quote.pe) && quote.pe > 0
      ? quote.pe
      : null) ??
    (typeof quote?.priceEarningsRatio === "number" &&
    Number.isFinite(quote.priceEarningsRatio) &&
    quote.priceEarningsRatio > 0
      ? quote.priceEarningsRatio
      : null);

  if (typeof pe === "number" && Number.isFinite(pe)) {
    const yahooLike = { summaryDetail: { trailingPE: pe } };
    out.valuation = scoreValuation(yahooLike);
    out.valuation.raw = { ...(out.valuation.raw || {}), pe };
  }

  // Company name for nicer label when it is still "New Stock"
  const companyName = profile?.companyName || profile?.name || null;
  if (companyName) {
    out.company_name = {
      index: null,
      confidence: 1,
      raw: { companyName },
    };
  }

  return out;
}
