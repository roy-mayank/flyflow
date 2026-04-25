# Flyflow

Flyflow is a **voice-first assistant for flying smarter**, not for shopping fares. You describe a trip in natural language—for example *“I’m flying Paris to New York next month”—*and the app is meant to pull together **operational context** so you can choose **seats and sides of the plane** with your eyes open.

## What we’re building

1. **Voice queries** — Ask for information the same way you’d ask a friend who knows aviation: route, airline, aircraft type, time of year, airport pair, etc.
2. **Typical flight geometry** — Use **ADS-B / flight-tracking style data** (e.g. Flightradar24 or similar APIs and datasets) to infer **usual tracks, approaches, and runway usage** for that city pair and carriers. Patterns matter: the same IATA pair can land on different runways or from different directions depending on wind and flow.
3. **Cabin and seat context** — Layer in **seat maps and cabin notes** ([Quicket JETS](https://sandbox.quicket.io/redoc)-class data: recline, pitch, misaligned windows, galley noise, wing-in-window flags) so recommendations are tied to a real seat, not generic “window vs aisle.”
4. **Landing and scenery** — Combine track history + approach direction + seat map geometry to suggest **which side of the aircraft** (port vs starboard) tends to give the **better view on approach**, when that is knowable—and to be explicit when it isn’t (weather, runway swaps, night flights).

The end goal is a single place to answer: *“Given how this route usually flies and how this jet is laid out, where should I sit?”*

## Repository today vs roadmap

The codebase still includes a **FastAPI** backend and **React (Vite)** frontend with **voice interpretation** (Whisper + structured parsing). There is also a **live flight prices** path wired to Skyscanner’s partner API—useful during the pivot for slot extraction and UI flow, but **not the long-term product center**; future work prioritizes **tracking-derived patterns**, **seat/cabin intelligence**, and **explainable “window left / window right”** guidance grounded in data.

---

## Prerequisites

- **Node.js** 20+ (recommended for Vite 7)
- **Python** 3.11+ with `pip`
- API keys for the features you enable locally (see below)

## Backend

From the repository root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

On macOS or Linux, activate the venv with `source .venv/bin/activate` instead.

The API serves at `http://127.0.0.1:8000`. Health check: `GET http://127.0.0.1:8000/health`.

## Frontend

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). In development, `/api` is proxied to the backend on port 8000, so keep both processes running.

To call the API directly (bypass the proxy), create `frontend/.env.development` with:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

## Environment variables

Create a `.env` file at the **repository root** and/or in **`backend/`** (variables in `backend/.env` override the root file on duplicates).

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required for `POST /api/voice/interpret` (Whisper + parsing). |
| `SKYSCANNER_API_KEY` | Used by `POST /api/flights/live-search` today (live prices poll); may be retired or narrowed as the product moves toward tracking and seat intelligence. |
| `SKYSCANNER_MARKET` | Optional default market (e.g. `UK`). |
| `SKYSCANNER_LOCALE` | Optional (e.g. `en-GB`). |
| `SKYSCANNER_CURRENCY` | Optional (e.g. `GBP`). |
| `FRONTEND_ORIGINS` | Optional comma-separated CORS origins (defaults include the Vite dev URL). |
| `WHISPER_MODEL` | Optional; defaults to `whisper-1`. |
| `PARSER_MODEL` | Optional; defaults to `gpt-4o-mini`. |
| `QUICKET_APP_ID` | [Quicket JETS](https://sandbox.quicket.io/redoc) `appId` (query) used with your private key to mint a JWT. |
| `QUICKET_PRIVATE_KEY` | Sent as `Authorization: Bearer <key>` to `GET /api/v1/auth` on Quicket; never expose this to the browser—call Flyflow’s `/api/seatmaps/quicket/*` routes instead. |
| `QUICKET_BASE_URL` | Optional. Defaults to `https://sandbox.quicket.io`; set the production API host when you leave sandbox. |

Integrations for third-party flight tracking will add their own keys as they land; respect each provider’s **terms of use** and **licensing** (prefer official APIs over scraping).

You can run the UI without keys, but voice interpretation, live-search, and Quicket-backed seat map routes need the corresponding configuration.

### Seat maps: Flyflow → Quicket

Upstream OpenAPI: [swagger.json](https://sandbox.quicket.io/redoc/swagger.json). Auth is described under [auth](https://sandbox.quicket.io/redoc#tag/auth/operation/auth): `GET /api/v1/auth?appId=…` with `Authorization: Bearer <private_key>` returns `{ "accessToken" }`. The backend caches that JWT and attaches it to Quicket calls.

Proxied routes (same JSON bodies and paths as Quicket, unless noted):

| Method | Flyflow path | Quicket upstream |
| --- | --- | --- |
| `GET` | `/api/seatmaps/quicket/plane/by-reg/{reg}` | `/api/v1/plane/info/by/reg/{reg}` |
| `GET` | `/api/seatmaps/quicket/seatmap/{link_id}` | `/api/v1/plane/seatmap/{linkId}` (optional query: `colorTheme`, `language`) |
| `GET` | `/api/seatmaps/quicket/seatmap/{link_id}/redirect` | `/api/v1/plane/seatmap/{linkId}/redirect` (forwards 307 `Location` to the seat map CDN) |
| `POST` | `/api/seatmaps/quicket/flight/features` | `/api/v1/flight/features` |
| `POST` | `/api/seatmaps/quicket/flight/plane-features` | `/api/v1/flight/features/plane` |
| `POST` | `/api/seatmaps/quicket/flight/plane-seatmap` | `/api/v1/flight/features/plane/seatmap` |

For interactive seat rendering, Quicket points to the React package [`@seatmaps.com/react-lib`](https://www.npmjs.com/package/@seatmaps.com/react-lib).

## Production build (frontend)

```powershell
cd frontend
npm run build
npm run preview
```

`preview` serves the built assets; configure `VITE_API_BASE_URL` for your deployed API if it is not same-origin.
