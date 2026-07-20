/*! Albireus Yahoo Stocks — technical indicators */
(function (global) {
  "use strict";

  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    if (period <= 0) return out;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null || !Number.isFinite(v)) {
        sum = 0;
        continue;
      }
      sum += v;
      if (i >= period) {
        const prev = values[i - period];
        if (prev != null) sum -= prev;
      }
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    if (period <= 0) return out;
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null || !Number.isFinite(v)) continue;
      if (prev == null) {
        // seed with SMA when enough points
        if (i >= period - 1) {
          let sum = 0;
          let ok = true;
          for (let j = i - period + 1; j <= i; j++) {
            if (values[j] == null) {
              ok = false;
              break;
            }
            sum += values[j];
          }
          if (!ok) continue;
          prev = sum / period;
          out[i] = prev;
        }
        continue;
      }
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  /** Stochastic KD (9,3,3) */
  function kd(highs, lows, closes, period = 9, kSmooth = 3, dSmooth = 3) {
    const rsv = new Array(closes.length).fill(null);
    for (let i = 0; i < closes.length; i++) {
      if (i < period - 1) continue;
      let hh = -Infinity;
      let ll = Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        if (highs[j] > hh) hh = highs[j];
        if (lows[j] < ll) ll = lows[j];
      }
      if (!Number.isFinite(hh) || !Number.isFinite(ll) || hh === ll) {
        rsv[i] = 50;
      } else {
        rsv[i] = ((closes[i] - ll) / (hh - ll)) * 100;
      }
    }
    const k = sma(rsv, kSmooth);
    const d = sma(k, dSmooth);
    return { k, d };
  }

  /** MACD (12,26,9) */
  function macd(closes, fast = 12, slow = 26, signal = 9) {
    const emaFast = ema(closes, fast);
    const emaSlow = ema(closes, slow);
    const dif = closes.map((_, i) =>
      emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
    );
    const dea = ema(dif, signal);
    const hist = dif.map((v, i) => (v != null && dea[i] != null ? v - dea[i] : null));
    return { dif, dea, hist };
  }

  /** RSI (14) Wilder */
  function rsi(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    if (closes.length < period + 1) return out;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d;
      else loss -= d;
    }
    let avgGain = gain / period;
    let avgLoss = loss / period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      const g = d > 0 ? d : 0;
      const l = d < 0 ? -d : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  }

  /** On-Balance Volume */
  function obv(closes, volumes) {
    const out = new Array(closes.length).fill(null);
    let acc = 0;
    for (let i = 0; i < closes.length; i++) {
      if (i === 0) {
        acc = volumes[i] || 0;
        out[i] = acc;
        continue;
      }
      if (closes[i] > closes[i - 1]) acc += volumes[i] || 0;
      else if (closes[i] < closes[i - 1]) acc -= volumes[i] || 0;
      out[i] = acc;
    }
    return out;
  }

  function toLinePoints(times, values) {
    const pts = [];
    for (let i = 0; i < times.length; i++) {
      if (values[i] == null || !Number.isFinite(values[i])) continue;
      pts.push({ time: times[i], value: values[i] });
    }
    return pts;
  }

  global.StockIndicators = {
    sma,
    ema,
    kd,
    macd,
    rsi,
    obv,
    toLinePoints,
  };
})(typeof window !== "undefined" ? window : globalThis);
