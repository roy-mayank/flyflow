import type { LiveSearchResponse } from "../api/flights";
import type { InterpretResponse } from "../api/voice";

type ResultsPanelProps = {
  result: InterpretResponse | null;
  requestError: string | null;
  interpretHistory: InterpretResponse[];
  flightSnapshot: LiveSearchResponse | null;
  flightLoading: boolean;
  flightError: string | null;
};

function formatTimeParts(parts: Record<string, unknown>): string {
  const y = parts.year;
  const m = parts.month;
  const d = parts.day;
  const h = parts.hour;
  const min = parts.minute;
  if (
    typeof y !== "number" ||
    typeof m !== "number" ||
    typeof d !== "number"
  ) {
    return "—";
  }
  const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (typeof h === "number" && typeof min === "number") {
    return `${date} ${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  return date;
}

export function ResultsPanel({
  result,
  requestError,
  interpretHistory,
  flightSnapshot,
  flightLoading,
  flightError,
}: ResultsPanelProps) {
  return (
    <section className="results-panel" aria-labelledby="results-heading">
      <h2 id="results-heading">Last result</h2>
      {requestError ? (
        <p className="results-error" role="alert">
          {requestError}
        </p>
      ) : null}
      {!result && !requestError ? (
        <p className="results-empty">
          Speak after enabling voice to see a transcript here.
        </p>
      ) : null}
      {result ? (
        <div className="results-body">
          <div>
            <h3>Transcript</h3>
            <p className="results-transcript">{result.transcript || "—"}</p>
          </div>
          <div>
            <h3>Parsed intent</h3>
            <pre className="results-json">
              {JSON.stringify(result.parsed, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}

      <div className="results-flight-section">
        <h2 className="results-flight-heading">Voice history and flights</h2>
        <p className="results-flight-meta">
          Segments in session: {interpretHistory.length}
        </p>

        {flightLoading ? (
          <p className="results-flight-status" aria-live="polite">
            Updating flight search…
          </p>
        ) : null}
        {flightError ? (
          <p className="results-error" role="alert">
            {flightError}
          </p>
        ) : null}

        {flightSnapshot ? (
          <div className="results-flight-body">
            <div>
              <h3>Merged slots</h3>
              <p className="results-flight-ready">
                Search ready:{" "}
                <strong>{flightSnapshot.ready ? "yes" : "no"}</strong>
                {flightSnapshot.ready
                  ? null
                  : " — keep speaking: need origin, destination, and outbound date (IATA + YYYY-MM-DD)."}
              </p>
              <pre className="results-json results-json--compact">
                {JSON.stringify(flightSnapshot.slots, null, 2)}
              </pre>
            </div>
            {flightSnapshot.ready && flightSnapshot.liveSearch ? (
              <div>
                <h3>Skyscanner live search</h3>
                <p className="results-flight-meta">
                  Status:{" "}
                  <code>{String(flightSnapshot.liveSearch.skyscannerStatus ?? "—")}</code>{" "}
                  · Itineraries: {flightSnapshot.liveSearch.itineraryCount}
                </p>
                <ul className="itinerary-list">
                  {flightSnapshot.liveSearch.itineraries.map((it) => (
                    <li key={it.id} className="itinerary-card">
                      <div className="itinerary-card__head">
                        {it.priceAmount != null ? (
                          <span className="itinerary-price">
                            from {it.priceAmount.toFixed(0)}
                            {flightSnapshot.slots.currency
                              ? ` ${flightSnapshot.slots.currency}`
                              : ""}
                          </span>
                        ) : (
                          <span className="itinerary-price">Price n/a</span>
                        )}
                        {it.deepLink ? (
                          <a
                            href={it.deepLink}
                            className="itinerary-link"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View deal
                          </a>
                        ) : null}
                      </div>
                      <ul className="itinerary-legs">
                        {it.legs.map((leg, i) => (
                          <li key={i} className="itinerary-leg">
                            <span className="itinerary-leg__route">
                              {leg.originIata ?? "?"} → {leg.destinationIata ?? "?"}
                            </span>
                            {leg.carrierName ? (
                              <span className="itinerary-leg__carrier">
                                {leg.carrierName}
                              </span>
                            ) : null}
                            <span className="itinerary-leg__time">
                              dep {formatTimeParts(leg.departure)} · arr{" "}
                              {formatTimeParts(leg.arrival)}
                              {typeof leg.stopCount === "number"
                                ? ` · ${leg.stopCount} stop(s)`
                                : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : interpretHistory.length > 0 &&
          !flightLoading &&
          !flightError ? (
          <p className="results-flight-status">Waiting for flight merge…</p>
        ) : null}
      </div>
    </section>
  );
}
