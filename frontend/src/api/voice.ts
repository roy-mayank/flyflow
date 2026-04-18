const base = (): string =>
  (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export type ParsedIntent = {
  instructionType: string;
  entities: Record<string, unknown>;
  items: string[];
  confidence: number;
};

export type InterpretResponse = {
  transcript: string;
  parsed: ParsedIntent;
};

export async function interpretAudio(blob: Blob): Promise<InterpretResponse> {
  const form = new FormData();
  const ext = blob.type.includes("webm") ? "webm" : "wav";
  form.append("audio", blob, `segment.${ext}`);

  const url = `${base()}/api/voice/interpret`;
  const res = await fetch(url, {
    method: "POST",
    body: form,
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

  return (await res.json()) as InterpretResponse;
}
