"""Voice interpret: multipart audio -> Whisper -> structured intent (OpenAI)."""

import io
import json
import logging
import os
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from openai import OpenAI

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "whisper-1")
PARSER_MODEL = os.getenv("PARSER_MODEL", "gpt-4o-mini")

# JSON schema for chat completions response_format (strict=False for flexible entities).
PARSED_INTENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "instructionType": {
            "type": "string",
            "description": "Free-form label for the user's intent (e.g. search, filter, sort).",
        },
        "entities": {
            "type": "object",
            "additionalProperties": True,
            "description": "Key-value slots extracted from the utterance.",
        },
        "items": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Targets or phrases tied to the instruction.",
        },
        "confidence": {
            "type": "number",
            "description": "Model confidence from 0 to 1.",
        },
    },
    "required": ["instructionType", "entities", "items", "confidence"],
    "additionalProperties": False,
}


def _get_client() -> OpenAI:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Server is not configured with OPENAI_API_KEY.",
        )
    return OpenAI(api_key=key)


@router.post("/interpret")
async def interpret_voice(audio: UploadFile = File(...)) -> dict[str, Any]:
    """Transcribe audio with Whisper, then parse transcript into structured intent."""
    if not audio.filename and not audio.content_type:
        raise HTTPException(status_code=400, detail="Missing audio file.")

    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty audio upload.")

    filename = audio.filename or "audio.webm"
    buf = io.BytesIO(raw)
    buf.name = filename

    logger.info(
        "voice/interpret: received upload filename=%r content_type=%r bytes=%s",
        audio.filename,
        audio.content_type,
        len(raw),
    )

    client = _get_client()

    try:
        transcription = client.audio.transcriptions.create(
            model=WHISPER_MODEL,
            file=buf,
        )
    except Exception:
        logger.exception(
            "voice/interpret: Whisper transcription failed (model=%r)",
            WHISPER_MODEL,
        )
        raise HTTPException(
            status_code=502,
            detail="Transcription service failed.",
        ) from None

    transcript = (transcription.text or "").strip()
    if not transcript:
        return {
            "transcript": "",
            "parsed": {
                "instructionType": "none",
                "entities": {},
                "items": [],
                "confidence": 0.0,
            },
        }

    system = (
        "You convert user voice transcripts into a single structured intent. "
        "instructionType is a short free-form verb or category. "
        "entities holds extracted key-value slots. items holds string targets. "
        "confidence is 0-1."
    )
    user = f"Transcript:\n{transcript}"

    try:
        completion = client.chat.completions.create(
            model=PARSER_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "parsed_voice_intent",
                    "strict": False,
                    "schema": PARSED_INTENT_SCHEMA,
                },
            },
        )
    except Exception:
        logger.exception(
            "voice/interpret: intent chat completion failed (model=%r)",
            PARSER_MODEL,
        )
        raise HTTPException(
            status_code=502,
            detail="Intent parsing failed.",
        ) from None

    message = completion.choices[0].message
    content = message.content or "{}"
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        logger.exception(
            "voice/interpret: model content was not valid JSON (first_200_chars=%r)",
            content[:200],
        )
        raise HTTPException(
            status_code=502,
            detail="Model returned invalid JSON.",
        ) from None

    logger.info(
        "voice/interpret: success transcript_len=%s instruction_type=%r",
        len(transcript),
        parsed.get("instructionType") if isinstance(parsed, dict) else None,
    )
    return {"transcript": transcript, "parsed": parsed}
