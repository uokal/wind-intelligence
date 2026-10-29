from datetime import datetime
from fastapi import APIRouter, Query, HTTPException, Depends
from pydantic import BaseModel, field_validator

from app.clients.elexon import ElexonClient
from app.services.wind_data import fetch_and_normalize
from app.schemas.wind import (
    ActualsResponse,
    ForecastsResponse,
    CoverageResponse,
)

router = APIRouter()


class DateRangeParams(BaseModel):
    model_config = {"extra": "forbid"}
    
    date_from: str = Query(..., description="Start date (YYYY-MM-DD)", alias="from")
    date_to: str = Query(..., description="End date (YYYY-MM-DD)", alias="to")

    @field_validator("date_from", "date_to")
    @classmethod
    def _validate_format(cls, v):
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("Date must be YYYY-MM-DD")
        return v


def get_elexon_client() -> ElexonClient:
    return ElexonClient()


@router.get("/wind/actuals", response_model=ActualsResponse, summary="Get actual wind generation")
async def get_actuals(
    date_from: str = Query(..., alias="from", description="Start date YYYY-MM-DD"),
    date_to: str = Query(..., alias="to", description="End date YYYY-MM-DD"),
    client: ElexonClient = Depends(get_elexon_client),
):
    try:
        actuals, _, _ = await fetch_and_normalize(client, date_from, date_to)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream Elexon error: {e}")
    return ActualsResponse(
        date_from=date_from,
        date_to=date_to,
        interval_count=len(actuals),
        records=actuals,
    )


@router.get("/wind/forecasts", response_model=ForecastsResponse, summary="Get wind forecasts (all versions)")
async def get_forecasts(
    date_from: str = Query(..., alias="from", description="Start date YYYY-MM-DD"),
    date_to: str = Query(..., alias="to", description="End date YYYY-MM-DD"),
    client: ElexonClient = Depends(get_elexon_client),
):
    try:
        _, forecasts, _ = await fetch_and_normalize(client, date_from, date_to)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream Elexon error: {e}")
    return ForecastsResponse(
        date_from=date_from,
        date_to=date_to,
        interval_count=len({(r.settlement_date, r.settlement_period) for r in forecasts}),
        version_count=len(forecasts),
        records=forecasts,
    )


@router.get("/wind/coverage", response_model=CoverageResponse, summary="Get data coverage for period")
async def get_coverage(
    date_from: str = Query(..., alias="from", description="Start date YYYY-MM-DD"),
    date_to: str = Query(..., alias="to", description="End date YYYY-MM-DD"),
    client: ElexonClient = Depends(get_elexon_client),
):
    try:
        _, _, coverage = await fetch_and_normalize(client, date_from, date_to)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream Elexon error: {e}")
    return coverage