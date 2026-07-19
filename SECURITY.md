# Security Policy

## Supported Versions

Atlas follows semantic versioning. The latest stable release is the only supported version for security fixes.

| Version | Supported |
|---------|-----------|
| latest | ✅ |
| < latest | ❌ |

---

## Reporting a Vulnerability

Atlas is a community-maintained open-source project. We take security concerns seriously.

If you discover a security vulnerability, **do not open a public GitHub issue**. Instead, report it privately:

1. **Email**: [Your email address]
2. **Subject**: `[Atlas Security] Brief description`

Alternatively, use the **GitHub Security Advisory** tab on the repository (if enabled).

### What to include

- Type of vulnerability
- Steps to reproduce
- Affected versions
- Any potential impact
- Suggested fix (if available)

### Response timeline

- **Acknowledgement**: within 48 hours
- **Initial assessment**: within 5 business days
- **Fix timeline**: communicated after assessment

---

## Security Best Practices for Deployments

### Environment Variables

- Never commit `.env` files to version control. The `.env` file is in `.gitignore`.
- Use strong, unique values for `BETTER_AUTH_SECRET`. Generate via `openssl rand -hex 32`.
- Store production secrets in your deployment platform's secret management (Vercel Environment Variables, Render Secret Files, or Docker secrets), not in files.

### Database

- Use a dedicated PostgreSQL user with minimal required permissions.
- Enable SSL for production database connections. Set `sslmode=require` in `DATABASE_URL` or ensure `DATABASE_SSL` is not set to `false`.
- Restrict network access to the database (Neon allows IP-based access rules).

### API Security

- Athena enforces rate limiting: 10 POST requests per 15 minutes on auth endpoints, 200 requests per 15 minutes on all other API endpoints.
- Helmet sets security-related HTTP headers.
- CORS is restricted to the `WEB_ORIGIN` value.
- All authenticated endpoints reject unauthenticated requests with HTTP 401.

### Docker Deployments

- The production Dockerfile uses multi-stage builds to minimize the attack surface.
- The backend container runs as root by default. For production deployments, consider running with a non-root user.
- Expose only the frontend port (80) to the public internet. The backend (8787) and database (5432) should remain on the internal Docker network.
- The `.dockerignore` file excludes `.env`, `node_modules`, and build artifacts from the build context.
- Review and update image tags (`pgvector/pgvector:pg16`, `node:20-alpine`, `nginx:alpine`) regularly for security patches.

### Dependencies

- Review dependency updates regularly via `npm audit`.
- The project uses `npm ci` for deterministic, reproducible installs.
- Pinned versions in `package-lock.json` protect against supply-chain attacks during install.

---

## Responsible Disclosure

We request that security researchers:

- Give us reasonable time to fix and release a patch before publishing the vulnerability.
- Do not exploit the vulnerability beyond what is necessary to demonstrate the issue.
- Do not access or modify user data without explicit permission.
- Follow applicable laws and regulations.
