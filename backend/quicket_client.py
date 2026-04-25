"""Quicket JETS API client (sandbox / production).

Auth: GET /api/v1/auth?appId=... with header Authorization: Bearer <private_key>
returns { accessToken }; subsequent calls use Bearer <accessToken>.

Docs: https://sandbox.quicket.io/redoc
"""

from __future__ import annotations

import base64
import json
import logging
import os
import threading
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_BASE = "https://sandbox.quicket.io"
_AUTH_PATH = "/api/v1/auth"
_TOKEN_SKEW_SEC = 60.0


def _jwt_exp_unix(token: str) -> float | None:
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return None
        payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload_b64.encode("ascii")))
        exp = data.get("exp")
        return float(exp) if isinstance(exp, (int, float)) else None
    except Exception:
        return None


class QuicketConfigError(RuntimeError):
    pass


class QuicketClient:
    """Thread-safe JWT cache and thin wrappers around Quicket REST paths."""

    def __init__(self) -> None:
        self._base = os.getenv("QUICKET_BASE_URL", _DEFAULT_BASE).rstrip("/")
        self._app_id = os.getenv("QUICKET_APP_ID", "").strip()
        self._private_key = os.getenv("QUICKET_PRIVATE_KEY", "").strip()
        self._lock = threading.Lock()
        self._token: str | None = None
        self._token_expires_at: float = 0.0

    def configured(self) -> bool:
        return bool(self._app_id and self._private_key)

    def _fetch_token(self) -> str:
        url = f"{self._base}{_AUTH_PATH}"
        params = {"appId": self._app_id}
        headers = {"Authorization": f"Bearer {self._private_key}"}
        with httpx.Client(timeout=30.0) as client:
            r = client.get(url, params=params, headers=headers)
            r.raise_for_status()
            data = r.json()
        token = data.get("accessToken")
        if not isinstance(token, str) or not token:
            raise QuicketConfigError("Quicket auth response missing accessToken")
        exp = _jwt_exp_unix(token)
        if exp is not None:
            self._token_expires_at = exp - _TOKEN_SKEW_SEC
        else:
            self._token_expires_at = time.time() + 25 * 60
        self._token = token
        logger.info("Quicket access token refreshed")
        return token

    def access_token(self) -> str:
        if not self.configured():
            raise QuicketConfigError(
                "Set QUICKET_APP_ID and QUICKET_PRIVATE_KEY (see README)."
            )
        with self._lock:
            if self._token and time.time() < self._token_expires_at:
                return self._token
            return self._fetch_token()

    def invalidate_token(self) -> None:
        with self._lock:
            self._token = None
            self._token_expires_at = 0.0

    def _auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token()}"}

    def request_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any | None = None,
        retry_on_401: bool = True,
    ) -> tuple[int, dict[str, Any] | list[Any] | None, str | None]:
        """Returns (status_code, json_or_none, text_if_not_json)."""
        url = f"{self._base}{path}"
        headers = {**self._auth_headers(), "Accept": "application/json"}
        if json_body is not None:
            headers["Content-Type"] = "application/json"
        with httpx.Client(timeout=120.0) as client:
            r = client.request(
                method,
                url,
                params=params or {},
                headers=headers,
                json=json_body,
            )
            if r.status_code == 401 and retry_on_401:
                self.invalidate_token()
                headers = {**self._auth_headers(), "Accept": "application/json"}
                if json_body is not None:
                    headers["Content-Type"] = "application/json"
                r = client.request(
                    method,
                    url,
                    params=params or {},
                    headers=headers,
                    json=json_body,
                )
            ct = (r.headers.get("content-type") or "").lower()
            if "application/json" in ct:
                try:
                    return r.status_code, r.json(), None
                except json.JSONDecodeError:
                    return r.status_code, None, r.text
            return r.status_code, None, r.text

    def request_raw(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        retry_on_401: bool = True,
    ) -> httpx.Response:
        """For redirects or non-JSON responses."""
        url = f"{self._base}{path}"
        headers = self._auth_headers()
        client = httpx.Client(timeout=120.0, follow_redirects=False)
        try:
            r = client.request(method, url, params=params or {}, headers=headers)
            if r.status_code == 401 and retry_on_401:
                self.invalidate_token()
                headers = self._auth_headers()
                r = client.request(method, url, params=params or {}, headers=headers)
            return r
        finally:
            client.close()


_client_singleton: QuicketClient | None = None
_client_lock = threading.Lock()


def get_quicket_client() -> QuicketClient:
    global _client_singleton
    with _client_lock:
        if _client_singleton is None:
            _client_singleton = QuicketClient()
        return _client_singleton
