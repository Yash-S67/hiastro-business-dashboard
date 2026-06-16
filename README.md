# HiAstro Business Dashboard

Static dashboard for Monetization, Acquisition, Retention, and Engagement.

## Refresh data

Run from `/Users/yashs/Documents/WorkDirectory`:

```bash
.venv/bin/python hiastro-business-dashboard/scripts/build_dashboard_data.py
```

The script reads credentials from the parent `.env` file and writes aggregated data to:

```text
hiastro-business-dashboard/data/dashboard_data.json
```

## Local preview

```bash
cd /Users/yashs/Documents/WorkDirectory/hiastro-business-dashboard
/Users/yashs/Documents/WorkDirectory/.venv/bin/python scripts/serve_dashboard.py --port 8080
```

Open `http://localhost:8080`.

This local server also enables flexible daily selection. When you pick a date that is not already in `data/dashboard_data.json`, the browser calls:

```text
/api/dashboard?date=YYYY-MM-DD
```

The endpoint fetches aggregate metrics from MySQL and Mixpanel using the parent `.env` file. It does not write the selected-date result to the repo and does not return raw rows or credentials to the browser.

## Marketing CSV upload

The Marketing tab can use a session-only CSV upload for campaign spend when the Google Sheet feed is not available. Use the `Campaign Data` export format:

```text
Date, Platform, Campaign Type, Campaign ID, Campaign Name, Spend, Installs, Impressions, Clicks
```

Optional columns are also supported:

```text
New Logins, Trials, Subscribers, Revenue
```

If optional conversion/revenue columns are missing, the dashboard uses the uploaded CSV for spend, clicks, impressions, installs, CTR, CPC, CPM, and CPI, then uses the existing dashboard totals for selected-date trial/subscriber/revenue CAC and ROAS. Uploaded CSV rows are not stored in the repo; they apply only to the current browser session.

The uploader also supports the `Subscription Overview` workbook format where the first row is `Device Type / All`, the second row is blank, and the third row contains the real headers:

```text
Date, Installs, Marketing spends, Marketing spends - subs, New Logins, Subscription New Logins, Trial Starts, Trials @ Re 1, Trials @ Re 49, Paid Subs, Paid Subs @ 199, Paid Subs @ 499, Paid upgrades @ 300, Revenue, Trial Revenue, Sub Revenue, DAU, Subscriber DAU, Trial CAC, Subscriber CAC
```

CSV and tab-separated exports are both accepted.

## GitHub Pages

This folder is ready to push as a static GitHub Pages site. Do not commit credentials; the dashboard only includes aggregated JSON.

GitHub Pages can switch across dates already present in `data/dashboard_data.json`. The publishing setup now has two scheduled refresh paths:

- Daily incremental refresh at **06:35 UTC / 12:05 IST** via `.github/workflows/refresh-data.yml`
- Weekly full rebuild at **03:45 UTC / 09:15 IST Sunday** via `.github/workflows/refresh-full-rebuild.yml`

The daily job keeps the dashboard date moving forward quickly. The weekly full rebuild refreshes the heavier historical slices and diagnostic sections.

Arbitrary dynamic date selection on GitHub Pages needs a separate API service, because GitHub Pages cannot safely hold MySQL or Mixpanel credentials. This repo includes `scripts/serve_dashboard.py` plus `render.yaml` so the same live API can be deployed as a small web service. After deployment, set this public, non-secret value in `assets/config.js`:

```js
window.HIASTRO_DASHBOARD_API_BASE_URL = "https://your-dashboard-api.example.com";
```

Keep all MySQL and Mixpanel credentials only as API-service environment variables.

## Daily update

Primary path:

- GitHub Actions refreshes and pushes `data/dashboard_data.json`
- GitHub Pages redeploys automatically after that push

Backup path:

- Codex cron automation `hiastro-dashboard-daily-refresh` runs locally at **12:05 IST**
- It checks freshness first, then runs `scripts/refresh_and_push.sh` only if the latest complete IST day is missing

Manual refresh:

```bash
/Users/yashs/Documents/WorkDirectory/hiastro-business-dashboard/scripts/refresh_and_push.sh
```

Live dynamic fetch options:

- Local: run `scripts/serve_dashboard.py` and the browser can fetch any selected date through `/api/dashboard?date=YYYY-MM-DD`
- Hosted: deploy `render.yaml`, set `window.HIASTRO_DASHBOARD_API_BASE_URL`, and GitHub Pages can fetch selected dates dynamically from the API service

The old Mac LaunchAgent plist is left in the repo as reference only. The scheduled GitHub workflows plus the Codex backup automation are the intended refresh system now.

Add these repository secrets in GitHub before enabling the hosted refresh:

```text
MYSQL_HOST
MYSQL_PORT
MYSQL_USER
MYSQL_PASSWORD
MYSQL_DATABASE
MIXPANEL_PROJECT_ID
MIXPANEL_SERVICE_ACCOUNT_USERNAME
MIXPANEL_SERVICE_ACCOUNT_SECRET
```

For the hosted API service (`render.yaml`), also set:

```text
ANTHROPIC_API_KEY      # enables the natural-language query box
DASHBOARD_API_TOKEN    # shared token gating /api/dashboard and /api/query
```

## Ask the Data (natural-language query)

The **Ask the Data** section turns a plain-English question into a read-only SQL
query. Claude (`claude-opus-4-8`) writes a single `SELECT` against the live MySQL
schema; the server validates it (SELECT-only, single statement, comments and
string literals stripped before keyword checks, row + time capped) and runs it
inside a `READ ONLY` transaction, so the database itself refuses any write even
if validation were bypassed. Generated SQL and results are shown in the browser;
raw credentials are never returned.

This requires the live API service:

- Local: run `scripts/serve_dashboard.py` with `ANTHROPIC_API_KEY` in the parent `.env`.
- Hosted: deploy `render.yaml`, set `ANTHROPIC_API_KEY`, set `DASHBOARD_API_TOKEN`,
  and put the same token in `assets/config.js` as `window.HIASTRO_DASHBOARD_API_TOKEN`.

`POST /api/query` with `{"question": "..."}` returns `{status, sql, columns, rows, ...}`.
Tunables (env): `DASHBOARD_QUERY_MODEL`, `DASHBOARD_QUERY_MAX_ROWS` (default 200),
`DASHBOARD_QUERY_TIMEOUT_MS` (default 15000).

## Live auto-refresh

When the API service is running it refreshes `data/dashboard_data.json` daily on
its own: a background thread checks whether the latest complete IST day is
present and rebuilds if not (interval `DASHBOARD_AUTO_REFRESH_INTERVAL_S`,
default 1800s; disable with `DASHBOARD_AUTO_REFRESH=0`). The front-end polls
`/api/status` every 30 minutes and reloads the data when a newer day appears,
showing a **Live** badge next to the freshness stamp.

## Subscription retention and 7-day trends

The Monetization → **Sub Retention** tab answers "how many subscribers are
staying (not cancelling)" two ways: a point-in-time view (active paid
subscribers not marked `cancel_at_period_end` / `CANCELED_PLAN`, with churn-risk
and revenue-at-risk) and a realized first-month renewal cohort. The Executive
Summary also shows a rolling last-7-days sparkline trend for revenue, new users,
subscribers, and sessions.
