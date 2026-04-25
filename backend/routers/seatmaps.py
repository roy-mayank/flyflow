"""Proxy endpoints for Quicket JETS seat map and cabin data.

Upstream docs: https://sandbox.quicket.io/redoc
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from quicket_client import QuicketConfigError, get_quicket_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/seatmaps", tags=["seatmaps"])


def _quicket() -> Any:
    return get_quicket_client()


class FlightPlaneFeaturesBody(BaseModel):
    """Body for POST /api/v1/flight/features/plane (max 6 flights)."""

    flights: list[dict[str, Any]] = Field(default_factory=list)
    featuresList: list[str] | None = None
    lang: str | None = Field(default="EN")
    units: str | None = Field(default="metric")


class FlightPlaneSeatmapBody(BaseModel):
    """Body for POST /api/v1/flight/features/plane/seatmap."""

    flight: dict[str, Any]
    lang: str | None = Field(default="EN")
    units: str | None = Field(default="metric")
    supportedSeatTypesCount: int | None = Field(default=45)


class FlightFeaturesBody(BaseModel):
    """Body for POST /api/v1/flight/features (max 300 flights)."""

    flights: list[dict[str, Any]] = Field(default_factory=list)
    featuresList: list[str] | None = None
    lang: str | None = Field(default="EN")
    units: str | None = Field(default="metric")


def _require_quicket():
    c = _quicket()
    if not c.configured():
        raise HTTPException(
            status_code=503,
            detail="Quicket is not configured (QUICKET_APP_ID, QUICKET_PRIVATE_KEY).",
        )
    return c


@router.get("/quicket/plane/by-reg/{reg}")
def quicket_plane_by_reg(reg: str):
    """Map to GET /api/v1/plane/info/by/reg/{reg}."""
    c = _require_quicket()
    path = f"/api/v1/plane/info/by/reg/{reg}"
    try:
        status, data, raw = c.request_json("GET", path)
    except QuicketConfigError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("Quicket plane by reg failed")
        raise HTTPException(status_code=502, detail=str(e)) from e
    if isinstance(data, dict | list):
        return Response(
            content=json.dumps(data),
            media_type="application/json",
            status_code=status,
        )
    raise HTTPException(status_code=status, detail=raw or "Upstream error")


@router.get("/quicket/seatmap/{link_id}")
def quicket_seatmap_link(
    link_id: str,
    colorTheme: str | None = Query(default=None, min_length=3, max_length=16),
    language: str | None = Query(default=None, max_length=5),
):
    """Map to GET /api/v1/plane/seatmap/{linkId} — seat map CDN URL metadata."""
    c = _require_quicket()
    params: dict[str, Any] = {}
    if colorTheme is not None:
        params["colorTheme"] = colorTheme
    if language is not None:
        params["language"] = language
    path = f"/api/v1/plane/seatmap/{link_id}"
    try:
        status, data, raw = c.request_json("GET", path, params=params or None)
    except QuicketConfigError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("Quicket seatmap link failed")
        raise HTTPException(status_code=502, detail=str(e)) from e
    if isinstance(data, dict | list):
        return Response(
            content=json.dumps(data),
            media_type="application/json",
            status_code=status,
        )
    raise HTTPException(status_code=status, detail=raw or "Upstream error")


@router.get("/quicket/seatmap/{link_id}/redirect")
def quicket_seatmap_redirect(
    link_id: str,
    colorTheme: str | None = Query(default=None, min_length=3, max_length=16),
    language: str | None = Query(default=None, max_length=5),
):
    """Forward 307 from GET /api/v1/plane/seatmap/{linkId}/redirect."""
    c = _require_quicket()
    params: dict[str, Any] = {}
    if colorTheme is not None:
        params["colorTheme"] = colorTheme
    if language is not None:
        params["language"] = language
    path = f"/api/v1/plane/seatmap/{link_id}/redirect"
    try:
        r = c.request_raw("GET", path, params=params or None)
    except QuicketConfigError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("Quicket seatmap redirect failed")
        raise HTTPException(status_code=502, detail=str(e)) from e
    loc = r.headers.get("location")
    if r.is_redirect and loc:
        return Response(status_code=r.status_code, headers={"Location": loc})
    if r.headers.get("content-type", "").startswith("application/json"):
        try:
            body = r.json()
            return Response(
                content=json.dumps(body),
                media_type="application/json",
                status_code=r.status_code,
            )
        except json.JSONDecodeError:
            pass
    return Response(content=r.content, status_code=r.status_code)


@router.post("/quicket/flight/features")
def quicket_flight_features(body: FlightFeaturesBody):
    """Map to POST /api/v1/flight/features (cabin-level amenities, max 300 flights)."""
    c = _require_quicket()
    payload: dict[str, Any] = {
        "flights": body.flights,
        "lang": body.lang or "EN",
        "units": body.units or "metric",
    }
    if body.featuresList is not None:
        payload["featuresList"] = body.featuresList
    try:
        status, data, raw = c.request_json(
            "POST", "/api/v1/flight/features", json_body=payload
        )
    except QuicketConfigError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("Quicket flight features failed")
        raise HTTPException(status_code=502, detail=str(e)) from e
    if isinstance(data, dict | list):
        return Response(
            content=json.dumps(data),
            media_type="application/json",
            status_code=status,
        )
    raise HTTPException(status_code=status, detail=raw or "Upstream error")


@router.post("/quicket/flight/plane-features")
def quicket_plane_features(body: FlightPlaneFeaturesBody):
    """Map to POST /api/v1/flight/features/plane (seatDetails, seatMapLink, media, …)."""
    c = _require_quicket()
    payload: dict[str, Any] = {
        "flights": body.flights,
        "lang": body.lang or "EN",
        "units": body.units or "metric",
    }
    if body.featuresList is not None:
        payload["featuresList"] = body.featuresList
    try:
        status, data, raw = c.request_json(
            "POST", "/api/v1/flight/features/plane", json_body=payload
        )
    except QuicketConfigError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("Quicket plane features failed")
        raise HTTPException(status_code=502, detail=str(e)) from e
    if isinstance(data, dict | list):
        return Response(
            content=json.dumps(data),
            media_type="application/json",
            status_code=status,
        )
    raise HTTPException(status_code=status, detail=raw or "Upstream error")


@router.post("/quicket/flight/plane-seatmap")
def quicket_plane_seatmap(body: FlightPlaneSeatmapBody):
    """Map to POST /api/v1/flight/features/plane/seatmap (full seat geometry per cabin)."""
    c = _require_quicket()
    payload: dict[str, Any] = {
        "flight": body.flight,
        "lang": body.lang or "EN",
        "units": body.units or "metric",
    }
    if body.supportedSeatTypesCount is not None:
        payload["supportedSeatTypesCount"] = body.supportedSeatTypesCount
    try:
        status, data, raw = c.request_json(
            "POST", "/api/v1/flight/features/plane/seatmap", json_body=payload
        )
    except QuicketConfigError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("Quicket plane seatmap failed")
        raise HTTPException(status_code=502, detail=str(e)) from e
    if isinstance(data, dict | list):
        return Response(
            content=json.dumps(data),
            media_type="application/json",
            status_code=status,
        )
    raise HTTPException(status_code=status, detail=raw or "Upstream error")
