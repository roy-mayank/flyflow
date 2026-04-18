import type { VoicePhase } from "../hooks/useVoiceVad";

type VoiceStatusBarProps = {
  armed: boolean;
  phase: VoicePhase;
  dbfs: number;
  dbThreshold: number;
  uploading: boolean;
  micError: string | null;
};

export function VoiceStatusBar({
  armed,
  phase,
  dbfs,
  dbThreshold,
  uploading,
  micError,
}: VoiceStatusBarProps) {
  if (micError) {
    return (
      <div className="status-bar status-bar--error" role="status">
        <strong>Voice inactive.</strong> {micError}
      </div>
    );
  }

  if (!armed) {
    return (
      <div className="status-bar status-bar--inactive" role="status">
        <span className="status-dot status-dot--muted" aria-hidden />
        <strong>Voice off</strong>
        <span className="status-sub">Press the microphone button to listen.</span>
      </div>
    );
  }

  const levelPct = Math.min(
    100,
    Math.max(0, ((dbfs + 80) / 50) * 100),
  );

  let headline = "Listening for speech";
  if (uploading) headline = "Sending clip to server…";
  else if (phase === "recording") headline = "Recording speech…";
  else if (phase === "monitoring") headline = "Listening — speak when ready";

  return (
    <div className="status-bar status-bar--active" role="status">
      <span className="status-dot status-dot--live" aria-hidden />
      <div className="status-bar__text">
        <strong>{headline}</strong>
        <span className="status-sub">
          Gate: above {dbThreshold.toFixed(0)} dBFS · current{" "}
          {dbfs.toFixed(1)} dBFS
        </span>
      </div>
      <div
        className="level-meter"
        aria-label={`Level ${dbfs.toFixed(0)} decibels full scale`}
      >
        <div className="level-meter__fill" style={{ width: `${levelPct}%` }} />
      </div>
    </div>
  );
}
