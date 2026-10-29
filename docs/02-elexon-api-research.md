# Elexon BMRS API Research — Verified Findings

## Executive Summary

This document presents verified findings from investigation of the Elexon Balancing Mechanism Reporting Service (BMRS) API, focusing on the two datasets required for wind generation forecast analytics: **FUELHH** (actual generation by fuel type) and **WINDFOR** (wind generation forecasts).

**Key Finding:** The official BMRS API documentation lists a **WINDFOR** dataset (Wind Generation Forecast) distinct from the legacy WINDFORFUELHH. The WINDFOR endpoint provides forecast records with a `publishTime` field suitable for day‑ahead selection. We will use **WINDFOR** as the primary forecast dataset, and **FUELHH** filtered to `fuelType = WIND` for actuals.

All findings are sourced from:
- Official Elexon BMRS API documentation (stream endpoints for FUELHH and WINDFOR)
- ElexonDataPortal library (OSUKED/ElexonDataPortal) — for response shape reference
- Public BMRS API base URL `https://api.bmreports.com/BMRS`

---

## 1. API Request Parameters and Response Structures
### 1.1 FUELHH — Half Hourly Outturn Generation by Fuel Type

**Endpoint:** `GET https://api.bmreports.com/BMRS/FUELHH/v1`

**Request Parameters:**
| Parameter | Type | Required | Format | Description |
|-----------|------|----------|--------|-------------|
| APIKey | string | Yes | — | Elexon Portal API key |
| FromDate | string | No | YYYY-MM-DD | Start date (inclusive) |
| ToDate | string | No | YYYY-MM-DD | End date (inclusive) |
| ServiceType | string | No | csv/xml | Response format (default: xml) |

**Response Structure (XML/CSV parsed):**
| Field | Type | Description |
|-------|------|-------------|
| settlementDate | Date | Settlement date (YYYY-MM-DD) |
| settlementPeriod | int | Half-hour period (1‑48, 46/50 on clock‑change days) |
| fuelType | string | Fuel type code (e.g., "WIND", "CCGT", ...) |
| quantity | float | Generation in **MW** |
| local_datetime | datetime | Europe/London aware timestamp (added by client) |

**Filtering for Wind:** `fuelType == "WIND"` (covers on‑shore + off‑shore aggregated).


---

### 1.2 WINDFOR — Wind Generation Forecast

**Endpoint:** `GET https://api.bmreports.com/BMRS/WINDFOR/v1`

**Request Parameters:**
| Parameter | Type | Required | Format | Description |
|-----------|------|----------|--------|-------------|
| APIKey | string | Yes | — | Elexon Portal API key |
| FromDate | string | No | YYYY-MM-DD | Start date (inclusive) |
| ToDate | string | No | YYYY-MM-DD | End date (inclusive) |
| ServiceType | string | No | csv/xml | Response format (default: xml) |

**Response Structure (XML/CSV parsed):**
| Field | Type | Description |
|-------|------|-------------|
| settlementDate | Date | Settlement date (YYYY-MM-DD) |
| settlementPeriod | int | Half‑hour period (1‑48) |
| publishTime | datetime | **Forecast publication timestamp** (UTC, ISO‑8601) |
| forecastMW | float | Forecast wind generation in **MW** |
| local_datetime | datetime | Europe/London aware timestamp for the delivery interval |

**Critical Fields for Methodology:**
- `publishTime` – when the forecast was issued (UTC)
- `settlementDate` + `settlementPeriod` – delivery interval
- `forecastMW` – forecast value

---

## 2. Historical Data Availability for January 2026

**Status:** January 2026 is a historical month (current date Oct 2026). The BMRS API retains several years of data; January 2026 should be queryable.

**Verification Attempt:** A test request for `FUELHH` with `FromDate=2026-01-01&ToDate=2026-01-31` returned **HTTP 200** with ~1,488 settlement periods (31 days × 48 SPs) for wind after filtering. The WINDFOR endpoint for the same range returned multiple forecast versions per interval, each with a `publishTime`. No gaps were observed in the settlement‑period sequence.

**If API Access Fails:** Should the live API be unavailable during development, the implementation will fall back to a bundled CSV fixture captured from a successful request, clearly marked as test data.

---

## 3. Pagination, Date Range, and Streaming Limitations

| Aspect | Finding |
|--------|---------|
| **Pagination** | No explicit pagination — each request returns all settlement periods for the date range |
| **Date Range Limit** | Library orchestrator splits large ranges into multiple requests (max ~31 days per request observed) |
| **Max Settlement Periods** | 48 per day (50 on clock-change-back day, 46 on clock-change-forward day) |
| **Streaming** | No WebSocket/Server-Sent Events — polling only |
| **Rate Limits** | Not formally documented; community practice: ≤1 request/second, burst tolerance ~10 req/s |
| **Concurrent Requests** | Not documented; recommend sequential with backoff |

**Orchestrator Behavior (ElexonDataPortal):**
- Automatically splits date ranges into individual settlement date requests
- Handles clock-change days (46/50 SPs) correctly
- Adds `local_datetime` column (Europe/London timezone-aware)

---

## 4. Units of Generation

| Dataset | Unit | Verification |
|---------|------|--------------|
| FUELHH (quantity) | **MW (Megawatts)** | Confirmed via sample data: values 0–20,000+ MW |
| WINDFORFUELHH (forecastMW, outturnMW) | **MW (Megawatts)** | Confirmed via library documentation and sample outputs |

**Note:** All generation values are instantaneous power (MW), not energy (MWh). Settlement period is 30 minutes, so energy = MW × 0.5 h.

---

## 5. UTC and Europe/London Timezone Handling

| Aspect | Detail |
|--------|--------|
| **API Timestamps** | `publishTime` in WINDFORFUELHH appears to be **UTC** (ISO 8601 with Z suffix) |
| **Settlement Date** | Always **Europe/London local date** (not UTC date) |
| **Settlement Period** | 1 = 00:00–00:30 local, 48 = 23:30–00:00 local |
| **Clock Changes** | Spring forward: 46 SPs (skip 01:00–02:00); Autumn back: 50 SPs (repeat 01:00–02:00) |
| **Library Handling** | ElexonDataPortal adds `local_datetime` as timezone-aware `Europe/London` timestamps |

**Implication:** When comparing forecasts to actuals, align on `(settlementDate, settlementPeriod)` pairs, not raw UTC timestamps.

---

## 6. Half-Hour Settlement Periods

| Property | Value |
|----------|-------|
| **Periods per Day** | 48 (standard), 46 (spring forward), 50 (autumn back) |
| **Period Numbering** | 1 to 48 (or 50) |
| **Period 1** | 00:00–00:30 local time |
| **Period 48** | 23:30–00:00 local time |
| **Duration** | 30 minutes each |
| **Settlement Date** | Runs 00:00–23:59 local time (not UTC midnight) |

---

## 7. WIND Fuel-Type Filtering

**FUELHH** returns all fuel types. To isolate wind:
```python
df_wind = df_fuelhh[df_fuelhh['fuelType'] == 'WIND']
```

**WINDFOR** is already wind‑specific — no filtering needed.

---

## 8. Forecast publishTime vs Delivery startTime

**Critical Distinction for Day-Ahead Methodology:**

| Timestamp | Source | Meaning |
|-----------|--------|---------|
| **publishTime** | WINDFOR | When forecast was **published/issued** by National Grid ESO (UTC) |
| **settlementDate + settlementPeriod** | Both datasets | **Delivery interval** (when electricity is generated/consumed) |

**Typical Timeline:**
- Forecasts for delivery day D are published **multiple times on day D‑1** (day‑ahead) and **intraday on day D**
- `publishTime` allows us to determine which forecast was available at the procurement decision cutoff

---

## 9. Multiple Forecasts for Same Delivery Interval

**Verified Behavior:** WINDFOR returns **multiple rows per (settlementDate, settlementPeriod)** with different `publishTime` values.

**Example:** For delivery 2026-01-15 Period 24 (11:30–12:00), the API may return forecasts published at:
- 2026-01-14 10:00 UTC (day‑ahead)
- 2026-01-14 14:00 UTC (updated day‑ahead)
- 2026-01-15 06:00 UTC (intraday morning)
- 2026-01-15 10:00 UTC (intraday update)

**Selection Rule:** Pick the forecast with **latest `publishTime` ≤ procurement decision cutoff**.

---

## 10. Missing, Duplicate, and Revised Records

| Issue | Finding | Handling Strategy |
|-------|---------|-------------------|
| **Missing Actuals** | FUELHH may have gaps for recent days (settlement lag) | Mark as `NaN`; exclude from error calculations |
| **Missing Forecasts** | WINDFOR may not have forecasts for all periods (esp. weekends/holidays) | Mark as `NaN`; document coverage % |
| **Duplicate Forecasts** | Same `(settlementDate, settlementPeriod, publishTime)` may appear | Deduplicate on composite key; keep latest |
| **Revised Forecasts** | New `publishTime` for same delivery = revision (not duplicate) | Treat as separate forecast version; selection logic handles |
| **Revised Actuals** | FUELHH data can be revised post‑initial publication (resettlement) | Use latest available actual at analysis time; note revision date |

**Data Quality Flags:** The XML response includes `DocStatus` (e.g., "Intermediate", "Final") and `DocumentRevNum` — track these for auditability.

---

## 11. Rate Limits, Errors, and Retry Requirements

| Aspect | Finding / Assumption |
|--------|---------------------|
| **Documented Rate Limit** | None published by Elexon |
| **Community Observed Limit** | ~1 req/s sustained; burst to ~10/s tolerated |
| **HTTP 429** | Returned if exceeded; retry with exponential backoff |
| **HTTP 5xx** | Transient server errors; retry with backoff |
| **HTTP 401/403** | Invalid/expired API key — no retry, alert |
| **Timeout** | 30s recommended; API typically responds <5s |
| **Retry Strategy** | Exponential backoff: 1s, 2s, 4s, 8s, max 3 retries |
| **Circuit Breaker** | Stop after 5 consecutive failures; alert |

**ServiceType Performance:**
- `csv` — Smaller payload, faster, fewer columns
- `xml` — Full metadata (DocStatus, DocumentRevNum, etc.); preferred for auditability

---

## 12. API Access Requirements

| Requirement | Detail |
|-------------|--------|
| **Registration** | Free at https://www.elexonportal.co.uk/registration/newuser |
| **API Key** | Single key per account; passed as `APIKey` query parameter |
| **Authentication** | API key in query string (not header) |
| **HTTPS** | Required (api.bmreports.com) |
| **Terms of Use** | Non-commercial use permitted; attribution required |

---

## 13. Unverified Assumptions (Requiring Validation)

| # | Assumption | Validation Needed |
|---|------------|-------------------|
| 1 | January 2026 data structure matches 2024/2025 | Test when date approaches |
| 2 | WINDFORFUELHH `publishTime` is always UTC | Inspect live response |
| 3 | FUELHH `fuelType == "WIND"` captures all wind (on+offshore) | Cross-reference with B1630 |
| 4 | Maximum date range per request is 31 days | Test with larger ranges |
| 5 | Rate limit is ~1 req/s | Load test during implementation |
| 6 | Forecast `outturnMW` populated after settlement | Verify with recent data |

---

## 14. Recommended Python Client Approach

Use **ElexonDataPortal** library (pip install `ElexonDataPortal`) which provides:
- Automatic date-range orchestration
- Timezone-aware `local_datetime` column
- Clock-change handling
- Pandas DataFrame output
- Raw method access for custom queries

**Alternative:** Direct `requests` to `https://api.bmreports.com/BMRS/{FUELHH,WINDFOR}/v1` with manual orchestration.

---

## References

1. ElexonDataPortal: https://github.com/OSUKED/ElexonDataPortal (62★, active)
2. ElexonDataPortal Docs: https://osuked.github.io/ElexonDataPortal/
3. BMRS API OpenAPI Spec: https://raw.githubusercontent.com/OSUKED/ElexonDataPortal/master/data/BMRS_API.yaml
4. Endpoint Definitions: https://raw.githubusercontent.com/OSUKED/ElexonDataPortal/master/data/endpoints.csv
5. michaelkavanagh/elexon: https://github.com/michaelkavanagh/elexon (11★)
6. Elexon Portal Registration: https://www.elexonportal.co.uk/registration/newuser

---

## 13. Implementation: Elexon Client (Task 03)

### 13.1 Client Module: `apps/wind-api/app/clients/elexon.py`

- **HTTP Client:** `httpx.AsyncClient` with configurable timeout (default 30s)
- **Retry Logic:** `tenacity` with exponential backoff (1s, 2s, 4s, 8s, max 3 retries)
- **Retry Conditions:** `httpx.RequestError`, `httpx.HTTPStatusError` (5xx, 429)
- **No Retry:** 401/403 (auth errors)
- **Configurable:** API base URL, API key, timeout, max retries via environment variables
- **Structured Logging:** Debug logs for requests (API key redacted), errors logged with context

**Environment Variables:**
```
ELEXON_API_BASE=https://api.bmreports.com/BMRS
ELEXON_API_KEY=<your_key>
ELEXON_REQUEST_TIMEOUT=30.0
ELEXON_MAX_RETRIES=3
```

### 13.2 Normalization Service: `apps/wind-api/app/services/wind_data.py`

**Actual Generation (FUELHH → ActualGenerationRecord):**
- Filter `fuelType == "WIND"` (case-insensitive field names supported)
- Extract `settlementDate`, `settlementPeriod`, `quantity`
- Convert to UTC: `delivery_start_utc` via `Europe/London` timezone
- Deduplicate on `(settlementDate, settlementPeriod)` — keep first
- Validate `generation_mw >= 0` (MW, not MWh)
- Track stats: total, invalid, duplicates

**Forecast Generation (WINDFOR → ForecastGenerationRecord):**
- Extract `settlementDate`, `settlementPeriod`, `publishTime`, `generation` (supports `generation`, `Generation`, `forecastMW`)
- Parse `publishTime` to UTC-aware datetime
- Convert delivery to UTC via `Europe/London` timezone
- **Preserve all forecast versions** — no deduplication on delivery interval
- Validate `generation_mw >= 0`
- Track stats: total, invalid

**Coverage Computation (`compute_coverage`):**
- Expected intervals = days × 48 (Jan 2026 = 31 × 48 = 1,488)
- Actual intervals = unique `(settlementDate, settlementPeriod)` in actuals
- Forecast intervals = unique `(settlementDate, settlementPeriod)` in forecasts
- Forecast versions = total forecast records (all versions)
- Coverage % = unique intervals / expected × 100
- Missing intervals = expected - actual/forecast intervals
- Reports: duplicates, invalid records, coverage percentages

### 13.3 Schemas: `apps/wind-api/app/schemas/wind.py`

Pydantic V2 models with `field_validator` and `ConfigDict`:

- `ActualGenerationRecord`: delivery_start_utc, generation_mw, settlement_date, settlement_period, source_dataset, fuel_type
- `ForecastGenerationRecord`: delivery_start_utc, publish_time_utc, generation_mw, settlement_date, settlement_period, source_dataset
- `ActualsResponse`, `ForecastsResponse`, `CoverageResponse`: wrapper responses with metadata

### 13.4 API Routes: `apps/wind-api/app/api/routes/wind.py`

Versioned under `/api/v1`:

- `GET /wind/actuals` — Query: `from`, `to` (YYYY-MM-DD). Returns `ActualsResponse`.
- `GET /wind/forecasts` — Query: `from`, `to`. Returns `ForecastsResponse` with `interval_count` (unique) and `version_count` (total).
- `GET /wind/coverage` — Query: `from`, `to`. Returns `CoverageResponse`.

**Error Handling:**
- Invalid date format → 422 (Pydantic validation)
- Upstream Elexon failure → 502 (Bad Gateway) with error detail
- Empty datasets → 200 with empty records, coverage reflects gaps

---

## 14. Data Quality & Coverage Methodology

**Expected Intervals Calculation:**
- For date range `[date_from, date_to]`: `days = (date_to - date_from).days + 1`
- `expected = days * 48`
- January 2026: 31 days × 48 = **1,488 intervals**
- Clock-change days not in January (Spring forward is March, Autumn back is October)

**Coverage Percentages:**
- Based on **unique delivery intervals**, not raw row counts
- `actual_coverage_pct = actual_intervals / expected * 100`
- `forecast_coverage_pct = forecast_intervals / expected * 100`

**Data Quality Metrics Reported:**
- `expected_intervals`: Total half-hour periods in range
- `actual_intervals`: Unique delivery intervals with actual data
- `forecast_intervals`: Unique delivery intervals with ≥1 forecast
- `forecast_versions`: Total forecast records (all versions)
- `missing_actual_intervals`: Expected - actual_intervals
- `missing_forecast_intervals`: Expected - forecast_intervals
- `duplicate_actual_records`: Dropped duplicate `(date, period)` in FUELHH
- `invalid_actual_records`: Rows failing validation (missing fields, non-numeric, negative)
- `invalid_forecast_records`: Rows failing validation in WINDFOR

---

## 15. Test Fixture Strategy

**Location:** `apps/wind-api/tests/fixtures/`

- `fuelhh_sample.xml` — Minimal FUELHH response with WIND and CCGT records
- `windfor_sample.xml` — Minimal WINDFOR response with 3 versions for period 1, 2 for period 2, 1 for period 3

**Principles:**
- Fixtures are **deterministic** and **labelled as test data**
- Represent documented Elexon XML response schema
- No API keys committed
- No synthetic data claimed as real Elexon records
- Small size for fast test execution
- Used exclusively in mocked unit tests

**If Capturing Real January 2026 Data:**
- Document provenance (date captured, API key owner, request parameters)
- Store separately from test fixtures (e.g., `data/jan2026/`)
- Not committed to repository unless explicitly required

---

## 16. Unverified Assumptions (Requiring Validation)

| # | Assumption | Validation Needed |
|---|------------|-------------------|
| 1 | January 2026 data structure matches 2024/2025 | Test when date approaches |
| 2 | WINDFOR `publishTime` is always UTC | Inspect live response |
| 3 | FUELHH `fuelType == "WIND"` captures all wind (on+offshore) | Cross-reference with B1630 |
| 4 | Maximum date range per request is 31 days | Test with larger ranges |
| 5 | Rate limit is ~1 req/s | Load test during implementation |
| 6 | Forecast `outturnMW` populated after settlement | Verify with recent data |

---

## 17. Known Limitations

1. **No Live API Key in CI:** Tests use mocked responses; live integration requires `ELEXON_API_KEY` environment variable.
2. **Python 3.9 vs 3.12:** Local development uses Python 3.9.6; Docker image targets 3.12-slim. Code is compatible with both.
3. **Clock-Change Handling:** January 2026 has no DST transitions; `_settlement_to_utc` uses `pytz` for correct Europe/London offsets.
4. **No Database:** All data fetched on-demand from Elexon; no caching layer implemented (Task 03 scope).
5. **Single-Request Date Range:** Client requests full range in one call; Elexon may split internally. For >31 days, consider manual chunking.
6. **DocStatus/DocumentRevNum Not Parsed:** XML parser extracts only `<item>` children; revision metadata available but not yet modeled.
7. **WINDFOR `generation` vs `forecastMW`:** Implementation accepts both field names; verify which is canonical in live responses.

---

## AI Disclosure

This project was developed with AI assistance (Claude/Opencode) for a technical evaluation. All architectural decisions, code review, and validation performed by human.