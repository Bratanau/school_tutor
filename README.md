# ScrollEd

ScrollEd is a mobile exam preparation app with an adaptive vertical and horizontal learning feed.

## Structure

- `backend/` FastAPI API, PostgreSQL access, YandexGPT integration and Wikipedia media validation.
- `mobile/` Expo application with exam creation, catalog, preparation feed, progress and contextual AI chat.
- `db/schema.sql` single source of truth for a fresh PostgreSQL database.

## Backend

```powershell
cd backend
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API is available at `http://127.0.0.1:8000/docs`.

## Mobile

```powershell
cd mobile
npm install
npx expo start
```

Set `EXPO_PUBLIC_API_URL` for a physical device, or use the defaults in `mobile/api.ts` for web, iOS simulator and Android emulator.

## Database

Apply `db/schema.sql` once to a fresh PostgreSQL database. Existing databases should be backed up before replacing an old schema; the current application uses the `app_user`, `exams`, `exam_topics`, `user_knowledge`, `cards` and `quiz_results` tables defined there.
