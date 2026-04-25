"""Skyscanner Flights Live Prices: merge voice history, create/poll search, return summary."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from flight_merge import (
    is_search_ready,
    merge_flight_entities_from_history,
    normalize_slots,
    search_fingerprint,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/flights", tags=["flights"])

SKYSCANNER_CREATE_URL = (
    "https://partners.api.skyscanner.net/apiservices/v3/flights/live/search/create"
)
SKYSCANNER_POLL_URL = (
    "https://partners.api.skyscanner.net/apiservices/v3/flights/live/search/poll"
)

_MAX_POLLS = 35
_POLL_INTERVAL_SEC = 2.0
_REQUEST_TIMEOUT_SEC = 60.0


class HistoryEntry(BaseModel):
    transcript: str = ""
    parsed: dict[str, Any]


class LiveSearchRequest(BaseModel):
    history: list[HistoryEntry] = Field(default_factory=list)


_CABIN_MAP = {
    "economy": "CABIN_CLASS_ECONOMY",
    "premium_economy": "CABIN_CLASS_PREMIUM_ECONOMY",
    "premium economy": "CABIN_CLASS_PREMIUM_ECONOMY",
    "business": "CABIN_CLASS_BUSINESS",
    "first": "CABIN_CLASS_FIRST",
    "first class": "CABIN_CLASS_FIRST",
}


def _skyscanner_headers() -> dict[str, str]:
    key = os.getenv("SKYSCANNER_API_KEY", "").strip()
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Server is not configured with SKYSCANNER_API_KEY.",
        )
    return {
        "x-api-key": key,
        "Content-Type": "application/json",
    }


def _ymd_parts(iso_date: str) -> dict[str, int]:
    y, m, d = iso_date.split("-")
    return {"year": int(y), "month": int(m), "day": int(d)}


def _map_cabin(raw: str) -> str:
    key = raw.strip().lower().replace(" ", "_")
    return _CABIN_MAP.get(key, _CABIN_MAP.get(raw.strip().lower(), "CABIN_CLASS_ECONOMY"))


def build_live_prices_query(slots: dict[str, Any]) -> dict[str, Any]:
    market = slots.get("market") or os.getenv("SKYSCANNER_MARKET", "UK")
    locale = slots.get("locale") or os.getenv("SKYSCANNER_LOCALE", "en-GB")
    currency = slots.get("currency") or os.getenv("SKYSCANNER_CURRENCY", "GBP")
    origin = slots["originIata"]
    dest = slots["destinationIata"]
    out = slots["outboundDate"]
    ret = slots.get("returnDate")
    adults = int(slots.get("adults") or 1)
    cabin = _map_cabin(str(slots.get("cabinClass") or "economy"))

    leg_out = {
        "originPlaceId": {"iata": origin},
        "destinationPlaceId": {"iata": dest},
        "date": _ymd_parts(out),
    }
    query_legs: list[dict[str, Any]] = [leg_out]
    if ret:
        query_legs.append(
            {
                "originPlaceId": {"iata": dest},
                "destinationPlaceId": {"iata": origin},
                "date": _ymd_parts(ret),
            }
        )

    return {
        "market": market,
        "locale": locale,
        "currency": currency,
        "queryLegs": query_legs,
        "adults": adults,
        "cabinClass": cabin,
        "childrenAges": [],
        "includeSustainabilityData": True,
        "nearbyAirports": False,
    }


def _parse_price_amount(raw: Any) -> float | None:
    if raw is None:
        return None
    try:
        return float(str(raw).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _first_deeplink(itinerary: dict[str, Any]) -> str | None:
    for opt in itinerary.get("pricingOptions") or []:
        for item in opt.get("items") or []:
            link = item.get("deepLink")
            if isinstance(link, str) and link:
                return link
    return None


def _min_price_option(itinerary: dict[str, Any]) -> tuple[float | None, str | None]:
    best: float | None = None
    best_link: str | None = None
    for opt in itinerary.get("pricingOptions") or []:
        amt = _parse_price_amount((opt.get("price") or {}).get("amount"))
        link = _first_deeplink({"pricingOptions": [opt]})
        if amt is not None and (best is None or amt < best):
            best = amt
            best_link = link
    if best_link is None:
        best_link = _first_deeplink(itinerary)
    return best, best_link


def _place_iata(place_ref: Any, places_map: Any) -> str | None:
    if isinstance(place_ref, dict):
        iata = place_ref.get("iata")
        return str(iata) if iata else None
    if isinstance(place_ref, str) and isinstance(places_map, dict):
        p = places_map.get(place_ref)
        if isinstance(p, dict):
            iata = p.get("iata")
            return str(iata) if iata else None
    return None


def summarize_live_results(payload: dict[str, Any]) -> dict[str, Any]:
    content = payload.get("content") or {}
    results = content.get("results") or {}
    itineraries_raw = results.get("itineraries") or {}
    legs_map = results.get("legs") or {}
    places_map = results.get("places") or {}
    carriers_map = results.get("carriers") or {}

    rows: list[dict[str, Any]] = []
    if not isinstance(itineraries_raw, dict):
        return {"itineraryCount": 0, "itineraries": []}

    for it_id, it_data in itineraries_raw.items():
        if not isinstance(it_data, dict):
            continue
        price, deeplink = _min_price_option(it_data)
        leg_ids = it_data.get("legIds") or []
        leg_summaries: list[dict[str, Any]] = []
        for lid in leg_ids:
            leg = legs_map.get(lid) if isinstance(legs_map, dict) else None
            if not isinstance(leg, dict):
                continue
            o_pid = leg.get("originPlaceId")
            d_pid = leg.get("destinationPlaceId")
            o_iata = _place_iata(o_pid, places_map)
            d_iata = _place_iata(d_pid, places_map)
            dep = leg.get("departureDateTime") or {}
            arr = leg.get("arrivalDateTime") or {}
            m_ids = leg.get("marketingCarrierIds") or []
            carrier_name = None
            if m_ids and isinstance(carriers_map, dict):
                c0 = carriers_map.get(m_ids[0])
                if isinstance(c0, dict):
                    carrier_name = c0.get("name")
            leg_summaries.append(
                {
                    "originIata": o_iata,
                    "destinationIata": d_iata,
                    "departure": dep,
                    "arrival": arr,
                    "durationInMinutes": leg.get("durationInMinutes"),
                    "stopCount": leg.get("stopCount"),
                    "carrierName": carrier_name,
                }
            )
        rows.append(
            {
                "id": it_id,
                "priceAmount": price,
                "deepLink": deeplink,
                "legs": leg_summaries,
            }
        )

    rows.sort(
        key=lambda r: (
            r["priceAmount"] is None,
            r["priceAmount"] if r["priceAmount"] is not None else 1e18,
        )
    )
    return {"itineraryCount": len(rows), "itineraries": rows[:12]}


def _poll_status_done(status: Any) -> bool:
    if status is None:
        return False
    s = str(status).upper()
    if "FAIL" in s:
        return True
    return "COMPLETED" in s


def _poll_status_failed(status: Any) -> bool:
    if status is None:
        return False
    return "FAIL" in str(status).upper()


async def _run_live_search(query: dict[str, Any]) -> dict[str, Any]:
    headers = _skyscanner_headers()
    body = {"query": query}
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SEC) as client:
        try:
            cr = await client.post(SKYSCANNER_CREATE_URL, json=body, headers=headers)
        except httpx.RequestError as e:
            logger.exception("Skyscanner create request failed")
            raise HTTPException(
                status_code=502, detail=f"Skyscanner create failed: {e!s}"
            ) from None

        if cr.status_code == 401:
            raise HTTPException(status_code=502, detail="Skyscanner rejected API key.")
        if cr.status_code == 429:
            raise HTTPException(
                status_code=429, detail="Skyscanner rate limited; try again shortly."
            )
        if cr.status_code >= 400:
            text = cr.text[:500]
            logger.warning("Skyscanner create HTTP %s: %s", cr.status_code, text)
            raise HTTPException(
                status_code=502,
                detail=f"Skyscanner create error ({cr.status_code}).",
            )

        try:
            create_data = cr.json()
        except Exception:
            raise HTTPException(
                status_code=502, detail="Skyscanner create returned invalid JSON."
            ) from None

        session_token = create_data.get("sessionToken")
        if not session_token:
            raise HTTPException(
                status_code=502,
                detail="Skyscanner create response missing sessionToken.",
            )

        last_payload: dict[str, Any] = create_data
        poll_url = f"{SKYSCANNER_POLL_URL}/{session_token}"
        polls = 0
        while True:
            st = last_payload.get("status")
            if _poll_status_failed(st):
                break
            if _poll_status_done(st):
                break
            if polls >= _MAX_POLLS:
                break
            await asyncio.sleep(_POLL_INTERVAL_SEC)
            polls += 1
            try:
                pr = await client.post(poll_url, json={}, headers=headers)
            except httpx.RequestError as e:
                logger.exception("Skyscanner poll failed")
                raise HTTPException(
                    status_code=502, detail=f"Skyscanner poll failed: {e!s}"
                ) from None
            if pr.status_code >= 400:
                text = pr.text[:500]
                logger.warning("Skyscanner poll HTTP %s: %s", pr.status_code, text)
                raise HTTPException(
                    status_code=502,
                    detail=f"Skyscanner poll error ({pr.status_code}).",
                )
            try:
                last_payload = pr.json()
            except Exception:
                raise HTTPException(
                    status_code=502, detail="Skyscanner poll returned invalid JSON."
                ) from None

        summary = summarize_live_results(last_payload)
        summary["skyscannerStatus"] = last_payload.get("status")
        summary["sessionToken"] = session_token
        return summary


@router.post("/live-search")
async def live_search(body: LiveSearchRequest) -> dict[str, Any]:
    raw = [e.model_dump() for e in body.history]
    merged = merge_flight_entities_from_history(raw)
    slots = normalize_slots(merged)
    fp = search_fingerprint(slots)
    ready = is_search_ready(slots)

    base_out: dict[str, Any] = {
        "ready": ready,
        "mergedEntities": merged,
        "slots": slots,
        "searchFingerprint": fp,
    }

    if not ready:
        return {**base_out, "liveSearch": None}

    query = build_live_prices_query(slots)
    try:
        live = await _run_live_search(query)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Unexpected error during Skyscanner live search")
        raise HTTPException(
            status_code=500, detail="Unexpected error during flight search."
        ) from None

    return {**base_out, "liveSearch": live}
