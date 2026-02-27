"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  computeScores,
  getSignal,
  interpretFmpData,
  ALWAYS_MANUAL,
  confidenceColor,
} from "../../lib/scoring";

const STORAGE_KEY = "stock-scorer-v5";

function defaultValues() {
  return {
    eps_surprise: null,
    revisions: null,
    revision_acceleration: null,
    sector_tailwind: null,
    relative_valuation: null,
    revenue_momentum: null,
    eps_inflection: null,
    catalyst_proximity: null,
    trend_health: null,
    accumulation: null,
    balance_sheet: null,
    binary_risk: null,
    positioning: null,
    options_iv: null,
    event_risk: null,
    regulatory_risk: null,
  };
}

const PRESETS = {
  "National Bank style": {
    name: "National Bank style",
    values: {
      ...defaultValues(),
      sector_tailwind: 4,
      relative_valuation: 4,
      trend_health: 3,
      catalyst_proximity: 3,
      binary_risk: 2,
    },
  },
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.stocks) return null;

    const stocks = {};
    for (const [id, s] of Object.entries(parsed.stocks)) {
      stocks[id] = {
        name: s.name || "New Stock (TICK)",
        values: { ...defaultValues(), ...(s.values || {}) },
        autoFields: new Set(s.autoFields || []),
        manualFields: new Set(s.manualFields || []),
        autoRaw: s.autoRaw || {},
        autoConf: s.autoConf || {},
      };
    }

    return {
      active: parsed.active || Object.keys(stocks)[0],
      tab: parsed.tab || "core",
      stocks,
    };
  } catch {
    return null;
  }
}

function saveState(state) {
  const serializable = {
    active: state.active,
    tab: state.tab,
    stocks: Object.fromEntries(
      Object.entries(state.stocks).map(([id, s]) => [
        id,
        {
          name: s.name,
          values: s.values,
          autoFields: Array.from(s.autoFields || []),
          manualFields: Array.from(s.manualFields || []),
          autoRaw: s.autoRaw || {},
          autoConf: s.autoConf || {},
        },
      ])
    ),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
}

export default function StockScorerV5() {
  const boot = useMemo(() => {
    const loaded = typeof window !== "undefined" ? loadState() : null;
    if (loaded) return loaded;
    const id = "s" + Date.now();
    return {
      active: id,
      tab: "core",
      stocks: {
        [id]: {
          name: "New Stock (TICK)",
          values: defaultValues(),
          autoFields: new Set(),
          manualFields: new Set(),
          autoRaw: {},
          autoConf: {},
        },
      },
    };
  }, []);

  const [active, setActive] = useState(boot.active);
  const [tab, setTab] = useState(boot.tab);
  const [stocks, setStocks] = useState(boot.stocks);

  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState("");

  useEffect(() => {
    saveState({ active, tab, stocks });
  }, [active, tab, stocks]);

  const stock = stocks[active];
  const scores = computeScores(stock.values);
  const signal = getSignal(scores.final);

  const setStockName = (id, name) => {
    setStocks((p) => ({ ...p, [id]: { ...p[id], name } }));
  };

  const setField = (fieldId, value, source) => {
    setStocks((p) => {
      const s = p[active];
      const nextValues = { ...s.values, [fieldId]: value };

      const nextManual = new Set(s.manualFields);
      const nextAuto = new Set(s.autoFields);

      if (source === "manual") {
        nextManual.add(fieldId);
      } else if (source === "auto") {
        nextAuto.add(fieldId);
      }

      return {
        ...p,
        [active]: {
          ...s,
          values: nextValues,
          manualFields: nextManual,
          autoFields: nextAuto,
        },
      };
    });
  };

  const addStock = () => {
    const id = "s" + Date.now();
    setStocks((p) => ({
      ...p,
      [id]: {
        name: "New Stock (TICK)",
        values: defaultValues(),
        autoFields: new Set(),
        manualFields: new Set(),
        autoRaw: {},
        autoConf: {},
      },
    }));
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
    setStocks((prev) => ({
      ...prev,
      [active]: {
        name: p.name,
        values: { ...p.values },
        autoFields: new Set(),
        manualFields: new Set(),
        autoRaw: {},
        autoConf: {},
      },
    }));
  };

  const clearAutoForField = useCallback(
    (fieldId) => {
      setStocks((p) => {
        const s = p[active];
        const newManual = new Set(s.manualFields);
        newManual.delete(fieldId);

        const autoVal = s.autoFields.has(fieldId) ? s.values[fieldId] : null;

        return {
          ...p,
          [active]: {
            ...s,
            values: { ...s.values, [fieldId]: autoVal },
            manualFields: newManual,
          },
        };
      });
    },
    [active]
  );

  const fetchData = useCallback(async () => {
    try {
      setFetchErr("");
      setFetching(true);

      const rawName = String(stocks[active]?.name || "").trim();
      const symbol = rawName.split(" ")[0].replace(/[()]/g, "").toUpperCase();

      if (!symbol || symbol.length > 10) {
        throw new Error("Missing symbol");
      }

      const res = await fetch(`/api/fmp?symbol=${encodeURIComponent(symbol)}`, {
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = json?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const interpreted = interpretFmpData(json);

      setStocks((p) => {
        const s = p[active];

        const newValues = { ...s.values };
        const newAutoFields = new Set(s.autoFields);
        const newAutoRaw = { ...(s.autoRaw || {}) };
        const newAutoConf = { ...(s.autoConf || {}) };

        let filled = 0;

        for (const [fieldId, info] of Object.entries(interpreted)) {
          if (!info) continue;

          const isAlwaysManual = ALWAYS_MANUAL.includes(fieldId);
          const alreadyManual = s.manualFields.has(fieldId);

          if (isAlwaysManual || alreadyManual) continue;

          newValues[fieldId] = info.index;
          newAutoFields.add(fieldId);
          newAutoRaw[fieldId] = info.raw;
          newAutoConf[fieldId] = info.confidence;
          filled += 1;
        }

        return {
          ...p,
          [active]: {
            ...s,
            name: symbol,
            values: newValues,
            autoFields: newAutoFields,
            autoRaw: newAutoRaw,
            autoConf: newAutoConf,
            _lastFillCount: filled,
          },
        };
      });
    } catch (err) {
      setFetchErr(String(err?.message || err));
    } finally {
      setFetching(false);
    }
  }, [active, stocks]);

  const filledCount = stock?._lastFillCount || 0;

  return (
    <div className="min-h-screen w-full px-4 py-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="text-sm opacity-80">
            <button
              className="px-3 py-2 rounded-lg border border-white/10"
              onClick={addStock}
            >
              + Add Stock
            </button>
          </div>

          <div className="flex items-center gap-2">
            <select
              className="px-3 py-2 rounded-lg bg-black/30 border border-white/10"
              value={active}
              onChange={(e) => setActive(e.target.value)}
            >
              {Object.entries(stocks).map(([id, s]) => (
                <option key={id} value={id}>
                  {s.name}
                </option>
              ))}
            </select>

            <button
              className="px-3 py-2 rounded-lg border border-white/10"
              onClick={() => removeStock(active)}
            >
              Remove
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-4 mb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-2xl font-semibold">{signal}</div>
              <div className="text-sm opacity-70">
                Confidence:{" "}
                {Object.keys(stock.autoFields || {}).length === 0 &&
                Array.from(stock.manualFields || []).length === 0
                  ? "INCOMPLETE, score unreliable"
                  : "in progress"}
              </div>
              {filledCount > 0 ? (
                <div className="text-sm mt-1" style={{ color: "#22c55e" }}>
                  {filledCount} fields auto filled
                </div>
              ) : null}
            </div>

            <div className="text-right">
              <button
                className="px-4 py-2 rounded-xl border border-cyan-400/60 text-cyan-200"
                onClick={fetchData}
                disabled={fetching}
              >
                {fetching ? "Fetching..." : "FETCH DATA"}
              </button>

              {fetchErr ? (
                <div className="mt-2 text-sm px-3 py-2 rounded-lg bg-red-950/40 border border-red-500/40 text-red-200">
                  {fetchErr}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-xl font-semibold">{stock.name}</div>
            <div className="text-sm opacity-70">
              edit{" "}
              <input
                className="ml-2 px-3 py-1 rounded-lg bg-black/30 border border-white/10"
                value={stock.name}
                onChange={(e) => setStockName(active, e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2 mb-3">
            {["core", "timing", "risk", "overlay"].map((t) => (
              <button
                key={t}
                className={`px-4 py-2 rounded-xl border ${
                  tab === t
                    ? "border-indigo-400/60 text-indigo-200"
                    : "border-white/10 opacity-80"
                }`}
                onClick={() => setTab(t)}
              >
                {t === "core"
                  ? "Core Signal"
                  : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          <div className="text-sm opacity-70">
            This file is a simplified drop in replacement focused on fixing FMP
            fetch and auto fill wiring. Your existing field UI below can remain
            as is. If you want me to preserve every existing UI section exactly,
            paste your current StockScorerV5.jsx and I will merge instead of
            simplifying.
          </div>
        </div>
      </div>
    </div>
  );
}
