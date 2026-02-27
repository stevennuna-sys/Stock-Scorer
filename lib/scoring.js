// lib/scoring.js
// FMP-ONLY Scoring Engine (No Yahoo dependencies)

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

function makeResult(index, confidence, raw = null) {
  return { index, confidence, raw };
}

function safeNumber(val) {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

// ─────────────────────────────────────────────
// CANONICAL SCORERS
// ─────────────────────────────────────────────

function scoreEpsSurprisePct(pct) {
  if (pct === null) return makeResult(null, "low");

  let index;

  if (pct < -10) index = 0;
  else if (pct < -2) index = 1;
  else if (pct < 3) index = 2;
  else if (pct < 10) index = 3;
  else index = 4;

  return makeResult(index, "high", {
    surprisePct: pct.toFixed(2) + "%",
  });
}

function scoreValuation(pe, sector) {
  if (!pe || pe <= 0) return makeResult(null, "low");

  const sectorMedian = SECTOR_FWD_PE[sector] || SECTOR_FWD_PE.Unknown;
  const ratio = pe / sectorMedian;

  let index;
  if (ratio > 1.2) index = 0;
  else if (ratio > 0.95) index = 1;
  else if (ratio > 0.85) index = 2;
  else if (ratio > 0.7) index = 3;
  else index = 4;

  return makeResult(index, "high", {
    pe: pe.toFixed(1),
    sectorMedian,
    ratio: ratio.toFixed(2),
    sector,
  });
}

function scoreMacro(sector) {
  const index =
    SECTOR_MACRO[sector] !== undefined
      ? SECTOR_MACRO[sector]
      : SECTOR_MACRO.Unknown;

  return makeResult(index, "medium", { sector });
}

// ─────────────────────────────────────────────
// FMP NORMALIZATION + INTERPRETATION
// ─────────────────────────────────────────────

function normalizeFmp(fmpData) {
  const quote = fmpData?.quote?.[0] || null;
  const profile = fmpData?.profile?.[0] || null;

  const earningsSurprises = Array.isArray(fmpData?.earningsSurprises)
    ? [...fmpData.earningsSurprises]
    : [];

  // Ensure newest first
  earningsSurprises.sort((a, b) => {
    if (!a?.date || !b?.date) return 0;
    return new Date(b.date) - new Date(a.date);
  });

  const recent = earningsSurprises[0] || null;

  const surprisePct = safeNumber(
    recent?.surprisePercentage ?? recent?.surprise_percentage
  );

  const pe = safeNumber(quote?.pe ?? quote?.priceEarningsRatio);
  const sector = (profile?.sector || "Unknown").trim();
  const companyName = profile?.companyName || profile?.name || null;

  return {
    surprisePct,
    pe,
    sector,
    companyName,
  };
}

export function interpretFmpData(fmpData) {
  const m = normalizeFmp(fmpData);

  return {
    eps_surprise: scoreEpsSurprisePct(m.surprisePct),
    valuation: scoreValuation(m.pe, m.sector),
    macro_sensitivity: scoreMacro(m.sector),
    company_name: makeResult(null, "high", {
      companyName: m.companyName,
    }),
  };
}

// ─────────────────────────────────────────────

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
