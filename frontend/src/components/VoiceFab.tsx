type VoiceFabProps = {
  armed: boolean;
  uploading: boolean;
  onToggle: () => void;
};

export function VoiceFab({ armed, uploading, onToggle }: VoiceFabProps) {
  const label = uploading
    ? "Processing voice clip"
    : armed
      ? "Voice listening on — press to stop"
      : "Voice listening off — press to start";

  return (
    <button
      type="button"
      className={`voice-fab ${armed ? "voice-fab--on" : "voice-fab--off"} ${uploading ? "voice-fab--busy" : ""}`}
      aria-pressed={armed}
      aria-busy={uploading}
      aria-label={label}
      disabled={uploading}
      onClick={onToggle}
    >
      <span className="voice-fab__sheen" aria-hidden />
      <span className="voice-fab__inner">
        {uploading ? (
          <span className="voice-fab__spinner" aria-hidden />
        ) : (
          <svg className="voice-fab__icon" viewBox="0 0 24 24" aria-hidden>
            <path
              fill="currentColor"
              d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"
            />
          </svg>
        )}
      </span>
      {armed && !uploading ? <span className="voice-fab__pulse" aria-hidden /> : null}
    </button>
  );
}
