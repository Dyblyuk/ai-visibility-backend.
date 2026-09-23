# Persistent report storage

The app supports PostgreSQL via `REPORT_DATABASE_URL`. Report JSON and generated PDF bytes live in `ai_visibility_reports`; there is no age-based deletion in PostgreSQL. Existing SendPulse mappings and `/api/sendpulse-report` requests remain compatible. PDF links continue working after a web-service restart because downloads read the database.

## Render activation

1. Provision a dedicated database in workspace Top-marketing, region Oregon (same as the web service). Proposed instance: Basic 256 MB, 1 GB disk. Confirm recurring cost before provisioning. Do not use the expiring free database for permanent retention.
2. Set `REPORT_DATABASE_URL` on `ai-visibility-backend` to the database's internal connection string. Store it only in Render environment variables; never commit it.
3. Redeploy. Startup creates the additive `ai_visibility_reports` table. If the configured DB is unavailable, startup fails; it never silently falls back to memory.
4. `/api/health` must contain `reportStorage: {kind:"postgres",durable:true}`.
5. Save a synthetic report on a staging service with outgoing integrations disabled. Issue its PDF, restart the service, and verify the same token and PDF URL still work.

Until activation, health reports `kind: memory, durable: false`. Memory mode keeps entries up to 24 hours (cleanup on a new save), caps entries at 1,000, and still loses them on restart. Reports created before the switch cannot be migrated automatically from the previous process.

## Validation

`npm test` exercises the SQL using PGlite's PostgreSQL engine on disk: close/reopen, 60-day-old report, byte-for-byte PDF retrieval, token isolation, repeated delivery, and lead-notification deduplication. A HTTP smoke test separately exercises the production server and PDFKit. Render connectivity remains to be verified after infrastructure activation.

## Boundaries

This change does not activate the separate draft PR's shared-secret/contact authorization: the current working SendPulse flow is kept compatible. The new tokens have 192 bits of randomness, but possession of a token remains the access mechanism. Authenticated issuance and subscriber binding remain a separate integration hardening task.
