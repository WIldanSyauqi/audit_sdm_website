# Audit SDM Website

A portfolio-ready HR audit management system focused on employee administration, audit tracking, findings review, role-based permissions, and deployment-ready backend services.

## Project overview

This application simulates an internal HR audit dashboard for managing compliance checks, employee records, audit findings, and report generation. It is designed to showcase full-stack workflow logic, role segmentation, CRUD operations, and clean frontend presentation for portfolio or demo purposes.

## Features

- Audit lifecycle management with title, department, score, and status tracking
- Employee management with create, read, update, delete, reset password, and safe role protections
- Database-driven employee ID reindexing after deletion to keep IDs consistent
- Role-based access for admin, auditor, manager, and viewer
- Audit logs, CSV export, password strength validation, and reporting views
- SQLite-first database with PostgreSQL-ready compatibility
- Vercel, Render, and Railway deployment templates included

## Local run

```bash
npm install
npm start
```

Open: http://localhost:3000

## Default login

- Email: admin@audit.local
- Password: admin123

## Production status

The project has been deployed to Vercel successfully, but the live deployment is currently protected by Vercel authentication. The app is reachable through the Vercel dashboard and can be opened by authenticated project members until public access is enabled.

Production URL:
- https://auditsdmwebsite-oakrcv1b4-hotaru-id.vercel.app

## Deployment configs

- Vercel: [vercel.json](vercel.json)
- Render: [render.yaml](render.yaml)
- Railway: [railway.json](railway.json)

## Environment variables

```env
PORT=3000
JWT_SECRET=change-this-secret-key
NODE_ENV=development
DB_CLIENT=sqlite
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/audit_sdm
```

## Portfolio notes

This project is optimized for a professional portfolio showcase: it demonstrates practical backend logic, real database behavior, role permissions, secure admin guards, and deployment-ready architecture in a single application.
