// lib/scoring.js
// Converts raw Yahoo Finance quoteSummary JSON into scorer dropdown indexes (0-4).
// Never touches the scoring formula. Only produces input indexes.
//
// Each function returns: { index: 0-4, confidence: "high"|"medium"|"low", raw: any }
// confidence reflects data quality, not signal quality.

// ─── SECTOR MEDIAN FORWARD P/E TABLE ──────────────────────────────────────────
// Sourced from Damodaran Jan 2025 + Bloomberg consensus.
// Update annually. Used for relative valuation.
const SECTOR_FWD_PE = {
  "Technology":                    24,
  "Communication Services":        18,
  "Consumer Cyclical":             22,
  "Consumer Defensive":            20,
  "Healthcare":                    18,
  "Financial Services":            13,
  "Industrials":                   20,
  "Basic Materials":               14,
  "Energy":                        12,
  "Real Estate":                   38,  // uses FFO multiple
  "Utilities":                     16,
  "Unknown":                       18,  // fallback
};

// ─── SECTOR MACRO SENSITIVITY TABLE ───────────────────────────────────────────
// Hardcoded heuristic. Partially automated (sector → index).
// 0 = highly exposed, 4 = counter-cyclical
const SECTOR_MACRO = {
  "Technology":                    1,   // rate-sensitive, macro exposed
  "Communication Services":        2,
  "Consumer Cyclical":             0,   // very exposed
  "Consumer Defensive":            3,
  "Healthcare":                    3,
  "Financial Services":            1,   // credit cycle exposed
  "Industrials":                   1,
  "Basic Materials":               0,
  "Energy":                        1,
  "Real Estate":                   1,
  "Utilities":                     4,
  "Unknown":                       2,
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function safe(val) {
  // Returns the value if it's a usable number, else null
  if (val === null || val === undefined) return null;
  if (typeof val === "object" && "raw" in val) return safe(val.raw);
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function safeStr(val) {
  if (!val) return null;
  if (typeof val === "string") return val;
  if (val?.longFmt) return val.longFmt;
  return null;
}

function daysFromNow(epochSeconds) {
  if (!epochSeconds) return null;
  const ms = epochSeconds * 1000;
  const diffMs = ms - Date.now();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

// ─── FACTOR INTERPRETERS ──────────────────────────────────────────────────────

/**
 * EPS Surprise — index 0-4
 * Source: earnings.earningsChart.quarterly (most recent quarter)
 * Formula: pct = (actual - estimate) / |estimate| * 100
 */
export function scoreEpsSurprise(data) {
  try {
    const quarters = data?.earnings?.earningsChart?.quarterly;
    if (!quarters?.length) return { index: null, confidence: "low", raw: null };

    // Most recent quarter is last in array
    const recent = quarters[quarters.length - 1];
    const actual = safe(recent?.actual);
    const estimate = safe(recent?.estimate);

    if (actual === null || estimate === null || estimate === 0) {
      return { index: null, confidence: "low", raw: null };
    }

    const pct = ((actual - estimate) / Math.abs(estimate)) * 100;
    let index;
    if (pct < 1)       index = 0;
    else if (pct < 5)  index = 1;
    else if (pct < 10) index = 2;
    else if (pct < 20) index = 3;
    else               index = 4;

    return { index, confidence: "high", raw: { actual, estimate, pct: +pct.toFixed(1) } };
  } catch {
    return { index: null, confidence: "low", raw: null };
  }
}

/**
 * Revision Level — index 0-4
 * Source: upgradeDowngradeHistory (last 90 days)
 * Formula: ratio = upgrades / (upgrades + downgrades)
 * 0: <0.2, 1: 0.2-0.4, 2: 0.4-0.6, 3: 0.6-0.8, 4: >0.8
 */
export function scoreRevisionLevel(data) {
  try {
    const history = data?.upgradeDowngradeHistory?.history;
    if (!history?.length) return { index: null, confidence: "low", raw: null };

    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const recent = history.filter((h) => {
      const ts = safe(h?.epochGradeDate);
      return ts && ts * 1000 > cutoff;
    });

    if (!recent.length) return { index: null, confidence: "low", raw: null };

    // Classify each action
    const UP = ["upgrade", "initiated", "reiterated", "buy", "overweight", "outperform", "strong buy"];
    const DOWN = ["downgrade", "underweight", "underperform", "sell", "reduce"];

    let ups = 0, downs = 0;
    recent.forEach((h) => {
      const action = (h?.action || "").toLowerCase();
      const grade = (h?.toGrade || "").toLowerCase();
      if (UP.some((u) => action.includes(u) || grade.includes(u))) ups++;
      else if (DOWN.some((d) => action.includes(d) || grade.includes(d))) downs++;
    });

    const total = ups + downs;
    if (total === 0) return { index: 1, confidence: "low", raw: { ups: 0, downs: 0 } };

    const ratio = ups / total;
    let index;
    if (ratio < 0.2)      index = 0;
    else if (ratio < 0.4) index = 1;
    else if (ratio < 0.6) index = 2;
    else if (ratio < 0.8) index = 3;
    else                  index = 4;

    return {
      index,
      confidence: total >= 5 ? "medium" : "low",
      raw: { ups, downs, total, ratio: +ratio.toFixed(2) },
    };
  } catch {
    return { index: null, confidence: "low", raw: null };
  }
}

/**
 * Revision Velocity — index 0-4
 * Source: earningsTrend — current EPS estimate vs 7daysAgo for current quarter
 * Formula: delta = current - sevenDaysAgo, then direction + magnitude
 */
export function scoreRevisionVelocity(data) {
  try {
    const trends = data?.earningsTrend?.trend;
    if (!trends?.length) return { index: null, confidence: "low", raw: null };

    // "0q" = current quarter
    const curQ = trends.find((t) => t?.period === "0q") || trends[0];
    const current = safe(curQ?.earningsEstimate?.avg);
    const sevenAgo = safe(curQ?.earningsEstimate?.yearAgoEps) ?? safe(curQ?.earningsEstimate?.avg);
    // Yahoo doesn't always expose 7d-ago directly; use growth as proxy
    const growth = safe(curQ?.earningsEstimate?.growth);

    if (current === null) return { index: null, confidence: "low", raw: null };

    // If we have explicit growth rate
    if (growth !== null) {
      let index;
      if (growth < -0.05)      index = 0;  // decelerating
      else if (growth < 0.01)  index = 1;  // flat
      else if (growth < 0.05)  index = 2;  // modest
      else if (growth < 0.12)  index = 3;  // accelerating
      else                     index = 4;  // rapid

      return { index, confidence: "medium", raw: { growth: +(growth * 100).toFixed(1) + "%" } };
    }

    return { index: null, confidence: "low", raw: null };
  } catch {
    return { index: null, confidence: "low", raw: null };
  }
}

/**
 * Relative Valuation — index 0-4 (nonlinear: index 2 scores highest)
 * Source: summaryDetail.forwardPE + sector lookup table
 * Formula: ratio = stockFwdPE / sectorMedianPE
 */
export function scoreValuation(data) {
  try {
    const fwdPE = safe(data?.summaryDetail?.forwardPE)
               ?? safe(data?.defaultKeyStatistics?.forwardPE);
    const sector = safeStr(data?.assetProfile?.sector) || "Unknown";
    const sectorMedian = SECTOR_FWD_PE[sector] ?? SECTOR_FWD_PE["Unknown"];

    if (fwdPE === null || fwdPE <= 0) {
      return { index: null, confidence: "low", raw: { fwdPE, sector } };
    }

    const ratio = fwdPE / sectorMedian;
    let index;
    // Nonlinear: 0.85-0.95x (modest discount) scores best = index 2
    if (ratio > 1.20)       index = 0;  // premium
    else if (ratio > 0.95)  index = 1;  // in-line
    else if (ratio > 0.85)  index = 2;  // modest discount — highest score
    else if (ratio > 0.70)  index = 3;  // meaningful discount
    else                    index = 4;  // deep discount — value trap risk

    return {
      index,
      confidence: "high",
      raw: { fwdPE: +fwdPE.toFixed(1), sectorMedian, ratio: +ratio.toFixed(2), sector },
    };
  } catch {
    return { index: null, confidence: "low", raw: null };
  }
}

/**
 * Revenue Momentum — index 0-4
 * Source: financialData.revenueGrowth (YoY quarterly, most recent)
 * Formula: revenueGrowth is already a decimal (0.05 = 5%)
 * Note: Yahoo gives YoY not QoQ; we use it as a proxy.
 */
export function scoreRevenueMomentum(data) {
  try {
    const growth = safe(data?.financialData?.revenueGrowth);
    if (growth === null) return { index: null, confidence: "low", raw: null };

    let index;
    if (growth < 0)        index = 0;
    else if (growth < 0.01) index = 1;
    else if (growth < 0.05) index = 2;
    else if (growth < 0.10) index = 3;
    else                    index = 4;

    return {
      index,
      confidence: "high",
      raw: { revenueGrowth: +(growth * 100).toFixed(1) + "%" },
    };
  } catch {
    return { index: null, confidence: "low", raw: null };
  }
}

/**
 * EPS Inflection — index 0-4
 * Source: earningsTrend — "0y" (current year) and "+1y" (next year) EPS growth
 * Formula: thisYrGrowth + nextYrGrowth → 5 buckets
 */
export function scoreEpsInflection(data) {
  try {
    const trends = data?.earningsTrend?.trend;
    if (!trends?.length) return { index: null, confidence: "low", raw: null };

    const thisYr = trends.find((t) => t?.period === "0y");
    const nextYr = trends.find((t) => t?.period === "+1y");

    const thisG = safe(thisYr?.earningsEstimate?.growth);
    const nextG = safe(nextYr?.earningsEstimate?.growth);

    if (thisG === null && nextG === null) {
      return { index: null, confidence: "low", raw: null };
    }

    const t = thisG ?? 0;
    const n = nextG ?? 0;

    let index;
    if (t < 0 && n < 0)              index = 0;  // both declining
    else if (t < 0.02 && n < 0.02)   index = 1;  // flat both
    else if (t >= 0.02 && n >= 0.02 && n < 0.15) index = 2;  // moderate both
    else if (t < 0.05 && n >= 0.15)  index = 3;  // flat this yr / inflecting next
    else                              index = 4;  // strong + accelerating

    return {
      index,
      confidence: "medium",
      raw: {
        thisYrGrowth: thisG !== null ? +(thisG * 100).toFixed(1) + "%" : null,
        nextYrGrowth: nextG !== null ? +(nextG * 100).toFixed(1) + "%" : null,
      },
    };
  } catch {
    return { index: null, confidence: "low", raw: null };
  }
}

/**
 * Catalyst Proximity — index 0-4
 * Source: calendarEvents.earnings.earningsDate (array of epoch timestamps)
 * Formula: days to nearest future earnings date
 */
export function scoreCatalystProximity(data) {
  try {
    const dates = data?.calendarEvents?.earnings?.earningsDate;
    if (!dates?.length) return { index: null, confidence: "low", raw: null };

    // Find the nearest future date
    const futureDates = dates
      .map((d) => ({ days: daysFromNow(safe(d)), raw: safe(d) }))
      .filter((d) => d.days !== null && d.days > -10)  // allow slight past dates
      .sort((a, b) => a.days - b.days);

    if (!futureDates.length) return { index: 0, confidence: "medium", raw: { note: "No upcoming earnings found" } };

    const days = futureDates[0].days;
    let index;
    if (days > 120)      index = 1;
    else if (days > 90)  index = 2;
    else if (days > 60)  index = 3;
    else                 index = 4;

    return {
      index,
      confidence: "high",
      raw: { daysToEarnings: days },
    };
  } catch {
    return { index: null, confidence: "low", raw: null };
  }
}

/**
 * Trend Health — index 0-4
 * Source: summaryDetail (price, twoHundredDayAverage, fiftyTwoWeekLow/High)
 *         financialData.currentPrice
 * Note: We can't compare to SPY without a second call, so we use 52wk position as proxy.
 * Proxy: above/below 200d + position in 52wk range as relative strength proxy
 */
export function scoreTrendHealth(data) {
  try {
    const price = safe(data?.financialData?.currentPrice)
               ?? safe(data?.summaryDetail?.regularMarketPrice);
    const ma200 = safe(data?.summaryDetail?.twoHundredDayAverage);
    const low52  = safe(data?.summaryDetail?.fiftyTwoWeekLow);
    const high52 = safe(data?.summaryDetail?.fiftyTwoWeekHigh);

    if (price === null || ma200 === null) {
      return { index: null, confidence: "low", raw: null };
    }

    const above200 = price > ma200;
    // 52wk position as relative strength proxy: 0 = at low, 1 = at high
    const range52 = high52 && low52 ? (price - low52) / (high52 - low52) : null;

    let index;
    if (!above200 && (range52 === null || range52 < 0.3)) index = 0;
    else if (!above200)                                   index = 1;
    else if (above200 && (range52 !== null && range52 < 0.5)) index = 2;
    else if (above200 && (range52 !== null && range52 < 0.75)) index = 3;
    else                                                   index = 4;

    return {
      index,
      confidence: "medium",  // medium because SPY comparison is approximated
      raw: {
        price: +price.toFixed(2),
        ma200: +ma200.toFixed(2),
        above200,
        range52wk: range52 !== null ? +(range52 * 100).toFixed(0) + "%" : null,
      },
    };
  } catch {
    return { index: null, confidence: "low", raw: null };
  }
}

/**
 * Accumulation Pattern — index 0-4 (partial / proxy only)
 * Source: summaryDetail averageVolume vs averageVolume10days + price trend
 * Heuristic: if 10d avg volume > 90d avg volume AND price is up → accumulation
 */
export function scoreAccumulation(data) {
  try {
    const vol10d = safe(data?.summaryDetail?.averageVolume10days);
    const vol90d = safe(data?.summaryDetail?.averageVolume);
    const price   = safe(data?.financialData?.currentPrice);
    const ma50    = safe(data?.summaryDetail?.fiftyDayAverage);

    if (!vol10d || !vol90d) return { index: null, confidence: "low", raw: null };

    const volRatio = vol10d / vol90d;
    const priceAboveMa50 = price !== null && ma50 !== null ? price > ma50 : null;

    let index;
    if (volRatio > 1.3 && priceAboveMa50 === false) index = 0;  // high vol, price falling = distribution
    else if (volRatio < 0.8)                         index = 1;  // quiet, no pattern
    else if (volRatio >= 0.8 && volRatio < 1.1)     index = 2;  // quiet accumulation
    else if (volRatio >= 1.1 && priceAboveMa50)     index = 3;  // above avg vol, price holding
    else                                              index = 2;  // default to neutral

    return {
      index,
      confidence: "low",  // volume proxy is rough — always flag for review
      raw: { volRatio: +volRatio.toFixed(2), priceAboveMa50 },
    };
  } catch {
    return { index: null, confidence: "low", raw: null };
  }
}

/**
 * Balance Sheet — index 0-4
 * Source: financialData (totalDebt, totalCash, ebitda)
 * Formula: netDebt = totalDebt - totalCash; leverage = netDebt / ebitda
 */
export function scoreBalanceSheet(data) {
  try {
    const debt   = safe(data?.financialData?.totalDebt);
    const cash   = safe(data?.financialData?.totalCash);
    const ebitda = safe(data?.financialData?.ebitda);

    if (debt === null || cash === null) {
      return { index: null, confidence: "low", raw: null };
    }

    const netDebt = debt - cash;

    // Net cash position
    if (netDebt <= 0) {
      return { index: 4, confidence: "high", raw: { netDebt: +(netDebt / 1e9).toFixed(2) + "B", leverage: "net cash" } };
    }

    if (!ebitda || ebitda <= 0) {
      // Can't compute leverage, use rough debt/cash ratio
      return { index: null, confidence: "low", raw: { netDebt: +(netDebt / 1e9).toFixed(2) + "B" } };
    }

    const leverage = netDebt / ebitda;
    let index;
    if (leverage > 5)      index = 0;
    else if (leverage > 3) index = 1;
    else if (leverage > 1.5) index = 2;
    else                   index = 3;

    return {
      index,
      confidence: "high",
      raw: {
        netDebt: +(netDebt / 1e9).toFixed(2) + "B",
        ebitda: +(ebitda / 1e9).toFixed(2) + "B",
        leverage: +leverage.toFixed(2) + "x",
      },
    };
  } catch {
    return { index: null, confidence: "low", raw: null };
  }
}

/**
 * Macro Sensitivity — index 0-4 (partial — sector lookup only)
 * Source: assetProfile.sector → hardcoded table
 */
export function scoreMacroSensitivity(data) {
  try {
    const sector = safeStr(data?.assetProfile?.sector) || "Unknown";
    const index = SECTOR_MACRO[sector] ?? SECTOR_MACRO["Unknown"];
    return {
      index,
      confidence: "low",  // hardcoded table, always flag for review
      raw: { sector },
    };
  } catch {
    return { index: null, confidence: "low", raw: null };
  }
}

// ─── MASTER FUNCTION ──────────────────────────────────────────────────────────
// Returns a map of factorId → { index, confidence, raw }
// Only includes fields where we have at least a low-confidence estimate.

export function interpretYahooData(yahooData) {
  return {
    eps_surprise:       scoreEpsSurprise(yahooData),
    revisions:          scoreRevisionLevel(yahooData),
    revision_velocity:  scoreRevisionVelocity(yahooData),
    // sector_tailwind: always manual
    valuation:          scoreValuation(yahooData),
    revenue_momentum:   scoreRevenueMomentum(yahooData),
    eps_inflection:     scoreEpsInflection(yahooData),
    catalyst_proximity: scoreCatalystProximity(yahooData),
    chart_trend:        scoreTrendHealth(yahooData),
    accumulation:       scoreAccumulation(yahooData),
    // binary_risk: always manual
    balance_sheet:      scoreBalanceSheet(yahooData),
    // thesis_risk: always manual
    macro_sensitivity:  scoreMacroSensitivity(yahooData),
    // institutional_flow: always manual
    // iv_environment: always manual
  };
}

// Fields that are always manual — used by UI to show MANUAL badge
export const ALWAYS_MANUAL = new Set([
  "sector_tailwind",
  "binary_risk",
  "thesis_risk",
  "institutional_flow",
  "iv_environment",
]);

// Confidence color for UI badge
export function confidenceColor(confidence) {
  if (confidence === "high")   return "#00ff88";
  if (confidence === "medium") return "#ffd700";
  return "#ff9544";
}
