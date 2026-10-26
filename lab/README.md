# Top Marketing — AI Audit v2 Lab

Isolated, unpublished experiment on `experiment/ai-audit-v2-lab`. The production files, `main`, Render services, domains, webhooks, and campaigns are unchanged.

## What works

- Profile: brand, HTTPS website, priority service/category, geography.
- Up to 3 HTML pages checked with public-address DNS pinning and redirect validation.
- 2–3 editable, explicitly confirmed unbranded customer queries. Automatically suggested guarantee wording is removed; historical fixtures retain their exact original questions.
- Four brand-knowledge checks and recommendations for each confirmed query.
- Evidence tied to a page or a verbatim AI answer; coverage and unavailable results remain explicit.
- Three priority actions, clearly separating observed gaps from recommended manual checks.
- Three-page PDF in Unbounded / Noto Sans and Top Marketing colors.
- A recorded example for reviewing the UI without buying another scan.

## Boundary with production

Live mode calls **only** these existing, stateless computation endpoints on the production backend:

1. `/api/discovery-queries`
2. `/api/scan-engine`
3. `/api/zone-query`

This reuses the configured provider keys without reading or copying them. **Live tests consume the same provider API credits and quotas as production.** Two parallel recommendation requests and one lab job at a time bound the load. The experiment does not reconfigure the production backend.

No production delivery, storage, CRM, SendPulse, Telegram, lead, or ad-conversion endpoints are proxied. No `phone`, email, cookies, or authorization headers are forwarded. The lab never imports production `server.js`, so production database initialization and conversion workers do not start. Preparations and results are temporary in-memory objects with a one-hour TTL; there is no production database connection.

## Run locally

Use Node.js 24. From the repository root:

```sh
npm ci
cd lab
npm run dev
```

Default port: 3000 (`PORT` can override it). Open `http://localhost:3000`. This starts a separate process, not the production server. Do not change Render's branch or start command to this experiment.

Tests:

```sh
cd lab
npm test
```

## Deliberate limits of this iteration

- These are API snapshots, not rankings in consumer chat interfaces or Google AI Overviews.
- Website checks inspect initial HTML; a JavaScript-rendered element can be missed. Absence is scoped to the inspected pages.
- Brand and geography indicators are textual checks, not an automatic verification of every claim.
- Competitor domains are taken from AI answers and are not a guarantee that those domains were actual retrieval sources. Automated competitor-site comparisons and structured source citation capture remain a next iteration.
- No causal claim that an observed gap explains an AI recommendation; no promise of ranking improvement or extra revenue.
- The current underlying assessor still depends on Anthropic. The lab displays failures and coverage honestly; cross-provider fallback is not implemented here.

## Promoting later

Review the recorded example, then test multiple real brands and compare accuracy, usefulness, time, and cost. Merge/publish only after separate approval. The experiment is additive under `lab/`, making a selective production port possible without replacing the existing funnel.

## Fonts

Unbounded and Noto Sans are distributed under the SIL Open Font License. Source: the Google Fonts repository. License files are included with the font assets.
