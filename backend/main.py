"""Flyflow API.

Environment:
  OPENAI_API_KEY — required for POST /api/voice/interpret (Whisper + parser); set in
    `.env` at the repository root and/or in `backend/.env` (backend file wins on duplicates).
  FRONTEND_ORIGINS — optional comma-separated CORS origins (defaults include Vite dev).
  WHISPER_MODEL — defaults to whisper-1; PARSER_MODEL — defaults to gpt-4o-mini.
"""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

_backend_dir = Path(__file__).resolve().parent
_repo_root = _backend_dir.parent

# Load OPENAI_API_KEY (and other vars) from .env: repo root first, then backend/ overrides.
load_dotenv(_repo_root / ".env", override=True)
load_dotenv(_backend_dir / ".env", override=True)

from routers.voice import router as voice_router

logging.getLogger("routers").setLevel(logging.INFO)

app = FastAPI()

_origins_env = os.getenv("FRONTEND_ORIGINS", "")
_origins = [o.strip() for o in _origins_env.split(",") if o.strip()]
_default_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
allow_origins = list(dict.fromkeys(_origins + _default_origins))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(voice_router)


@app.get("/health")
def health():
    return {"status": "ok"}
