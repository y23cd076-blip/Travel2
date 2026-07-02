# SmartTrip AI — Vercel frontend

A Next.js (App Router) replacement for the Streamlit UI. Same trip-planning
flow, calling the same FastAPI backend — just a different frontend, styled
as a boarding-pass / ticket-stub itinerary.

## Local development

```bash
npm install
cp .env.example .env.local
# edit .env.local: NEXT_PUBLIC_BACKEND_URL + Firebase config
npm run dev
```

Opens at `http://localhost:3000`. You'll be redirected to `/login` until you
sign in.

## Destination search (Photon)

The From/To fields use [Photon](https://photon.komoot.io), a free, keyless
geocoding API built on OpenStreetMap data, so users can search and pick
*any* place, not just the 5 curated pilot cities. `components/
PlaceAutocomplete.jsx` calls it directly from the browser as the user
types — no API key, no signup, nothing to configure.

If the Photon request fails (e.g. offline, service hiccup) the field still
works as a plain text input — it just won't offer suggestions for that
keystroke.

## Auth (Firebase)

The app is gated behind Firebase Authentication (email/password + Google).
Nothing renders on `/` until a user is signed in; unauthenticated visits
redirect to `/login`.

1. In the [Firebase console](https://console.firebase.google.com/), create a
   project (or reuse the one from the backend's Firestore setup).
2. **Build → Authentication → Get started**, then enable the
   **Email/Password** and **Google** sign-in providers.
3. **Project settings → General → Your apps → Add app → Web**, register the
   app (no hosting needed), and copy the `firebaseConfig` values into
   `.env.local`:
   ```
   NEXT_PUBLIC_FIREBASE_API_KEY=...
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
   NEXT_PUBLIC_FIREBASE_APP_ID=...
   ```
4. **Authentication → Settings → Authorized domains**: add `localhost` (on by
   default) and your Vercel domain once deployed, or Google sign-in's popup
   will fail with `auth/unauthorized-domain`.

Auth state lives in `lib/AuthContext.jsx` (`AuthProvider` / `useAuth`),
wrapped around the app in `app/layout.jsx`. The login/signup UI is in
`app/login/page.jsx`.

This is client-side auth only — the FastAPI backend does not currently
verify Firebase ID tokens, so `/plan-trip` and `/trips` stay open to anyone
who can reach the backend URL directly. If you want the backend to actually
enforce login (not just gate the UI), the next step is verifying the
Firebase ID token server-side (e.g. `firebase-admin`'s `verifyIdToken`) on
each request — happy to wire that up too if you need it.

## Deploying to Vercel

1. Push this `vercel-frontend/` folder to a GitHub repo (or the repo root,
   if you're deploying this alone).
2. In Vercel: **New Project → Import** your repo.
   - If `vercel-frontend/` is a subfolder of a larger repo, set **Root
     Directory** to `vercel-frontend` in the project settings.
   - Framework preset: Next.js (auto-detected).
3. Add an environment variable in **Project Settings → Environment
   Variables**:
   ```
   NEXT_PUBLIC_BACKEND_URL = https://your-backend.onrender.com
   ```
   It must be `NEXT_PUBLIC_`-prefixed since the browser calls the backend
   directly (client-side fetch), not through a Vercel server function.
4. Deploy.

No other secrets go here — `GEMINI_API_KEY` and Firestore credentials live
only on the backend (Render), which is the only thing that talks to Gemini
or Firestore. This frontend only ever calls `GET /destinations` and
`POST /plan-trip` on your backend.

## Notes

- CORS: the FastAPI backend already sets `allow_origins=["*"]`, so it will
  accept requests from your Vercel domain with no extra backend config.
- Free-tier Render backends spin down on idle; the first request after a
  period of inactivity can take 30-60s. The UI shows a loading state and a
  friendly retry message rather than a raw fetch error in that case.
