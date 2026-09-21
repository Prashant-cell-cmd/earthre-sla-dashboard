# EarthRe SLA Monitoring Dashboard

A full-stack take-home implementation for the EarthRe Full Stack Engineer case study.

## Architecture

- **Frontend:** React + Vite, deployed as a static site (Cloudflare Pages).
- **API / processing:** Cloudflare Worker. CSV uploads are parsed, timestamps normalized, latency converted to milliseconds, invalid latency handled, unknown status codes flagged, and duplicate rows ignored.
- **Persistence:** Cloudflare D1 (SQLite).
- **Flow:** Upload UI → Worker → validation/cleaning → D1 → stats/log APIs → dashboard.

This keeps processing stateless: the Worker does not depend on local files or in-memory state after the request completes.

## Data findings

The supplied datasets contain mixed ISO timestamps and Unix-second timestamps; both are normalized to UTC ISO-8601. Latency uses both milliseconds and seconds; seconds are converted to milliseconds. Latency is sometimes missing and one negative latency appears in each supplied dataset; missing/negative/non-finite latency is stored as NULL rather than deleting the whole check. Exact duplicate rows occur and are ignored using a deterministic fingerprint. Status 999 appears once per dataset and is retained but marked invalid/unknown. HTTP 500/502/503 are retained as failed checks.

## Availability assumption

Availability is calculated as `successful HTTP 200 checks / all stored checks × 100`. Status 999 is retained for auditability but excluded from the successful numerator. 500/502/503 count as failed checks. This is an application-level health-check availability metric, not a provider billing-credit calculation.

## Stats

The dashboard shows availability, total checks, successful/failed/invalid checks, average latency, and P95 latency. These were selected because they are useful to on-call/support/billing users while remaining explainable from the supplied data.

## Local development

### Worker

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create earthre-sla
# Copy the returned database_id into wrangler.toml
npx wrangler d1 execute earthre-sla --remote --file=schema.sql
npm run dev
```

### Web

```bash
cd web
npm install
# Windows PowerShell
$env:VITE_API_URL="http://localhost:8787"
npm run dev
```

## Deployment

1. Create the D1 database and apply `schema.sql`.
2. Put the returned D1 database ID in `worker/wrangler.toml`.
3. Run `npm run deploy` from `worker` and note the Worker URL.
4. Set `VITE_API_URL` to the Worker URL when building the web app.
5. Deploy `web/dist` to Cloudflare Pages.

## Out of scope

Authentication, user accounts, multi-tenancy, and CI pipelines are intentionally excluded as required by the assignment.

## With more time

I would add paginated logs, service-level filtering, a small chart for availability/latency over time, stronger schema validation, upload audit metadata, automated tests, and a more sophisticated CSV parser/library if the platform limits allowed it.

## Live verification

Update this section immediately before submission with the deployed frontend URL, Worker URL, and the date/time they were last verified.
