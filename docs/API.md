# Worxstream AI Agent – API contract

Use this to align the frontend (e.g. `apiEndpoints.ts`, `api.ts`, `chatBackendSession.ts`) with the backend.

## Base URL

- Backend base URL is **not hardcoded** in the app; it comes from env: `BACKEND_URL` or `PUBLIC_URL`.
- Frontend should use the same base for the chat backend, e.g.:
  - Env: `VITE_CHAT_BACKEND_URL` (or reuse your main API base).
  - Default in frontend can be e.g. `VITE_CHAT_BACKEND_URL || 'https://mcp.worxstream.io'` so that in production you set `VITE_CHAT_BACKEND_URL` to the real backend URL.

**Full URL for an endpoint = baseURL + path** (e.g. `https://mcp.worxstream.io` + `/api/auth/session` → `https://mcp.worxstream.io/api/auth/session`).

## Auth – Chat backend session

All paths are under **`/api/auth`**. Session path:

| Endpoint constant | Path              | Method | Description |
|-------------------|-------------------|--------|-------------|
| `CHAT_SESSION`    | `/api/auth/session` | POST   | Set session (after login). Body: `{ userId, companyId, apiToken }`. |
|                   | `/api/auth/session` | DELETE | Clear session (logout). |
|                   | `/api/auth/session` | GET    | Session status. Response: `{ success, active, message }`. |

- **Frontend `apiEndpoints.ts`:** under AUTH use e.g. `CHAT_SESSION: '/api/auth/session'`.
- **Frontend `api.ts`:** use a chat backend config with `baseURL: VITE_CHAT_BACKEND_URL || 'https://mcp.worxstream.io'` and the same `ApiService` as your main API.
- **Frontend `chatBackendSession.ts`:** use `chatApi` + `API_ENDPOINTS.AUTH.CHAT_SESSION` for POST/DELETE/GET (no raw fetch).

So:

- POST session: `chatApi.post(API_ENDPOINTS.AUTH.CHAT_SESSION, body)`
- DELETE session: `chatApi.delete(API_ENDPOINTS.AUTH.CHAT_SESSION)`
- GET session: `chatApi.get(API_ENDPOINTS.AUTH.CHAT_SESSION)`

## Route not found (404)

A 404 for `POST /api/auth/session` means the server that receives the request does **not** have that route.

1. **Session and chat on the same backend (this repo)**  
   This backend mounts auth at `/api/auth`, so the path is **`/api/auth/session`** (with `/api`).  
   - Set `VITE_CHAT_BACKEND_URL` to the same base as this API (e.g. same as `VITE_API_BACKEND_URL` if that’s where this app is deployed).  
   - Then the full URL is `{base}/api/auth/session`, which this app serves.

2. **Session on a different host**  
   If the session is served by another backend (e.g. main app login server), set `VITE_CHAT_BACKEND_URL` to that server’s base URL so session requests go there. That server must expose the same contract (POST/DELETE/GET `/api/auth/session` or the path it uses; see below).

3. **Backend mounted without `/api`**  
   If the real path on the server is `/auth/session` (no `/api`), then:
   - In `apiEndpoints.ts` use `CHAT_SESSION: '/auth/session'`.
   - Full URL = `baseURL + '/auth/session'` (e.g. `https://mcp.worxstream.io/auth/session`).
   - Ensure `VITE_CHAT_BACKEND_URL` is the base that, when combined with `/auth/session`, matches how the backend is mounted (e.g. if the app is under `https://mcp.worxstream.io/api`, set base to `https://mcp.worxstream.io/api` and endpoint to `/auth/session` → `https://mcp.worxstream.io/api/auth/session`).

## Discovery

- **GET /**  
  Returns API name, version, and an `endpoints` object that includes `auth.session: '/api/auth/session'` so the frontend can confirm the path.
- **GET /health**  
  Health check.
