import express from 'express';

const router = express.Router();

// Environment variables:
// BETTER_AUTH_BASE_URL - base URL for Better Auth management endpoints (e.g. https://auth.example.com)
// BETTER_AUTH_API_KEY - service API key for server-to-server calls (optional)
// COOKIE_NAME - optional cookie name for session (defaults to ba_session)

const BASE = process.env.BETTER_AUTH_BASE_URL ?? null;
const COOKIE_NAME = process.env.COOKIE_NAME ?? 'ba_session';

async function introspectSession(token) {
  if (!BASE || !token) return null;

  try {
    const resp = await fetch(new URL('/auth/session', BASE).toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(process.env.BETTER_AUTH_API_KEY ? { 'x-api-key': process.env.BETTER_AUTH_API_KEY } : {})
      }
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    // Expecting { user: { id, email, ... } } or similar shape. Return user object.
    return data.user ?? data;
  } catch (err) {
    return null;
  }
}

// Middleware to populate req.user when a valid session exists.
export async function authMiddleware(req, _res, next) {
  try {
    const cookieToken = req.cookies?.[COOKIE_NAME];
    const authHeader = req.headers?.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null;
    const token = authHeader || cookieToken || null;

    if (!token || !BASE) {
      // No token or no configured auth provider — leave req.user undefined and continue.
      return next();
    }

    const user = await introspectSession(token);
    if (user) {
      req.user = user;
    }
  } catch (err) {
    // don't block requests on auth failures — req.user remains undefined
  }

  return next();
}

// Auth router: lightweight proxy endpoints for signup/login/logout/session
router.post('/signup', async (req, res) => {
  if (!BASE) return res.status(500).json({ error: 'auth_not_configured' });

  try {
    const resp = await fetch(new URL('/auth/signup', BASE).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.BETTER_AUTH_API_KEY ? { 'x-api-key': process.env.BETTER_AUTH_API_KEY } : {}) },
      body: JSON.stringify(req.body)
    });

    const payload = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json(payload);
    }

    // Accept token from provider and set cookie if provided
    const token = payload?.token ?? payload?.session_token ?? null;
    if (token) {
      res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    }

    return res.json({ user: payload.user ?? payload });
  } catch (err) {
    return res.status(500).json({ error: 'signup_failed' });
  }
});

router.post('/login', async (req, res) => {
  if (!BASE) return res.status(500).json({ error: 'auth_not_configured' });

  try {
    const resp = await fetch(new URL('/auth/login', BASE).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.BETTER_AUTH_API_KEY ? { 'x-api-key': process.env.BETTER_AUTH_API_KEY } : {}) },
      body: JSON.stringify(req.body)
    });

    const payload = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json(payload);
    }

    const token = payload?.token ?? payload?.session_token ?? null;
    if (token) {
      res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    }

    return res.json({ user: payload.user ?? payload });
  } catch (err) {
    return res.status(500).json({ error: 'login_failed' });
  }
});

router.post('/logout', async (req, res) => {
  if (!BASE) {
    res.clearCookie(COOKIE_NAME);
    return res.json({ ok: true });
  }

  try {
    const cookieToken = req.cookies?.[COOKIE_NAME];
    const authHeader = req.headers?.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null;
    const token = authHeader || cookieToken || null;

    if (token) {
      // Attempt to inform provider
      await fetch(new URL('/auth/logout', BASE).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(process.env.BETTER_AUTH_API_KEY ? { 'x-api-key': process.env.BETTER_AUTH_API_KEY } : {}) },
        body: JSON.stringify({ token })
      }).catch(() => {});
    }

    res.clearCookie(COOKIE_NAME);
    return res.json({ ok: true });
  } catch (err) {
    res.clearCookie(COOKIE_NAME);
    return res.status(500).json({ error: 'logout_failed' });
  }
});

router.get('/session', async (req, res) => {
  if (!BASE) return res.status(200).json({ user: null });

  const cookieToken = req.cookies?.[COOKIE_NAME];
  const authHeader = req.headers?.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null;
  const token = authHeader || cookieToken || null;

  if (!token) return res.status(200).json({ user: null });

  const user = await introspectSession(token);
  return res.json({ user: user ?? null });
});

export default router;
