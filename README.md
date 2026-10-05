# CAMVIA

CAMVIA is a school management intelligence application for student records,
attendance, fees, parent communication, alerts, and school administration.

## Development

Requirements: Node.js 22.12+ (or 20.19+) and npm.

```powershell
npm ci
npm run dev
```

Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in a local
`.env.local` file before connecting to Supabase. Never expose service-role keys
to the browser.

For build, lint, Supabase, and deployment guidance, see
[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) and
[docs/PRODUCTION_READINESS.md](./docs/PRODUCTION_READINESS.md).
