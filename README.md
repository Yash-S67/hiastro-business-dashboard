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
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## GitHub Pages

This folder is ready to push as a static GitHub Pages site. Do not commit credentials; the dashboard only includes aggregated JSON.

## Daily update on GitHub

The workflow `.github/workflows/refresh-data.yml` refreshes `data/dashboard_data.json` every day at **08:30 IST** and commits the updated aggregate data. The Pages workflow redeploys after that commit.

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
