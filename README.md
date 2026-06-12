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

## GitHub Pages

This folder is ready to push as a static GitHub Pages site. Do not commit credentials; the dashboard only includes aggregated JSON.

GitHub Pages can switch only across dates already present in `data/dashboard_data.json`. Arbitrary dynamic date selection is available on the local server because GitHub Pages cannot safely hold MySQL or Mixpanel credentials.

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

The workflow `.github/workflows/refresh-data.yml` remains available for manual runs if the database is ever opened to GitHub runners or moved behind a reachable analytics endpoint.

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
