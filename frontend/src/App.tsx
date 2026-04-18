import { useCallback, useMemo, useState } from "react";
import { interpretAudio, type InterpretResponse } from "./api/voice";
import { EntryModal, isIntroDismissed } from "./components/EntryModal";
import { ResultsPanel } from "./components/ResultsPanel";
import { VoiceFab } from "./components/VoiceFab";
import { VoiceStatusBar } from "./components/VoiceStatusBar";
import { useVoiceVad } from "./hooks/useVoiceVad";

const DB_THRESHOLD = -42;
const SPEECH_START_MS = 140;
const SILENCE_END_MS = 480;
const MIN_SEGMENT_MS = 450;

async function warmMicrophone(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
}

export default function App() {
  const [showIntro, setShowIntro] = useState(() => !isIntroDismissed());
  const [armed, setArmed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<InterpretResponse | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const onSegment = useCallback(async (blob: Blob) => {
    setUploading(true);
    setRequestError(null);
    try {
      const data = await interpretAudio(blob);
      setResult(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setRequestError(msg);
    } finally {
      setUploading(false);
    }
  }, []);

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

      <ResultsPanel result={result} requestError={requestError} />

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
