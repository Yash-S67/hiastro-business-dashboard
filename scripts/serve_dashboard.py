from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from datetime import date, datetime, timedelta
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from build_dashboard_data import (
    DASHBOARD_ROOT,
    IST,
    OUTPUT_PATH,
    build_daily_api_payload,
)

API_TOKEN = os.environ.get("DASHBOARD_API_TOKEN", "").strip()
QUERY_ENABLED = bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))
AUTO_REFRESH = os.environ.get("DASHBOARD_AUTO_REFRESH", "1").lower() in {"1", "true", "yes"}
AUTO_REFRESH_INTERVAL_S = int(os.environ.get("DASHBOARD_AUTO_REFRESH_INTERVAL_S", "1800"))
MAX_QUERY_BODY = 8000


def latest_complete_ist_day() -> date:
    return datetime.now(IST).date() - timedelta(days=1)


def dashboard_latest_loaded_day() -> str | None:
    """Newest IST day already present in dashboard_data.json."""
    try:
        data = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    meta = data.get("metadata", {})
    days = [p.get("date") for p in meta.get("daily_periods", []) if p.get("date")]
    window_end = meta.get("current_window", {}).get("end")
    if window_end:
        days.append(window_end)
    return max(days) if days else None


class DashboardRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DASHBOARD_ROOT), **kwargs)

    def log_message(self, *args):  # keep the console quiet but overridable
        if os.environ.get("DASHBOARD_VERBOSE"):
            super().log_message(*args)

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", os.environ.get("DASHBOARD_ALLOWED_ORIGIN", "*"))
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Dashboard-Token")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT.value)
        self.end_headers()

    # ---- auth -------------------------------------------------------------
    def _authorized(self, query_params: dict) -> bool:
        if not API_TOKEN:
            return True  # local/dev mode: no token configured, endpoints are open
        header = self.headers.get("X-Dashboard-Token", "")
        token = header or (query_params.get("token") or [""])[0]
        return token == API_TOKEN

    def _require_auth(self, query_params: dict) -> bool:
        if self._authorized(query_params):
            return True
        self.write_json(HTTPStatus.UNAUTHORIZED, {"error": "Missing or invalid dashboard API token."})
        return False

    # ---- routing ----------------------------------------------------------
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            self.handle_status_api()
            return
        if parsed.path == "/api/dashboard":
            params = parse_qs(parsed.query)
            if not self._require_auth(params):
                return
            self.handle_dashboard_api(params)
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/query":
            params = parse_qs(parsed.query)
            if not self._require_auth(params):
                return
            self.handle_query_api()
            return
        self.write_json(HTTPStatus.NOT_FOUND, {"error": "Unknown endpoint."})

    # ---- json helper ------------------------------------------------------
    def write_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status.value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---- endpoints --------------------------------------------------------
    def handle_status_api(self) -> None:
        self.write_json(
            HTTPStatus.OK,
            {
                "status": "ok",
                "live_daily_api": True,
                "query_enabled": QUERY_ENABLED,
                "auth_required": bool(API_TOKEN),
                "auto_refresh": AUTO_REFRESH,
                "latest_complete_day": latest_complete_ist_day().isoformat(),
                "dashboard_latest_day": dashboard_latest_loaded_day(),
                "timezone": "Asia/Kolkata",
                "generated_at_ist": datetime.now(IST).isoformat(timespec="seconds"),
            },
        )

    def handle_dashboard_api(self, params: dict) -> None:
        raw_date = (params.get("date") or [""])[0]
        try:
            day_value = date.fromisoformat(raw_date)
        except ValueError:
            self.write_json(HTTPStatus.BAD_REQUEST, {"error": "Pass date as YYYY-MM-DD."})
            return
        try:
            payload = build_daily_api_payload(day_value)
        except ValueError as exc:
            self.write_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            self.write_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {
                    "error": "Could not fetch live dashboard data for this date.",
                    "detail": str(exc),
                    "generated_at": datetime.now().isoformat(timespec="seconds"),
                },
            )
        else:
            self.write_json(HTTPStatus.OK, payload)

    def handle_query_api(self) -> None:
        if not QUERY_ENABLED:
            self.write_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"error": "Custom query is disabled. Set ANTHROPIC_API_KEY on the API service to enable it."},
            )
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > MAX_QUERY_BODY:
            self.write_json(HTTPStatus.BAD_REQUEST, {"error": "Send a JSON body {\"question\": \"...\"}."})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            question = str(body.get("question", "")).strip()
        except (ValueError, UnicodeDecodeError):
            self.write_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON body."})
            return
        if not question:
            self.write_json(HTTPStatus.BAD_REQUEST, {"error": "Ask a question first."})
            return
        try:
            from query_assistant import answer_question

            result = answer_question(question)
        except Exception as exc:
            self.write_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"status": "error", "error": str(exc)})
            return
        self.write_json(HTTPStatus.OK, result)


# ---- background daily auto-refresh ---------------------------------------
_refresh_lock = threading.Lock()


def _run_refresh() -> None:
    if not _refresh_lock.acquire(blocking=False):
        return  # a refresh is already running
    try:
        print(f"[auto-refresh] rebuilding dashboard data at {datetime.now(IST).isoformat(timespec='seconds')} IST")
        subprocess.run(
            [sys.executable, str(Path(__file__).resolve().parent / "build_dashboard_data.py")],
            check=False,
            cwd=str(DASHBOARD_ROOT.parent),
        )
        print("[auto-refresh] done")
    finally:
        _refresh_lock.release()


def _auto_refresh_loop() -> None:
    while True:
        try:
            loaded = dashboard_latest_loaded_day()
            latest = latest_complete_ist_day().isoformat()
            if loaded is None or loaded < latest:
                _run_refresh()
        except Exception as exc:  # never let the loop die
            print(f"[auto-refresh] check failed: {exc}")
        time.sleep(AUTO_REFRESH_INTERVAL_S)


def start_auto_refresh() -> None:
    thread = threading.Thread(target=_auto_refresh_loop, name="auto-refresh", daemon=True)
    thread.start()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the HiAstro dashboard with live date selection and NL queries.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("DASHBOARD_PORT", "8080")))
    args = parser.parse_args()

    if AUTO_REFRESH:
        start_auto_refresh()

    server = ThreadingHTTPServer((args.host, args.port), DashboardRequestHandler)
    print(f"Serving HiAstro dashboard at http://{args.host}:{args.port}")
    print("Live daily data endpoint:  GET  /api/dashboard?date=YYYY-MM-DD")
    print("Natural-language query:    POST /api/query  {\"question\": \"...\"}")
    print(f"Custom query enabled: {QUERY_ENABLED} | auth required: {bool(API_TOKEN)} | auto-refresh: {AUTO_REFRESH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
