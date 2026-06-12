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

GitHub Pages can switch across dates already present in `data/dashboard_data.json`. The GitHub workflow is scheduled daily at **03:15 UTC / 08:45 IST** and can refresh this aggregate file when GitHub can reach the database and repository secrets are configured.

Arbitrary dynamic date selection on GitHub Pages needs a separate API service, because GitHub Pages cannot safely hold MySQL or Mixpanel credentials. This repo includes `scripts/serve_dashboard.py` plus `render.yaml` so the same live API can be deployed as a small web service. After deployment, set this public, non-secret value in `assets/config.js`:

```js
window.HIASTRO_DASHBOARD_API_BASE_URL = "https://your-dashboard-api.example.com";
```

Keep all MySQL and Mixpanel credentials only as API-service environment variables.

## Daily update

The dashboard refresh is installed as a Mac LaunchAgent because GitHub-hosted runners cannot reach the MySQL server. It runs every day at **08:30 IST**, refreshes `data/dashboard_data.json`, commits the updated aggregate data, and pushes it to GitHub. GitHub Pages redeploys after that push.

Installed LaunchAgent:

```text
~/Library/LaunchAgents/com.hiastro.business-dashboard-refresh.plist
```

Manual refresh:

```bash
/Users/yashs/Documents/WorkDirectory/hiastro-business-dashboard/scripts/refresh_and_push.sh
```

The workflow `.github/workflows/refresh-data.yml` also runs daily and remains available for manual runs. If GitHub runners cannot reach MySQL, the Mac LaunchAgent is the reliable refresh path; if the DB is opened to GitHub runners or moved behind a reachable analytics endpoint, GitHub can refresh without your Mac.

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
