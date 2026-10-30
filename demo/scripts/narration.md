# Wind Forecast Intelligence — verified English narration

Voice: macOS Daniel (en-GB), 145 words per minute. Values are substituted from live preflight and current test output.

## 0:00 — Wind Forecast Intelligence

Welcome to Wind Forecast Intelligence. This dashboard compares actual UK wind generation with the forecasts available before a day ahead decision cutoff. It helps energy analysts, procurement teams, and operational planners understand how well those forecasts matched delivery. Wind output changes with the weather, so a single forecast should never be treated as certainty. Here, we will inspect real January twenty twenty six data from Elexon, explore forecast errors, and then look at the code that makes the comparison reproducible.

## 0:40 — Four measures of forecast performance

The first cards summarise the selected month. Mean absolute error is 2,126.12 megawatts. Think of this as the average size of the miss, regardless of whether the forecast was too high or too low. Root mean squared error is 2,620.8 megawatts. It gives larger misses more weight, making it useful when occasional large errors matter. Mean forecast bias is 1,840.3 megawatts. Its positive sign means the selected forecasts overestimated generation on average. Evaluated coverage is 100 percent, across 1488 half hour intervals. Coverage tells us how much data could be compared; it does not mean the forecasts were perfectly accurate. These are historical measurements for this selection, not guarantees about future wind production.

## 1:40 — Forecast versus actual generation

The blue line shows actual wind generation, and the amber line shows the selected forecast. Following them together makes the timing and size of the differences easier to see. I can focus on a single day without changing the monthly summary. The error chart below uses forecast minus actual. Red bars above zero indicate overestimation: more wind was expected than actually arrived. Blue bars below zero indicate underestimation. A value near zero means the two were close for that interval. The tooltip provides the timestamp and numerical values. Both the direction and the size of these errors matter when interpreting operational exposure. This visual comparison helps analysts find periods worth investigating before they draw conclusions from an average alone.

## 2:40 — Reproduce a decision with filters

The controls let us ask a more specific question. I will select a shorter January date range, change the decision cutoff, and choose the time zone used to interpret that cutoff. Applying the filters sends real requests to the backend. We wait until those requests finish before reading the updated results. The cutoff determines which forecast publications were available to the decision maker, rather than using a later forecast with hindsight. Refresh requests the current selection again. Loading indicators and disabled refresh controls show that the application is working. Finally, I will restore the full month and the default London noon cutoff so the next view has the same context as our opening summary. Changing these controls changes the evaluation, not the underlying recorded generation.

## 3:40 — Interpret the evidence and limitations

Accuracy details add context beyond the headline averages. Directional measures distinguish overestimation from underestimation, while the error percentiles help reveal the tail of the distribution. The business insight describes the observed bias, but it does not calculate a financial saving. For procurement, unexpected shortfalls or surpluses may require balancing decisions; this dashboard provides historical evidence for that discussion. Data quality separates raw source availability from evaluated coverage after alignment and forecast expansion. Those percentages measure different things and should not be confused. The methodology panel explains the cutoff, publication eligibility, hourly forecast expansion, and the error convention. The transparency table exposes the selected publication and cutoff alongside each delivery interval, helping a reviewer trace a result. Important limitations remain: this demonstration covers January only, publication discovery samples fixed historical times, and there is no persistent cache. We should validate other periods and operational assumptions before using the results in a production decision process. Forecast uncertainty remains even when every interval has data.

## 5:00 — Architecture and repository structure

Now we move from the product demonstration to the implementation. This is an Nx monorepo with a React frontend and a FastAPI backend. The frontend lives under apps, wind web. It uses TypeScript, Vite, Tailwind version four, and Recharts. A typed API client connects the dashboard to versioned backend endpoints. The backend lives under apps, wind API, with separate route, client, schema, and service modules. The Elexon client retrieves the public historical datasets. Normalisation prepares records for forecast selection, alignment, and metric calculation. The package scripts coordinate development, builds, and checks across the workspace. These are actual repository files displayed in a read only, allowlisted source viewer, rather than a simulated editor or terminal.

## 5:50 — Retrieve historical Elexon data

Here is the real Elexon integration. Actual generation comes from the FUEL H H dataset, filtered to wind. The client requests the selected settlement date range and converts the returned records into a consistent representation. Forecasts come from the wind generation history endpoint associated with WINDFOR. The retrieval loop asks for historical snapshots at six and ten in the morning, UTC, on the day before each delivery date. That is an important discovery limitation: the code does not enumerate every possible publication before the cutoff. The returned publication timestamp is retained so eligibility can be checked later. Network requests have timeouts and retry handling. The normalisation service then converts timestamps to UTC and records invalid or duplicate source records. None of the values in this video have been replaced with mock data.

## 6:50 — Select eligible forecasts and align intervals

Forecast selection starts with the decision cutoff. The default is noon in Europe London on the previous day. The service converts that boundary to UTC, excludes publications after it, and selects the latest eligible publication. Deterministic tie breaking makes repeated evaluations consistent. This prevents look ahead bias within the publications that were actually retrieved. It does not overcome the fixed time discovery limitation we just discussed. The forecast source is hourly, while actual generation is half hourly. Each selected hourly value is expanded across its two half hour delivery intervals. Actuals and forecasts are then aligned on the same delivery start time. Missing values are preserved as missing rather than silently converted to zero. The error calculation subtracts actual generation from forecast generation, and percentage metrics exclude zero actual generation. These rules are covered by backend tests.

## 7:50 — Inspect live API responses in Swagger

FastAPI exposes interactive Swagger documentation generated from the running service. First, the health endpoint confirms the API is responding. The accuracy endpoint returns metrics together with the selected dates, cutoff configuration, and methodology. The time series endpoint exposes aligned delivery intervals, actual generation, selected forecast, and error values. The coverage endpoint reports source availability and quality counts. I am executing these requests against the local running backend and showing their actual successful responses. A one day range keeps the example readable and avoids repeating the full monthly payload. These structured responses make it possible for another client to reproduce the same analysis without depending on the dashboard presentation.

## 8:40 — Validation and deployment configuration

These are fresh command results from this repository. The backend pytest suite passes 90 tests, and frontend Vitest passes 14 tests. TypeScript strict checking, ESLint, Ruff, and the production build also complete successfully. The tests cover selection rules, alignment, metrics, route filters, and key interface behaviour. Dockerfiles and Vercel configuration are present in the repository. Their presence is not proof of a working deployment: this recording does not claim that Docker images or a Vercel deployment were tested. Production rollout still needs its own environment and integration checks.

## 9:20 — Evidence for better forecast decisions

Wind Forecast Intelligence makes forecast accuracy traceable. React and FastAPI power the analysis. Fixed publication sampling remains a limitation. This project used AI assistance. Thank you.
