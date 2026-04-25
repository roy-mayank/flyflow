import type { InterpretResponse } from "./api/voice";

export function mergeFlightEntitiesFromHistory(
  history: InterpretResponse[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const h of history) {
    const e = h.parsed?.entities;
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    for (const [k, v] of Object.entries(e as Record<string, unknown>)) {
      if (v != null) merged[k] = v;
    }
  }
  return merged;
}

const IATA_RE = /^[A-Z0-9]{3}$/i;

function normIata(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  return IATA_RE.test(s) ? s : null;
}

function coerceDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return s;
}

export type NormalizedFlightSlots = {
  originIata: string | null;
  destinationIata: string | null;
  outboundDate: string | null;
  returnDate: string | null;
  adults: number;
  cabinClass: string;
  market: string | null;
  locale: string | null;
  currency: string | null;
};

export function normalizeSlots(merged: Record<string, unknown>): NormalizedFlightSlots {
  const origin =
    normIata(merged.originIata) ?? normIata(merged.origin);
  const destination =
    normIata(merged.destinationIata) ?? normIata(merged.destination);
  const outboundDate =
    coerceDate(merged.outboundDate) ?? coerceDate(merged.departureDate);
  const returnDate =
    coerceDate(merged.returnDate) ?? coerceDate(merged.inboundDate);
  let adults = 1;
  if (merged.adults != null) {
    const n = Number(merged.adults);
    if (!Number.isNaN(n)) adults = Math.min(9, Math.max(1, Math.floor(n)));
  }
  const cabinClass = String(merged.cabinClass ?? "economy")
    .trim()
    .toLowerCase();
  const marketRaw = String(merged.market ?? "").trim().toUpperCase();
  const localeRaw = String(merged.locale ?? "").trim();
  const currencyRaw = String(merged.currency ?? "").trim().toUpperCase();
  return {
    originIata: origin,
    destinationIata: destination,
    outboundDate,
    returnDate,
    adults,
    cabinClass,
    market: marketRaw || null,
    locale: localeRaw || null,
    currency: currencyRaw || null,
  };
}

export function isSearchReady(slots: NormalizedFlightSlots): boolean {
  return Boolean(
    slots.originIata && slots.destinationIata && slots.outboundDate,
  );
}

export function searchFingerprint(slots: NormalizedFlightSlots): string {
  return [
    slots.originIata ?? "",
    slots.destinationIata ?? "",
    slots.outboundDate ?? "",
    slots.returnDate ?? "",
    String(slots.adults),
    slots.cabinClass,
  ].join("|");
}
