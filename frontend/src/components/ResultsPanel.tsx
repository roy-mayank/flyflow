import type { InterpretResponse } from "../api/voice";

type ResultsPanelProps = {
  result: InterpretResponse | null;
  requestError: string | null;
};

export function ResultsPanel({ result, requestError }: ResultsPanelProps) {
  return (
    <section className="results-panel" aria-labelledby="results-heading">
      <h2 id="results-heading">Last result</h2>
      {requestError ? (
        <p className="results-error" role="alert">
          {requestError}
        </p>
      ) : null}
      {!result && !requestError ? (
        <p className="results-empty">Speak after enabling voice to see a transcript here.</p>
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
    </section>
  );
}
