# Analytics Methodology

## 1. Forecast-Error Sign Convention

**Critical Definition (used throughout):**

```
Error = Forecast − Actual
      = forecastMW − actualMW
```

| Error Sign | Terminology | Procurement Meaning |
|------------|-------------|---------------------|
| **Error > 0** | **Overestimation** / Over-forecast | Forecast predicted more wind than delivered → buyer may have over-procured wind, needs balancing purchases |
| **Error < 0** | **Underestimation** / Under-forecast | Forecast predicted less wind than delivered → buyer under-procured wind, missed cheaper generation |
| **Error = 0** | Perfect forecast | Ideal |

**Rationale:** This convention (Forecast − Actual) is standard in forecast verification literature (Jolliffe & Stephenson, 2012) and makes "positive bias = systematic over-forecasting" intuitive for procurement teams.

---

## 2. Core Metrics

### 2.1 Mean Absolute Error (MAE)

**Formula:**
```
MAE = (1/n) × Σ|forecast_i − actual_i|
```

**Interpretation:** Average magnitude of forecast error in MW, regardless of direction.

**Procurement Value:** Directly translates to expected balancing volume (MWh = MAE × 0.5h per period). Easy to communicate: "On average, our day-ahead wind forecast is off by X MW."

**Properties:** 
- Same units as data (MW)
- Robust to outliers (less than RMSE)
- Does not indicate direction of bias

---

### 2.2 Root Mean Squared Error (RMSE)

**Formula:**
```
RMSE = √[(1/n) × Σ(forecast_i − actual_i)²]
```

**Interpretation:** Quadratic mean error; penalizes large errors more heavily than MAE.

**Procurement Value:** Highlights risk of **extreme forecast misses** that drive expensive balancing actions. If RMSE >> MAE, error distribution has heavy tails → higher imbalance price risk.

**Properties:**
- Same units (MW)
- Sensitive to outliers
- RMSE ≥ MAE always; equality only if all errors identical magnitude

---

### 2.3 Mean Error / Forecast Bias (ME)

**Formula:**
```
ME = (1/n) × Σ(forecast_i − actual_i)
    = (1/n) Σ Error_i
```

**Interpretation:** Systematic tendency to over- or under-forecast. **Signed** — preserves direction.

**Procurement Value:** 
- ME > 0 → Systematic **over-forecasting** → buyer consistently buys too much wind
- ME < 0 → Systematic **under-forecasting** → buyer consistently misses cheap wind
- |ME| ≈ MAE → Errors mostly one-sided (directional bias dominates)
- |ME| << MAE → Errors symmetric around zero (random noise dominates)

**Strategic Action:** Non-zero ME suggests forecast model calibration issue; can apply bias correction.

---

### 2.4 Mean Absolute Percentage Error (MAPE)

**Formula (with zero-actual safeguard):**
```
MAPE = (1/n') × Σ |(forecast_i − actual_i) / actual_i| × 100%
```
where `n'` = count of intervals where `actual_i > ε` (ε = 1 MW threshold)

**Zero-Actual Handling:**
- Wind generation can be 0 MW (calm periods)
- Division by zero undefined
- **Safeguard:** Exclude intervals where `actual_i ≤ 1 MW` from MAPE calculation
- Report `n_excluded` and `n_included` alongside MAPE

**Alternative (Symmetric MAPE / SMAPE):**
```
SMAPE = (1/n) × Σ |forecast_i − actual_i| / (|forecast_i| + |actual_i|) × 200%
```
- Handles zero actuals naturally
- Bounded [0%, 200%]
- Less intuitive for procurement teams

**Recommendation:** Report **MAE (MW)** as primary, **MAPE (with ε=1MW exclusion)** as secondary with explicit note on excluded intervals.

---

### 2.5 Forecast Overestimation / Underestimation Analysis

**Definitions:**
- **Overestimation Count** = Σ I(Error_i > 0)
- **Underestimation Count** = Σ I(Error_i < 0)
- **Overestimation Volume** = Σ max(Error_i, 0)  (MW-sum of positive errors)
- **Underestimation Volume** = Σ min(Error_i, 0)  (MW-sum of negative errors, negative value)

**Procurement Metrics:**
| Metric | Formula | Meaning |
|--------|---------|---------|
| Overestimation Frequency | OverCount / n | % of periods forecast > actual |
| Underestimation Frequency | UnderCount / n | % of periods forecast < actual |
| Net Overestimation Volume | OverVol + UnderVol | Total MW-direction imbalance |
| Asymmetry Ratio | OverVol / |UnderVol| | >1 = over-forecast dominates in volume |

**Value:** Quantifies **directional risk** — procurement team cares more about underestimation (missing cheap wind) vs overestimation (paying for balancing).

---

### 2.6 Error Distribution Analysis

**Required Visualizations:**
1. **Histogram** of errors (MW) — shape, symmetry, outliers
2. **Q-Q plot** vs Normal — assess Gaussian assumption
3. **Error vs Actual scatter** — heteroscedasticity check (errors larger at high wind?)
4. **Error by Settlement Period** — diurnal pattern (e.g., worse at dawn/dusk)
5. **Error by Month/Season** — seasonal degradation

**Summary Statistics:**
- Skewness, Kurtosis
- Percentiles: P10, P25, P50 (median), P75, P90
- Interquartile Range (IQR)
- % of intervals with |Error| > 500 MW, > 1000 MW, > 2000 MW

**Procurement Value:** Identifies **tail risk** — rare but catastrophic forecast errors that drive extreme imbalance prices.

---

### 2.7 Forecast vs Actual Time-Series Analysis

**Required Plots:**
1. **Overlay Plot** — Forecast (line) vs Actual (line) over January 2026, faceted by week
2. **Scatter Plot** — Forecast (x) vs Actual (y) with 1:1 line, R² annotation
3. **Residual Time Series** — Error over time, colored by over/under
4. **Rolling Metrics** — 7-day rolling MAE, RMSE, ME

**Key Diagnostics:**
- **R² (Coefficient of Determination)** — proportion of variance explained
- **Correlation Coefficient (r)** — linear association strength
- **Lag Analysis** — cross-correlation to detect systematic timing offsets

---

## 3. Metric Selection for UK Electricity Procurement Team

### 3.1 Primary Metrics (Dashboard Headline)

| Metric | Why It Matters to Procurement |
|--------|------------------------------|
| **MAE (MW)** | Directly maps to average balancing volume → cost estimate |
| **ME / Bias (MW)** | Reveals systematic over/under-procurement → actionable correction |
| **Overestimation Frequency (%)** | % of periods needing upward balancing (buy more) |
| **Underestimation Frequency (%)** | % of periods with missed cheap wind (opportunity cost) |

### 3.2 Secondary Metrics (Risk Assessment)

| Metric | Why It Matters |
|--------|---------------|
| **RMSE (MW)** | Tail risk / extreme event exposure |
| **P90 Error (MW)** | "Worst reasonable case" for budgeting |
| **Error by Settlement Period** | Identifies problematic hours (e.g., morning ramp) |
| **Coverage %** | Data quality confidence (missing forecasts/actuals) |

### 3.3 Metrics to Avoid / De-emphasize

| Metric | Reason |
|--------|--------|
| MAPE (unqualified) | Undefined at zero wind; misleading when actuals near zero |
| R² alone | Can be high while bias is large (systematic offset) |
| Correlation only | Insensitive to additive/multiplicative bias |

---

## 4. Aggregation Levels

| Level | Intervals | Use Case |
|-------|-----------|----------|
| **Per Settlement Period** | 1,488 | Granular diagnostics, period-specific patterns |
| **Daily (48 SPs aggregated)** | 31 | Daily procurement review, day-ahead performance |
| **Weekly** | ~4-5 | Weekly procurement strategy adjustment |
| **Monthly (Full January)** | 1 | Executive summary, model comparison baseline |

**Daily Aggregation Formulas:**
- Daily MAE = mean of 48 period MAEs
- Daily ME = mean of 48 period MEs (preserves sign)
- Daily Over/Under Volume = sum of period volumes

---

## 5. Benchmarking Context

| Benchmark | Source | Target |
|-----------|--------|--------|
| **Persistence Forecast** (today = tomorrow) | Naive baseline | Model must beat persistence MAE |
| **National Grid ESO Day-Ahead** | Published BMRA forecasts | Compare against same cutoff |
| **Industry Literature** | ~10-15% MAPE typical for day-ahead wind | Contextualize performance |

---

## 7. Implementation Details

### 7.1 Service Location

- **Analytics Service:** `apps/wind-api/app/services/analytics.py`
- **API Endpoints:** `apps/wind-api/app/api/routes/analytics.py`
- **Pydantic Models:** `apps/wind-api/app/schemas/wind.py` (AnalyticsResponse, AccuracyMetricsResponse, etc.)

### 7.2 Implementation Decisions

| Decision | Implementation |
|----------|----------------|
| **Pure functions** | All metric calculations are pure, stateless, independently testable |
| **Zero-actual MAPE** | Excludes intervals where `actual ≤ 1 MW`; reports excluded count |
| **Percentiles** | Linear interpolation (P50=median, P90, P95, P99) |
| **Error convention** | `Error = Forecast - Actual` (positive = overestimation) |
| **Coverage** | Reports matched, missing_forecast, missing_actual, total intervals |
| **Business insights** | Descriptive, evidence-based; no arbitrary confidence intervals |

### 7.3 API Endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /api/v1/analytics/accuracy` | Full AnalyticsResponse with all metrics |
| `GET /api/v1/analytics/timeseries` | Aligned time-series with errors |
| `GET /api/v1/analytics/day-ahead` | Selected forecasts per interval |

### 7.4 Complete Response Example (Accuracy)

```json
{
  "date_from": "2026-01-01",
  "date_to": "2026-01-31",
  "methodology": {
    "forecast_selection": "Latest eligible forecast published on or before D-1 12:00 Europe/London",
    "error_sign_convention": "Error = Forecast - Actual (positive = overestimation)",
    "mape_zero_handling": "Exclude intervals where actual <= 1 MW",
    "aggregation_level": "Per settlement period (30-min), daily rollup available"
  },
  "cutoff_config": {"hour": 12, "minute": 0, "timezone": "Europe/London"},
  "dataset_provenance": {
    "actuals_dataset": "Elexon BMRS FUELHH (fuelType=WIND)",
    "forecasts_dataset": "Elexon BMRS WINDFOR",
    "delivery_date_range": "2026-01-01 to 2026-01-31",
    "expected_intervals": 1488
  },
  "accuracy_metrics": {
    "mae_mw": 245.67,
    "rmse_mw": 312.45,
    "mean_error_mw": 45.23,
    "mape_percent": 8.92,
    "mape_excluded_count": 12,
    "mape_included_count": 1476
  },
  "directional_metrics": {
    "overestimation_count": 890,
    "underestimation_count": 586,
    "exact_match_count": 12,
    "overestimation_volume_mw": 185420.5,
    "underestimation_volume_mw": -124680.3,
    "overestimation_frequency_pct": 59.93,
    "underestimation_frequency_pct": 39.45
  },
  "distribution_metrics": {
    "max_absolute_error_mw": 2145.0,
    "median_absolute_error_mw": 156.0,
    "p90_absolute_error_mw": 623.0,
    "p95_absolute_error_mw": 892.0,
    "p99_absolute_error_mw": 1456.0
  },
  "coverage_metrics": {
    "total_evaluated_intervals": 1488,
    "matched_intervals": 1445,
    "missing_forecast_intervals": 28,
    "missing_actual_intervals": 15,
    "evaluation_coverage_pct": 97.11
  },
  "business_insights": {
    "systematic_bias": "overestimation",
    "bias_magnitude_mw": 45.23,
    "bias_direction": "positive",
    "higher_error_periods": ["periods_with_extreme_errors"],
    "key_finding": "Forecasts systematically overestimate wind generation by 45.2 MW on average. Procurement decisions based on these forecasts may lead to over-procurement and balancing purchase costs.",
    "caveats": [
      "Analysis limited to January 2026 (31 days, 1,488 intervals)",
      "Day-ahead cutoff assumption: 12:00 Europe/London on D-1 (EPEX SPOT gate closure)",
      "MAPE excludes intervals with actual generation <= 1 MW",
      "Missing actual/forecast intervals excluded from error metrics",
      "Results based on Elexon BMRS FUELHH (actuals) and WINDFOR (forecasts) datasets",
      "No consumer demand data included; wind-only analysis"
    ]
  }
}
```

---

## 8. References

1. Jolliffe, I.T., Stephenson, D.B. (2012). *Forecast Verification: A Practitioner's Guide*. Wiley.
2. National Grid ESO — "Forecast Accuracy Reports" (annual publications)
3. Elexon — "Balancing Mechanism Reporting Service" data specs
4. Hyndman, R.J., Koehler, A.B. (2006). "Another look at measures of forecast accuracy." *International Journal of Forecasting*.