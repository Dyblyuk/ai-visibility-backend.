# Telegram contact conversion tracking

## Implemented

The landing page captures UTM, GCLID/GBRAID/WBRAID and Meta FBC/FBP. It stores
the last tagged visit for 30 days and sends a snapshot with `/api/save-report`.
The server stores it against the existing random report token, so the SendPulse
deep link does not need to contain a phone number or advertising identifiers.

`POST /api/sendpulse-report` records a conversion only after a valid phone arrives
from an authenticated SendPulse request. Clicks, scans, PDF downloads and ordinary
untrusted API calls cannot create ad conversions. The event timestamp is contact
receipt, independently of PDF generation. The same normalized phone yields one
Lead across repeated report requests and new scans. No historical contacts are
backfilled. Restart-safe SQL deduplication also supplies a stable Meta event_id /
Google transactionId. Ads network requests run in the background, outside PDF delivery.

Meta uses CAPI `Lead` with `action_source=chat`. Google uses Data Manager API
`events:ingest`, `eventSource=MESSAGE`, and a conversion action for imported leads.
Google ingestion acceptance is recorded as `processing`, not success: the worker
polls `requestStatus:retrieve`. `sent` means accepted/processed, not attributed to an ad.
Errors retry with backoff; processing failures remain visible in the SQL outbox.
Rows expire before six-day-old leads could be incorrectly retried to Meta.

## Activation (not completed by installing the code)

1. Connect a durable PostgreSQL database using `REPORT_DATABASE_URL`. The existing
   report store is reused; no new dependency is required. Without it, report delivery
   continues, but the response explicitly says `storage_not_configured` and ad leads
   are NOT queued in volatile memory. Provisioning a new paid resource is separate.
2. Set `SENDPULSE_TRACKING_SECRET` to a cryptographically random server secret.
   In the existing SendPulse request, keep `token` and `phone` and add header
   `x-sendpulse-tracking-secret` with the same value. Keep it in a private/global
   variable, never in the public landing page or URL. Other report requests still
   work, but cannot create conversions.
3. Meta: confirm the intended dataset/pixel (the existing website pixel is
   `297361415966498`), set `META_PIXEL_ID`, `META_API_VERSION` (a supported Graph
   version), and `META_CAPI_ACCESS_TOKEN` in Render secrets. Use a test event code
   first; test events have status `test_sent`. Use a new test contact/event after
   removing the test code. Do not reuse test-sent rows for production metrics.
4. Google: choose the advertiser account (not merely the MCC), create the imported
   conversion action “Контакт отримано в Telegram”, count One, and configure it
   as a bidding goal only after verification. Set customer and conversion action
   IDs; optionally set the manager login account ID. Enable Data Manager API in
   the OAuth project's Google Cloud account and authorize scope
   `https://www.googleapis.com/auth/datamanager`. Store OAuth client ID, client
   secret, refresh token in Render. Credentials must not go into Git or chat.
5. Consent integration: `window.tmAdsConsent` accepts `adUserData`,
   `adPersonalization`, `adStorage`, each `granted` / `denied`. Wire this to the
   actual consent collection; never infer permission from sharing a phone.
   Unknown permission is not upgraded to granted. Phone hashes are sent to the
   platforms only on an explicit granted signal. Explicit refusal prevents
   collection/delivery. Without a granted signal Google uses the stored click ID
   and Meta uses available browser IDs; platform/account consent rules still apply.
6. Enable with `ADS_CONVERSIONS_ENABLED=true`. `/api/health` exposes configuration
   booleans, not credentials. Delivery requires enabled + durable store + shared
   secret + configured destination. It can activate Meta and Google independently.

## Google Sheets

The existing lead webhook now also receives `website`, `reportToken`, `attribution`
and `conversionStatus`. The existing Apps Script accepts the extra fields but
requires the updated `google-sheets-webhook.gs` deployment to display new columns.
Updating the Git file alone does not update Apps Script. Existing eight columns
and all existing rows are preserved. Only a narrow allowlist of attribution fields
is accepted; arbitrary URL parameters, landing-page URLs and raw phone numbers are
not sent to the ad APIs.

## Verify before buying traffic

- Tagged landing -> saved report -> authenticated SendPulse phone request -> two
  outbox rows. No contact or invalid source -> no rows.
- Meta Test Events must display Lead with matching event ID. Google must progress
  from processing to sent without warnings/errors in import diagnostics.
- Request the same PDF and make another scan with the same contact: no extra leads.
- Restart the service with pending jobs and verify they resume once.
- Check live diagnostics and the selected conversion's eligibility for the planned
  campaign objective; API acceptance alone is not proof of attribution or bidding.
- Match incoming lead counts against SQL and ad diagnostics; missing click IDs and
  denied consent cannot be silently reported as attributed conversions.

Read-only queue diagnostic:

```sql
SELECT platform, status, error_code, count(*)
FROM ad_conversion_outbox GROUP BY platform, status, error_code;
```

References:
- https://developers.facebook.com/docs/marketing-api/conversions-api/
- https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest
- https://developers.google.com/data-manager/api/reference/rest/v1/requestStatus/retrieve
- https://sendpulse.com/knowledge-base/chatbot/send-receive-data
