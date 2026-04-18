const STORAGE_KEY = "flyflow_voice_intro_dismissed_v1";

type EntryModalProps = {
  open: boolean;
  onClose: () => void;
  onWarmMic: () => Promise<void>;
};

export function isIntroDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissIntro(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function EntryModal({ open, onClose, onWarmMic }: EntryModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-intro-title"
        aria-describedby="voice-intro-desc"
      >
        <h2 id="voice-intro-title">Voice listening</h2>
        <p id="voice-intro-desc" className="modal-copy">
          This page can capture microphone audio when you turn on the control in
          the bottom-right corner. Audio is sent to the server for transcription
          and parsing only after each short speech segment ends. Use the banner
          and button states to see when listening is active.
        </p>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              dismissIntro();
              onClose();
            }}
          >
            Not now
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              try {
                await onWarmMic();
              } catch {
                /* permission denied — still dismiss */
              }
              dismissIntro();
              onClose();
            }}
          >
            Enable microphone
          </button>
        </div>
      </div>
    </div>
  );
}
