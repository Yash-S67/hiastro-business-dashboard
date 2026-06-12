from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from build_dashboard_data import DASHBOARD_ROOT, build_daily_api_payload


class DashboardRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DASHBOARD_ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/dashboard":
            self.handle_dashboard_api(parsed.query)
            return
        super().do_GET()

    def write_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status.value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_dashboard_api(self, query: str) -> None:
        params = parse_qs(query)
        raw_date = (params.get("date") or [""])[0]
        try:
            day_value = date.fromisoformat(raw_date)
        except ValueError:
            self.write_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "Pass date as YYYY-MM-DD."},
            )
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the HiAstro dashboard with live date selection.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("DASHBOARD_PORT", "8080")))
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), DashboardRequestHandler)
    print(f"Serving HiAstro dashboard at http://{args.host}:{args.port}")
    print("Live daily data endpoint: /api/dashboard?date=YYYY-MM-DD")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
