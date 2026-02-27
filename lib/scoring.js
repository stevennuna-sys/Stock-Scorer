// lib/scoring.js
// Server-side canonical scoring engine (FMP only)

export const MODEL_VERSION = "1.0.0";

const SECTOR_FWD_PE = {
  Technology: 24,
  "Communication Services": 18,
  "Consumer Cyclical": 22,
  "Consumer Defensive": 20,
  Healthcare: 18,
  "Financial Services": 13,
  Industrials: 20,
  "Basic Materials": 14,
  Energy: 12,
  "Real Estate": 38,
  Utilities: 16,
  Unknown: 18,
};

const SECTOR_MACRO = {
  Technology: 1,
  "Communication Services": 2,
  "Consumer Cyclical": 0,
  "Consumer Defensive": 3,
  Healthcare: 3,
  "Financial Services": 1,
  Industrials: 1,
  "Basic Materials": 0,
  Energy: 1,
  "Real Estate": 1,
  Utilities: 4,
  Unknown: 2,
};

function safeNumber(v) {
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function scoreBand(val, bands) {
  if (val === null) return null;
  for (let i = 0; i < bands.length; i++) {
    if (val < bands[i]) return i;
  }
  return bands.length;
}

// ─────────────────────────────
// FACTOR SCORING
// ─────────────────────────────

function scoreEpsSurprise(pct) {
  const index = scoreBand(pct, [-10, -2, 3, 10]);
  return {
    index,
    confidence: pct !== null ? "high" : "low",
    raw: pct !== null ? { surprisePct: pct.toFixed(2) + "%" } : null,
  };
}

function scoreValuation(pe, sector) {
  if (!pe || pe <= 0) return { index: null, confidence: "low", raw: null };

  const median = SECTOR_FWD_PE[sector] || SECTOR_FWD_PE.Unknown;
  const ratio = pe / median;

  const index = scoreBand(ratio, [0.7, 0.85, 0.95, 1.2]).reverse?.() ?? null;

  let i;
  if (ratio > 1.2) i = 0;
  else if (ratio > 0.95) i = 1;
  else if (ratio > 0.85) i = 2;
  else if (ratio > 0.7) i = 3;
  else i = 4;

  return {
    index: i,
    confidence: "high",
    raw: { pe, median, ratio: ratio.toFixed(2) },
  };
}

function scoreMacro(sector) {
  return {
    index:
      SECTOR_MACRO[sector] !== undefined
        ? SECTOR_MACRO[sector]
        : SECTOR_MACRO.Unknown,
    confidence: "medium",
    raw: { sector },
  };
}

// ─────────────────────────────
// NORMALIZATION
// ─────────────────────────────

function normalizeFmp(fmpData) {
  const quote = fmpData?.quote?.[0] || {};
  const profile = fmpData?.profile?.[0] || {};
  const surprises = Array.isArray(fmpData?.earningsSurprises)
    ? [...fmpData.earningsSurprises]
    : [];

  surprises.sort((a, b) => new Date(b?.date) - new Date(a?.date));

  const recent = surprises[0] || {};

  return {
    pe: safeNumber(quote.pe ?? quote.priceEarningsRatio),
    sector: (profile.sector || "Unknown").trim(),
    surprisePct: safeNumber(
      recent.surprisePercentage ?? recent.surprise_percentage
    ),
    companyName: profile.companyName || profile.name || null,
  };
}

// ─────────────────────────────
// COMPOSITE SCORING
// ─────────────────────────────

export function scoreFromFmp(fmpData) {
  const normalized = normalizeFmp(fmpData);

  const factors = {
    eps_surprise: scoreEpsSurprise(normalized.surprisePct),
    valuation: scoreValuation(normalized.pe, normalized.sector),
    macro_sensitivity: scoreMacro(normalized.sector),
  };

  const valid = Object.values(factors).filter(f => f.index !== null);

  const composite =
    valid.length > 0
      ? Math.round(
          (valid.reduce((s, f) => s + f.index, 0) /
            (valid.length * 4)) *
            100
        )
      : null;

  return {
    modelVersion: MODEL_VERSION,
    companyName: normalized.companyName,
    factors,
    composite,
    timestamp: Date.now(),
  };
}
