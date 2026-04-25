import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { liveSearchFromHistory, type LiveSearchResponse } from "./api/flights";
import { interpretAudio, type InterpretResponse } from "./api/voice";
import { EntryModal, isIntroDismissed } from "./components/EntryModal";
import { ResultsPanel } from "./components/ResultsPanel";
import { VoiceFab } from "./components/VoiceFab";
import { VoiceStatusBar } from "./components/VoiceStatusBar";
import {
  isSearchReady,
  mergeFlightEntitiesFromHistory,
  normalizeSlots,
  searchFingerprint,
} from "./flightMerge";
import { useVoiceVad } from "./hooks/useVoiceVad";

const DB_THRESHOLD = -42;
const SPEECH_START_MS = 140;
const SILENCE_END_MS = 480;
const MIN_SEGMENT_MS = 450;
const FLIGHT_SEARCH_DEBOUNCE_MS = 450;

async function warmMicrophone(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
}

export default function App() {
  const [showIntro, setShowIntro] = useState(() => !isIntroDismissed());
  const [armed, setArmed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<InterpretResponse | null>(null);
  const [interpretHistory, setInterpretHistory] = useState<InterpretResponse[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [flightLoading, setFlightLoading] = useState(false);
  const [flightError, setFlightError] = useState<string | null>(null);
  const [flightSnapshot, setFlightSnapshot] = useState<LiveSearchResponse | null>(
    null,
  );
  const lastReadyFingerprintRef = useRef<string>("");
  const flightRequestGen = useRef(0);

  const onSegment = useCallback(async (blob: Blob) => {
    setUploading(true);
    setRequestError(null);
    try {
      const data = await interpretAudio(blob);
      setResult(data);
      if (data.transcript?.trim()) {
        setInterpretHistory((prev) => [...prev, data]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setRequestError(msg);
    } finally {
      setUploading(false);
    }
  }, []);

  useEffect(() => {
    if (interpretHistory.length === 0) {
      lastReadyFingerprintRef.current = "";
      setFlightSnapshot(null);
      setFlightError(null);
      return;
    }

    const merged = mergeFlightEntitiesFromHistory(interpretHistory);
    const slots = normalizeSlots(merged);
    const ready = isSearchReady(slots);
    const fp = searchFingerprint(slots);
    if (ready && fp === lastReadyFingerprintRef.current) {
      return;
    }

    const timer = window.setTimeout(async () => {
      const gen = ++flightRequestGen.current;
      setFlightLoading(true);
      setFlightError(null);
      try {
        const fs = await liveSearchFromHistory(interpretHistory);
        if (gen !== flightRequestGen.current) return;
        setFlightSnapshot(fs);
        if (fs.ready) {
          lastReadyFingerprintRef.current = fs.searchFingerprint;
        } else {
          lastReadyFingerprintRef.current = "";
        }
      } catch (e) {
        if (gen !== flightRequestGen.current) return;
        lastReadyFingerprintRef.current = "";
        setFlightError(e instanceof Error ? e.message : "Flight search failed");
      } finally {
        if (gen === flightRequestGen.current) {
          setFlightLoading(false);
        }
      }
    }, FLIGHT_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [interpretHistory]);

  const vadOpts = useMemo(
    () => ({
      armed,
      dbThreshold: DB_THRESHOLD,
      speechStartMs: SPEECH_START_MS,
      silenceEndMs: SILENCE_END_MS,
      minSegmentMs: MIN_SEGMENT_MS,
      onSegment,
    }),
    [armed, onSegment],
  );

  const { dbfs, phase, error: vadError } = useVoiceVad(vadOpts);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Flyflow voice</h1>
        <p className="tagline">
          Voice activity detection in the browser, then Whisper and structured
          parsing on the server.
        </p>
      </header>

      <EntryModal
        open={showIntro}
        onClose={() => setShowIntro(false)}
        onWarmMic={warmMicrophone}
      />

      <VoiceStatusBar
        armed={armed}
        phase={phase}
        dbfs={dbfs}
        dbThreshold={DB_THRESHOLD}
        uploading={uploading}
        micError={vadError}
      />

      <ResultsPanel
        result={result}
        requestError={requestError}
        interpretHistory={interpretHistory}
        flightSnapshot={flightSnapshot}
        flightLoading={flightLoading}
        flightError={flightError}
      />

      <VoiceFab
        armed={armed}
        uploading={uploading}
        onToggle={() => setArmed((v) => !v)}
      />

      <footer className="app-footer">
        <button
          type="button"
          className="link-button"
          onClick={() => setShowIntro(true)}
        >
          Show intro again
        </button>
      </footer>
    </div>
  );
}
