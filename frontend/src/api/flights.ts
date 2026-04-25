import type { InterpretResponse } from "./voice";
import type { NormalizedFlightSlots } from "../flightMerge";

const base = (): string =>
  (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export type LiveSearchLegSummary = {
  originIata: string | null;
  destinationIata: string | null;
  departure: Record<string, unknown>;
  arrival: Record<string, unknown>;
  durationInMinutes?: number;
  stopCount?: number;
  carrierName?: string | null;
};

export type LiveSearchItinerarySummary = {
  id: string;
  priceAmount: number | null;
  deepLink: string | null;
  legs: LiveSearchLegSummary[];
};

export type LiveSearchPayload = {
  itineraryCount: number;
  itineraries: LiveSearchItinerarySummary[];
  skyscannerStatus?: string;
  sessionToken?: string;
};

export type LiveSearchResponse = {
  ready: boolean;
  mergedEntities: Record<string, unknown>;
  slots: NormalizedFlightSlots;
  searchFingerprint: string;
  liveSearch: LiveSearchPayload | null;
};

export async function liveSearchFromHistory(
  history: InterpretResponse[],
): Promise<LiveSearchResponse> {
  const url = `${base()}/api/flights/live-search`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      history: history.map((h) => ({
        transcript: h.transcript,
        parsed: h.parsed as Record<string, unknown>,
      })),
    }),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }

  return (await res.json()) as LiveSearchResponse;
}
