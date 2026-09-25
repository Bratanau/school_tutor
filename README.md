# ScrollEd MVP

ScrollEd converts books into a two-dimensional learning feed.

## Architecture

1. Expo uploads a PDF to `POST /process-pdf` using multipart form data.
2. FastAPI validates the file and extracts text with `pypdf`.
3. The processing service chunks the text, calls an AI provider through an explicit adapter, and validates structured JSON.
4. A document, topics, cards, quiz questions, and processing status are persisted in PostgreSQL.
5. The mobile client reads topics as vertical pages and cards inside each topic as horizontal pages. The final horizontal card is always a quiz.
6. Audio generation is asynchronous: the worker stores an ElevenLabs asset URL on an audio card.

## Repository layout

- `backend/main.py`: runnable FastAPI MVP with a deterministic mock AI provider.
- `backend/requirements.txt`: backend dependencies.
- `db/schema.sql`: PostgreSQL schema, subscription limits, organizations, cards, and quizzes.
- `mobile/App.tsx`: Expo screen with nested `react-native-pager-view` swipers.
- `mobile/package.json`: minimal Expo dependencies.

## Run backend

```bash
cd backend
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Then open `http://127.0.0.1:8000/docs`.

## Run mobile

```bash
cd mobile
npm install
npx expo start
```

Set `API_URL` in `mobile/App.tsx` to the host reachable from the simulator/device. The current UI uses local fixture data so the gesture interaction works before authentication and persistence are wired.

## Production next steps

- Replace `MockAIProvider` with an OpenAI structured-output adapter and enforce a schema with Pydantic.
- Move processing to a queue worker (Celery, Dramatiq, or a Supabase Edge/queue worker) so uploads return `202` and expose progress via polling or WebSocket.
- Store PDFs and generated media in object storage; keep only metadata in PostgreSQL.
- Enforce Free limits in a transaction using the `subscription_entitlements` view or a service-layer authorization check. Never rely on client-side limits.
- Add auth, signed upload URLs, malware scanning, rate limits, retention policies, and idempotency keys before launch.
