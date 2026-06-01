# Better Auth Integration — Step 3

Summary
- Integrates Better Auth for signup/login/logout and session introspection.
- Non-blocking: requests without a session continue to work and `req.user` will be populated when possible.
- Does NOT enable ownership enforcement or tenant isolation.

Files changed / added
- `server/auth.js` — auth middleware and proxy routes (`/api/auth/*`) and `authMiddleware` which populates `req.user` when possible.
- `server/app.js` — mounts `authMiddleware` and `'/api/auth'` routes; adds `cookie-parser`.
- `web/src/api/client.js` — `fetch` now sends credentials (`credentials: 'include'`).
- `web/src/api/auth.js` — frontend wrappers for `/api/auth/*`.
- `web/src/hooks/useAuth.js` — React hook to restore session and expose `login`, `signup`, `logout`.
- `web/src/App.jsx` — small header UI for login/signup/logout and session display (non-invasive).

Environment variables
- `BETTER_AUTH_BASE_URL` (required for full functionality) — base URL for Better Auth (e.g. `https://auth.example.com`).
- `BETTER_AUTH_API_KEY` (optional) — server API key for provider if required.
- `COOKIE_NAME` (optional) — cookie name used to store session token (defaults to `ba_session`).
- `WEB_ORIGIN` — existing app variable used for CORS; ensure it's allowed in Better Auth redirect settings when deploying.

Notes on session strategy and cookies
- The server sets an `httpOnly` cookie named by `COOKIE_NAME` when the provider returns a session token on login/signup.
- `web/src/api/client.js` includes `credentials: 'include'` so cookies are sent with requests.
- `authMiddleware` is intentionally permissive: it attempts to introspect a session token (cookie or Bearer header) and sets `req.user` when successful, but does not reject unauthenticated requests.

Migration requirements
- No database migrations are required for this sprint. Ownership columns and ownership-aware repositories exist but are not activated.

Validation steps
1. Set the following env vars locally (example):

```bash
export BETTER_AUTH_BASE_URL="https://<your-better-auth-host>"
export BETTER_AUTH_API_KEY="<optional-service-api-key>"
export COOKIE_NAME="ba_session"
export WEB_ORIGIN="http://localhost:5173"
```

2. Install dependencies (if needed) and start the app:

```bash
npm install
npm run dev
```

3. From the frontend, open the header `Log in / Sign up` control and create an account or log in.

4. Verify session restoration:
- Refresh the page — you should remain signed in.
- Inspect network requests to `/api/auth/session` which returns `{ user: ... }` when signed in.

5. Verify backend `req.user` availability:
- Call any existing API route (e.g. `/api/documents`) and temporarily add a console.log of `req.user` in a route handler to confirm the user object is present when authenticated.

Security and deployment notes
- Cookie is set with `httpOnly` and `sameSite: 'lax'`. For production `secure` is set when `NODE_ENV === 'production'`.
- Ensure `WEB_ORIGIN` matches the deployed frontend origin and is added to the allowed origins in Better Auth configuration.
- For production, configure HTTPS and proper domain cookie attributes.

Next steps (future sprints)
- Wire ownership-aware repository methods behind auth checks.
- Add RBAC / tenant isolation if required.
- Add refresh token handling and rotate session cookie strategies per Better Auth recommendations.
