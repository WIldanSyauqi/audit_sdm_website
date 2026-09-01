# Deployment Setup

## Production stack

- Node.js + Express API
- PostgreSQL as primary database
- JWT auth and RBAC
- scheduled DB backup via cron / task scheduler
- reverse proxy (Nginx or Caddy)
- HTTPS with certbot or cloud-managed TLS

## Environment variables

Set these in production:

- PORT
- JWT_SECRET
- DB_CLIENT=postgres
- DATABASE_URL
- NODE_ENV=production

## Start server

```bash
npm install
npm run start:prod
```

## Backup automation

Linux cron example:

```bash
0 0 * * * cd /path/to/project && DATABASE_URL=postgresql://user:pass@host:5432/audit_sdm npm run db:backup
```

Windows Task Scheduler example:

```powershell
C:\Program Files\nodejs\node.exe C:\path\to\project\scripts\backup-db.js
```

## Recommended production hardening

- use secrets manager
- rotate JWT secret
- enable HTTPS only
- restrict DB network access
- enable PG backups and retention policy
- run restore drills regularly
- keep audit_logs immutable
- add rate limiting and request validation
