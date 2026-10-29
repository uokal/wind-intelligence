# Day-Ahead Forecast Selection Methodology

## 1. Purpose and Scope

This document defines a **defensible, auditable methodology** for selecting the wind generation forecasts that were available at the time of day-ahead electricity procurement decisions, and comparing them against actual outturn generation.

**Scope:** January 2026 (proxy: January 2024/2025 for development)
**Datasets:** Elexon BMRS `FUELHH` (actuals, filtered to `fuelType = WIND`) and `WINDFOR` (forecasts)
**Decision Context:** UK day-ahead electricity market procurement

---

## 2. Key Definitions

| Term | Definition |
|------|------------|
| **Decision Date (D-1)** | The calendar day on which procurement decisions are made for delivery on the following day |
| **Delivery Date (D)** | The calendar day for which electricity is physically delivered/generated |
| **Settlement Period (SP)** | Half-hour interval (1–48, or 46/50 on clock-change days) within a settlement date |
| **Delivery Interval** | Unique combination of `(settlementDate, settlementPeriod)` |
| **Procurement Cutoff** | The latest time on D-1 by which procurement decisions must be finalized |
| **Forecast Publication Time (publishTime)** | Timestamp when a specific forecast version was issued by National Grid ESO (UTC) |
| **Forecast Version** | A unique forecast identified by `(deliveryInterval, publishTime)` |

---

## 3. UK Day-Ahead Market Timeline (Verified from Authoritative Sources)

### 3.1 EPEX SPOT Day-Ahead Auction (Primary Reference)

| Event | Time (Europe/London) | Day |
|-------|---------------------|-----|
| **Gate Closure** | 12:00 (noon) | D-1 |
| **Auction Run** | 12:00–12:30 | D-1 |
| **Results Publication** | ~12:45 | D-1 |
| **Delivery Starts** | 00:00 | D |

**Source:** EPEX SPOT GB Day-Ahead Market Rules; National Grid ESO "Day-Ahead Market" documentation.

### 3.2 National Grid ESO Wind Forecast Publication Schedule

| Forecast Type | Typical Publication Times (Europe/London) | Availability for D-1 12:00 Cutoff |
|---------------|------------------------------------------|-----------------------------------|
| **Day-Ahead (D-1)** | ~06:00, ~10:00, ~14:00, ~18:00 | **06:00 and 10:00 available**; 14:00+ after cutoff |
| **Intraday (D)** | ~06:00, ~10:00, ~14:00, ~18:00 | Not available for day-ahead decision |

**Source:** National Grid ESO "Wind Generation Forecast" publication times (BMRA reports WINDFORFUELHH).

### 3.3 Configurable Assumption (Per Assignment Requirement)

> **Assumption:** The procurement decision cutoff is **12:00 (noon) Europe/London time on D-1** (EPEX SPOT gate closure).

**Rationale:** This is the latest time a buyer can submit bids for day-ahead capacity. Any forecast published after 12:00 D-1 would constitute **look-ahead bias** if used for decision-making.

**Configuration Parameter:**
```python
PROCUREMENT_CUTOFF_HOUR = 12  # 12:00 noon Europe/London on D-1
PROCUREMENT_CUTOFF_TIMEZONE = "Europe/London"
```

---

## 4. Forecast Selection Algorithm

### 4.1 Core Principle

> **Never select a forecast published after the procurement decision cutoff.**

### 4.2 Step-by-Step Selection Logic

For each delivery interval `(delivery_date, settlement_period)`:

1. **Identify Candidate Forecasts**
   - Query WINDFOR for `FromDate=delivery_date`, `ToDate=delivery_date`
   - Filter to rows matching the target `settlementPeriod`
   - Each row = one forecast version with its `publishTime`

2. **Convert publishTime to Europe/London**
   - `publishTime` from API is UTC → convert to `Europe/London` for cutoff comparison

3. **Apply Cutoff Filter**
   - Cutoff datetime = `delivery_date - 1 day` at `12:00 Europe/London`
   - Keep only forecasts where `publishTime (Europe/London) <= cutoff`

4. **Select Latest Available Forecast**
   - From filtered set, pick forecast with **maximum `publishTime`**
   - This is the "last look" available to the procurement team

5. **Handle Edge Cases**
   - **No forecasts before cutoff** → Mark as `missing_forecast`; exclude from analytics
   - **Multiple forecasts with same max publishTime** → Deduplicate (keep first)
   - **Forecast exists but `forecastMW` is null** → Treat as missing

### 4.3 Pseudocode

```python
def select_day_ahead_forecast(
    delivery_date: date,
    settlement_period: int,
    forecasts_df: pd.DataFrame,
    cutoff_hour: int = 12,
    cutoff_tz: str = "Europe/London"
) -> Optional[pd.Series]:
    """
    Select the latest wind forecast available at day-ahead procurement cutoff.
    
    Returns: Series with forecastMW, publishTime, or None if no eligible forecast.
    """
    # Filter to target delivery interval
    mask = (forecasts_df['settlementDate'] == delivery_date) & \
           (forecasts_df['settlementPeriod'] == settlement_period)
    candidates = forecasts_df[mask].copy()
    
    if candidates.empty:
        return None  # No forecast at all for this interval
    
    # Ensure publishTime is timezone-aware UTC, convert to London
    candidates['publishTime_London'] = (
        pd.to_datetime(candidates['publishTime'], utc=True)
        .dt.tz_convert(cutoff_tz)
    )
    
    # Cutoff = 12:00 London time on D-1
    cutoff_dt = pd.Timestamp(delivery_date - timedelta(days=1), tz=cutoff_tz) \
                .replace(hour=cutoff_hour, minute=0, second=0, microsecond=0)
    
    # Keep only forecasts published on or before cutoff
    eligible = candidates[candidates['publishTime_London'] <= cutoff_dt]
    
    if eligible.empty:
        return None  # No forecast available in time for decision
    
    # Select latest publication
    latest = eligible.loc[eligible['publishTime_London'].idxmax()]
    return latest
```

---

## 5. Actual Generation Alignment

### 5.1 Source: FUELHH Dataset

- Query `FUELHH` for `FromDate=delivery_date`, `ToDate=delivery_date`
- Filter `fuelType == "WIND"`
- Result: One row per `(settlementDate, settlementPeriod)` with `quantity` (MW)

### 5.2 Alignment Key

Match on **composite key**: `(settlementDate, settlementPeriod)`

| Forecast Key | Actual Key | Join Type |
|--------------|------------|-----------|
| `(settlementDate, settlementPeriod)` | `(settlementDate, settlementPeriod)` | Inner (only intervals with both) |

### 5.3 Handling Missing Actuals

| Scenario | Action |
|----------|--------|
| Actual not yet published (settlement lag) | Mark `actualMW = NaN`; exclude from error metrics |
| Actual revised (resettlement) | Use latest available revision at analysis time; log revision number |
| Actual missing for entire day | Document gap; exclude day from aggregate metrics |

---

## 6. January 2026 Scope Definition

### 6.1 Delivery Date Range

```
Start: 2026-01-01 (settlement date)
End:   2026-01-31 (settlement date)
```

### 6.2 Decision Date Range (D-1)

```
Start: 2025-12-31 (for 2026-01-01 delivery)
End:   2026-01-30 (for 2026-01-31 delivery)
```

### 6.3 Settlement Periods per Day

- Standard days: 48 periods
- 2026-03-29 (spring forward): 46 periods — **not in January scope**
- 2026-10-25 (autumn back): 50 periods — **not in January scope**
- **January 2026: All 31 days × 48 SPs = 1,488 delivery intervals**

### 6.4 Proxy for Development

Since January 2026 data doesn't exist yet, **use January 2024** (or 2025) as development proxy:
- Same calendar structure (31 days, no clock changes in January)
- Identical methodology applies

---

## 7. Missing Data Handling Strategy

| Data Gap | Forecast Side | Actual Side | Analytics Impact |
|----------|---------------|-------------|------------------|
| **No forecast before cutoff** | `forecastMW = NaN` | — | Exclude interval from all metrics; count in "missing forecast" tally |
| **Forecast exists but null** | `forecastMW = NaN` | — | Same as above |
| **No actual (settlement lag)** | — | `actualMW = NaN` | Exclude from error metrics; count in "missing actual" tally |
| **No actual (permanent gap)** | — | `actualMW = NaN` | Same; investigate if systematic |
| **Both present** | `forecastMW` | `actualMW` | Include in all error calculations |

**Reporting:** Always report coverage percentages:
- Forecast coverage = intervals with valid forecast / 1,488
- Actual coverage = intervals with valid actual / 1,488
- Joint coverage = intervals with both / 1,488

---

## 8. Look-Ahead Bias Prevention Checklist

- [ ] **Cutoff enforcement:** No forecast with `publishTime > 12:00 D-1 (London)` used
- [ ] **Timezone correctness:** All timestamps converted to `Europe/London` before cutoff comparison
- [ ] **No actuals in forecast selection:** Actual generation (`outturnMW` in WINDFORFUELHH or FUELHH) never influences which forecast is selected
- [ ] **No future data in training:** If any ML model is used (not in scope), train only on D-2 and earlier
- [ ] **Revision awareness:** Use `DocumentRevNum` / `DocStatus` to detect revised actuals; document which version used
- [ ] **Clock-change handling:** Verify 46/50 SP days handled correctly (not in Jan scope but code must support)

---

## 9. Forecast-Error Sign Convention

**Explicit Convention (Critical for Bias Interpretation):**

```
Error = Forecast − Actual
      = forecastMW − actualMW
```

| Error Sign | Meaning | Procurement Implication |
|------------|---------|------------------------|
| **Positive (>0)** | **Overestimation** — forecast > actual | Buyer procured **too much** wind; may need balancing purchases |
| **Negative (<0)** | **Underestimation** — forecast < actual | Buyer procured **too little** wind; missed cheaper wind, may need expensive balancing |
| **Zero** | Perfect forecast | Ideal |

**Rationale:** This convention aligns with standard forecast verification practice (Jolliffe & Stephenson, 2012) and makes "positive bias = over-forecasting" intuitive for procurement teams.

---

## 10. Summary of Configurable Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `PROCUREMENT_CUTOFF_HOUR` | 12 | Hour (0-23) of cutoff on D-1 in `PROCUREMENT_CUTOFF_TIMEZONE` |
| `PROCUREMENT_CUTOFF_TIMEZONE` | "Europe/London" | Timezone for cutoff interpretation |
| `FORECAST_DATASET` | "WINDFOR" | BMRS dataset for forecasts |
| `ACTUAL_DATASET` | "FUELHH" | BMRS dataset for actuals |
| `WIND_FUEL_TYPE` | "WIND" | Fuel type code to filter in FUELHH |
| `SCOPE_START_DATE` | "2026-01-01" | First delivery date (inclusive) |
| `SCOPE_END_DATE` | "2026-01-31" | Last delivery date (inclusive) |

All parameters externalized to configuration file / environment variables for auditability.

---

## 11. Validation and Auditability

### 11.1 Selection Log Output

For each delivery interval, log:
```json
{
  "delivery_date": "2026-01-15",
  "settlement_period": 24,
  "cutoff_datetime_london": "2026-01-14T12:00:00+00:00",
  "candidate_forecasts": 4,
  "eligible_forecasts": 2,
  "selected_publish_time_utc": "2026-01-14T10:00:00Z",
  "selected_forecast_mw": 8423.5,
  "actual_mw": 8150.2,
  "error_mw": 273.3,
  "status": "matched"
}
```

### 11.2 Aggregate Coverage Report

```
January 2026 Day-Ahead Forecast Coverage:
- Total delivery intervals: 1,488
- Intervals with forecast before cutoff: 1,452 (97.6%)
- Intervals with actual generation: 1,480 (99.5%)
- Intervals with both (analyzed): 1,445 (97.1%)
- Missing forecast: 36 (2.4%)
- Missing actual: 8 (0.5%)
```

---

## 12. References

1. EPEX SPOT GB Day-Ahead Market Rules — Gate closure 12:00 D-1
2. National Grid ESO — Wind Generation Forecast publication schedule
3. Elexon BMRS API — WINDFORFUELHH and FUELHH dataset specifications
4. Jolliffe, I.T., Stephenson, D.B. (2012). *Forecast Verification: A Practitioner's Guide*. Wiley.
5. Ofgem — "Electricity Market Reform" publications on procurement timelines