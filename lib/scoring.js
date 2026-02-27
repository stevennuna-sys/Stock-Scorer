// lib/scoring.js
// Clean FMP-only scoring engine

export const MODEL_VERSION = "2.0.0";

// Sector reference medians
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

function safeNumber(v) {
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function normalizeIndex(i) {
  if (i === null) return null;
  return (i / 4) * 100;
}

function scoreEpsSurprise(pct) {
  if (pct === null) return { index: null, confidence: "low", raw: null };

  let i;
  if (pct < -10) i = 0;
  else if (pct < -2) i = 1;
  else if (pct < 3) i = 2;
  else if (pct < 10) i = 3;
  else i = 4;

  return {
    index: i,
    confidence: "high",
    raw: { surprisePct: pct.toFixed(2) + "%" },
  };
}

function scoreValuation(pe, sector) {
  if (!pe || pe <= 0) return { index: null, confidence: "low", raw: null };

  const median = SECTOR_FWD_PE[sector] || SECTOR_FWD_PE.Unknown;
  const ratio = pe / median;

  let i;
  if (ratio > 1.2) i = 0;
  else if (ratio > 0.95) i = 1;
  else if (ratio > 0.85) i = 2;
  else if (ratio > 0.7) i = 3;
  else i = 4;

  return {
    index: i,
    confidence: "high",
    raw: { pe, sectorMedian: median, ratio: ratio.toFixed(2) },
  };
}

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

export function scoreFromFmp(fmpData) {
  const n = normalizeFmp(fmpData);

  const factors = {
    eps_surprise: scoreEpsSurprise(n.surprisePct),
    valuation: scoreValuation(n.pe, n.sector),
  };

  const valid = Object.values(factors).filter(f => f.index !== null);

  const composite =
    valid.length > 0
      ? Math.round(
          valid.reduce((s, f) => s + normalizeIndex(f.index), 0) /
            valid.length
        )
      : null;

  return {
    modelVersion: MODEL_VERSION,
    companyName: n.companyName,
    composite,
    factors,
    timestamp: Date.now(),
  };
}

export const ALWAYS_MANUAL = new Set([
  "sector_tailwind",
  "binary_risk",
  "thesis_risk",
  "institutional_flow",
  "iv_environment",
]);

export function confidenceColor(confidence) {
  if (confidence === "high") return "#00ff88";
  if (confidence === "medium") return "#ffd700";
  return "#ff9544";
}
