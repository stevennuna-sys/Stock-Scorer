"use client";
import React, { useState, useCallback } from "react";

/*
SCORING FORMULA
Final = CoreScore * (0.75 + timingRaw / 80) - RiskDeduction
CoreScore:     0-80  (7 fundamental factors, normalized)
timingRaw:     0-20  (raw timing points, used directly in multiplier)
RiskDeduction: 0-15  (convex penalties)
Confidence:    f(score, completeness)
*/

const CORE_FACTORS = [
  {
    id: "eps_surprise",
    label: "EPS Surprise Magnitude",
    description: "Beat vs consensus estimate last quarter",
    weight: 20,
    anchors: ["Miss / in-line < 1%", "Small beat 1-5%", "Solid beat 5-10%", "Strong beat 10-20%", "Blowout > 20%"],
    scores: [0, 4, 10, 16, 20],
  },
  {
    id: "revisions",
    label: "Estimate Revision Level",
    description: "Direction of analyst EPS changes, last 90 days",
    weight: 16,
    anchors: ["Mostly downward", "Mixed / flat", "More up than down", "Majority upward", "All up, zero down"],
    scores: [0, 3, 8, 13, 16],
  },
  {
    id: "revision_velocity",
    label: "Revision Acceleration",
    description: "Speed of revision change, velocity predicts momentum",
    weight: 6,
    anchors: ["Decelerating / reversing", "Flat, no acceleration", "Modest pick-up", "Clearly accelerating", "Rapid acceleration post-beat"],
    scores: [0, 1, 3, 5, 6],
  },
  {
    id: "sector_tailwind",
    label: "Sector Tailwind",
    description: "Industry revisions, rate cycle, commodity / spend trajectory",
    weight: 14,
    anchors: ["Sector headwind", "Neutral", "Modest tailwind", "Strong structural cycle", "Dominant cycle (hard market / AI / defense)"],
    scores: [0, 3, 7, 11, 14],
  },
  {
    id: "valuation",
    label: "Relative Valuation",
    description: "Forward P/E vs sector median, nonlinear scoring",
    weight: 12,
    note: "Deep discount capped, verify not a value trap",
    anchors: ["Premium > 20% above sector", "In-line with sector", "Modest discount 5-15%", "Meaningful discount 15-30%", "Deep discount > 30%"],
    scores: [0, 4, 12, 10, 7],
  },
  {
    id: "revenue_momentum",
    label: "Revenue Acceleration",
    description: "Beat quality, real top-line growth, not just cost cuts",
    weight: 6,
    anchors: ["Revenue declining", "Flat QoQ", "Growing 1-5% QoQ", "Growing 5-10% QoQ", "Accelerating > 10% QoQ"],
    scores: [0, 1, 3, 5, 6],
  },
  {
    id: "eps_inflection",
    label: "EPS Inflection Profile",
    description: "Flat this year / exploding next = turnaround asymmetry",
    weight: 6,
    anchors: ["Both years declining", "Flat both years", "Moderate growth both", "Flat this yr / strong next (inflection)", "Strong this yr + accelerating next"],
    scores: [0, 1, 3, 6, 6],
  },
];

const TIMING_FACTORS = [
  {
    id: "catalyst_proximity",
    label: "Catalyst Proximity",
    description: "Specific event within 120 days, earnings, investor day, acquisition close",
    weight: 12,
    anchors: ["No catalyst identified", "Vague / > 120 days", "Earnings 90-120 days", "Earnings + conference 60-90 days", "Hard catalyst < 60 days"],
    scores: [0, 2, 6, 9, 12],
  },
  {
    id: "chart_trend",
    label: "Trend Health",
    description: "Price vs 200-day MA + relative strength vs SPY",
    weight: 4,
    anchors: [
      "Below 200-day, underperforming SPY badly",
      "Below 200-day but resilient",
      "Above 200-day, lagging SPY",
      "Above 200-day, flat vs SPY (resilience)",
      "Above 200-day, breaking out vs SPY",
    ],
    scores: [0, 1, 2, 3, 4],
  },
  {
    id: "accumulation",
    label: "Accumulation Pattern",
    description: "Volume behavior, institutional buying precedes moves",
    weight: 4,
    anchors: ["Distribution: high vol, price falling", "Neutral / no pattern", "Quiet accumulation", "Above-avg vol, price holding base", "Clear accumulation: vol surge + base breakout"],
    scores: [0, 1, 2, 3, 4],
  },
];

const RISK_FACTORS = [
  {
    id: "binary_risk",
    label: "Binary Event Risk",
    description: "FDA ruling, DOJ action, regulatory decision with +/-30% move potential",
    weight: 5,
    anchors: ["Major binary pending, thesis-ending risk", "Significant event risk", "Some regulatory exposure", "Minimal event risk", "No binary risk"],
    penalties: [5, 3, 1, 0, 0],
  },
  {
    id: "balance_sheet",
    label: "Balance Sheet Stress",
    description: "Leverage, debt maturity, covenant risk",
    weight: 4,
    anchors: ["Near-distress / covenant breach risk", "Elevated leverage, limited headroom", "Moderate leverage, manageable", "Clean balance sheet", "Net cash position"],
    penalties: [4, 2, 1, 0, 0],
  },
  {
    id: "thesis_risk",
    label: "Thesis Integrity",
    description: "How likely is the core thesis to hold for 3-6 months?",
    weight: 4,
    anchors: ["Thesis actively undermined by new data", "Significant uncertainty", "Some noise, core intact", "Thesis well-supported", "Thesis confirmed and accelerating"],
    penalties: [4, 2, 1, 0, 0],
  },
  {
    id: "macro_sensitivity",
    label: "Macro Sensitivity",
    description: "Exposure to credit cycle, commodity, rate shock, tariffs",
    weight: 2,
    anchors: ["Highly exposed, thesis breaks in downturn", "Significant macro sensitivity", "Moderate exposure", "Defensive characteristics", "Counter-cyclical / macro-neutral"],
    penalties: [2, 1, 0, 0, 0],
  },
];

const FLOW_FACTOR = {
  id: "institutional_flow",
  label: "Institutional Flow",
  description: "Long-only initiation + multi-strat accumulation post-beat",
  anchors: ["Net selling / exiting", "No significant change", "Some long-only initiation", "Multiple quality funds entering", "Long-only + multi-strat both accumulating"],
  scores: [0, 2, 5, 8, 11],
  max: 11,
};

const IV_FACTOR = {
  id: "iv_environment",
  label: "IV Environment",
  description: "Call buying attractiveness, low IV post-beat is optimal",
  anchors: ["IV elevated pre-earnings (favor stock)", "IV moderate / neutral", "IV collapsed post-beat (calls cheap)", "IV near 52-wk low + catalyst ahead", "N/A, stock only"],
  scores: [0, 1, 2, 2, 1],
};

const CORE_MAX = CORE_FACTORS.reduce((s, f) => s + f.weight, 0);
const TIMING_MAX = TIMING_FACTORS.reduce((s, f) => s + f.weight, 0);

function clampIdx(val, arr) {
  if (val === null || val === undefined) return null;
  return Math.max(0, Math.min(arr.length - 1, Math.round(Number(val))));
}

function computeScores(values) {
  let coreRaw = 0;
  let timingRaw = 0;
  let riskPenalty = 0;

  CORE_FACTORS.forEach((f) => {
    const idx = clampIdx(values[f.id], f.scores);
    if (idx !== null) coreRaw += f.scores[idx];
  });

  TIMING_FACTORS.forEach((f) => {
    const idx = clampIdx(values[f.id], f.scores);
    if (idx !== null) timingRaw += f.scores[idx];
  });

  RISK_FACTORS.forEach((f) => {
    const idx = clampIdx(values[f.id], f.penalties);
    if (idx !== null) riskPenalty += f.penalties[idx];
  });

  const flowIdx = clampIdx(values[FLOW_FACTOR.id], FLOW_FACTOR.scores);
  const flowScore = flowIdx !== null ? FLOW_FACTOR.scores[flowIdx] : null;

  const coreScore = Math.round((coreRaw / CORE_MAX) * 80);
  const timingScore = Math.round((timingRaw / TIMING_MAX) * 20);
  const riskDeduct = Math.min(15, riskPenalty);

  const timingMultiplier = 0.75 + timingRaw / 80;
  const preRisk = coreScore * timingMultiplier;
  const final = Math.max(0, Math.min(100, Math.round(preRisk - riskDeduct)));

  return {
    coreScore,
    timingScore,
    timingRaw,
    timingMultiplier,
    riskDeduct,
    final,
    coreRaw,
    riskPenalty,
    flowScore,
  };
}

function getConfidence(score, completePct) {
  const adjusted = score * (0.5 + completePct / 200);
  if (adjusted >= 70 && completePct >= 80) return { label: "HIGH", color: "#00ff88" };
  if (adjusted >= 55 && completePct >= 60) return { label: "MODERATE", color: "#ffd700" };
  if (completePct < 50) return { label: "INCOMPLETE, score unreliable", color: "#ff9544" };
  return { label: "LOW", color: "#ff4466" };
}

function getSignal(score) {
  if (score >= 78) return { label: "STRONG BUY", color: "#00ff88", bg: "rgba(0,255,136,0.07)", tier: "A" };
  if (score >= 65) return { label: "BUY", color: "#7dff6b", bg: "rgba(125,255,107,0.06)", tier: "B" };
  if (score >= 50) return { label: "WATCH", color: "#ffd700", bg: "rgba(255,215,0,0.06)", tier: "C" };
  if (score >= 35) return { label: "WEAK", color: "#ff9544", bg: "rgba(255,149,68,0.06)", tier: "D" };
  return { label: "NO SIGNAL", color: "#ff4466", bg: "rgba(255,68,102,0.06)", tier: "F" };
}

function getTradeStructure(scores, values) {
  const { final, coreScore, timingScore, riskDeduct, flowScore } = scores;

  const ivIdx = clampIdx(values[IV_FACTOR.id], IV_FACTOR.scores);

  const catFactor = TIMING_FACTORS.find((f) => f.id === "catalyst_proximity");
  const catIdx = catFactor ? clampIdx(values["catalyst_proximity"], catFactor.scores) : null;

  const ivLow = ivIdx !== null && (ivIdx === 2 || ivIdx === 3);
  const ivModerate = ivIdx === 1;
  const ivHigh = ivIdx === 0;

  const catStrong = catIdx !== null && catIdx >= 3;

  const flowHigh = flowScore !== null && flowScore >= 8;
  const flowWeak = flowScore !== null && flowScore <= 2;

  if (final < 35) {
    return {
      action: "PASS",
      color: "#ff4466",
      reason: "Score below minimum threshold.",
      detail: "No capital deployment. Revisit if revisions accelerate or catalyst clarifies.",
    };
  }

  if (final < 50) {
    return {
      action: "WATCHLIST",
      color: "#ff9544",
      reason: "Insufficient signal quality for entry.",
      detail: "Add to watch list. Enter only on revision acceleration or cleaner timing setup.",
    };
  }

  if (riskDeduct >= 8) {
    return {
      action: "STOCK, HALF SIZE",
      color: "#ffd700",
      reason: "Risk penalty too high for full commitment.",
      detail: "Material binary or thesis risk present. Stock preferred over options. Size at 50% normal. Reassess after risk event resolves.",
    };
  }

  if (ivLow && catStrong && final >= 65) {
    if (flowHigh) {
      return {
        action: "BUY CALLS, FULL CONVICTION",
        color: "#00ff88",
        reason: "IV cheap + catalyst < 90 days + institutional accumulation confirmed.",
        detail: "Target 60-90 day expiry, delta 0.35-0.50. Naked call if blowout beat + deep discount. Spread if modest discount.",
      };
    }
    if (flowWeak) {
      return {
        action: "STOCK + SMALL CALLS",
        color: "#7dff6b",
        reason: "IV cheap + catalyst near, but flow not confirming.",
        detail: "Primary position in stock. Small call position for leverage. Monitor filings and dark pool volume for accumulation confirmation.",
      };
    }
    return {
      action: "BUY CALLS",
      color: "#00ff88",
      reason: "IV cheap post-beat + catalyst < 90 days.",
      detail: "Target 60-90 day expiry, delta 0.30-0.45. Spread if modest valuation discount; naked call if blowout beat.",
    };
  }

  if ((ivLow || ivModerate) && !catStrong && final >= 65 && riskDeduct < 6) {
    if (flowHigh) {
      return {
        action: "BUY 120-210 DTE CALLS, FULL CONVICTION",
        color: "#00ff88",
        reason: "IV reasonable + institutional accumulation confirmed + runway.",
        detail: "Target delta 0.35-0.50. Two earnings cycles. Spread reduces cost; naked call if conviction is high and discount is deep.",
      };
    }
    return {
      action: "BUY 120-210 DTE CALLS",
      color: "#7dff6b",
      reason: "IV reasonable, catalyst further out, longer expiry fits.",
      detail: "Target delta 0.35-0.50. Consider a bull call spread. If IV rank is high, reduce size or wait.",
    };
  }

  if (ivLow && !catStrong && final >= 65) {
    if (flowHigh) {
      return {
        action: "BUY LEAPS, FULL CONVICTION",
        color: "#7dff6b",
        reason: "IV cheap + institutional accumulation confirmed, catalyst later.",
        detail: "January or later expiry. Delta 0.40-0.50. Thesis needs runway.",
      };
    }
    return {
      action: "BUY LEAPS",
      color: "#7dff6b",
      reason: "IV cheap but catalyst later, extend expiry.",
      detail: "January or later expiry. Avoid short-dated calls. Delta 0.40-0.50 to survive slow re-rating.",
    };
  }

  if (ivHigh) {
    return {
      action: "STOCK NOW, CALLS AFTER EARNINGS",
      color: "#ffd700",
      reason: "IV elevated pre-earnings, options expensive.",
      detail: "Buy stock today. If earnings beat occurs and IV collapses, rotate into calls after earnings.",
    };
  }

  if (coreScore >= 60 && timingScore >= 14) {
    if (flowHigh) {
      return {
        action: "STOCK, FULL SIZE + OVERWEIGHT",
        color: "#00ff88",
        reason: "Core + timing strong + institutional accumulation confirmed.",
        detail: "Full position. Consider adding on pre-catalyst weakness.",
      };
    }
    return {
      action: "STOCK, FULL SIZE",
      color: "#00ff88",
      reason: "Core + timing both strong.",
      detail: "Standard full position. Add on weakness. Review after next earnings report.",
    };
  }

  if (coreScore >= 60 && timingScore < 10) {
    return {
      action: "STOCK, SCALE IN",
      color: "#7dff6b",
      reason: "Quality high, timing early.",
      detail: "Build in thirds over 4-6 weeks. Add on dips or revision acceleration.",
    };
  }

  return {
    action: "STOCK",
    color: "#7dff6b",
    reason: "Balanced signal across core and timing.",
    detail: "Standard entry. Monitor revision velocity weekly. Add if acceleration continues into catalyst window.",
  };
}

function getNarrative(values) {
  const velFactor = CORE_FACTORS.find((f) => f.id === "revision_velocity");
  const velIdx = velFactor ? clampIdx(values["revision_velocity"], velFactor.scores) : null;

  const sorted = CORE_FACTORS
    .map((f) => {
      const idx = clampIdx(values[f.id], f.scores);
      return { ...f, rawScore: idx !== null ? f.scores[idx] : 0, pct: idx !== null ? f.scores[idx] / f.weight : 0 };
    })
    .filter((f) => f.rawScore > 0)
    .sort((a, b) => b.pct - a.pct);

  const drivers = sorted.slice(0, 2).map((f) => f.label.toLowerCase());

  const risks = RISK_FACTORS
    .filter((f) => {
      const idx = clampIdx(values[f.id], f.penalties);
      return idx !== null && f.penalties[idx] >= 2;
    })
    .map((f) => f.label.toLowerCase());

  const velocityAlert = velIdx !== null && velIdx >= 3 ? "Revision velocity accelerating, momentum building" : null;

  return {
    primaryDriver: drivers.length > 0 ? drivers.join(" + ") : "insufficient data",
    keyRisk: risks.length > 0 ? risks[0] : "no material flags",
    allRisks: risks,
    velocityAlert,
  };
}

const PRESETS = {
  NA: {
    name: "National Bank (NA.TO)  Feb 2026",
    values: {
      eps_surprise: 3,
      revisions: 4,
      revision_velocity: 3,
      sector_tailwind: 3,
      valuation: 3,
      revenue_momentum: 3,
      eps_inflection: 3,
      catalyst_proximity: 3,
      chart_trend: 3,
      accumulation: 3,
      binary_risk: 4,
      balance_sheet: 3,
      thesis_risk: 4,
      macro_sensitivity: 2,
      institutional_flow: 3,
      iv_environment: 4,
    },
  },
  ALL: {
    name: "Allstate (ALL)  Feb 2026",
    values: {
      eps_surprise: 4,
      revisions: 4,
      revision_velocity: 4,
      sector_tailwind: 4,
      valuation: 3,
      revenue_momentum: 3,
      eps_inflection: 4,
      catalyst_proximity: 3,
      chart_trend: 2,
      accumulation: 2,
      binary_risk: 3,
      balance_sheet: 3,
      thesis_risk: 4,
      macro_sensitivity: 2,
      institutional_flow: 2,
      iv_environment: 2,
    },
  },
  COF: {
    name: "Capital One (COF)  Feb 2026",
    values: {
      eps_surprise: 3,
      revisions: 3,
      revision_velocity: 2,
      sector_tailwind: 2,
      valuation: 4,
      revenue_momentum: 3,
      eps_inflection: 3,
      catalyst_proximity: 3,
      chart_trend: 1,
      accumulation: 1,
      binary_risk: 3,
      balance_sheet: 2,
      thesis_risk: 3,
      macro_sensitivity: 1,
      institutional_flow: 2,
      iv_environment: 1,
    },
  },
};

const defaultValues = () => ({
  ...Object.fromEntries(CORE_FACTORS.map((f) => [f.id, null])),
  ...Object.fromEntries(TIMING_FACTORS.map((f) => [f.id, null])),
  ...Object.fromEntries(RISK_FACTORS.map((f) => [f.id, null])),
  institutional_flow: null,
  iv_environment: null,
});

const C = {
  core: "#7c6af7",
  timing: "#00d4ff",
  risk: "#ff4466",
  flow: "#ff9800",
  iv: "#a78bfa",
};

function ScoreDial({ score, signal, size }) {
  const s = size || 120;
  const r = s * 0.37;
  const cx = s / 2;
  const cy = s / 2;
  const circ = 2 * Math.PI * r;

  return (
    <div style={{ position: "relative", width: s, height: s, flexShrink: 0 }}>
      <svg width={s} height={s} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#131520" strokeWidth={s * 0.075} />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={signal.color}
          strokeWidth={s * 0.075}
          strokeDasharray={`${(score / 100) * circ} ${circ}`}
          strokeLinecap="round"
          style={{
            transition: "stroke-dasharray 0.7s cubic-bezier(.4,0,.2,1)",
            filter: `drop-shadow(0 0 5px ${signal.color}55)`,
          }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: s * 0.26, fontWeight: 800, color: signal.color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: s * 0.08, color: "#334155", fontFamily: "'DM Mono', monospace" }}>/100</span>
      </div>
    </div>
  );
}

function MiniDial({ score, color, size }) {
  const s = size || 36;
  const r = s * 0.36;
  const cx = s / 2;
  const cy = s / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(Math.max(score / 100, 0), 1);

  return (
    <div style={{ position: "relative", width: s, height: s }}>
      <svg width={s} height={s} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={s * 0.1} />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={s * 0.1}
          strokeDasharray={`${pct * circ} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.5s" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: s * 0.28, fontWeight: 800, color, fontFamily: "'DM Mono', monospace" }}>{score}</span>
      </div>
    </div>
  );
}

function FormulaBar({ coreScore, timingRaw, timingMultiplier, riskDeduct, final }) {
  const preRisk = Math.round(coreScore * timingMultiplier);
  const barRest = Math.max(0, 100 - (coreScore + timingRaw + riskDeduct));

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 8, color: "#334155", letterSpacing: 2, marginBottom: 6, fontFamily: "'DM Mono', monospace" }}>FORMULA</div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>
        <span style={{ color: C.core, fontWeight: 700 }}>{coreScore}</span>
        <span style={{ color: "#334155" }}>x</span>
        <span style={{ color: C.timing }}>{`(0.75 + ${timingRaw}/80)`}</span>
        <span style={{ color: "#475569" }}>{`= ${preRisk}`}</span>
        <span style={{ color: "#334155" }}>-</span>
        <span style={{ color: C.risk }}>{riskDeduct}</span>
        <span style={{ color: "#334155" }}>=</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#e2e8f0" }}>{final}</span>
      </div>

      <div style={{ marginTop: 7, height: 3, background: "#1e293b", borderRadius: 2, overflow: "hidden", display: "flex", gap: 1 }}>
        <div style={{ flex: coreScore, background: C.core, transition: "flex 0.5s" }} />
        <div style={{ flex: timingRaw, background: C.timing, transition: "flex 0.5s" }} />
        <div style={{ flex: riskDeduct, background: C.risk, transition: "flex 0.5s" }} />
        <div style={{ flex: barRest, background: "#0d0f1a" }} />
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 5 }}>
        {[
          { label: "Core", val: coreScore, max: 80, color: C.core },
          { label: "timingRaw", val: timingRaw, max: 20, color: C.timing },
          { label: "Risk -", val: riskDeduct, max: 15, color: C.risk },
        ].map((x) => (
          <div key={x.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: x.color }} />
            <span style={{ fontSize: 9, color: "#334155", fontFamily: "'DM Mono', monospace" }}>
              {x.label}:{" "}
              <span style={{ color: x.color, fontWeight: 700 }}>{x.label === "Risk -" ? `-${x.val}` : x.val}</span>
              <span style={{ color: "#1e293b" }}>{`/${x.max}`}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FactorRow({ factor, value, onChange, type }) {
  const color = C[type] || C.core;
  const isRisk = type === "risk";
  const arr = isRisk ? factor.penalties : factor.scores;
  const idx = clampIdx(value, arr);
  const score = idx !== null ? arr[idx] : null;
  const maxVal = Math.max(...arr);
  const pct = score !== null && maxVal > 0 ? (score / maxVal) * 100 : 0;

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.015)",
        border: `1px solid ${value !== null ? color + "1f" : "rgba(255,255,255,0.04)"}`,
        borderRadius: 8,
        padding: "11px 13px",
        transition: "border-color 0.2s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = color + "44";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = value !== null ? color + "1f" : "rgba(255,255,255,0.04)";
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{factor.label}</span>
          {factor.note && <span style={{ fontSize: 9, color: "#334155", marginLeft: 5, fontStyle: "italic" }}>{`i ${factor.note}`}</span>}
          <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>{factor.description}</div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, marginLeft: 8, color: score !== null ? color : "#1e293b", fontFamily: "'DM Mono', monospace" }}>
          {score !== null ? (isRisk ? `-${score}` : `+${score}`) : "n/a"}
        </span>
      </div>

      <div style={{ height: 2, background: "#1e293b", borderRadius: 1, marginBottom: 7, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: pct + "%",
            borderRadius: 1,
            background: isRisk ? (pct > 60 ? C.risk : "#ff944866") : pct > 75 ? "#00ff88" : pct > 40 ? color : color + "88",
            transition: "width 0.4s cubic-bezier(.4,0,.2,1)",
          }}
        />
      </div>

      <select
        value={value !== null ? value : ""}
        onChange={(e) => onChange(factor.id, e.target.value === "" ? null : Number(e.target.value))}
        style={{
          width: "100%",
          background: "#080910",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 5,
          padding: "6px 24px 6px 8px",
          color: value !== null ? "#e2e8f0" : "#334155",
          fontSize: 11,
          cursor: "pointer",
          outline: "none",
          appearance: "none",
          fontFamily: "'DM Sans', sans-serif",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%23334155'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 8px center",
        }}
      >
        <option value="">Select...</option>
        {factor.anchors.map((a, i) => (
          <option key={i} value={i}>
            {a}
          </option>
        ))}
      </select>
    </div>
  );
}

function CandidateRow({ name, final, isActive, onClick }) {
  const sig = getSignal(final);
  return (
    <button
      onClick={onClick}
      style={{
        background: isActive ? sig.bg : "transparent",
        border: `1px solid ${isActive ? sig.color + "33" : "rgba(255,255,255,0.04)"}`,
        borderRadius: 7,
        padding: "8px 10px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        transition: "all 0.15s",
        textAlign: "left",
      }}
    >
      <MiniDial score={final} color={sig.color} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? "#e2e8f0" : "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        <div style={{ fontSize: 9, color: sig.color, fontFamily: "'DM Mono', monospace" }}>{sig.label}</div>
      </div>
    </button>
  );
}

export default function StockScorerV32() {
  const [stocks, setStocks] = useState({
    s1: { name: "National Bank (NA.TO)", values: { ...PRESETS.NA.values } },
    s2: { name: "Allstate (ALL)", values: { ...PRESETS.ALL.values } },
    s3: { name: "Capital One (COF)", values: { ...PRESETS.COF.values } },
  });

  const [active, setActive] = useState("s1");
  const [tab, setTab] = useState("core");
  const [editName, setEditName] = useState(false);

  const update = useCallback(
    (id, val) => {
      setStocks((p) => ({ ...p, [active]: { ...p[active], values: { ...p[active].values, [id]: val } } }));
    },
    [active]
  );

  const addStock = () => {
    const id = "s" + Date.now();
    setStocks((p) => ({ ...p, [id]: { name: "New Stock", values: defaultValues() } }));
    setActive(id);
    setTab("core");
  };

  const removeStock = (id) => {
    if (Object.keys(stocks).length <= 1) return;
    const next = { ...stocks };
    delete next[id];
    setStocks(next);
    if (active === id) setActive(Object.keys(next)[0]);
  };

  const loadPreset = (k) => {
    const p = PRESETS[k];
    setStocks((prev) => ({ ...prev, [active]: { name: p.name, values: { ...p.values } } }));
  };

  const stock = stocks[active];
  const scores = computeScores(stock.values);
  const signal = getSignal(scores.final);
  const trade = getTradeStructure(scores, stock.values);
  const narr = getNarrative(stock.values);

  const allFactorIds = [
    ...CORE_FACTORS.map((f) => f.id),
    ...TIMING_FACTORS.map((f) => f.id),
    ...RISK_FACTORS.map((f) => f.id),
    FLOW_FACTOR.id,
    IV_FACTOR.id,
  ];

  const filled = allFactorIds.filter((id) => stock.values[id] !== null && stock.values[id] !== undefined).length;
  const completePct = Math.round((filled / allFactorIds.length) * 100);
  const conf = getConfidence(scores.final, completePct);

  const ranked = Object.entries(stocks)
    .map(([id, s]) => ({ id, name: s.name, final: computeScores(s.values).final }))
    .sort((a, b) => b.final - a.final);

  const TABS = [
    { id: "core", label: "Core Signal", color: C.core, factors: CORE_FACTORS },
    { id: "timing", label: "Timing", color: C.timing, factors: TIMING_FACTORS },
    { id: "risk", label: "Risk", color: C.risk, factors: RISK_FACTORS },
    { id: "overlay", label: "Overlay", color: C.flow, factors: [] },
  ];

  const currentTab = TABS.find((t) => t.id === tab);
  const showOverlay = tab === "overlay";

  return (
    <div style={{ minHeight: "100vh", background: "#080910", color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&family=DM+Mono:wght@400;500;700&display=swap'); *{box-sizing:border-box;margin:0;padding:0} ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px} select option{background:#0a0c18;color:#e2e8f0}`}</style>

      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "18px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, paddingBottom: 16, marginBottom: 18, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div>
            <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 5 }}>
              {["core", "timing", "risk"].map((k) => (
                <div key={k} style={{ width: 6, height: 6, borderRadius: "50%", background: C[k], boxShadow: "0 0 8px " + C[k] }} />
              ))}
              <span style={{ fontSize: 9, color: "#1e293b", letterSpacing: 3, fontFamily: "'DM Mono', monospace", marginLeft: 4 }}>V3.2  PRODUCTION</span>
            </div>

            <h1
              style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: -0.5,
                background: `linear-gradient(90deg, #e2e8f0, ${C.core} 50%, ${C.timing})`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Stock Opportunity Scorer
            </h1>

            <p style={{ fontSize: 10, color: "#1e293b", marginTop: 2 }}>Core x (0.75 + timingRaw/80) - Risk | Flow informed trade logic | Completeness gated confidence</p>
          </div>

          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {Object.keys(PRESETS).map((k) => (
              <button
                key={k}
                onClick={() => loadPreset(k)}
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 5,
                  padding: "4px 9px",
                  color: "#334155",
                  fontSize: 9,
                  cursor: "pointer",
                  fontFamily: "'DM Mono', monospace",
                  letterSpacing: 1,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.target.style.color = C.core;
                  e.target.style.borderColor = C.core + "55";
                }}
                onMouseLeave={(e) => {
                  e.target.style.color = "#334155";
                  e.target.style.borderColor = "rgba(255,255,255,0.07)";
                }}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 14, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 16 }}>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 8, color: "#1e293b", letterSpacing: 3, marginBottom: 8, fontFamily: "'DM Mono', monospace" }}>CANDIDATES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {ranked.map(({ id, name, final }) => (
                  <CandidateRow key={id} name={name} final={final} isActive={id === active} onClick={() => setActive(id)} />
                ))}
              </div>

              <button
                onClick={addStock}
                style={{
                  width: "100%",
                  marginTop: 5,
                  background: "transparent",
                  border: "1px dashed rgba(255,255,255,0.07)",
                  borderRadius: 5,
                  padding: "6px",
                  color: "#1e293b",
                  fontSize: 10,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.target.style.borderColor = C.core + "55";
                  e.target.style.color = C.core;
                }}
                onMouseLeave={(e) => {
                  e.target.style.borderColor = "rgba(255,255,255,0.07)";
                  e.target.style.color = "#1e293b";
                }}
              >
                + Add Stock
              </button>
            </div>

            <div style={{ background: signal.bg, border: "1px solid " + signal.color + "22", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <ScoreDial score={scores.final} signal={signal} size={110} />

              <div style={{ display: "flex", gap: 8 }}>
                {[
                  { label: "CORE", val: scores.coreScore, max: 80, color: C.core },
                  { label: "TIME", val: scores.timingScore, max: 20, color: C.timing },
                  { label: "RISK", val: scores.riskDeduct, max: 15, color: C.risk },
                ].map((x) => (
                  <div key={x.label} style={{ textAlign: "center" }}>
                    <MiniDial score={x.val} color={x.color} size={34} />
                    <div style={{ fontSize: 7, color: "#334155", marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
                      {x.label}
                      <span style={{ color: "#1e293b" }}>{`/${x.max}`}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: signal.color, fontFamily: "'DM Mono', monospace" }}>{signal.label}</div>
                <div style={{ fontSize: 9, color: conf.color, marginTop: 2 }}>{`Confidence: ${conf.label}`}</div>
              </div>

              <div style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#1e293b", marginBottom: 3, fontFamily: "'DM Mono', monospace" }}>
                  <span>COMPLETE</span>
                  <span style={{ color: completePct === 100 ? "#00ff88" : C.core }}>{`${completePct}%`}</span>
                </div>
                <div style={{ height: 2, background: "#131520", borderRadius: 1, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: completePct + "%", background: completePct === 100 ? "#00ff88" : C.core, transition: "width 0.4s" }} />
                </div>
              </div>

              {Object.keys(stocks).length > 1 && (
                <button
                  onClick={() => removeStock(active)}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: "1px solid rgba(255,68,102,0.15)",
                    borderRadius: 5,
                    padding: "4px",
                    color: "#ff4466",
                    fontSize: 9,
                    cursor: "pointer",
                    opacity: 0.4,
                    transition: "opacity 0.2s",
                  }}
                  onMouseEnter={(e) => (e.target.style.opacity = 1)}
                  onMouseLeave={(e) => (e.target.style.opacity = 0.4)}
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 10, padding: "11px 13px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                {editName ? (
                  <input
                    autoFocus
                    value={stock.name}
                    onChange={(e) => setStocks((p) => ({ ...p, [active]: { ...p[active], name: e.target.value } }))}
                    onBlur={() => setEditName(false)}
                    onKeyDown={(e) => e.key === "Enter" && setEditName(false)}
                    style={{ flex: 1, background: "transparent", border: "none", borderBottom: "1px solid " + C.core, outline: "none", color: "#e2e8f0", fontSize: 15, fontWeight: 800, padding: "2px 0" }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 800 }}>{stock.name}</span>
                )}

                <button onClick={() => setEditName(!editName)} style={{ background: "transparent", border: "none", color: "#334155", cursor: "pointer", fontSize: 11, padding: "2px 6px", marginLeft: 8 }}>
                  {editName ? "done" : "edit"}
                </button>
              </div>

              <div style={{ display: "flex", gap: 5 }}>
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    style={{
                      flex: 1,
                      padding: "6px 2px",
                      borderRadius: 6,
                      cursor: "pointer",
                      background: tab === t.id ? t.color + "14" : "transparent",
                      border: "1px solid " + (tab === t.id ? t.color + "44" : "rgba(255,255,255,0.04)"),
                      color: tab === t.id ? t.color : "#334155",
                      fontSize: 10,
                      fontWeight: 700,
                      transition: "all 0.15s",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {!showOverlay ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {currentTab.factors.map((f) => (
                  <FactorRow key={f.id} factor={f} value={stock.values[f.id] != null ? stock.values[f.id] : null} onChange={update} type={tab} />
                ))}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[{ ...FLOW_FACTOR, type: "flow" }, { ...IV_FACTOR, type: "iv" }].map((f) => (
                  <FactorRow key={f.id} factor={f} value={stock.values[f.id] != null ? stock.values[f.id] : null} onChange={update} type={f.type} />
                ))}

                <div style={{ gridColumn: "1/-1", background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 8, color: "#334155", letterSpacing: 2, marginBottom: 6, fontFamily: "'DM Mono', monospace" }}>OVERLAY NOTE</div>
                  <div style={{ fontSize: 10, color: "#475569", lineHeight: 1.6 }}>
                    Institutional Flow and IV Environment are informational overlays. They do not contribute to the core score but drive the trade structure output. Flow confirmation unlocks higher conviction trade actions.
                  </div>
                </div>
              </div>
            )}

            <FormulaBar coreScore={scores.coreScore} timingRaw={scores.timingRaw} timingMultiplier={scores.timingMultiplier} riskDeduct={scores.riskDeduct} final={scores.final} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ background: `linear-gradient(135deg, ${trade.color}0a, transparent)`, border: "1px solid " + trade.color + "2a", borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 8, color: "#1e293b", letterSpacing: 3, marginBottom: 8, fontFamily: "'DM Mono', monospace" }}>TRADE STRUCTURE</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: trade.color, fontFamily: "'DM Mono', monospace", marginBottom: 4 }}>{trade.action}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginBottom: 8 }}>{trade.reason}</div>
                <div style={{ fontSize: 10, color: "#475569", lineHeight: 1.6, borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 8 }}>{trade.detail}</div>
              </div>

              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 8, color: "#1e293b", letterSpacing: 3, marginBottom: 10, fontFamily: "'DM Mono', monospace" }}>SIGNAL NARRATIVE</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  <div>
                    <div style={{ fontSize: 8, color: "#1e293b", letterSpacing: 2, marginBottom: 2, fontFamily: "'DM Mono', monospace" }}>CONFIDENCE</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: conf.color }}>{conf.label}</div>
                  </div>

                  <div>
                    <div style={{ fontSize: 8, color: "#1e293b", letterSpacing: 2, marginBottom: 2, fontFamily: "'DM Mono', monospace" }}>PRIMARY DRIVER</div>
                    <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.5 }}>{narr.primaryDriver}</div>
                  </div>

                  {narr.velocityAlert && <div style={{ background: "rgba(0,212,255,0.07)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 6, padding: "6px 8px", fontSize: 10, color: C.timing }}>{narr.velocityAlert}</div>}

                  <div>
                    <div style={{ fontSize: 8, color: "#1e293b", letterSpacing: 2, marginBottom: 2, fontFamily: "'DM Mono', monospace" }}>KEY RISK</div>
                    <div style={{ fontSize: 10, color: narr.allRisks.length > 0 ? "#ff9544" : "#334155", lineHeight: 1.5 }}>{narr.keyRisk}</div>
                  </div>

                  <div style={{ display: "flex", gap: 5, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                    {[
                      { l: "Core", v: scores.coreScore, c: C.core, suffix: "/80" },
                      { l: "Time", v: scores.timingScore, c: C.timing, suffix: "/20" },
                      { l: "Risk-", v: scores.riskDeduct, c: C.risk, suffix: "/15" },
                    ].map((x) => (
                      <div key={x.l} style={{ flex: 1, textAlign: "center", background: "rgba(255,255,255,0.02)", borderRadius: 5, padding: "5px 3px" }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: x.c, fontFamily: "'DM Mono', monospace" }}>{x.l === "Risk-" ? `-${x.v}` : x.v}</div>
                        <div style={{ fontSize: 7, color: "#1e293b", fontFamily: "'DM Mono', monospace" }}>{`${x.l}${x.suffix}`}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[
                { r: "78+", l: "STRONG BUY", c: "#00ff88" },
                { r: "65-77", l: "BUY", c: "#7dff6b" },
                { r: "50-64", l: "WATCH", c: "#ffd700" },
                { r: "35-49", l: "WEAK", c: "#ff9544" },
                { r: "< 35", l: "NO SIGNAL", c: "#ff4466" },
              ].map((g) => (
                <div key={g.l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: g.c, boxShadow: "0 0 4px " + g.c }} />
                  <span style={{ fontSize: 8, color: "#1e293b", fontFamily: "'DM Mono', monospace" }}>
                    {g.r} <span style={{ color: g.c }}>{g.l}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
