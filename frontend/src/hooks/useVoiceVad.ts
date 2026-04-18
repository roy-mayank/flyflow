import { useCallback, useEffect, useRef, useState } from "react";

/** Approximate full-scale dB from normalized RMS (0..1). */
export function rmsToDbfs(rms: number): number {
  const safe = Math.max(rms, 1e-8);
  return 20 * Math.log10(safe);
}

const PICK_MIME = (): string | undefined => {
  const c = "audio/webm;codecs=opus";
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c))
    return c;
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.("audio/webm"))
    return "audio/webm";
  return undefined;
};

export type VoicePhase = "idle" | "monitoring" | "recording";

export type UseVoiceVadOptions = {
  armed: boolean;
  dbThreshold: number;
  speechStartMs: number;
  silenceEndMs: number;
  minSegmentMs: number;
  onSegment: (blob: Blob) => void | Promise<void>;
};

/**
 * Web Audio RMS -> dBFS for UI + gating; MediaRecorder captures one blob per utterance.
 */
export function useVoiceVad(opts: UseVoiceVadOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [dbfs, setDbfs] = useState(-100);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef(0);
  const speechCandidateRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const recordingRef = useRef(false);
  const onSegmentRef = useRef(opts.onSegment);
  onSegmentRef.current = opts.onSegment;

  const stopRecorder = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null;
  }, []);

  const teardownAudio = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    stopRecorder();
    analyserRef.current = null;
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => undefined);
      ctxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    speechCandidateRef.current = null;
    silenceStartRef.current = null;
    recordingRef.current = false;
    setPhase("idle");
    setDbfs(-100);
  }, [stopRecorder]);

  const loop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const {
      dbThreshold,
      speechStartMs,
      silenceEndMs,
      minSegmentMs,
    } = optsRef.current;

    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const s = buf[i] ?? 0;
      sum += s * s;
    }
    const rms = Math.sqrt(sum / buf.length);
    const level = rmsToDbfs(rms);
    setDbfs(level);

    const now = performance.now();
    const above = level > dbThreshold;

    if (recordingRef.current) {
      if (above) {
        silenceStartRef.current = null;
      } else {
        if (silenceStartRef.current === null) silenceStartRef.current = now;
        else if (now - silenceStartRef.current >= silenceEndMs) {
          silenceStartRef.current = null;
          speechCandidateRef.current = null;
          const rec = recorderRef.current;
          if (rec && rec.state === "recording") {
            try {
              rec.stop();
            } catch {
              /* ignore */
            }
          }
        }
      }
    } else {
      if (above) {
        if (speechCandidateRef.current === null) speechCandidateRef.current = now;
        else if (now - speechCandidateRef.current >= speechStartMs) {
          speechCandidateRef.current = null;
          silenceStartRef.current = null;
          const stream = streamRef.current;
          if (!stream) return;

          chunksRef.current = [];
          recordStartRef.current = now;
          const mime = PICK_MIME();
          const rec = mime
            ? new MediaRecorder(stream, { mimeType: mime })
            : new MediaRecorder(stream);
          recorderRef.current = rec;
          rec.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
          };
          rec.onstop = () => {
            recordingRef.current = false;
            setPhase("monitoring");
            const duration = performance.now() - recordStartRef.current;
            const type = rec.mimeType || "audio/webm";
            const blob = new Blob(chunksRef.current, { type: type });
            chunksRef.current = [];
            recorderRef.current = null;
            if (duration >= minSegmentMs && blob.size > 2000) {
              void Promise.resolve(onSegmentRef.current(blob)).catch(() => undefined);
            }
          };
          try {
            rec.start(100);
            recordingRef.current = true;
            setPhase("recording");
          } catch {
            recordingRef.current = false;
            setError("Could not start recording.");
            setPhase("monitoring");
          }
        }
      } else {
        speechCandidateRef.current = null;
      }
    }

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const startLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const attachStream = useCallback(
    (stream: MediaStream) => {
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      analyserRef.current = analyser;
      setPhase("monitoring");
      void ctx.resume().catch(() => undefined);
      startLoop();
    },
    [startLoop],
  );

  useEffect(() => {
    if (!opts.armed) {
      teardownAudio();
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setError(null);
        cancelAnimationFrame(rafRef.current);
        if (ctxRef.current) {
          void ctxRef.current.close().catch(() => undefined);
          ctxRef.current = null;
        }
        analyserRef.current = null;
        stopRecorder();
        speechCandidateRef.current = null;
        silenceStartRef.current = null;
        recordingRef.current = false;
        attachStream(stream);
      } catch {
        if (!cancelled) {
          setError("Microphone permission denied or unavailable.");
          setPhase("idle");
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      teardownAudio();
    };
  }, [opts.armed, attachStream, stopRecorder, teardownAudio]);

  return { dbfs, phase, error, attachStream, teardownAudio };
}
