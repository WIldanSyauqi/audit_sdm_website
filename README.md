# Audit SDM Portfolio Project

A polished HR audit portal built as a presentation-ready portfolio app for showcasing system design, CRUD functionality, role-based access, and deployment readiness.

## Features

- Complete audit CRUD form with title, department, status, and score
- Employee management form with name, email, role, and password
- Frontend search and role-based filtering for audits and employees
- Login and access flow with admin, auditor, manager, and viewer roles
- REST API backend with SQLite default and PostgreSQL-ready configuration
- Render, Vercel, and Railway deployment configs included
- Clean UI tailored for portfolio presentation and live demo use

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000

## Default login

- Email: admin@audit.local
- Password: admin123

## Deployment

- Render: use the included [render.yaml](render.yaml)
- Vercel: use the included [vercel.json](vercel.json)
- Railway: use the included [railway.json](railway.json)

## Environment variables

```env
PORT=3000
JWT_SECRET=change-this-secret-key
NODE_ENV=development
DB_CLIENT=sqlite
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/audit_sdm
```

## Portfolio notes

This version is optimized for presentations: a more refined interface, realistic workflow logic, and clear evidence of CRUD and dashboard operations without requiring additional setup beyond the local Node runtime.
