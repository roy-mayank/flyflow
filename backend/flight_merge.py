"""Merge flight-related slots from voice interpret history (chronological shallow merge)."""

from __future__ import annotations

import re
from datetime import date
from typing import Any

def merge_flight_entities_from_history(history: list[dict[str, Any]]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for entry in history:
        parsed = entry.get("parsed")
        if not isinstance(parsed, dict):
            continue
        entities = parsed.get("entities")
        if not isinstance(entities, dict):
            continue
        for k, v in entities.items():
            if v is not None:
                merged[k] = v
    return merged


_IATA_RE = re.compile(r"^[A-Z0-9]{3}$")


def _norm_iata(raw: Any) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip().upper()
    if _IATA_RE.match(s):
        return s
    return None


def _coerce_date(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, str):
        s = raw.strip()
        m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
        if not m:
            return None
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            date(y, mo, d)
        except ValueError:
            return None
        return s
    return None


def normalize_slots(merged: dict[str, Any]) -> dict[str, Any]:
    """Canonical slot dict for readiness + fingerprint."""
    origin = _norm_iata(merged.get("originIata")) or _norm_iata(merged.get("origin"))
    dest = _norm_iata(merged.get("destinationIata")) or _norm_iata(
        merged.get("destination")
    )
    out = _coerce_date(merged.get("outboundDate")) or _coerce_date(
        merged.get("departureDate")
    )
    ret = _coerce_date(merged.get("returnDate")) or _coerce_date(
        merged.get("inboundDate")
    )
    adults_raw = merged.get("adults", 1)
    try:
        adults = int(adults_raw)
    except (TypeError, ValueError):
        adults = 1
    adults = max(1, min(adults, 9))
    cabin = str(merged.get("cabinClass") or "economy").strip().lower()
    return {
        "originIata": origin,
        "destinationIata": dest,
        "outboundDate": out,
        "returnDate": ret,
        "adults": adults,
        "cabinClass": cabin,
        "market": str(merged.get("market") or "").strip().upper() or None,
        "locale": str(merged.get("locale") or "").strip() or None,
        "currency": str(merged.get("currency") or "").strip().upper() or None,
    }


def is_search_ready(slots: dict[str, Any]) -> bool:
    return bool(
        slots.get("originIata")
        and slots.get("destinationIata")
        and slots.get("outboundDate")
    )


def search_fingerprint(slots: dict[str, Any]) -> str:
    parts = [
        slots.get("originIata") or "",
        slots.get("destinationIata") or "",
        slots.get("outboundDate") or "",
        slots.get("returnDate") or "",
        str(slots.get("adults", 1)),
        str(slots.get("cabinClass") or "economy"),
    ]
    return "|".join(parts)
