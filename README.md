# Focus Reader Frontend

A Vue 3 + Vite application wired to the provided backend API spec for Profiles, Library, Annotations, FocusStats, and TextSettings.

## What’s included

- Vue 3, Vite, TypeScript
- Vue Router, Pinia
- Axios API client with typed endpoints in `src/lib/api`
- Basic pages: `Library`, `Reader`, `Annotations`, `Stats`, `Login`
- Env-configurable API base or dev proxy

## Configure environment

Copy `.env.example` to `.env` and set one of the following:

- Use dev proxy (recommended during local development):
  - Leave `VITE_API_BASE_URL` empty
  - Set `VITE_API_PROXY_TARGET` to your backend URL (e.g. `http://localhost:3000`)
  - All `/api/*` requests from the app will be proxied to that target
- Or set direct base URL:
  - Set `VITE_API_BASE_URL` (e.g. `http://localhost:3000`)
  - Leave `VITE_API_PROXY_TARGET` empty

## Run locally

```bash
npm install
npm run dev
```

- App runs on http://localhost:5173
- If using the proxy, ensure your backend is running and accessible at the `VITE_API_PROXY_TARGET`

## Type-check and build

```bash
npm run typecheck
npm run build
npm run preview
```

## API client

- Base Axios instance: `src/lib/api/client.ts`
- Endpoints mapped 1:1 with `api.md`: `src/lib/api/endpoints.ts`
- Shared types derived from the spec: `src/lib/api/types.ts`

## Auth model

`src/stores/auth.ts` provides a minimal auth store based on `/api/Profile/authenticate`, storing the returned `user` id.

## Notes

- The demo pages call the backend exactly as specified in `api.md`. Server-side validation is assumed per the spec.
- Adjust UI/flows as needed; the current pages are functional scaffolds to exercise the API.