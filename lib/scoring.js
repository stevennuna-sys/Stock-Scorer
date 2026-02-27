// lib/scoring.js

const SECTOR_FWD_PE = {
  "Technology":             24,
  "Communication Services": 18,
  "Consumer Cyclical":      22,
  "Consumer Defensive":     20,
  "Healthcare":             18,
  "Financial Services":     13,
  "Industrials":            20,
  "Basic Materials":        14,
  "Energy":                 12,
  "Real Estate":            38,
  "Utilities":              16,
  "Unknown":                18,
};

const SECTOR_MACRO = {
  "Technology":             1,
  "Communication Services": 2,
  "Consumer Cyclical":      0,
  "Consumer Defensive":     3,
  "Healthcare":             3,
  "Financial Services":     1,
  "Industrials":            1,
  "Basic Materials":        0,
  "Energy":                 1,
  "Real Estate":            1,
  "Utilities":              4,
  "Unknown":                2,
};

function safe(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "object" && "raw" in val) return safe(val.raw);
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function safeStr(val) {
  if (!val) return null;
  if (typeof val === "string") return val;
  if (val && val.longFmt) return val.longFmt;
  return null;
}

function daysFromNow(epochSeconds) {
  if (!epochSeconds) return null;
  return Math.round((epochSeconds * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
}

export function scoreEpsSurprise(data) {
  try {
    const quarters = data && data.earnings && data.earnings.earningsChart && data.earnings.earningsChart.quarterly;
    if (!quarters || !quarters.length) return { index: null, confidence: "low", raw: null };
    const recent = quarters[quarters.length - 1];
    const actual = safe(recent && recent.actual);
    const estimate = safe(recent && recent.estimate);
    if (actual === null || estimate === null || estimate === 0) return { index: null, confidence: "low", raw: null };
    const pct = ((actual - estimate) / Math.abs(estimate)) * 100;
    let index;
    if (pct < 1) index = 0;
    else if (pct < 5) index = 1;
    else if (pct < 10) index = 2;
    else if (pct < 20) index = 3;
    else index = 4;
    return { index, confidence: "high", raw: { actual, estimate, pct: +pct.toFixed(1) } };
  } catch (e) { return { index: null, confidence: "low", raw: null }; }
}

export function scoreRevisionLevel(data) {
  try {
    const history = data && data.upgradeDowngradeHistory && data.upgradeDowngradeHistory.history;
    if (!history || !history.length) return { index: null, confidence: "low", raw: null };
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const recent = history.filter(function(h) {
      const ts = safe(h && h.epochGradeDate);
      return ts && ts * 1000 > cutoff;
    });
    if (!recent.length) return { index: null, confidence: "low", raw: null };
    const UP = ["upgrade", "initiated", "reiterated", "buy", "overweight", "outperform", "strong buy"];
    const DOWN = ["downgrade", "underweight", "underperform", "sell", "reduce"];
    let ups = 0, downs = 0;
    recent.forEach(function(h) {
      const action = ((h && h.action) || "").toLowerCase();
      const grade = ((h && h.toGrade) || "").toLowerCase();
      if (UP.some(function(u) { return action.includes(u) || grade.includes(u); })) ups++;
      else if (DOWN.some(function(d) { return action.includes(d) || grade.includes(d); })) downs++;
    });
    const total = ups + downs;
    if (total === 0) return { index: 1, confidence: "low", raw: { ups: 0, downs: 0 } };
    const ratio = ups / total;
    let index;
    if (ratio < 0.2) index = 0;
    else if (ratio < 0.4) index = 1;
    else if (ratio < 0.6) index = 2;
    else if (ratio < 0.8) index = 3;
    else index = 4;
    return { index, confidence: total >= 5 ? "medium" : "low", raw: { ups, downs, total, ratio: +ratio.toFixed(2) } };
  } catch (e) { return { index: null, confidence: "low", raw: null }; }
}

export function scoreRevisionVelocity(data) {
  try {
    const trends = data && data.earningsTrend && data.earningsTrend.trend;
    if (!trends || !trends.length) return { index: null, confidence: "low", raw: null };
    const curQ = trends.find(function(t) { return t && t.period === "0q"; }) || trends[0];
    const growth = safe(curQ && curQ.earningsEstimate && curQ.earningsEstimate.growth);
    if (growth !== null) {
      let index;
      if (growth < -0.05) index = 0;
      else if (growth < 0.01) index = 1;
      else if (growth < 0.05) index = 2;
      else if (growth < 0.12) index = 3;
      else index = 4;
      return { index, confidence: "medium", raw: { growth: +(growth * 100).toFixed(1) + "%" } };
    }
    return { index: null, confidence: "low", raw: null };
  } catch (e) { return { index: null, confidence: "low", raw: null }; }
}

export function scoreValuation(data) {
  try {
    const fwdPE = safe(data && data.summaryDetail && data.summaryDetail.forwardPE) ||
                  safe(data && data.defaultKeyStatistics && data.defaultKeyStatistics.forwardPE);
    const sector = safeStr(data && data.assetProfile && data.assetProfile.sector) || "Unknown";
    const sectorMedian = SECTOR_FWD_PE[sector] || SECTOR_FWD_PE["Unknown"];
    if (fwdPE === null || fwdPE <= 0) return { index: null, confidence: "low", raw: { fwdPE, sector } };
    const ratio = fwdPE / sectorMedian;
    let index;
    if (ratio > 1.20) index = 0;
    else if (ratio > 0.95) index = 1;
    else if (ratio > 0.85) index = 2;
    else if (ratio > 0.70) index = 3;
    else index = 4;
    return { index, confidence: "high", raw: { fwdPE: +fwdPE.toFixed(1), sectorMedian, ratio: +ratio.toFixed(2), sector } };
  } catch (e) { return { index: null, confidence: "low", raw: null }; }
}

export function scoreRevenueMomentum(data) {
  try {
    const growth = safe(data && data.financialData && data.financialData.revenueGrowth);
    if (growth === null) return { index: null, confidence: "low", raw: null };
    let index;
    if (growth < 0) index = 0;
    else if (growth < 0.01) index = 1;
    else if (growth < 0.05) index = 2;
    else if (growth < 0.10) index = 3;
    else index = 4;
    return { index, confidence: "high", raw: { revenueGrowth: +(growth * 100).toFixed(1) + "%" } };
  } catch (e) { return { index: null, confidence: "low", raw: null }; }
}

export function scoreEpsInflection(data) {
  try {
    const trends = data && data.earningsTrend && data.earningsTrend.trend;
    if (!trends || !trends.length) return { index: null, confidence: "low", raw: null };
    const thisYr = trends.find(function(t) { return t && t.period === "0y"; });
    const nextYr = trends.find(function(t) { return t && t.period === "+1y"; });
    const thisG = safe(thisYr && thisYr.earningsEstimate && thisYr.earningsEstimate.growth);
    const nextG = safe(nextYr && nextYr.earningsEstimate && nextYr.earningsEstimate.growth);
    if (thisG === null && nextG === null) return { index: null, confidence: "low", raw: null };
    const t = thisG !== null ? thisG : 0;
    const n = nextG !== null ? nextG : 0;
    let index;
    if (t < 0 && n < 0) index = 0;
    else if (t < 0.02 && n < 0.02) index = 1;
    else if (t >= 0.02 && n >= 0.02 && n < 0.15) index = 2;
    else if (t < 0.05 && n >= 0.15) index = 3;
    else index = 4;
    return { index, confidence: "medium", raw: { thisYrGrowth: thisG !== null ? +(thisG * 100).toFixed(1) + "%" : null, nextYrGrowth: nextG !== null ? +(nextG * 100).toFixed(1) + "%" : null } };
  } catch (e) { return { index: null, confidence: "low", raw: null }; }
}

export function scoreCatalystProximity(data) {
  try {
    const dates = data && data.calendarEvents && data.calendarEvents.earnings && data.calendarEvents.earnings.earningsDate;
    if (!dates || !dates.length) return { index: null, confidence: "low", raw: null };
    const futureDates = dates
      .map(function(d) { return { days: daysFromNow(safe(d)), raw: safe(d) }; })
      .filter(function(d) { return d.days !== null && d.days > -10; })
      .sort(function(a, b) { return a.days - b.days; });
    if (!futureDates.length) return { index: 0, confidence: "medium", raw: { note: "No upcoming earnings found" } };
    const days = futureDates[0].days;
    let index;
    if (days > 120) index = 1;
    else if (days > 90) index = 2;
    else if (days > 60) index = 3;
    else index = 4;
    return { index, confidence: "high", raw: { daysToEarnings: days } };
  } catch (e) { return { index: null, confidence: "low", raw: null }; }
}

export function scoreTrendHealth(data) {
  try {
    const price = safe(data && data.financialData && data.financialData.currentPrice) ||
                  safe(data && data.summaryDetail && data.summaryDetail.regularMarketPrice);
    const ma200 = safe(data && data.summaryDetail && data.summaryDetail.twoHundredDayAverage);
    const low52 = safe(data && data.summaryDetail && data.summaryDetail.fiftyTwoWeekLow);
    const high52 = safe(data && data.summaryDetail && data.summaryDetail.fiftyTwoWeekHigh);
    if (price === null || ma200 === null) return { index: null, confidence: "low", raw: null };
    const above200 = price > ma200;
    const range52 = high52 && low52 ? (price - low52) / (high52 - low52) : null;
    let index;
    if (!above200 && (range52 === null || range52 < 0.3)) index = 0;
    else if (!above200) index = 1;
    else if (above200 && range52 !== null && range52 < 0.5) index = 2;
    else if (above200 && range52 !== null && range52 < 0.75) index = 3;
    else index = 4;
    return { index, confidence: "medium", raw: { price: +price.toFixed(2), ma200: +ma200.toFixed(2), above200, range52wk: range52 !== null ? +(range52 * 100).toFixed(0) + "%" : null } };
  } catch (e) { return { index: null, confidence: "low", raw: null }; }
}

export function scoreAccumulation(data) {
  try {
    const vol10d = safe(data && data.summaryDetail && data.summaryDetail.averageVolume10days);
    const vol90d = safe(data && data.summaryDetail && data.summaryDetail.averageVolume);
    const price = safe(data && data.financialData && data.financialData.currentPrice);
    const ma50 = safe(data && data.summaryDetail && data.summaryDetail.fiftyDayAverage);
    if (!vol10d || !vol90d) return { index: null, confidence: "low", raw: null };
    const volRatio = vol10d / vol90d;
    const priceAboveMa50 = price !== null && ma50 !== null ? price > ma50 : null;
    let index;
    if (volRatio > 1.3 && priceAboveMa50 === false) index = 0;
    else if (volRatio < 0.8) index = 1;
    else if (volRatio >= 0.8 && volRatio < 1.1) index = 2;
    else if (volRatio >= 1.1 && priceAboveMa50) index = 3;
    else index = 2;
    return { index, confidence: "low", raw: { volRatio: +volRatio.toFixed(2), priceAboveMa50 } };
  } catch (e) { return { index: null, confidence: "low", raw: null }; }
}

export function scoreBalanceSheet(data) {
  try {
    const debt = safe(data && data.financialData && data.financialData.totalDebt);
    const cash = safe(data && data.financialData && data.financialData.totalCash);
    const ebitda = safe(data && data.financialData && data.financialData.ebitda);
    if (debt === null || cash === null) return { index: null, confidence: "low", raw: null };
    const netDebt = debt - cash;
    if (netDebt <= 0) return { index: 4, confidence: "high", raw: { netDebt: +(netDebt / 1e9).toFixed(2) + "B", leverage: "net cash" } };
    if (!ebitda || ebitda <= 0) return { index: null, confidence: "low", raw: { netDebt: +(netDebt / 1e9).toFixed(2) + "B" } };
    const leverage = netDebt / ebitda;
    let index;
    if (leverage > 5) index = 0;
    else if (leverage > 3) index = 1;
    else if (leverage > 1.5) index = 2;
    else index = 3;
    return { index, confidence: "high", raw: { netDebt: +(netDebt / 1e9).toFixed(2) + "B", ebitda: +(ebitda / 1e9).toFixed(2) + "B", leverage: +leverage.toFixed(2) + "x" } };
  } catch (e) { return { index: null, confidence: "low", raw: null }; }
}

export function scoreMacroSensitivity(data) {
  try {
    const sector = safeStr(data && data.assetProfile && data.assetProfile.sector) || "Unknown";
    const index = SECTOR_MACRO[sector] !== undefined ? SECTOR_MACRO[sector] : SECTOR_MACRO["Unknown"];
    return { index, confidence: "low", raw: { sector } };
  } catch (e) { return { index: null, confidence: "low", raw: null }; }
}

// ─── FMP INTERPRETER ──────────────────────────────────────────────────────────

function fmpEpsSurprise(fmpData) {
  try {
    const surprises = fmpData && fmpData.earningsSurprises;
    if (!Array.isArray(surprises) || !surprises.length) return { index: null, confidence: "low", raw: null };
    const recent = surprises[0];
    const pct = recent && (recent.surprisePercentage !== undefined ? recent.surprisePercentage : recent.surprise_percentage);
    if (pct === null || pct === undefined) return { index: null, confidence: "low", raw: null };
    const p = Number(pct);
    if (isNaN(p)) return { index: null, confidence: "low", raw: null };
    let index;
    if (p >= 15) index = 4;
    else if (p >= 7) index = 3;
    else if (p >= -3) index = 2;
    else if (p >= -10) index = 1;
    else index = 0;
    return { index, confidence: 0.7, raw: { surprisePct: +p.toFixed(2) + "%", actual: (recent && recent.actualEarningResult) || null, estimate: (recent && recent.estimatedEarning) || null, period: (recent && recent.date) || null } };
  } catch (e) { return { index: null, confidence: "low", raw: null }; }
}

function fmpValuation(fmpData) {
  try {
    const quote = fmpData && fmpData.quote && fmpData.quote[0];
    const profile = fmpData && fmpData.profile && fmpData.profile[0];
    const pe = quote && (quote.pe !== undefined ? quote.pe : quote.priceEarningsRatio);
    if (pe === null || pe === undefined) return { index: null, confidence: "low", raw: { pe: null } };
    const peNum = Number(pe);
    if (isNaN(peNum) || peNum <= 0) return { index: null, confidence: "low", raw: { pe: peNum } };
    const sector = ((profile && profile.sector) || "Unknown").trim();
    const sectorMedian = SECTOR_FWD_PE[sector] || SECTOR_FWD_PE["Unknown"];
    const ratio = peNum / sectorMedian;
    let index;
    if (ratio > 1.20) index = 0;
    else if (ratio > 0.95) index = 1;
    else if (ratio > 0.85) index = 2;
    else if (ratio > 0.70) index = 3;
    else index = 4;
    return { index, confidence: 0.6, raw: { pe: +peNum.toFixed(1), sectorMedian, ratio: +ratio.toFixed(2), sector } };
  } catch (e) { return { index: null, confidence: "low", raw: null }; }
}

function fmpCompanyName(fmpData) {
  try {
    const profile = fmpData && fmpData.profile && fmpData.profile[0];
    const name = (profile && (profile.companyName || profile.name)) || null;
    if (!name) return { index: null, confidence: 1, raw: null };
    return { index: null, confidence: 1, raw: { companyName: name } };
  } catch (e) { return { index: null, confidence: 1, raw: null }; }
}

export function interpretFmpData(fmpData) {
  return {
    eps_surprise: fmpEpsSurprise(fmpData),
    valuation:    fmpValuation(fmpData),
    company_name: fmpCompanyName(fmpData),
  };
}

export function interpretYahooData(yahooData) {
  return {
    eps_surprise:       scoreEpsSurprise(yahooData),
    revisions:          scoreRevisionLevel(yahooData),
    revision_velocity:  scoreRevisionVelocity(yahooData),
    valuation:          scoreValuation(yahooData),
    revenue_momentum:   scoreRevenueMomentum(yahooData),
    eps_inflection:     scoreEpsInflection(yahooData),
    catalyst_proximity: scoreCatalystProximity(yahooData),
    chart_trend:        scoreTrendHealth(yahooData),
    accumulation:       scoreAccumulation(yahooData),
    balance_sheet:      scoreBalanceSheet(yahooData),
    macro_sensitivity:  scoreMacroSensitivity(yahooData),
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
