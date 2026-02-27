// lib/scoring.js
// Scoring logic + auto fill interpreter for FMP payloads returned by the API route.

export const ALWAYS_MANUAL = [
  "sector_tailwind",
  "binary_risk",
  "positioning",
  "options_iv",
  "event_risk",
  "regulatory_risk",
];

export function confidenceColor(confidence) {
  if (confidence === "high") return "#22c55e";
  if (confidence === "med") return "#f59e0b";
  if (confidence === "low") return "#fb7185";
  return "#64748b";
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickFirstArray(obj) {
  if (!obj) return null;
  if (Array.isArray(obj) && obj.length) return obj[0];
  return null;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function scoreFromPercent(pct, bands) {
  // bands is [{ min, index, confidence }]
  if (pct == null) return null;
  for (const b of bands) {
    if (pct >= b.min) return { index: b.index, confidence: b.confidence };
  }
  return { index: 0, confidence: "low" };
}

function scoreFromValue(value, rules) {
  // rules: [{ test: (v)=>bool, index, confidence }]
  if (value == null) return null;
  for (const r of rules) {
    if (r.test(value)) return { index: r.index, confidence: r.confidence };
  }
  return { index: 0, confidence: "low" };
}

/*
Expected FMP payload (defensive, all optional):
{
  symbol,
  quote: { price, pe, volume, avgVolume, earningsAnnouncement, priceAvg50, priceAvg200 },
  ratiosTtm: { priceEarningsRatioTTM, debtEquityRatioTTM },
  keyMetricsTtm: { ... },
  income: [ { revenue, netIncome, eps, date }, { revenue, netIncome, eps, date } ],
  earningsSurprises: [ { actualEarningResult, estimatedEarning, epsSurprisePercent, date } ],
  profile: { sector, industry, ... }
}
*/
export function interpretFmpData(fmp) {
  const out = {};

  const quote = fmp?.quote || pickFirstArray(fmp?.quote);
  const ratios = fmp?.ratiosTtm || pickFirstArray(fmp?.ratiosTtm);
  const incomeArr = fmp?.income || fmp?.incomeStatement || [];
  const income0 = Array.isArray(incomeArr) ? incomeArr[0] : null;
  const income1 = Array.isArray(incomeArr) ? incomeArr[1] : null;

  const surprisesArr = fmp?.earningsSurprises || [];
  const surprise0 = Array.isArray(surprisesArr) ? surprisesArr[0] : null;

  // 1) EPS surprise magnitude
  const epsSurprisePct =
    safeNum(surprise0?.epsSurprisePercent) ??
    (() => {
      const act = safeNum(surprise0?.actualEarningResult);
      const est = safeNum(surprise0?.estimatedEarning);
      if (act == null || est == null || est === 0) return null;
      return ((act - est) / Math.abs(est)) * 100;
    })();

  const epsSurpriseScore = scoreFromPercent(epsSurprisePct, [
    { min: 10, index: 5, confidence: "high" },
    { min: 3, index: 3, confidence: "med" },
    { min: -2, index: 2, confidence: "low" },
    { min: -1000, index: 0, confidence: "low" },
  ]);

  if (epsSurpriseScore) {
    out.eps_surprise = {
      index: epsSurpriseScore.index,
      confidence: epsSurpriseScore.confidence,
      raw: { epsSurprisePct },
    };
  }

  // 2) Valuation (PE)
  const pe =
    safeNum(ratios?.priceEarningsRatioTTM) ??
    safeNum(quote?.pe) ??
    safeNum(quote?.peRatio);

  const valuationScore = scoreFromValue(pe, [
    { test: (v) => v > 0 && v <= 15, index: 5, confidence: "med" },
    { test: (v) => v > 15 && v <= 22, index: 3, confidence: "low" },
    { test: (v) => v > 22, index: 1, confidence: "low" },
  ]);

  if (valuationScore) {
    out.relative_valuation = {
      index: valuationScore.index,
      confidence: valuationScore.confidence,
      raw: { pe },
    };
  }

  // 3) Trend health (price vs 200 and 50)
  const price = safeNum(quote?.price);
  const ma50 = safeNum(quote?.priceAvg50);
  const ma200 = safeNum(quote?.priceAvg200);

  let trendIndex = null;
  let trendConfidence = "low";
  if (price != null && ma200 != null) {
    const above200 = price >= ma200;
    const above50 = ma50 != null ? price >= ma50 : null;

    if (above200 && above50 === true) {
      trendIndex = 5;
      trendConfidence = "med";
    } else if (above200) {
      trendIndex = 3;
      trendConfidence = "low";
    } else {
      trendIndex = 1;
      trendConfidence = "low";
    }

    out.trend_health = {
      index: trendIndex,
      confidence: trendConfidence,
      raw: { price, ma50, ma200 },
    };
  }

  // 4) Accumulation (volume vs avg)
  const vol = safeNum(quote?.volume);
  const avgVol = safeNum(quote?.avgVolume);
  if (vol != null && avgVol != null && avgVol > 0) {
    const r = vol / avgVol;
    const accScore = scoreFromValue(r, [
      { test: (v) => v >= 1.5, index: 5, confidence: "low" },
      { test: (v) => v >= 1.1, index: 3, confidence: "low" },
      { test: (v) => v < 1.1, index: 1, confidence: "low" },
    ]);
    out.accumulation = {
      index: accScore.index,
      confidence: accScore.confidence,
      raw: { vol, avgVol, ratio: r },
    };
  }

  // 5) Catalyst proximity (next earnings)
  const earnDate = quote?.earningsAnnouncement || quote?.earningsDate;
  const dte = daysUntil(earnDate);
  if (dte != null) {
    const catScore = scoreFromValue(dte, [
      { test: (v) => v >= 0 && v <= 21, index: 5, confidence: "low" },
      { test: (v) => v > 21 && v <= 60, index: 3, confidence: "low" },
      { test: (v) => v > 60, index: 1, confidence: "low" },
      { test: (v) => v < 0, index: 1, confidence: "low" },
    ]);
    out.catalyst_proximity = {
      index: catScore.index,
      confidence: catScore.confidence,
      raw: { earnDate, dte },
    };
  }

  // 6) Revenue momentum (latest vs prior year period if present)
  const rev0 = safeNum(income0?.revenue);
  const rev1 = safeNum(income1?.revenue);
  if (rev0 != null && rev1 != null && rev1 !== 0) {
    const yoy = ((rev0 - rev1) / Math.abs(rev1)) * 100;
    const revScore = scoreFromPercent(yoy, [
      { min: 10, index: 5, confidence: "low" },
      { min: 3, index: 3, confidence: "low" },
      { min: -1000, index: 1, confidence: "low" },
    ]);
    out.revenue_momentum = {
      index: revScore.index,
      confidence: revScore.confidence,
      raw: { revenueYoyPct: yoy, rev0, rev1 },
    };
  }

  return out;
}

/*
Below is the rest of the existing scoring engine.
It consumes discrete factor indexes in stock.values and outputs totals.
This file is written to match the existing UI expectations.
*/

export function computeScores(values) {
  const coreWeights = {
    eps_surprise: 18,
    revisions: 22,
    revision_acceleration: 12,
    sector_tailwind: 10,
    relative_valuation: 8,
    revenue_momentum: 10,
    eps_inflection: 0,
  };

  const timeWeights = {
    catalyst_proximity: 10,
    trend_health: 10,
  };

  const riskWeights = {
    accumulation: 5,
    balance_sheet: 5,
    binary_risk: 5,
  };

  function scoreBucket(bucketWeights) {
    let wSum = 0;
    let sSum = 0;
    for (const k of Object.keys(bucketWeights)) {
      const w = bucketWeights[k];
      if (!w) continue;
      const v = values?.[k];
      if (v == null) continue;
      const idx = Number(v);
      if (!Number.isFinite(idx)) continue;
      wSum += w;
      sSum += w * clamp(idx, 0, 5);
    }
    if (wSum === 0) return 0;
    return (sSum / (wSum * 5)) * 100;
  }

  const core = scoreBucket(coreWeights);
  const time = scoreBucket(timeWeights);
  const risk = scoreBucket(riskWeights);

  const final = clamp(core * 0.8 + time * 0.2 - (100 - risk) * 0.15, 0, 100);

  return {
    core,
    time,
    risk,
    final,
  };
}

export function getSignal(score) {
  if (score >= 78) return "STRONG BUY";
  if (score >= 65) return "BUY";
  if (score >= 50) return "WATCH";
  return "NO SIGNAL";
}
