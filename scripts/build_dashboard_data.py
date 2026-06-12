from __future__ import annotations

import json
import math
import os
import re
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from time import sleep
from typing import Any

import pandas as pd
import requests
from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.engine import URL


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DASHBOARD_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = DASHBOARD_ROOT / "data"
OUTPUT_PATH = DATA_DIR / "dashboard_data.json"

IST = timezone(timedelta(hours=5, minutes=30))
UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
HEX32_RE = re.compile(r"^[0-9a-fA-F]{32}$")
ENTITY_ID_RE = re.compile(r"^[0-9a-fA-F]{24}$")
REVENUE_FAMILIES = [
    ("subscription", "Subscription"),
    ("pay_as_you_go", "Pay as you go"),
    ("day_pass", "Day pass"),
]
MIXPANEL_EVENTS = [
    "$ae_session",
    "Login Success",
    "Follow up Query",
    "App Opened from Notification",
    "subscription_paywall_shown",
    "subscription_trial_initiated",
]


def dashboard_source_notes() -> list[str]:
    return [
        "Subscription revenue comes from MySQL subscription_lifecycle_events where revenue_recorded = 1 and charge_amount > 0, joined to subscription_plans.",
        "Plan-level Main / Trial is a same-period movement ratio, not a user-level cohort conversion; use Follow-up to Main for pack funnel comparison.",
        "Daily date selection uses preloaded aggregate periods on GitHub Pages; the local dashboard server can fetch selected dates on demand through /api/dashboard without saving raw rows.",
        "Pay as you go means successful ADD_MONEY wallet payment orders.",
        "Customized day pass revenue comes from MySQL customer_day_pass joined to day_pass_config.",
        "Acquisition new users come from MySQL users.created_at; login success comes from Mixpanel.",
        "Config funnel paywall shown and trial CTA clicks come from Mixpanel; config, gender, and DOB-derived age buckets come from MySQL users/profiles; subscription purchases come from lifecycle revenue events.",
        "Subscription renewal readiness comes from customer_subscriptions current period dates and cancel-at-period-end state; true autopay success needs recurring charge result events.",
        "Follow-up entity values are resolved to bot names using chat_session bot_id and normalized bot-name slugs.",
        "Retention uses completed MySQL chat_session activity for new-user cohorts.",
        "Engagement duration and BIM notification opens come from Mixpanel app events.",
        "Metric coverage flags show where a dashboard metric is partial or missing because a denominator/source is unavailable.",
    ]


def clean_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if pd.isna(value) if not isinstance(value, (list, tuple, dict, set)) else False:
        return None
    return value


def records(df: pd.DataFrame) -> list[dict[str, Any]]:
    return [
        {key: clean_value(value) for key, value in row.items()}
        for row in df.to_dict(orient="records")
    ]


def pct_change(current: float, previous: float) -> float | None:
    if previous == 0:
        return None if current == 0 else 100.0
    return round((current - previous) / previous * 100, 2)


def safe_div(num: float, den: float) -> float:
    return round(num / den * 100, 2) if den else 0.0


def safe_ratio(num: float, den: float) -> float:
    return round(num / den, 2) if den else 0.0


def local_midnight(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=IST)


def utc_naive(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def day_range(start: date, end_inclusive: date) -> list[str]:
    days = []
    d = start
    while d <= end_inclusive:
        days.append(d.isoformat())
        d += timedelta(days=1)
    return days


def slugify(value: Any) -> str:
    text_value = str(value or "").lower()
    return re.sub(r"[^a-z0-9]+", "", text_value)


def slug_variants(name: str) -> set[str]:
    raw = slugify(name)
    words = [w for w in re.split(r"[^a-zA-Z0-9]+", str(name or "").lower()) if w]
    prefixes = {"pandit", "guru", "astrologer", "jyotish", "acharya"}
    stripped = [w for w in words if w not in prefixes]
    variants = {raw}
    if stripped:
        variants.add("".join(stripped))
        variants.add(stripped[0])
        if len(stripped) >= 2:
            variants.add(stripped[0] + stripped[-1])
    return {v for v in variants if v}


def revenue_family_label(family: Any) -> str:
    labels = dict(REVENUE_FAMILIES)
    key = str(family or "unknown")
    return labels.get(key, key.replace("_", " ").title())


def age_bucket(dob: Any, as_of: date) -> str:
    if dob is None or pd.isna(dob):
        return "Unknown"
    if isinstance(dob, str):
        try:
            dob = pd.to_datetime(dob).date()
        except Exception:
            return "Unknown"
    if isinstance(dob, datetime):
        dob = dob.date()
    age = as_of.year - dob.year - ((as_of.month, as_of.day) < (dob.month, dob.day))
    if age < 18:
        return "<18"
    if age <= 24:
        return "18-24"
    if age <= 34:
        return "25-34"
    if age <= 44:
        return "35-44"
    if age <= 54:
        return "45-54"
    return "55+"


def extract_uuid(value: Any) -> str | None:
    if value is None:
        return None
    text_value = str(value).strip()
    match = UUID_RE.search(text_value)
    return match.group(0).lower() if match else None


def normalize_user_id(value: Any) -> str | None:
    user_id = extract_uuid(value)
    if user_id:
        return user_id
    text_value = str(value or "").strip()
    if HEX32_RE.match(text_value):
        lowered = text_value.lower()
        return f"{lowered[:8]}-{lowered[8:12]}-{lowered[12:16]}-{lowered[16:20]}-{lowered[20:]}"
    return None


def event_user_id(props: dict[str, Any]) -> str | None:
    for key in (
        "$user_id",
        "user_id",
        "userId",
        "distinct_id",
        "uuid",
        "UUID",
        "id",
    ):
        user_id = normalize_user_id(props.get(key))
        if user_id:
            return user_id
    return None


def load_env() -> dict[str, str]:
    values = {k: v for k, v in dotenv_values(PROJECT_ROOT / ".env").items() if v is not None}
    values.update({k: v for k, v in os.environ.items() if v is not None})
    required = [
        "MYSQL_HOST",
        "MYSQL_PORT",
        "MYSQL_USER",
        "MYSQL_PASSWORD",
        "MIXPANEL_PROJECT_ID",
        "MIXPANEL_SERVICE_ACCOUNT_USERNAME",
        "MIXPANEL_SERVICE_ACCOUNT_SECRET",
    ]
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise RuntimeError(f"Missing required env values: {', '.join(missing)}")
    return values


def mysql_engine(env: dict[str, str]):
    url = URL.create(
        "mysql+pymysql",
        username=env["MYSQL_USER"],
        password=env["MYSQL_PASSWORD"],
        host=env["MYSQL_HOST"],
        port=int(env.get("MYSQL_PORT", "3306")),
        database=env.get("MYSQL_DATABASE") or "prod",
    )
    return create_engine(url, connect_args={"connect_timeout": 20}, pool_pre_ping=True)


def read_sql(engine, sql: str, params: dict[str, Any] | None = None) -> pd.DataFrame:
    for attempt in range(3):
        try:
            with engine.connect() as conn:
                return pd.read_sql(text(sql), conn, params=params or {})
        except (OperationalError, DBAPIError):
            if attempt == 2:
                raise
            engine.dispose()
            sleep(2 * (attempt + 1))
    raise RuntimeError("SQL query failed after retries")


def build_bot_lookup(engine, start: date, end: date) -> dict[str, dict[str, str]]:
    bots = read_sql(
        engine,
        """
        SELECT
            LOWER(HEX(bot_id)) AS bot_id_hex,
            bot_name,
            COUNT(*) AS sessions
        FROM prod.chat_session
        WHERE started_at >= :start_utc
          AND started_at < :end_utc
          AND bot_id IS NOT NULL
          AND bot_name IS NOT NULL
        GROUP BY bot_id_hex, bot_name
        ORDER BY sessions DESC
        """,
        {
            "start_utc": utc_naive(local_midnight(start)),
            "end_utc": utc_naive(local_midnight(end + timedelta(days=1))),
        },
    )
    lookup: dict[str, dict[str, str]] = {}
    seen_bot_ids: set[str] = set()
    for row in bots.to_dict(orient="records"):
        bot_id = str(row.get("bot_id_hex") or "").lower()
        bot_name = str(row.get("bot_name") or "").strip()
        if not bot_id or not bot_name:
            continue
        if bot_id not in seen_bot_ids:
            lookup[bot_id] = {"bot_id": bot_id, "bot_name": bot_name, "match_type": "bot_id"}
            seen_bot_ids.add(bot_id)
        for variant in slug_variants(bot_name):
            lookup.setdefault(variant, {"bot_id": bot_id, "bot_name": bot_name, "match_type": "slug"})
    return lookup


def resolve_entity(entity: Any, bot_lookup: dict[str, dict[str, str]]) -> dict[str, str]:
    entity_slug = str(entity or "Unknown").strip()
    key = entity_slug.lower()
    lookup = bot_lookup.get(key) or bot_lookup.get(slugify(entity_slug))
    if lookup:
        return {
            "entity_slug": entity_slug,
            "bot_id": lookup.get("bot_id") or (key if ENTITY_ID_RE.match(key) else ""),
            "bot_name": lookup.get("bot_name") or entity_slug,
            "entity_label": lookup.get("bot_name") or entity_slug,
            "entity_match_type": lookup.get("match_type") or "unknown",
        }
    return {
        "entity_slug": entity_slug,
        "bot_id": key if ENTITY_ID_RE.match(key) else "",
        "bot_name": "Unmapped",
        "entity_label": entity_slug,
        "entity_match_type": "unmapped",
    }


def fetch_mixpanel_events(env: dict[str, str], events: list[str], start: date, end: date) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    auth = (
        env["MIXPANEL_SERVICE_ACCOUNT_USERNAME"],
        env["MIXPANEL_SERVICE_ACCOUNT_SECRET"],
    )
    d = start
    max_attempts = 4
    while d <= end:
        for attempt in range(1, max_attempts + 1):
            day_events: list[dict[str, Any]] = []
            try:
                with requests.get(
                    "https://data-eu.mixpanel.com/api/2.0/export",
                    params={
                        "project_id": env["MIXPANEL_PROJECT_ID"],
                        "from_date": d.isoformat(),
                        "to_date": d.isoformat(),
                        "event": json.dumps(events),
                    },
                    auth=auth,
                    stream=True,
                    timeout=240,
                ) as response:
                    response.raise_for_status()
                    for line in response.iter_lines(decode_unicode=True):
                        if not line:
                            continue
                        event = json.loads(line)
                        props = event.get("properties", {})
                        ts = pd.to_datetime(props.get("time"), unit="s", utc=True, errors="coerce")
                        if pd.isna(ts):
                            continue
                        local_ts = ts.tz_convert("Asia/Kolkata")
                        local_day = local_ts.date()
                        if local_day < start or local_day > end:
                            continue
                        slim_props = {
                            key: props.get(key)
                            for key in (
                                "time",
                                "distinct_id",
                                "$user_id",
                                "user_id",
                                "userId",
                                "uuid",
                                "id",
                                "$ae_session_length",
                                "$os",
                                "platform",
                                "entity",
                                "category",
                                "gender",
                                "dob",
                                "$region",
                                "$city",
                                "campaign_name",
                                "has_trial",
                                "charge_amount",
                                "plan_amount",
                                "plan_id",
                                "action",
                                "selected_amount",
                                "amount_requested",
                                "start_trial",
                            )
                        }
                        slim_props["_event_time_ist"] = local_ts.isoformat()
                        slim_props["_event_date"] = local_day.isoformat()
                        day_events.append({"event": event.get("event"), "properties": slim_props})
                out.extend(day_events)
                break
            except requests.RequestException as exc:
                if attempt == max_attempts:
                    raise RuntimeError(f"Mixpanel export failed for {d.isoformat()} after {max_attempts} attempts") from exc
                sleep(2 * attempt)
        d += timedelta(days=1)
    return out


def aggregate_mixpanel(
    events: list[dict[str, Any]],
    latest_day: date,
    bot_lookup: dict[str, dict[str, str]] | None = None,
) -> dict[str, Any]:
    bot_lookup = bot_lookup or {}
    session_daily: dict[str, dict[str, Any]] = defaultdict(lambda: {"sessions": 0, "users": set(), "seconds": 0.0})
    session_platform: dict[str, dict[str, Any]] = defaultdict(lambda: {"sessions": 0, "users": set(), "seconds": 0.0})
    session_user_daily: dict[tuple[str, str], dict[str, Any]] = defaultdict(lambda: {"sessions": 0, "seconds": 0.0})
    session_users_total: set[str] = set()
    login_daily: dict[str, set[str]] = defaultdict(set)
    followup_daily: dict[str, set[str]] = defaultdict(set)
    followup_users: dict[str, dict[str, Any]] = {}
    followup_entity_counts: dict[str, Counter] = defaultdict(Counter)
    followup_entity_events = Counter()
    followup_segment_counts: dict[str, Counter] = {
        "platform": Counter(),
        "gender": Counter(),
        "age_bucket": Counter(),
        "region": Counter(),
    }
    subscription_paywall_user_daily: dict[tuple[str, str], dict[str, Any]] = defaultdict(lambda: {"paywall_shown": 0})
    subscription_trial_cta_user_daily: dict[tuple[Any, ...], dict[str, Any]] = defaultdict(
        lambda: {"trial_cta_clicks": 0}
    )
    bim_daily: dict[str, dict[str, Any]] = defaultdict(lambda: {"opens": 0, "users": set()})
    bim_platform: dict[str, dict[str, Any]] = defaultdict(lambda: {"opens": 0, "users": set()})
    bim_user_daily: dict[tuple[str, str], dict[str, Any]] = defaultdict(lambda: {"opens": 0})
    notification_campaigns: dict[str, dict[str, Any]] = defaultdict(lambda: {"opens": 0, "users": set()})

    for event in events:
        name = event["event"]
        props = event["properties"]
        event_date = props.get("_event_date")
        user_id = event_user_id(props)
        platform = str(props.get("platform") or props.get("$os") or "Unknown").lower()

        if name == "$ae_session":
            duration = props.get("$ae_session_length") or 0
            try:
                duration = float(duration)
            except Exception:
                duration = 0.0
            session_daily[event_date]["sessions"] += 1
            session_daily[event_date]["seconds"] += duration
            session_platform[platform]["sessions"] += 1
            session_platform[platform]["seconds"] += duration
            if user_id:
                session_daily[event_date]["users"].add(user_id)
                session_platform[platform]["users"].add(user_id)
                session_user_daily[(event_date, user_id)]["sessions"] += 1
                session_user_daily[(event_date, user_id)]["seconds"] += duration
                session_users_total.add(user_id)

        elif name == "Login Success" and user_id:
            login_daily[event_date].add(user_id)

        elif name == "Follow up Query" and user_id:
            followup_daily[event_date].add(user_id)
            entity = str(props.get("entity") or props.get("category") or "Unknown")
            followup_entity_counts[user_id][entity] += 1
            followup_entity_events[entity] += 1
            if user_id not in followup_users:
                followup_users[user_id] = {
                    "user_id": user_id,
                    "first_followup_date": event_date,
                    "platform": platform,
                    "gender": str(props.get("gender") or "Unknown").lower(),
                    "dob": props.get("dob"),
                    "age_bucket": age_bucket(props.get("dob"), latest_day),
                    "region": props.get("$region") or "Unknown",
                    "city": props.get("$city") or "Unknown",
                }
            for field in followup_segment_counts:
                value = followup_users[user_id].get(field) or "Unknown"
                followup_segment_counts[field][value] += 1

        elif name == "subscription_paywall_shown" and user_id:
            subscription_paywall_user_daily[(event_date, user_id)]["paywall_shown"] += 1

        elif name == "subscription_trial_initiated" and user_id:
            trial_amount = pd.to_numeric(props.get("charge_amount"), errors="coerce")
            main_pack_amount = pd.to_numeric(props.get("plan_amount"), errors="coerce")
            trial_amount = None if pd.isna(trial_amount) else float(round(float(trial_amount), 0))
            main_pack_amount = None if pd.isna(main_pack_amount) else float(round(float(main_pack_amount), 0))
            subscription_trial_cta_user_daily[(event_date, user_id, trial_amount, main_pack_amount)][
                "trial_cta_clicks"
            ] += 1

        elif name == "App Opened from Notification":
            campaign = str(props.get("campaign_name") or "Unknown")
            notification_campaigns[campaign]["opens"] += 1
            if user_id:
                notification_campaigns[campaign]["users"].add(user_id)
            is_bim = campaign.lower() in {"bot initiated messages", "bim"}
            if is_bim:
                bim_daily[event_date]["opens"] += 1
                bim_platform[platform]["opens"] += 1
                if user_id:
                    bim_daily[event_date]["users"].add(user_id)
                    bim_platform[platform]["users"].add(user_id)
                    bim_user_daily[(event_date, user_id)]["opens"] += 1

    def session_rows(source: dict[str, dict[str, Any]], key_name: str) -> list[dict[str, Any]]:
        rows = []
        for key, value in sorted(source.items()):
            users = len(value["users"])
            sessions = value["sessions"]
            seconds = value["seconds"]
            rows.append(
                {
                    key_name: key,
                    "sessions": sessions,
                    "users": users,
                    "total_minutes": round(seconds / 60, 1),
                    "avg_minutes_per_user": round(seconds / 60 / users, 2) if users else 0,
                    "avg_minutes_per_session": round(seconds / 60 / sessions, 2) if sessions else 0,
                    "sessions_per_user": round(sessions / users, 2) if users else 0,
                }
            )
        return rows

    def user_rows(source: dict[str, set[str]], key_name: str, metric_name: str) -> list[dict[str, Any]]:
        return [{key_name: key, metric_name: len(users)} for key, users in sorted(source.items())]

    def open_rows(source: dict[str, dict[str, Any]], key_name: str) -> list[dict[str, Any]]:
        return [
            {
                key_name: key,
                "opens": value["opens"],
                "users": len(value["users"]),
                "opens_per_user": safe_ratio(value["opens"], len(value["users"])),
            }
            for key, value in sorted(source.items())
        ]

    followup_demographics = {}
    for field in ["platform", "gender", "age_bucket", "region", "city"]:
        counter = Counter((profile.get(field) or "Unknown") for profile in followup_users.values())
        total = sum(counter.values())
        followup_demographics[field] = [
            {
                "bucket": bucket,
                "users": count,
                "pct": round(count / total * 100, 2) if total else 0,
            }
            for bucket, count in counter.most_common(20)
        ]

    return {
        "session_daily": session_rows(session_daily, "date"),
        "session_by_platform": session_rows(session_platform, "platform"),
        "session_user_daily": [
            {
                "date": event_date,
                "user_id": user_id,
                "sessions": value["sessions"],
                "seconds": value["seconds"],
            }
            for (event_date, user_id), value in sorted(session_user_daily.items())
        ],
        "session_users_total": len(session_users_total),
        "login_daily": user_rows(login_daily, "date", "login_success_users"),
        "followup_daily": user_rows(followup_daily, "date", "followup_users"),
        "followup_daily_user_ids": {event_date: sorted(users) for event_date, users in sorted(followup_daily.items())},
        "followup_users": followup_users,
        "primary_entity_by_user": {
            user_id: counts.most_common(1)[0][0]
            for user_id, counts in followup_entity_counts.items()
            if counts
        },
        "followup_entity_events": [
            {**resolve_entity(entity, bot_lookup), "followup_events": count}
            for entity, count in followup_entity_events.most_common(25)
        ],
        "followup_segments": {
            field: [
                {"bucket": bucket, "events": count}
                for bucket, count in counter.most_common(15)
            ]
            for field, counter in followup_segment_counts.items()
        },
        "followup_demographics": followup_demographics,
        "subscription_paywall_user_daily": [
            {
                "date": event_date,
                "user_id": user_id,
                "paywall_shown": value["paywall_shown"],
            }
            for (event_date, user_id), value in sorted(subscription_paywall_user_daily.items())
        ],
        "subscription_trial_cta_user_daily": [
            {
                "date": event_date,
                "user_id": user_id,
                "trial_amount": trial_amount,
                "main_pack_amount": main_pack_amount,
                "trial_cta_clicks": value["trial_cta_clicks"],
            }
            for (event_date, user_id, trial_amount, main_pack_amount), value in sorted(
                subscription_trial_cta_user_daily.items()
            )
        ],
        "bim_daily": open_rows(bim_daily, "date"),
        "bim_by_platform": open_rows(bim_platform, "platform"),
        "bim_user_daily": [
            {
                "date": event_date,
                "user_id": user_id,
                "opens": value["opens"],
            }
            for (event_date, user_id), value in sorted(bim_user_daily.items())
        ],
        "notification_campaigns": [
            {
                "campaign": campaign,
                "opens": value["opens"],
                "users": len(value["users"]),
                "opens_per_user": safe_ratio(value["opens"], len(value["users"])),
            }
            for campaign, value in sorted(notification_campaigns.items(), key=lambda item: item[1]["opens"], reverse=True)[:15]
        ],
    }


def build_monetization(
    engine,
    ranges: dict[str, Any],
    profiles: pd.DataFrame,
    primary_entity_by_user: dict[str, str],
    bot_lookup: dict[str, dict[str, str]] | None = None,
) -> dict[str, Any]:
    bot_lookup = bot_lookup or {}
    params = {
        "start_utc": utc_naive(local_midnight(ranges["prior_30_start"])),
        "end_utc": utc_naive(local_midnight(ranges["current_end"] + timedelta(days=1))),
    }
    revenue_sql = """
    SELECT
        DATE(DATE_ADD(event_time, INTERVAL 330 MINUTE)) AS day,
        user_id,
        family,
        pack,
        plan_code,
        amount,
        COUNT(*) AS transactions,
        SUM(amount) AS revenue
    FROM (
        SELECT
            COALESCE(sle.event_created_at, sle.created_at, sle.charge_at, sle.current_start) AS event_time,
            LOWER(BIN_TO_UUID(sle.user_id)) AS user_id,
            'subscription' AS family,
            CONCAT(
                CASE
                    WHEN sle.revenue_type = 'subscription_authenticated'
                         OR sle.event_type = 'subscription.authenticated'
                    THEN 'Trial'
                    WHEN sle.revenue_type = 'subscription_charged'
                         OR sle.event_type = 'subscription.charged'
                    THEN 'Main'
                    ELSE 'Subscription'
                END,
                ' Rs ',
                CAST(ROUND(sle.charge_amount, 0) AS CHAR)
            ) AS pack,
            COALESCE(sp.code, 'unknown_plan') AS plan_code,
            sle.charge_amount AS amount
        FROM prod.subscription_lifecycle_events sle
        LEFT JOIN prod.subscription_plans sp ON sle.plan_id = sp.id
        WHERE COALESCE(sle.event_created_at, sle.created_at, sle.charge_at, sle.current_start) >= :start_utc
          AND COALESCE(sle.event_created_at, sle.created_at, sle.charge_at, sle.current_start) < :end_utc
          AND sle.revenue_recorded = 1
          AND sle.charge_amount IS NOT NULL
          AND sle.charge_amount > 0

        UNION ALL

        SELECT
            po.created_at AS event_time,
            LOWER(BIN_TO_UUID(po.user_id)) AS user_id,
            'pay_as_you_go' AS family,
            CONCAT('Wallet Rs ', CAST(ROUND(po.amount, 0) AS CHAR)) AS pack,
            'wallet_recharge' AS plan_code,
            po.amount AS amount
        FROM prod.payment_orders po
        WHERE po.created_at >= :start_utc
          AND po.created_at < :end_utc
          AND po.status = 'PAID'
          AND JSON_UNQUOTE(JSON_EXTRACT(po.notes, '$.type')) = 'ADD_MONEY'

        UNION ALL

        SELECT
            COALESCE(cdp.starts_at, cdp.updated_at, cdp.created_at) AS event_time,
            LOWER(BIN_TO_UUID(cdp.user_id)) AS user_id,
            'day_pass' AS family,
            CONCAT('Day Pass Rs ', CAST(ROUND(dpc.amount, 0) AS CHAR)) AS pack,
            CONCAT('day_pass_config_', CAST(cdp.day_pass_config_id AS CHAR)) AS plan_code,
            dpc.amount AS amount
        FROM prod.customer_day_pass cdp
        LEFT JOIN prod.day_pass_config dpc ON cdp.day_pass_config_id = dpc.id
        WHERE COALESCE(cdp.starts_at, cdp.updated_at, cdp.created_at) >= :start_utc
          AND COALESCE(cdp.starts_at, cdp.updated_at, cdp.created_at) < :end_utc
          AND cdp.status IN ('ACTIVE', 'EXPIRED')
          AND dpc.amount IS NOT NULL
          AND dpc.amount > 0
    ) revenue_events
    GROUP BY day, user_id, family, pack, plan_code, amount
    """
    revenue = read_sql(engine, revenue_sql, params)
    if revenue.empty:
        revenue = pd.DataFrame(columns=["day", "user_id", "family", "pack", "plan_code", "amount", "transactions", "revenue"])
    revenue["day"] = pd.to_datetime(revenue["day"]).dt.date
    revenue["revenue"] = pd.to_numeric(revenue["revenue"], errors="coerce").fillna(0.0)
    revenue["transactions"] = pd.to_numeric(revenue["transactions"], errors="coerce").fillna(0).astype(int)

    def window_df(start: date, end: date) -> pd.DataFrame:
        return revenue[(revenue["day"] >= start) & (revenue["day"] <= end)].copy()

    current = window_df(ranges["current_start"], ranges["current_end"])
    prior7 = window_df(ranges["prior_7_start"], ranges["prior_7_end"])
    prior30 = window_df(ranges["prior_30_start"], ranges["prior_30_end"])
    current_enriched = enrich_users(current, profiles, ranges)

    def kpis(df: pd.DataFrame) -> dict[str, float]:
        txns = int(df["transactions"].sum()) if not df.empty else 0
        payers = int(df["user_id"].nunique()) if not df.empty else 0
        revenue_sum = float(df["revenue"].sum()) if not df.empty else 0.0
        return {
            "revenue": round(revenue_sum, 2),
            "payers": payers,
            "transactions": txns,
            "avg_transaction": round(revenue_sum / txns, 2) if txns else 0,
            "avg_revenue_per_payer": round(revenue_sum / payers, 2) if payers else 0,
        }

    current_kpis = kpis(current)
    prior7_kpis = kpis(prior7)
    prior30_kpis = kpis(prior30)
    prior_30_period_baseline = {
        key: (value / 30 * ranges["period_days"] if key in {"revenue", "transactions", "payers"} else value)
        for key, value in prior30_kpis.items()
    }

    def family_summary_rows() -> pd.DataFrame:
        known_families = [family_id for family_id, _label in REVENUE_FAMILIES]
        extra_families = sorted(
            (
                set(current["family"].dropna().astype(str))
                | set(prior7["family"].dropna().astype(str))
                | set(prior30["family"].dropna().astype(str))
            )
            - set(known_families)
        )
        rows = []
        total_revenue = current_kpis["revenue"]
        total_payers = current_kpis["payers"]
        total_transactions = current_kpis["transactions"]
        for family_id in known_families + extra_families:
            current_metrics = kpis(current[current["family"].eq(family_id)])
            prior7_metrics = kpis(prior7[prior7["family"].eq(family_id)])
            prior30_metrics = kpis(prior30[prior30["family"].eq(family_id)])
            prior30_baseline = {
                key: (value / 30 * ranges["period_days"] if key in {"revenue", "transactions", "payers"} else value)
                for key, value in prior30_metrics.items()
            }
            rows.append(
                {
                    "family": family_id,
                    "family_label": revenue_family_label(family_id),
                    "selection": f"family = {revenue_family_label(family_id)}",
                    **current_metrics,
                    "revenue_share_pct": safe_div(current_metrics["revenue"], total_revenue),
                    "payer_share_pct": safe_div(current_metrics["payers"], total_payers),
                    "transaction_share_pct": safe_div(current_metrics["transactions"], total_transactions),
                    "revenue_growth_vs_prior_7_pct": pct_change(current_metrics["revenue"], prior7_metrics["revenue"]),
                    "payer_growth_vs_prior_7_pct": pct_change(current_metrics["payers"], prior7_metrics["payers"]),
                    "transaction_growth_vs_prior_7_pct": pct_change(current_metrics["transactions"], prior7_metrics["transactions"]),
                    "avg_transaction_growth_vs_prior_7_pct": pct_change(current_metrics["avg_transaction"], prior7_metrics["avg_transaction"]),
                    "revenue_growth_vs_30day_baseline_pct": pct_change(current_metrics["revenue"], prior30_baseline["revenue"]),
                    "payer_growth_vs_30day_baseline_pct": pct_change(current_metrics["payers"], prior30_baseline["payers"]),
                    "transaction_growth_vs_30day_baseline_pct": pct_change(current_metrics["transactions"], prior30_baseline["transactions"]),
                    "avg_transaction_growth_vs_30day_baseline_pct": pct_change(current_metrics["avg_transaction"], prior30_baseline["avg_transaction"]),
                }
            )
        return pd.DataFrame(rows)

    family_summary = family_summary_rows()

    if current.empty:
        daily = pd.DataFrame(columns=["day", "family", "family_label", "revenue", "transactions", "payers", "avg_transaction", "revenue_share_pct"])
        daily_summary = pd.DataFrame(columns=["day", "revenue", "transactions", "payers", "avg_transaction", "avg_revenue_per_payer"])
        daily_user_cohort = pd.DataFrame(columns=["day", "user_cohort", "revenue", "transactions", "payers", "avg_transaction", "revenue_share_pct"])
        daily_family_user_cohort = pd.DataFrame(columns=["day", "family", "family_label", "user_cohort", "revenue", "transactions", "payers", "avg_transaction", "revenue_share_pct"])
    else:
        daily = (
            current.groupby(["day", "family"], as_index=False)
            .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"), payers=("user_id", "nunique"))
            .sort_values(["day", "family"])
        )
        daily["family_label"] = daily["family"].apply(revenue_family_label)
        daily_totals = daily.groupby("day")["revenue"].transform("sum")
        daily["avg_transaction"] = (daily["revenue"] / daily["transactions"]).round(2)
        daily["revenue_share_pct"] = (daily["revenue"] / daily_totals * 100).round(2)

        daily_summary = (
            current.groupby("day", as_index=False)
            .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"), payers=("user_id", "nunique"))
            .sort_values("day")
        )
        daily_summary["avg_transaction"] = (daily_summary["revenue"] / daily_summary["transactions"]).round(2)
        daily_summary["avg_revenue_per_payer"] = (daily_summary["revenue"] / daily_summary["payers"]).round(2)

        daily_user_cohort = (
            current_enriched.groupby(["day", "user_cohort"], as_index=False)
            .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"), payers=("user_id", "nunique"))
            .sort_values(["day", "user_cohort"])
        )
        daily_user_cohort["avg_transaction"] = (daily_user_cohort["revenue"] / daily_user_cohort["transactions"]).round(2)
        daily_cohort_totals = daily_user_cohort.groupby("day")["revenue"].transform("sum")
        daily_user_cohort["revenue_share_pct"] = (daily_user_cohort["revenue"] / daily_cohort_totals * 100).round(2)

        daily_family_user_cohort = (
            current_enriched.groupby(["day", "family", "user_cohort"], as_index=False)
            .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"), payers=("user_id", "nunique"))
            .sort_values(["day", "family", "user_cohort"])
        )
        daily_family_user_cohort["family_label"] = daily_family_user_cohort["family"].apply(revenue_family_label)
        daily_family_user_cohort["avg_transaction"] = (
            daily_family_user_cohort["revenue"] / daily_family_user_cohort["transactions"]
        ).round(2)
        daily_family_totals = daily_family_user_cohort.groupby(["day", "family"])["revenue"].transform("sum")
        daily_family_user_cohort["revenue_share_pct"] = (
            daily_family_user_cohort["revenue"] / daily_family_totals * 100
        ).round(2)

    daily["day"] = daily["day"].astype(str)
    daily_summary["day"] = daily_summary["day"].astype(str)
    daily_user_cohort["day"] = daily_user_cohort["day"].astype(str)
    daily_family_user_cohort["day"] = daily_family_user_cohort["day"].astype(str)

    family = family_summary.sort_values("revenue", ascending=False)

    pack = (
        current.groupby(["family", "pack", "plan_code", "amount"], as_index=False)
        .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"), payers=("user_id", "nunique"))
        .sort_values("revenue", ascending=False)
    )
    if pack.empty:
        pack = pd.DataFrame(columns=["family", "family_label", "selection", "pack", "plan_code", "amount", "revenue", "transactions", "payers", "avg_transaction", "revenue_share_pct", "revenue_growth_vs_prior_7_pct"])
    else:
        prior_pack = (
            prior7.groupby(["family", "pack", "plan_code", "amount"], as_index=False)
            .agg(prior_revenue=("revenue", "sum"))
        )
        pack = pack.merge(prior_pack, on=["family", "pack", "plan_code", "amount"], how="left")
        pack["prior_revenue"] = pack["prior_revenue"].fillna(0)
        pack["family_label"] = pack["family"].apply(revenue_family_label)
        pack["selection"] = (
            "family = "
            + pack["family_label"]
            + "; pack = "
            + pack["pack"].astype(str)
            + "; plan = "
            + pack["plan_code"].astype(str)
        )
        pack["avg_transaction"] = (pack["revenue"] / pack["transactions"]).round(2)
        pack["revenue_share_pct"] = (pack["revenue"] / pack["revenue"].sum() * 100).round(2)
        pack["revenue_growth_vs_prior_7_pct"] = pack.apply(
            lambda row: pct_change(float(row["revenue"]), float(row["prior_revenue"])),
            axis=1,
        )

    pack_merged = pack.copy()
    payg_family_row = family_summary[family_summary["family"].eq("pay_as_you_go")]
    if not payg_family_row.empty:
        payg_current_metrics = kpis(current[current["family"].eq("pay_as_you_go")])
        payg_prior_metrics = kpis(prior7[prior7["family"].eq("pay_as_you_go")])
        payg_merged_row = {
            "family": "pay_as_you_go",
            "pack": "All wallet recharges",
            "plan_code": "wallet_recharge",
            "amount": None,
            "revenue": payg_current_metrics["revenue"],
            "transactions": payg_current_metrics["transactions"],
            "payers": payg_current_metrics["payers"],
            "prior_revenue": payg_prior_metrics["revenue"],
            "family_label": revenue_family_label("pay_as_you_go"),
            "selection": "family = Pay as you go; pack = All wallet recharges",
            "avg_transaction": payg_current_metrics["avg_transaction"],
            "revenue_share_pct": safe_div(payg_current_metrics["revenue"], current_kpis["revenue"]),
            "revenue_growth_vs_prior_7_pct": pct_change(payg_current_metrics["revenue"], payg_prior_metrics["revenue"]),
        }
        pack_merged = pd.concat(
            [pack[pack["family"].ne("pay_as_you_go")], pd.DataFrame([payg_merged_row])],
            ignore_index=True,
        ).sort_values("revenue", ascending=False)

    if current.empty:
        daily_pack = pd.DataFrame(columns=["day", "family", "family_label", "pack", "plan_code", "amount", "revenue", "transactions", "payers", "avg_transaction"])
        daily_pack_merged = pd.DataFrame(columns=["day", "family", "family_label", "pack", "plan_code", "amount", "selection", "revenue", "transactions", "payers", "avg_transaction"])
        amount_breakdown = pd.DataFrame(columns=["family", "family_label", "amount", "revenue", "transactions", "payers", "revenue_share_pct", "avg_transaction"])
    else:
        daily_pack = (
            current.groupby(["day", "family", "pack", "plan_code", "amount"], as_index=False)
            .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"), payers=("user_id", "nunique"))
            .sort_values(["day", "revenue"], ascending=[True, False])
        )
        daily_pack["family_label"] = daily_pack["family"].apply(revenue_family_label)
        daily_pack["selection"] = (
            "family = "
            + daily_pack["family_label"]
            + "; pack = "
            + daily_pack["pack"].astype(str)
            + "; plan = "
            + daily_pack["plan_code"].astype(str)
        )
        daily_pack["avg_transaction"] = (daily_pack["revenue"] / daily_pack["transactions"]).round(2)
        daily_pack["day"] = daily_pack["day"].astype(str)

        amount_breakdown = (
            current.groupby(["family", "amount"], as_index=False)
            .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"), payers=("user_id", "nunique"))
            .sort_values(["family", "revenue"], ascending=[True, False])
        )
        amount_breakdown["family_label"] = amount_breakdown["family"].apply(revenue_family_label)
        amount_breakdown = add_share(amount_breakdown, "revenue", "revenue_share_pct")
        amount_breakdown["avg_transaction"] = (amount_breakdown["revenue"] / amount_breakdown["transactions"]).round(2)

        payg_daily_pack = daily[daily["family"].eq("pay_as_you_go")].copy()
        payg_daily_pack["pack"] = "All wallet recharges"
        payg_daily_pack["plan_code"] = "wallet_recharge"
        payg_daily_pack["amount"] = None
        payg_daily_pack["selection"] = "family = Pay as you go; pack = All wallet recharges"
        daily_pack_merged = pd.concat(
            [
                daily_pack[daily_pack["family"].ne("pay_as_you_go")],
                payg_daily_pack[
                    [
                        "day",
                        "family",
                        "family_label",
                        "pack",
                        "plan_code",
                        "amount",
                        "selection",
                        "revenue",
                        "transactions",
                        "payers",
                        "avg_transaction",
                    ]
                ],
            ],
            ignore_index=True,
        ).sort_values(["day", "revenue"], ascending=[True, False])

    subscription_current = current[current["family"].eq("subscription")].copy()
    subscription_prior = prior7[prior7["family"].eq("subscription")].copy()
    subscription_pack = pack[pack["family"].eq("subscription")].copy()
    payg_amount_breakdown = amount_breakdown[amount_breakdown["family"].eq("pay_as_you_go")].copy()
    payg_merged = family_summary[family_summary["family"].eq("pay_as_you_go")].copy()
    if payg_merged.empty:
        payg_merged = pd.DataFrame(
            columns=[
                "family",
                "family_label",
                "selection",
                "revenue",
                "payers",
                "transactions",
                "avg_transaction",
                "avg_revenue_per_payer",
                "revenue_share_pct",
                "payer_share_pct",
                "transaction_share_pct",
                "revenue_growth_vs_prior_7_pct",
            ]
        )
    else:
        payg_merged["pack"] = "All wallet recharges"
        payg_merged["plan_code"] = "wallet_recharge"

    if subscription_current.empty:
        subscription_plan_performance = pd.DataFrame(
            columns=[
                "selection",
                "plan_code",
                "revenue",
                "revenue_share_pct",
                "revenue_growth_vs_prior_7_pct",
                "payers",
                "transactions",
                "avg_transaction",
                "avg_revenue_per_payer",
                "trial_revenue",
                "trial_amount",
                "trial_buyers",
                "trial_transactions",
                "main_revenue",
                "main_amount",
                "main_buyers",
                "main_transactions",
                "main_to_trial_buyer_pct",
                "followup_users",
                "followup_to_trial_pct",
                "followup_to_main_pct",
            ]
        )
        subscription_stage_performance = pd.DataFrame(
            columns=["stage", "amount", "selection", "revenue", "revenue_share_pct", "payers", "transactions", "avg_transaction"]
        )
    else:
        def subscription_stage(pack_name: Any) -> str:
            text_value = str(pack_name or "")
            if text_value.startswith("Trial"):
                return "Trial"
            if text_value.startswith("Main"):
                return "Main"
            return "Other"

        subscription_current["stage"] = subscription_current["pack"].apply(subscription_stage)
        subscription_prior["stage"] = subscription_prior["pack"].apply(subscription_stage)
        subscription_total_revenue = float(subscription_current["revenue"].sum())
        plan_rows = []
        for plan_code in sorted(subscription_current["plan_code"].dropna().astype(str).unique()):
            plan_df = subscription_current[subscription_current["plan_code"].astype(str).eq(plan_code)]
            prior_plan_df = subscription_prior[subscription_prior["plan_code"].astype(str).eq(plan_code)]
            plan_revenue = float(plan_df["revenue"].sum())
            plan_payers = int(plan_df["user_id"].nunique())
            plan_transactions = int(plan_df["transactions"].sum())
            trial_df = plan_df[plan_df["stage"].eq("Trial")]
            main_df = plan_df[plan_df["stage"].eq("Main")]
            trial_buyers = int(trial_df["user_id"].nunique())
            main_buyers = int(main_df["user_id"].nunique())
            trial_amount = float(trial_df["amount"].dropna().iloc[0]) if not trial_df["amount"].dropna().empty else None
            main_amount = float(main_df["amount"].dropna().iloc[0]) if not main_df["amount"].dropna().empty else None
            plan_rows.append(
                {
                    "selection": f"subscription plan = {plan_code}",
                    "plan_code": plan_code,
                    "revenue": round(plan_revenue, 2),
                    "revenue_share_pct": safe_div(plan_revenue, subscription_total_revenue),
                    "revenue_growth_vs_prior_7_pct": pct_change(plan_revenue, float(prior_plan_df["revenue"].sum())),
                    "payers": plan_payers,
                    "transactions": plan_transactions,
                    "avg_transaction": round(plan_revenue / plan_transactions, 2) if plan_transactions else 0,
                    "avg_revenue_per_payer": round(plan_revenue / plan_payers, 2) if plan_payers else 0,
                    "trial_revenue": round(float(trial_df["revenue"].sum()), 2),
                    "trial_amount": trial_amount,
                    "trial_buyers": trial_buyers,
                    "trial_transactions": int(trial_df["transactions"].sum()),
                    "main_revenue": round(float(main_df["revenue"].sum()), 2),
                    "main_amount": main_amount,
                    "main_buyers": main_buyers,
                    "main_transactions": int(main_df["transactions"].sum()),
                    "main_to_trial_buyer_pct": safe_div(main_buyers, trial_buyers),
                    "followup_users": 0,
                    "followup_to_trial_pct": 0,
                    "followup_to_main_pct": 0,
                }
            )
        subscription_plan_performance = pd.DataFrame(plan_rows).sort_values("revenue", ascending=False)

        subscription_stage_performance = (
            subscription_current.groupby(["stage", "amount"], as_index=False)
            .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"), payers=("user_id", "nunique"))
            .sort_values(["stage", "revenue"], ascending=[True, False])
        )
        subscription_stage_performance["selection"] = (
            "subscription stage = "
            + subscription_stage_performance["stage"].astype(str)
            + "; amount = Rs "
            + subscription_stage_performance["amount"].round(0).astype(int).astype(str)
        )
        subscription_stage_performance["revenue_share_pct"] = (
            subscription_stage_performance["revenue"] / subscription_total_revenue * 100
        ).round(2)
        subscription_stage_performance["avg_transaction"] = (
            subscription_stage_performance["revenue"] / subscription_stage_performance["transactions"]
        ).round(2)

    user_revenue = (
        current.groupby("user_id", as_index=False)
        .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"))
    )
    if user_revenue.empty:
        payer_frequency = pd.DataFrame(columns=["bucket", "selection", "payers", "revenue", "transactions", "avg_revenue_per_payer", "revenue_share_pct"])
        revenue_concentration = []
    else:
        user_revenue["bucket"] = pd.cut(
            user_revenue["transactions"],
            bins=[0, 1, 2, 5, 999999],
            labels=["1 txn", "2 txn", "3-5 txn", "6+ txn"],
            include_lowest=True,
        ).astype(str)
        payer_frequency = (
            user_revenue.groupby("bucket", as_index=False)
            .agg(payers=("user_id", "nunique"), revenue=("revenue", "sum"), transactions=("transactions", "sum"))
        )
        payer_frequency["selection"] = "transaction frequency = " + payer_frequency["bucket"].astype(str)
        payer_frequency["avg_revenue_per_payer"] = (
            payer_frequency["revenue"] / payer_frequency["payers"]
        ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
        payer_frequency = add_share(payer_frequency, "revenue", "revenue_share_pct")
        ranked_payers = user_revenue.sort_values("revenue", ascending=False).reset_index(drop=True)
        total_payer_revenue = float(ranked_payers["revenue"].sum())
        revenue_concentration = []
        for top_n in [10, 50, 100]:
            top_revenue = float(ranked_payers.head(top_n)["revenue"].sum())
            revenue_concentration.append(
                {
                    "group": f"Top {top_n} payers",
                    "payers": min(top_n, int(ranked_payers["user_id"].nunique())),
                    "revenue": round(top_revenue, 2),
                    "revenue_share_pct": safe_div(top_revenue, total_payer_revenue),
                    "avg_revenue_per_payer": round(top_revenue / min(top_n, len(ranked_payers)), 2) if len(ranked_payers) else 0,
                }
            )
    user_family_revenue = (
        current.groupby(["user_id", "family"], as_index=False)
        .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"))
    )
    segment_rows = []
    family_segment_rows = []
    for field in ["user_cohort", "platform", "gender", "age_bucket", "config_id", "occupation", "marital_status"]:
        if current_enriched.empty:
            continue
        seg = (
            current_enriched.groupby(field, dropna=False)
            .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"), payers=("user_id", "nunique"))
            .reset_index()
            .rename(columns={field: "bucket"})
        )
        seg["segment"] = field
        seg["selection"] = seg["segment"].astype(str) + " = " + seg["bucket"].astype(str)
        seg["avg_transaction"] = (seg["revenue"] / seg["transactions"]).round(2)
        seg["avg_revenue_per_payer"] = (seg["revenue"] / seg["payers"]).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
        seg = add_share(seg, "revenue", "revenue_share_pct")
        segment_rows.append(seg)

        family_seg = (
            current_enriched.groupby(["family", field], dropna=False)
            .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"), payers=("user_id", "nunique"))
            .reset_index()
            .rename(columns={field: "bucket"})
        )
        family_seg["family_label"] = family_seg["family"].apply(revenue_family_label)
        family_seg["segment"] = field
        family_seg["selection"] = (
            "family = "
            + family_seg["family_label"].astype(str)
            + "; "
            + family_seg["segment"].astype(str)
            + " = "
            + family_seg["bucket"].astype(str)
        )
        family_seg["avg_transaction"] = (family_seg["revenue"] / family_seg["transactions"]).round(2)
        family_seg["avg_revenue_per_payer"] = (
            family_seg["revenue"] / family_seg["payers"]
        ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
        total_revenue_by_family = family_seg.groupby("family")["revenue"].transform("sum")
        family_seg["family_revenue_share_pct"] = (
            family_seg["revenue"] / total_revenue_by_family * 100
        ).round(2)
        family_seg = add_share(family_seg, "revenue", "total_revenue_share_pct")
        family_segment_rows.append(family_seg)
    payer_segments = pd.concat(segment_rows, ignore_index=True) if segment_rows else pd.DataFrame(
        columns=["segment", "bucket", "selection", "revenue", "transactions", "payers", "avg_transaction", "avg_revenue_per_payer", "revenue_share_pct"]
    )
    payer_segments_by_family = pd.concat(family_segment_rows, ignore_index=True) if family_segment_rows else pd.DataFrame(
        columns=["family", "family_label", "segment", "bucket", "selection", "revenue", "transactions", "payers", "avg_transaction", "avg_revenue_per_payer", "family_revenue_share_pct", "total_revenue_share_pct"]
    )
    entity_rows = []
    family_ids = [family_id for family_id, _label in REVENUE_FAMILIES]
    family_metrics_by_user: dict[str, dict[str, dict[str, float]]] = defaultdict(dict)
    for row in user_family_revenue.to_dict(orient="records"):
        family_metrics_by_user[str(row.get("user_id"))][str(row.get("family"))] = {
            "revenue": float(row.get("revenue") or 0),
            "transactions": int(row.get("transactions") or 0),
        }
    for user_id, entity in primary_entity_by_user.items():
        row = user_revenue[user_revenue["user_id"].eq(user_id)]
        revenue_value = float(row["revenue"].sum()) if not row.empty else 0.0
        txns = int(row["transactions"].sum()) if not row.empty else 0
        family_values: dict[str, Any] = {}
        for family_id in family_ids:
            family_metric = family_metrics_by_user.get(user_id, {}).get(family_id, {})
            family_revenue = float(family_metric.get("revenue") or 0)
            family_transactions = int(family_metric.get("transactions") or 0)
            family_values[f"{family_id}_revenue"] = family_revenue
            family_values[f"{family_id}_transactions"] = family_transactions
            family_values[f"{family_id}_payer"] = 1 if family_revenue > 0 else 0
        entity_rows.append(
            {
                **resolve_entity(entity, bot_lookup),
                "user_id": user_id,
                "revenue": revenue_value,
                "transactions": txns,
                **family_values,
            }
        )
    entity_df = pd.DataFrame(entity_rows)
    if entity_df.empty:
        family_entity_columns = []
        for family_id in family_ids:
            family_entity_columns.extend([f"{family_id}_revenue", f"{family_id}_payers", f"{family_id}_transactions"])
        entity_distribution = pd.DataFrame(
            columns=[
                "entity_label",
                "bot_name",
                "entity_slug",
                "bot_id",
                "entity_match_type",
                "followup_users",
                "payers",
                "transactions",
                "revenue",
                "conversion_pct",
                "revenue_share_pct",
                "avg_revenue_per_payer",
                "revenue_per_followup_user",
                *family_entity_columns,
            ]
        )
    else:
        entity_agg: dict[str, Any] = {
            "followup_users": ("user_id", "nunique"),
            "payers": ("revenue", lambda s: int((s > 0).sum())),
            "transactions": ("transactions", "sum"),
            "revenue": ("revenue", "sum"),
        }
        for family_id in family_ids:
            entity_agg[f"{family_id}_revenue"] = (f"{family_id}_revenue", "sum")
            entity_agg[f"{family_id}_payers"] = (f"{family_id}_payer", "sum")
            entity_agg[f"{family_id}_transactions"] = (f"{family_id}_transactions", "sum")
        entity_distribution = (
            entity_df.groupby(["entity_label", "bot_name", "entity_slug", "bot_id", "entity_match_type"], as_index=False)
            .agg(**entity_agg)
            .sort_values(["revenue", "followup_users"], ascending=False)
            .head(20)
        )
        entity_distribution["conversion_pct"] = (
            entity_distribution["payers"] / entity_distribution["followup_users"] * 100
        ).round(2)
        total_entity_revenue = float(entity_distribution["revenue"].sum())
        entity_distribution["revenue_share_pct"] = (
            entity_distribution["revenue"] / total_entity_revenue * 100 if total_entity_revenue else 0
        ).round(2)
        entity_distribution["avg_revenue_per_payer"] = (
            entity_distribution["revenue"] / entity_distribution["payers"]
        ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
        entity_distribution["revenue_per_followup_user"] = (
            entity_distribution["revenue"] / entity_distribution["followup_users"]
        ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
        for family_id in family_ids:
            entity_distribution[f"{family_id}_entity_revenue_share_pct"] = (
                entity_distribution[f"{family_id}_revenue"] / entity_distribution["revenue"] * 100
            ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)

    renewal = build_subscription_renewal(engine, ranges)

    return {
        "kpis": {
            "current": current_kpis,
            "prior_7": prior7_kpis,
            "prior_30": prior30_kpis,
            "growth_vs_prior_7": {
                key: pct_change(current_kpis.get(key, 0), prior7_kpis.get(key, 0))
                for key in current_kpis
            },
            "growth_vs_prior_30_7day_baseline": {
                key: pct_change(current_kpis.get(key, 0), prior_30_period_baseline.get(key, 0))
                for key in current_kpis
            },
            "growth_vs_prior_30_period_baseline": {
                key: pct_change(current_kpis.get(key, 0), prior_30_period_baseline.get(key, 0))
                for key in current_kpis
            },
            "by_family": records(family_summary.sort_values("revenue", ascending=False)),
        },
        "daily": records(daily),
        "daily_summary": records(daily_summary),
        "daily_user_cohort": records(daily_user_cohort),
        "daily_family_user_cohort": records(daily_family_user_cohort),
        "daily_pack": records(daily_pack.head(80)),
        "daily_pack_merged": records(daily_pack_merged.head(80)),
        "amount_breakdown": records(amount_breakdown.head(40)),
        "payg_merged": records(payg_merged.head(1)),
        "payg_amount_breakdown": records(payg_amount_breakdown.head(30)),
        "family": records(family),
        "pack": records(pack.head(30)),
        "pack_merged": records(pack_merged.head(30)),
        "subscription_pack": records(subscription_pack.head(30)),
        "subscription_plan_performance": records(subscription_plan_performance.head(20)),
        "subscription_stage_performance": records(subscription_stage_performance.head(20)),
        "payer_frequency": records(payer_frequency.sort_values("revenue", ascending=False)),
        "revenue_concentration": revenue_concentration,
        "payer_segments": records(payer_segments.sort_values(["segment", "revenue"], ascending=[True, False]).head(80)),
        "payer_segments_by_family": records(
            payer_segments_by_family.sort_values(["family", "segment", "revenue"], ascending=[True, True, False]).head(160)
        ),
        "entity_distribution": records(entity_distribution),
        "user_revenue_current": records(user_revenue),
        "user_family_revenue_current": records(user_family_revenue),
        "subscription_renewal": renewal,
    }


def build_subscription_renewal(engine, ranges: dict[str, Any]) -> dict[str, Any]:
    due_start = ranges["current_end"] + timedelta(days=1)
    due_end = ranges["current_end"] + timedelta(days=7)
    subs = read_sql(
        engine,
        """
        SELECT
            LOWER(BIN_TO_UUID(cs.user_id)) AS user_id,
            COALESCE(sp.code, 'unknown_plan') AS plan_code,
            sp.billing_amount,
            cs.status,
            cs.subscription_case,
            cs.cancel_at_period_end,
            DATE(DATE_ADD(cs.current_period_starts_at, INTERVAL 330 MINUTE)) AS period_start_date,
            DATE(DATE_ADD(cs.current_period_ends_at, INTERVAL 330 MINUTE)) AS renewal_due_date,
            DATE(DATE_ADD(cs.trial_ends_at, INTERVAL 330 MINUTE)) AS trial_end_date,
            DATE(DATE_ADD(cs.canceled_at, INTERVAL 330 MINUTE)) AS canceled_date
        FROM prod.customer_subscriptions cs
        LEFT JOIN prod.subscription_plans sp ON cs.plan_id = sp.id
        WHERE cs.created_at < :as_of_end_utc
        """,
        {
            "as_of_end_utc": utc_naive(local_midnight(ranges["current_end"] + timedelta(days=1))),
        },
    )
    if subs.empty:
        return {
            "kpis": {
                "active_paid_subscriptions": 0,
                "trial_active_subscriptions": 0,
                "renewal_due_next_7_days": 0,
                "autopay_ready_users": 0,
                "cancel_scheduled_users": 0,
                "renewal_revenue_at_risk": 0,
                "expected_renewal_revenue": 0,
                "cancel_scheduled_revenue": 0,
                "autopay_ready_pct": 0,
                "renewal_success_pct": None,
            },
            "due_daily": [],
            "due_by_plan": [],
            "status_breakdown": [],
            "notes": [
                "Renewal due is based on customer_subscriptions.current_period_ends_at.",
                "Autopay success will require a renewal charge success/failure event once recurring billing starts.",
            ],
        }

    for column in ["renewal_due_date", "period_start_date", "trial_end_date", "canceled_date"]:
        subs[column] = pd.to_datetime(subs[column], errors="coerce").dt.date
    subs["billing_amount"] = pd.to_numeric(subs["billing_amount"], errors="coerce").fillna(0)
    subs["cancel_at_period_end"] = pd.to_numeric(subs["cancel_at_period_end"], errors="coerce").fillna(0).astype(int)
    subs["is_paid_active"] = (
        subs["status"].eq("ACTIVE")
        & subs["subscription_case"].isin(["PLAN", "CANCELED_PLAN"])
        & subs["renewal_due_date"].notna()
    )
    subs["is_trial_active"] = subs["status"].eq("TRIAL_ACTIVE")
    subs["is_cancel_scheduled"] = subs["is_paid_active"] & (
        subs["cancel_at_period_end"].eq(1) | subs["subscription_case"].eq("CANCELED_PLAN")
    )
    subs["is_due_next_7"] = (
        subs["is_paid_active"]
        & (subs["renewal_due_date"] >= due_start)
        & (subs["renewal_due_date"] <= due_end)
    )
    subs["is_autopay_ready"] = subs["is_due_next_7"] & ~subs["is_cancel_scheduled"]
    due = subs[subs["is_due_next_7"]].copy()
    active_paid = subs[subs["is_paid_active"]].copy()
    cancel_scheduled = subs[subs["is_cancel_scheduled"]].copy()

    def user_count(df: pd.DataFrame) -> int:
        return int(df["user_id"].nunique()) if not df.empty else 0

    due_daily = pd.DataFrame(columns=["renewal_due_date", "due_users", "autopay_ready_users", "cancel_scheduled_users", "renewal_revenue_at_risk", "expected_renewal_revenue"])
    due_by_plan = pd.DataFrame(columns=["plan_code", "due_users", "autopay_ready_users", "cancel_scheduled_users", "renewal_revenue_at_risk", "expected_renewal_revenue", "autopay_ready_pct"])
    if not due.empty:
        due_daily = (
            due.groupby("renewal_due_date", as_index=False)
            .agg(
                due_users=("user_id", "nunique"),
                autopay_ready_users=("is_autopay_ready", "sum"),
                cancel_scheduled_users=("is_cancel_scheduled", "sum"),
                renewal_revenue_at_risk=("billing_amount", "sum"),
            )
            .sort_values("renewal_due_date")
        )
        due_daily["expected_renewal_revenue"] = due_daily["renewal_revenue_at_risk"] - (
            due[due["is_cancel_scheduled"]].groupby("renewal_due_date")["billing_amount"].sum()
        ).reindex(due_daily["renewal_due_date"]).fillna(0).to_numpy()
        due_by_plan = (
            due.groupby("plan_code", as_index=False)
            .agg(
                due_users=("user_id", "nunique"),
                autopay_ready_users=("is_autopay_ready", "sum"),
                cancel_scheduled_users=("is_cancel_scheduled", "sum"),
                renewal_revenue_at_risk=("billing_amount", "sum"),
            )
            .sort_values("renewal_revenue_at_risk", ascending=False)
        )
        cancel_revenue_by_plan = due[due["is_cancel_scheduled"]].groupby("plan_code")["billing_amount"].sum()
        due_by_plan["expected_renewal_revenue"] = due_by_plan["renewal_revenue_at_risk"] - (
            cancel_revenue_by_plan.reindex(due_by_plan["plan_code"]).fillna(0).to_numpy()
        )
        due_by_plan["autopay_ready_pct"] = (
            due_by_plan["autopay_ready_users"] / due_by_plan["due_users"] * 100
        ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
        due_daily["renewal_due_date"] = due_daily["renewal_due_date"].astype(str)

    status_breakdown = (
        subs.groupby(["status", "subscription_case"], dropna=False, as_index=False)
        .agg(users=("user_id", "nunique"))
        .sort_values("users", ascending=False)
    )
    renewal_revenue_at_risk = float(due["billing_amount"].sum()) if not due.empty else 0.0
    cancel_scheduled_revenue = float(due.loc[due["is_cancel_scheduled"], "billing_amount"].sum()) if not due.empty else 0.0
    expected_renewal_revenue = renewal_revenue_at_risk - cancel_scheduled_revenue
    due_users = user_count(due)
    autopay_ready_users = user_count(due[due["is_autopay_ready"]]) if not due.empty else 0
    return {
        "kpis": {
            "active_paid_subscriptions": user_count(active_paid),
            "trial_active_subscriptions": user_count(subs[subs["is_trial_active"]]),
            "renewal_due_next_7_days": due_users,
            "autopay_ready_users": autopay_ready_users,
            "cancel_scheduled_users": user_count(cancel_scheduled),
            "renewal_revenue_at_risk": round(renewal_revenue_at_risk, 2),
            "expected_renewal_revenue": round(expected_renewal_revenue, 2),
            "cancel_scheduled_revenue": round(cancel_scheduled_revenue, 2),
            "autopay_ready_pct": safe_div(autopay_ready_users, due_users),
            "renewal_success_pct": None,
        },
        "due_daily": records(due_daily),
        "due_by_plan": records(due_by_plan),
        "status_breakdown": records(status_breakdown),
        "notes": [
            "Renewal due is based on customer_subscriptions.current_period_ends_at.",
            "Autopay-ready excludes subscriptions already marked cancel_at_period_end or CANCELED_PLAN.",
            "Autopay success/failure will need recurring charge events once renewals start.",
        ],
    }


def build_profiles(engine, as_of: date) -> pd.DataFrame:
    sql = """
    WITH ranked_profiles AS (
        SELECT
            LOWER(BIN_TO_UUID(user_id)) AS user_id,
            gender,
            birth_datetime_utc,
            occupation,
            marital_status,
            ROW_NUMBER() OVER (
                PARTITION BY user_id
                ORDER BY is_primary DESC, updated_at DESC, created_at DESC
            ) AS rn
        FROM prod.user_profiles
    ),
    ranked_devices AS (
        SELECT
            LOWER(BIN_TO_UUID(user_id)) AS user_id,
            CASE
                WHEN app_package_name LIKE '%ios%' THEN 'ios'
                WHEN app_package_name LIKE '%android%' THEN 'android'
                ELSE 'unknown'
            END AS platform,
            CONCAT(COALESCE(app_version_major, ''), '.', COALESCE(app_version_minor, ''), '.', COALESCE(app_version_patch, '')) AS app_version,
            ROW_NUMBER() OVER (
                PARTITION BY user_id
                ORDER BY updated_at DESC, created_at DESC
            ) AS rn
        FROM prod.user_devices
    )
    SELECT
        LOWER(BIN_TO_UUID(u.id)) AS user_id,
        DATE(DATE_ADD(u.created_at, INTERVAL 330 MINUTE)) AS signup_date,
        u.monetization_config_id AS config_id,
        COALESCE(rp.gender, 'Unknown') AS gender,
        rp.birth_datetime_utc,
        COALESCE(rp.occupation, 'Unknown') AS occupation,
        COALESCE(rp.marital_status, 'Unknown') AS marital_status,
        COALESCE(rd.platform, 'unknown') AS platform,
        COALESCE(rd.app_version, 'unknown') AS app_version
    FROM prod.users u
    LEFT JOIN ranked_profiles rp ON LOWER(BIN_TO_UUID(u.id)) = rp.user_id AND rp.rn = 1
    LEFT JOIN ranked_devices rd ON LOWER(BIN_TO_UUID(u.id)) = rd.user_id AND rd.rn = 1
    """
    profiles = read_sql(engine, sql)
    profiles["signup_date"] = pd.to_datetime(profiles["signup_date"]).dt.date
    profiles["gender"] = profiles["gender"].fillna("Unknown").astype(str).str.lower()
    profiles["platform"] = profiles["platform"].fillna("unknown").astype(str).str.lower()
    profiles["occupation"] = profiles["occupation"].fillna("Unknown").astype(str)
    profiles["marital_status"] = profiles["marital_status"].fillna("Unknown").astype(str)
    profiles["age_bucket"] = profiles["birth_datetime_utc"].apply(lambda value: age_bucket(value, as_of))
    return profiles


PROFILE_COLUMNS = [
    "user_id",
    "signup_date",
    "gender",
    "age_bucket",
    "platform",
    "config_id",
    "occupation",
    "marital_status",
]


def user_cohort_from_signup(signup_date: Any, ranges: dict[str, Any]) -> str:
    if signup_date is None or pd.isna(signup_date):
        return "Unknown user"
    if isinstance(signup_date, str):
        try:
            signup_date = pd.to_datetime(signup_date).date()
        except Exception:
            return "Unknown user"
    if isinstance(signup_date, datetime):
        signup_date = signup_date.date()
    return "New user" if ranges["current_start"] <= signup_date <= ranges["current_end"] else "Old user"


def enrich_users(df: pd.DataFrame, profiles: pd.DataFrame, ranges: dict[str, Any]) -> pd.DataFrame:
    if df.empty:
        out = df.copy()
        for column in PROFILE_COLUMNS:
            if column not in out.columns:
                out[column] = None
        out["user_cohort"] = "Unknown user"
        return out
    profile_cols = [column for column in PROFILE_COLUMNS if column in profiles.columns]
    out = df.merge(profiles[profile_cols], on="user_id", how="left")
    out["user_cohort"] = out["signup_date"].apply(lambda value: user_cohort_from_signup(value, ranges))
    for column in ["gender", "age_bucket", "platform", "occupation", "marital_status"]:
        out[column] = out[column].fillna("Unknown").astype(str)
    out["config_id"] = out["config_id"].fillna("Unknown").astype(str)
    return out


def add_share(df: pd.DataFrame, value_col: str, out_col: str) -> pd.DataFrame:
    if df.empty:
        df[out_col] = []
        return df
    total = float(df[value_col].sum())
    df[out_col] = (df[value_col] / total * 100).round(2) if total else 0
    return df


def build_acquisition(
    profiles: pd.DataFrame,
    ranges: dict[str, Any],
    mixpanel: dict[str, Any],
    user_revenue_current: pd.DataFrame,
    user_family_revenue_current: pd.DataFrame,
) -> dict[str, Any]:
    current_users = profiles[
        (profiles["signup_date"] >= ranges["current_start"])
        & (profiles["signup_date"] <= ranges["current_end"])
    ].copy()
    followup_ids = set(mixpanel["followup_users"].keys())
    payer_ids = set(user_revenue_current.loc[user_revenue_current["revenue"] > 0, "user_id"])
    followup_base = pd.DataFrame(
        [
            {
                "user_id": user_id,
                "first_followup_date": profile.get("first_followup_date"),
                "event_gender": profile.get("gender") or "Unknown",
                "event_age_bucket": profile.get("age_bucket") or "Unknown",
                "region": profile.get("region") or "Unknown",
                "city": profile.get("city") or "Unknown",
            }
            for user_id, profile in mixpanel["followup_users"].items()
        ]
    )
    if followup_base.empty:
        followup_base = pd.DataFrame(columns=["user_id", "first_followup_date", "event_gender", "event_age_bucket", "region", "city"])
    followup_profiles = enrich_users(followup_base, profiles, ranges)
    db_gender = followup_profiles["gender"].fillna("Unknown").astype(str)
    event_gender = followup_profiles["event_gender"].fillna("Unknown").astype(str).str.lower()
    followup_profiles["gender"] = db_gender.where(~db_gender.str.lower().eq("unknown"), event_gender)
    db_age = followup_profiles["age_bucket"].fillna("Unknown").astype(str)
    event_age = followup_profiles["event_age_bucket"].fillna("Unknown").astype(str)
    followup_profiles["age_bucket"] = db_age.where(~db_age.str.lower().eq("unknown"), event_age)
    followup_profiles["region"] = followup_profiles["region"].fillna("Unknown").astype(str)
    followup_profiles["city"] = followup_profiles["city"].fillna("Unknown").astype(str)

    current_users["had_followup"] = current_users["user_id"].isin(followup_ids)
    current_users["paid"] = current_users["user_id"].isin(payer_ids)

    new_users = int(current_users["user_id"].nunique())
    followup_users = int(current_users.loc[current_users["had_followup"], "user_id"].nunique())
    payers = int(current_users.loc[current_users["paid"], "user_id"].nunique())
    funnel = [
        {"stage": "New users", "users": new_users, "conversion_from_previous_pct": 100.0, "conversion_from_start_pct": 100.0},
        {
            "stage": "Follow up",
            "users": followup_users,
            "conversion_from_previous_pct": safe_div(followup_users, new_users),
            "conversion_from_start_pct": safe_div(followup_users, new_users),
        },
        {
            "stage": "Any payment",
            "users": payers,
            "conversion_from_previous_pct": safe_div(payers, followup_users),
            "conversion_from_start_pct": safe_div(payers, new_users),
        },
    ]

    daily = (
        current_users.groupby("signup_date", as_index=False)
        .agg(new_users=("user_id", "nunique"), followup_users=("had_followup", "sum"), payers=("paid", "sum"))
        .sort_values("signup_date")
    )
    if daily.empty:
        daily = pd.DataFrame(columns=["signup_date", "new_users", "followup_users", "payers", "followup_rate_pct", "payer_rate_pct", "followup_to_payer_pct"])
    else:
        daily["followup_rate_pct"] = (daily["followup_users"] / daily["new_users"] * 100).round(2)
        daily["payer_rate_pct"] = (daily["payers"] / daily["new_users"] * 100).round(2)
        daily["followup_to_payer_pct"] = (daily["payers"] / daily["followup_users"] * 100).replace(
            [float("inf"), -float("inf")], 0
        ).fillna(0).round(2)
    daily["signup_date"] = daily["signup_date"].astype(str)
    login_daily = pd.DataFrame(mixpanel["login_daily"])
    if login_daily.empty:
        login_vs_signup_daily = daily.copy()
        login_vs_signup_daily["login_success_users"] = 0
    else:
        login_daily = login_daily.rename(columns={"date": "signup_date"})
        login_vs_signup_daily = daily.merge(login_daily, on="signup_date", how="outer").fillna(0)
        login_vs_signup_daily = login_vs_signup_daily.sort_values("signup_date")
        for column in ["new_users", "followup_users", "payers", "login_success_users"]:
            login_vs_signup_daily[column] = pd.to_numeric(login_vs_signup_daily[column], errors="coerce").fillna(0).astype(int)
        login_vs_signup_daily["login_to_signup_ratio"] = (
            login_vs_signup_daily["login_success_users"] / login_vs_signup_daily["new_users"]
        ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)

    current_user_ids = set(current_users["user_id"])
    new_user_family_revenue = user_family_revenue_current[user_family_revenue_current["user_id"].isin(current_user_ids)].copy()
    if new_user_family_revenue.empty:
        payment_type_funnel = pd.DataFrame(
            columns=["family", "family_label", "selection", "new_users", "followup_users", "payers", "followup_payers", "revenue", "transactions", "new_to_payment_pct", "followup_to_payment_pct", "avg_revenue_per_payer"]
        )
        daily_payment_family = pd.DataFrame(columns=["signup_date", "family", "family_label", "payers", "transactions", "revenue", "avg_revenue_per_payer"])
    else:
        new_user_family_revenue["revenue"] = pd.to_numeric(new_user_family_revenue["revenue"], errors="coerce").fillna(0.0)
        new_user_family_revenue["transactions"] = pd.to_numeric(new_user_family_revenue["transactions"], errors="coerce").fillna(0).astype(int)
        new_user_family_revenue = new_user_family_revenue.merge(
            current_users[["user_id", "signup_date", "had_followup"]],
            on="user_id",
            how="left",
        )
        payment_rows = []
        for family_id, family_label in REVENUE_FAMILIES:
            family_df = new_user_family_revenue[new_user_family_revenue["family"].eq(family_id)]
            family_payers = int(family_df["user_id"].nunique()) if not family_df.empty else 0
            family_followup_payers = int(family_df.loc[family_df["had_followup"].fillna(False), "user_id"].nunique()) if not family_df.empty else 0
            family_revenue = float(family_df["revenue"].sum()) if not family_df.empty else 0.0
            family_transactions = int(family_df["transactions"].sum()) if not family_df.empty else 0
            payment_rows.append(
                {
                    "family": family_id,
                    "family_label": family_label,
                    "selection": f"family = {family_label}",
                    "new_users": new_users,
                    "followup_users": followup_users,
                    "payers": family_payers,
                    "followup_payers": family_followup_payers,
                    "revenue": round(family_revenue, 2),
                    "transactions": family_transactions,
                    "new_to_payment_pct": safe_div(family_payers, new_users),
                    "followup_to_payment_pct": safe_div(family_followup_payers, followup_users),
                    "avg_revenue_per_payer": round(family_revenue / family_payers, 2) if family_payers else 0,
                }
            )
        payment_type_funnel = pd.DataFrame(payment_rows)
        daily_payment_family = (
            new_user_family_revenue.groupby(["signup_date", "family"], as_index=False)
            .agg(payers=("user_id", "nunique"), transactions=("transactions", "sum"), revenue=("revenue", "sum"))
            .sort_values(["signup_date", "family"])
        )
        daily_payment_family["family_label"] = daily_payment_family["family"].apply(revenue_family_label)
        daily_payment_family["avg_revenue_per_payer"] = (
            daily_payment_family["revenue"] / daily_payment_family["payers"]
        ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
    daily_payment_family["signup_date"] = daily_payment_family["signup_date"].astype(str)

    segment_rows = []
    for field in ["platform", "gender", "age_bucket", "config_id", "occupation", "marital_status"]:
        seg = (
            current_users.groupby(field, dropna=False)
            .agg(new_users=("user_id", "nunique"), followup_users=("had_followup", "sum"), payers=("paid", "sum"))
            .reset_index()
            .rename(columns={field: "bucket"})
        )
        seg["segment"] = field
        seg["selection"] = seg["segment"].astype(str) + " = " + seg["bucket"].astype(str)
        seg["followup_rate_pct"] = (seg["followup_users"] / seg["new_users"] * 100).round(2)
        seg["payer_rate_pct"] = (seg["payers"] / seg["new_users"] * 100).round(2)
        seg["followup_to_payer_pct"] = (seg["payers"] / seg["followup_users"] * 100).replace(
            [float("inf"), -float("inf")], 0
        ).fillna(0).round(2)
        segment_rows.append(seg)
    segments = pd.concat(segment_rows, ignore_index=True) if segment_rows else pd.DataFrame()
    if segments.empty:
        segment_opportunities = pd.DataFrame(columns=["selection", "segment", "bucket", "new_users", "followup_users", "payers", "followup_rate_pct", "payer_rate_pct", "followup_to_payer_pct", "opportunity_score"])
    else:
        segment_opportunities = segments[segments["new_users"] >= max(50, int(new_users * 0.002))].copy()
        segment_opportunities["opportunity_score"] = (
            segment_opportunities["new_users"] * segment_opportunities["payer_rate_pct"] / 100
        ).round(2)
        segment_opportunities = segment_opportunities.sort_values(
            ["payer_rate_pct", "new_users"], ascending=[False, False]
        )

    followup_daily_rows = []
    for event_date, users in mixpanel.get("followup_daily_user_ids", {}).items():
        for user_id in users:
            followup_daily_rows.append({"date": event_date, "user_id": user_id})
    followup_daily_df = pd.DataFrame(followup_daily_rows)
    if followup_daily_df.empty:
        followup_daily_user_cohort = pd.DataFrame(columns=["date", "user_cohort", "followup_users", "share_pct"])
    else:
        followup_daily_df = enrich_users(followup_daily_df, profiles, ranges)
        followup_daily_user_cohort = (
            followup_daily_df.groupby(["date", "user_cohort"], as_index=False)
            .agg(followup_users=("user_id", "nunique"))
            .sort_values(["date", "user_cohort"])
        )
        daily_total = followup_daily_user_cohort.groupby("date")["followup_users"].transform("sum")
        followup_daily_user_cohort["share_pct"] = (followup_daily_user_cohort["followup_users"] / daily_total * 100).round(2)

    followup_demographics = {}
    followup_segment_rows = []
    for field in ["user_cohort", "platform", "gender", "age_bucket", "region", "city", "config_id", "occupation", "marital_status"]:
        if followup_profiles.empty:
            followup_demographics[field] = []
            continue
        counter = Counter((value or "Unknown") for value in followup_profiles[field].fillna("Unknown").astype(str))
        total = sum(counter.values())
        rows = [
            {
                "bucket": bucket,
                "users": count,
                "pct": round(count / total * 100, 2) if total else 0,
            }
            for bucket, count in counter.most_common(20)
        ]
        followup_demographics[field] = rows
        for row in rows:
            followup_segment_rows.append(
                {
                    "segment": field,
                    "bucket": row["bucket"],
                    "selection": f"{field} = {row['bucket']}",
                    "users": row["users"],
                    "pct": row["pct"],
                }
            )

    return {
        "kpis": {
            "new_users": new_users,
            "login_success_users": int(sum(row["login_success_users"] for row in mixpanel["login_daily"])),
            "new_user_to_followup_pct": safe_div(followup_users, new_users),
            "new_user_to_payment_pct": safe_div(payers, new_users),
        },
        "daily": records(daily),
        "login_vs_signup_daily": records(login_vs_signup_daily),
        "daily_payment_family": records(daily_payment_family),
        "login_daily": mixpanel["login_daily"],
        "funnel": funnel,
        "payment_type_funnel": records(payment_type_funnel.sort_values("revenue", ascending=False)),
        "segments": records(segments.sort_values(["segment", "new_users"], ascending=[True, False])),
        "segment_opportunities": records(segment_opportunities.head(40)),
        "followup_daily_user_cohort": records(followup_daily_user_cohort),
        "followup_entity_events": mixpanel.get("followup_entity_events", []),
        "followup_demographics": followup_demographics,
        "followup_segment_detail": followup_segment_rows,
    }


def build_config_funnel(
    engine,
    ranges: dict[str, Any],
    followup_user_ids: set[str],
    mixpanel: dict[str, Any],
) -> list[dict[str, Any]]:
    users = read_sql(
        engine,
        """
        SELECT LOWER(BIN_TO_UUID(id)) AS user_id, monetization_config_id AS config_id
        FROM prod.users
        WHERE monetization_config_id IN (18, 20)
        """,
    )
    purchases = read_sql(
        engine,
        """
        SELECT
            LOWER(BIN_TO_UUID(sle.user_id)) AS user_id,
            CASE
                WHEN sle.revenue_type = 'subscription_authenticated'
                     OR sle.event_type = 'subscription.authenticated'
                THEN 'subscription.authenticated'
                WHEN sle.revenue_type = 'subscription_charged'
                     OR sle.event_type = 'subscription.charged'
                THEN 'subscription.charged'
                ELSE sle.event_type
            END AS event_type,
            sle.charge_amount AS amount
        FROM prod.subscription_lifecycle_events sle
        WHERE COALESCE(sle.event_created_at, sle.created_at, sle.charge_at, sle.current_start) >= :start_utc
          AND COALESCE(sle.event_created_at, sle.created_at, sle.charge_at, sle.current_start) < :end_utc
          AND sle.revenue_recorded = 1
          AND sle.charge_amount IS NOT NULL
          AND sle.charge_amount > 0
        """,
        {
            "start_utc": utc_naive(local_midnight(ranges["current_start"])),
            "end_utc": utc_naive(local_midnight(ranges["current_end"] + timedelta(days=1))),
        },
    )
    purchases["amount"] = pd.to_numeric(purchases["amount"], errors="coerce").round(0)
    paywall_events = pd.DataFrame(mixpanel.get("subscription_paywall_user_daily", []))
    trial_cta_events = pd.DataFrame(mixpanel.get("subscription_trial_cta_user_daily", []))
    if paywall_events.empty:
        paywall_events = pd.DataFrame(columns=["user_id", "paywall_shown"])
    if trial_cta_events.empty:
        trial_cta_events = pd.DataFrame(columns=["user_id", "trial_amount", "main_pack_amount", "trial_cta_clicks"])
    for column in ["trial_amount", "main_pack_amount"]:
        trial_cta_events[column] = pd.to_numeric(trial_cta_events[column], errors="coerce").round(0)

    rows = []
    for config_id, trial_amount in [(18, 1), (20, 49)]:
        cohort_ids = set(users.loc[users["config_id"].eq(config_id), "user_id"])
        follow_ids = cohort_ids.intersection(followup_user_ids)
        paywall_ids = follow_ids.intersection(set(paywall_events["user_id"]))
        config_trial_cta = trial_cta_events[
            trial_cta_events["user_id"].isin(follow_ids)
            & trial_cta_events["trial_amount"].eq(trial_amount)
        ].copy()
        trial_cta_ids = set(config_trial_cta["user_id"])
        trial_cta_199_ids = set(config_trial_cta.loc[config_trial_cta["main_pack_amount"].eq(199), "user_id"])
        trial_cta_499_ids = set(config_trial_cta.loc[config_trial_cta["main_pack_amount"].eq(499), "user_id"])
        follow_purchases = purchases[purchases["user_id"].isin(follow_ids)]
        trial_ids = set(
            follow_purchases.loc[
                follow_purchases["event_type"].eq("subscription.authenticated")
                & follow_purchases["amount"].eq(trial_amount),
                "user_id",
            ]
        )
        main_199_ids = set(
            follow_purchases.loc[
                follow_purchases["event_type"].eq("subscription.charged")
                & follow_purchases["amount"].eq(199),
                "user_id",
            ]
        )
        main_499_ids = set(
            follow_purchases.loc[
                follow_purchases["event_type"].eq("subscription.charged")
                & follow_purchases["amount"].eq(499),
                "user_id",
            ]
        )
        main_ids = main_199_ids | main_499_ids
        rows.append(
            {
                "config_id": config_id,
                "trial_type": "Rs 1 trial" if config_id == 18 else "Rs 49 trial",
                "trial_amount": trial_amount,
                "assigned_users": len(cohort_ids),
                "followup_users": len(follow_ids),
                "paywall_shown_users": len(paywall_ids),
                "trial_cta_users": len(trial_cta_ids),
                "trial_buyers": len(trial_ids),
                "main_plan_buyers": len(main_ids),
                "trial_cta_199_pack_users": len(trial_cta_199_ids),
                "trial_cta_499_pack_users": len(trial_cta_499_ids),
                "main_199_buyers": len(main_199_ids),
                "main_499_buyers": len(main_499_ids),
                "assigned_to_followup_pct": safe_div(len(follow_ids), len(cohort_ids)),
                "followup_to_paywall_pct": safe_div(len(paywall_ids), len(follow_ids)),
                "paywall_to_trial_cta_pct": safe_div(len(trial_cta_ids), len(paywall_ids)),
                "trial_cta_to_trial_purchase_pct": safe_div(len(trial_ids), len(trial_cta_ids)),
                "followup_to_trial_pct": safe_div(len(trial_ids), len(follow_ids)),
                "trial_to_main_pct": safe_div(len(main_ids), len(trial_ids)),
                "followup_to_main_pct": safe_div(len(main_ids), len(follow_ids)),
            }
        )
    return rows


def enrich_subscription_plan_followup(
    monetization: dict[str, Any],
    config_funnel: list[dict[str, Any]],
) -> None:
    config_by_trial_amount = {
        int(row["trial_amount"]): row
        for row in config_funnel
        if row.get("trial_amount") is not None
    }
    enriched_rows = []
    for row in monetization.get("subscription_plan_performance", []):
        enriched = dict(row)
        trial_amount = enriched.get("trial_amount")
        if trial_amount is not None:
            try:
                config_row = config_by_trial_amount.get(int(round(float(trial_amount))))
            except (TypeError, ValueError):
                config_row = None
            if config_row:
                followup_users = int(config_row.get("followup_users") or 0)
                enriched["trial_type"] = config_row.get("trial_type")
                enriched["followup_users"] = followup_users
                enriched["followup_to_trial_pct"] = safe_div(int(enriched.get("trial_buyers") or 0), followup_users)
                enriched["followup_to_main_pct"] = safe_div(int(enriched.get("main_buyers") or 0), followup_users)
                enriched["selection"] = (
                    f"subscription plan = {enriched.get('plan_code')}; "
                    f"trial cohort = {config_row.get('trial_type')}"
                )
        enriched_rows.append(enriched)
    monetization["subscription_plan_performance"] = enriched_rows


def build_retention(engine, profiles: pd.DataFrame, ranges: dict[str, Any]) -> dict[str, Any]:
    cohort_start = ranges["prior_30_start"]
    cohort_end = ranges["current_end"] - timedelta(days=7)
    cohort_users = profiles[
        (profiles["signup_date"] >= cohort_start)
        & (profiles["signup_date"] <= cohort_end)
    ][["user_id", "signup_date", "platform", "gender", "age_bucket", "config_id", "occupation", "marital_status"]].copy()

    activity = read_sql(
        engine,
        """
        SELECT
            LOWER(BIN_TO_UUID(user_id)) AS user_id,
            DATE(DATE_ADD(started_at, INTERVAL 330 MINUTE)) AS active_date,
            bot_name,
            session_type,
            COUNT(*) AS sessions,
            SUM(COALESCE(duration_mins, 0)) AS minutes
        FROM prod.chat_session
        WHERE started_at >= :start_utc
          AND started_at < :end_utc
          AND status = 'COMPLETED'
        GROUP BY user_id, active_date, bot_name, session_type
        """,
        {
            "start_utc": utc_naive(local_midnight(cohort_start)),
            "end_utc": utc_naive(local_midnight(cohort_end + timedelta(days=8))),
        },
    )
    if not activity.empty:
        activity["active_date"] = pd.to_datetime(activity["active_date"]).dt.date
    joined = activity.merge(cohort_users, on="user_id", how="inner") if not activity.empty else pd.DataFrame()
    if not joined.empty:
        joined["day_n"] = (joined["active_date"] - joined["signup_date"]).apply(lambda x: x.days)
        joined = joined[(joined["day_n"] >= 0) & (joined["day_n"] <= 7)]

    denom = cohort_users["user_id"].nunique()
    curve_rows = []
    for day_n in range(8):
        active_users = joined.loc[joined["day_n"].eq(day_n), "user_id"].nunique() if not joined.empty else 0
        curve_rows.append(
            {
                "day_n": day_n,
                "cohort_users": int(denom),
                "retained_users": int(active_users),
                "retention_pct": safe_div(active_users, denom),
            }
        )

    platform_rows = []
    for platform, group in cohort_users.groupby("platform"):
        d = group["user_id"].nunique()
        active = joined[joined["user_id"].isin(set(group["user_id"]))] if not joined.empty else pd.DataFrame()
        for day_n in [1, 3, 7]:
            retained = active.loc[active["day_n"].eq(day_n), "user_id"].nunique() if not active.empty else 0
            platform_rows.append(
                {
                    "platform": platform,
                    "day_n": day_n,
                    "cohort_users": int(d),
                    "retained_users": int(retained),
                    "retention_pct": safe_div(retained, d),
                }
            )

    segment_retention_rows = []
    for field in ["platform", "gender", "age_bucket", "config_id", "occupation", "marital_status"]:
        for bucket, group in cohort_users.groupby(field, dropna=False):
            d = group["user_id"].nunique()
            if d == 0:
                continue
            active = joined[joined["user_id"].isin(set(group["user_id"]))] if not joined.empty else pd.DataFrame()
            for day_n in [1, 3, 7]:
                retained = active.loc[active["day_n"].eq(day_n), "user_id"].nunique() if not active.empty else 0
                segment_retention_rows.append(
                    {
                        "selection": f"{field} = {bucket}",
                        "segment": field,
                        "bucket": str(bucket),
                        "day_n": day_n,
                        "cohort_users": int(d),
                        "retained_users": int(retained),
                        "retention_pct": safe_div(retained, d),
                    }
                )
    segment_retention = pd.DataFrame(segment_retention_rows)

    bot = read_sql(
        engine,
        """
        WITH user_bot AS (
            SELECT
                bot_name,
                LOWER(BIN_TO_UUID(user_id)) AS user_id,
                COUNT(*) AS sessions,
                COUNT(DISTINCT DATE(DATE_ADD(started_at, INTERVAL 330 MINUTE))) AS active_days,
                SUM(COALESCE(duration_mins, 0)) AS minutes
            FROM prod.chat_session
            WHERE started_at >= :start_utc
              AND started_at < :end_utc
              AND status = 'COMPLETED'
            GROUP BY bot_name, user_id
        )
        SELECT
            bot_name,
            COUNT(DISTINCT user_id) AS active_users,
            SUM(CASE WHEN active_days >= 2 THEN 1 ELSE 0 END) AS repeat_users_2plus_days,
            SUM(sessions) AS sessions,
            SUM(minutes) AS minutes
        FROM user_bot
        GROUP BY bot_name
        ORDER BY active_users DESC
        LIMIT 20
        """,
        {
            "start_utc": utc_naive(local_midnight(ranges["current_start"])),
            "end_utc": utc_naive(local_midnight(ranges["current_end"] + timedelta(days=1))),
        },
    )
    if not bot.empty:
        bot["repeat_rate_pct"] = (bot["repeat_users_2plus_days"] / bot["active_users"] * 100).round(2)
        bot["minutes_per_user"] = (bot["minutes"] / bot["active_users"]).round(2)

    bot_user = read_sql(
        engine,
        """
        SELECT
            bot_name,
            LOWER(BIN_TO_UUID(user_id)) AS user_id,
            COUNT(*) AS sessions,
            COUNT(DISTINCT DATE(DATE_ADD(started_at, INTERVAL 330 MINUTE))) AS active_days,
            SUM(COALESCE(duration_mins, 0)) AS minutes
        FROM prod.chat_session
        WHERE started_at >= :start_utc
          AND started_at < :end_utc
          AND status = 'COMPLETED'
        GROUP BY bot_name, user_id
        """,
        {
            "start_utc": utc_naive(local_midnight(ranges["current_start"])),
            "end_utc": utc_naive(local_midnight(ranges["current_end"] + timedelta(days=1))),
        },
    )
    if bot_user.empty:
        bot_user_cohort = pd.DataFrame(
            columns=["bot_name", "user_cohort", "active_users", "repeat_users_2plus_days", "repeat_rate_pct", "sessions", "minutes", "minutes_per_user"]
        )
        bot_segment = pd.DataFrame(
            columns=["selection", "segment", "bucket", "active_users", "repeat_users_2plus_days", "repeat_rate_pct", "sessions", "minutes", "minutes_per_user"]
        )
    else:
        bot_user = enrich_users(bot_user, profiles, ranges)
        bot_user["repeat_flag"] = bot_user["active_days"] >= 2
        bot_user_cohort = (
            bot_user.groupby(["bot_name", "user_cohort"], as_index=False)
            .agg(
                active_users=("user_id", "nunique"),
                repeat_users_2plus_days=("repeat_flag", "sum"),
                sessions=("sessions", "sum"),
                minutes=("minutes", "sum"),
            )
            .sort_values(["active_users", "sessions"], ascending=False)
            .head(40)
        )
        bot_user_cohort["repeat_rate_pct"] = (
            bot_user_cohort["repeat_users_2plus_days"] / bot_user_cohort["active_users"] * 100
        ).round(2)
        bot_user_cohort["minutes_per_user"] = (
            bot_user_cohort["minutes"] / bot_user_cohort["active_users"]
        ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)

        bot_segment_rows = []
        for field in ["user_cohort", "platform", "gender", "age_bucket", "config_id", "occupation", "marital_status"]:
            seg = (
                bot_user.groupby(field, dropna=False)
                .agg(
                    active_users=("user_id", "nunique"),
                    repeat_users_2plus_days=("repeat_flag", "sum"),
                    sessions=("sessions", "sum"),
                    minutes=("minutes", "sum"),
                )
                .reset_index()
                .rename(columns={field: "bucket"})
            )
            seg["segment"] = field
            seg["selection"] = seg["segment"].astype(str) + " = " + seg["bucket"].astype(str)
            seg["repeat_rate_pct"] = (
                seg["repeat_users_2plus_days"] / seg["active_users"] * 100
            ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
            seg["minutes_per_user"] = (
                seg["minutes"] / seg["active_users"]
            ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
            bot_segment_rows.append(seg)
        bot_segment = pd.concat(bot_segment_rows, ignore_index=True)

    return {
        "cohort_window": {"start": cohort_start.isoformat(), "end": cohort_end.isoformat()},
        "curve": curve_rows,
        "platform": platform_rows,
        "segment_retention": records(segment_retention.sort_values(["segment", "day_n", "cohort_users"], ascending=[True, True, False]).head(120)),
        "bot": records(bot),
        "bot_user_cohort": records(bot_user_cohort),
        "bot_segment": records(bot_segment.sort_values(["segment", "active_users"], ascending=[True, False]).head(100)),
    }


def make_ranges(period_id: str, current_start: date, current_end: date) -> dict[str, Any]:
    period_days = (current_end - current_start).days + 1
    previous_end = current_start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=period_days - 1)
    prior_30_end = previous_end
    prior_30_start = prior_30_end - timedelta(days=29)
    return {
        "period_id": period_id,
        "period_days": period_days,
        "today_ist": datetime.now(IST).date(),
        "current_start": current_start,
        "current_end": current_end,
        "prior_7_start": previous_start,
        "prior_7_end": previous_end,
        "prior_30_start": prior_30_start,
        "prior_30_end": prior_30_end,
        "comparison_label": "previous day" if period_days == 1 else f"previous {period_days} days",
    }


def filter_events(events: list[dict[str, Any]], start: date, end: date) -> list[dict[str, Any]]:
    return [
        event
        for event in events
        if start <= datetime.strptime(event["properties"]["_event_date"], "%Y-%m-%d").date() <= end
    ]


def build_engagement(mixpanel: dict[str, Any], profiles: pd.DataFrame, ranges: dict[str, Any]) -> dict[str, Any]:
    session_daily = pd.DataFrame(mixpanel["session_daily"])
    if session_daily.empty:
        engagement_kpis = {
            "active_users": 0,
            "sessions": 0,
            "total_minutes": 0,
            "avg_minutes_per_user": 0,
            "avg_minutes_per_session": 0,
        }
    else:
        total_sessions = int(session_daily["sessions"].sum())
        total_minutes = float(session_daily["total_minutes"].sum())
        active_users = int(mixpanel["session_users_total"])
        engagement_kpis = {
            "active_users": active_users,
            "sessions": total_sessions,
            "total_minutes": round(total_minutes, 1),
            "avg_minutes_per_user": round(total_minutes / active_users, 2) if active_users else 0,
            "avg_minutes_per_session": round(total_minutes / total_sessions, 2) if total_sessions else 0,
        }

    bim_opens = sum(row["opens"] for row in mixpanel["bim_daily"])
    bim_users = sum(row["users"] for row in mixpanel["bim_by_platform"])

    session_user_daily = pd.DataFrame(mixpanel.get("session_user_daily", []))
    if session_user_daily.empty:
        session_user_cohort_daily = pd.DataFrame(columns=["date", "user_cohort", "sessions", "users", "total_minutes", "avg_minutes_per_user", "sessions_per_user"])
        session_segments = pd.DataFrame(columns=["segment", "bucket", "selection", "users", "sessions", "total_minutes", "avg_minutes_per_user", "sessions_per_user", "user_share_pct"])
        session_intensity = pd.DataFrame(columns=["bucket", "selection", "users", "sessions", "total_minutes", "avg_minutes_per_user", "sessions_per_user", "user_share_pct"])
    else:
        session_user_daily = enrich_users(session_user_daily, profiles, ranges)
        session_user_daily["total_minutes"] = session_user_daily["seconds"] / 60
        session_user_cohort_daily = (
            session_user_daily.groupby(["date", "user_cohort"], as_index=False)
            .agg(
                sessions=("sessions", "sum"),
                users=("user_id", "nunique"),
                total_minutes=("total_minutes", "sum"),
            )
            .sort_values(["date", "user_cohort"])
        )
        session_user_cohort_daily["total_minutes"] = session_user_cohort_daily["total_minutes"].round(1)
        session_user_cohort_daily["avg_minutes_per_user"] = (
            session_user_cohort_daily["total_minutes"] / session_user_cohort_daily["users"]
        ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
        session_user_cohort_daily["sessions_per_user"] = (
            session_user_cohort_daily["sessions"] / session_user_cohort_daily["users"]
        ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)

        segment_rows = []
        for field in ["user_cohort", "platform", "gender", "age_bucket", "config_id", "occupation", "marital_status"]:
            seg = (
                session_user_daily.groupby(field, dropna=False)
                .agg(
                    users=("user_id", "nunique"),
                    sessions=("sessions", "sum"),
                    total_minutes=("total_minutes", "sum"),
                )
                .reset_index()
                .rename(columns={field: "bucket"})
            )
            seg["segment"] = field
            seg["selection"] = seg["segment"].astype(str) + " = " + seg["bucket"].astype(str)
            seg["total_minutes"] = seg["total_minutes"].round(1)
            seg["avg_minutes_per_user"] = (seg["total_minutes"] / seg["users"]).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
            seg["sessions_per_user"] = (seg["sessions"] / seg["users"]).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
            seg = add_share(seg, "users", "user_share_pct")
            segment_rows.append(seg)
        session_segments = pd.concat(segment_rows, ignore_index=True)

        user_session_totals = (
            session_user_daily.groupby("user_id", as_index=False)
            .agg(sessions=("sessions", "sum"), total_minutes=("total_minutes", "sum"))
        )
        user_session_totals["bucket"] = pd.cut(
            user_session_totals["total_minutes"],
            bins=[-0.01, 1, 5, 15, 45, 999999],
            labels=["0-1 min", "1-5 min", "5-15 min", "15-45 min", "45+ min"],
        ).astype(str)
        session_intensity = (
            user_session_totals.groupby("bucket", as_index=False)
            .agg(users=("user_id", "nunique"), sessions=("sessions", "sum"), total_minutes=("total_minutes", "sum"))
        )
        session_intensity["selection"] = "total session time = " + session_intensity["bucket"].astype(str)
        session_intensity["total_minutes"] = session_intensity["total_minutes"].round(1)
        session_intensity["avg_minutes_per_user"] = (
            session_intensity["total_minutes"] / session_intensity["users"]
        ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
        session_intensity["sessions_per_user"] = (
            session_intensity["sessions"] / session_intensity["users"]
        ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
        session_intensity = add_share(session_intensity, "users", "user_share_pct")

    bim_user_daily = pd.DataFrame(mixpanel.get("bim_user_daily", []))
    if bim_user_daily.empty:
        bim_user_cohort_daily = pd.DataFrame(columns=["date", "user_cohort", "opens", "users", "opens_per_user", "share_pct"])
    else:
        bim_user_daily = enrich_users(bim_user_daily, profiles, ranges)
        bim_user_cohort_daily = (
            bim_user_daily.groupby(["date", "user_cohort"], as_index=False)
            .agg(opens=("opens", "sum"), users=("user_id", "nunique"))
            .sort_values(["date", "user_cohort"])
        )
        bim_user_cohort_daily["opens_per_user"] = (
            bim_user_cohort_daily["opens"] / bim_user_cohort_daily["users"]
        ).replace([float("inf"), -float("inf")], 0).fillna(0).round(2)
        daily_opens = bim_user_cohort_daily.groupby("date")["opens"].transform("sum")
        bim_user_cohort_daily["share_pct"] = (bim_user_cohort_daily["opens"] / daily_opens * 100).round(2)

    notification_campaigns = pd.DataFrame(mixpanel["notification_campaigns"])
    if notification_campaigns.empty:
        notification_campaigns = pd.DataFrame(columns=["campaign", "opens", "users", "opens_per_user", "open_share_pct"])
    else:
        notification_campaigns = add_share(notification_campaigns, "opens", "open_share_pct")

    bim_by_platform = pd.DataFrame(mixpanel["bim_by_platform"])
    if bim_by_platform.empty:
        bim_by_platform = pd.DataFrame(columns=["platform", "opens", "users", "opens_per_user", "open_share_pct"])
    else:
        bim_by_platform = add_share(bim_by_platform, "opens", "open_share_pct")

    return {
        "kpis": {
            **engagement_kpis,
            "bim_notification_opens": int(bim_opens),
            "bim_notification_users": int(bim_users),
        },
        "session_daily": mixpanel["session_daily"],
        "session_by_platform": mixpanel["session_by_platform"],
        "session_user_cohort_daily": records(session_user_cohort_daily),
        "session_segments": records(session_segments.sort_values(["segment", "users"], ascending=[True, False]).head(80)),
        "session_intensity": records(session_intensity.sort_values("users", ascending=False)),
        "bim_daily": mixpanel["bim_daily"],
        "bim_by_platform": records(bim_by_platform.sort_values("opens", ascending=False)),
        "bim_user_cohort_daily": records(bim_user_cohort_daily),
        "notification_campaigns": records(notification_campaigns.sort_values("opens", ascending=False)),
    }


def bucket_pct(rows: list[dict[str, Any]], bucket_name: str) -> float:
    for row in rows:
        if str(row.get("bucket", "")).lower() == bucket_name.lower():
            return float(row.get("pct") or 0)
    return 0.0


def build_metric_coverage(period_dashboard: dict[str, Any]) -> dict[str, Any]:
    acquisition = period_dashboard["acquisition"]
    monetization = period_dashboard["monetization"]
    engagement = period_dashboard["engagement"]

    demographics = acquisition.get("followup_demographics", {})
    unknown_gender_pct = bucket_pct(demographics.get("gender", []), "unknown")
    unknown_age_pct = bucket_pct(demographics.get("age_bucket", []), "unknown")
    config_rows = monetization.get("config_funnel", [])
    has_paywall_cta = any(
        row.get("paywall_shown_users", 0) or row.get("trial_cta_users", 0)
        for row in config_rows
    )
    followup_entities = acquisition.get("followup_entity_events", [])
    total_entity_events = sum(row.get("followup_events", 0) for row in followup_entities)
    unmapped_entity_events = sum(
        row.get("followup_events", 0)
        for row in followup_entities
        if row.get("entity_match_type") == "unmapped"
    )
    unmapped_entity_pct = safe_div(unmapped_entity_events, total_entity_events)
    bim_opens = engagement["kpis"].get("bim_notification_opens", 0)

    rows = [
        {
            "area": "Monetization",
            "metric": "Revenue, payer, transaction, avg transaction",
            "status": "Available",
            "coverage_pct": 100,
            "missing_detail": "None",
            "next_data_needed": "None",
        },
        {
            "area": "Monetization",
            "metric": "Revenue stream KPI split by subscription, pay-as-you-go, and day pass",
            "status": "Available",
            "coverage_pct": 100,
            "missing_detail": "None",
            "next_data_needed": "None",
        },
        {
            "area": "Monetization",
            "metric": "Revenue share by family, pack, bot/entity",
            "status": "Available",
            "coverage_pct": 100,
            "missing_detail": "None",
            "next_data_needed": "None",
        },
        {
            "area": "Monetization",
            "metric": "Rs 1 / Rs 49 config to trial and main plan funnel",
            "status": "Available" if has_paywall_cta else "Partial",
            "coverage_pct": 100 if has_paywall_cta else 80,
            "missing_detail": "None" if has_paywall_cta else "Config assignment and purchases are available; paywall and CTA events were not found.",
            "next_data_needed": "None" if has_paywall_cta else "Track subscription_paywall_shown and subscription_trial_initiated with user_id.",
        },
        {
            "area": "Monetization",
            "metric": "Subscription renewal due and autopay readiness",
            "status": "Partial",
            "coverage_pct": 70,
            "missing_detail": "Renewal due, cancel-at-period-end, and active state are available; recurring autopay success/failure is not yet available as an event.",
            "next_data_needed": "Track renewal_success, renewal_failed, and renewal_retry events with user_id, plan_id, amount, and due date.",
        },
        {
            "area": "Acquisition",
            "metric": "New user to follow-up to payment conversion",
            "status": "Available",
            "coverage_pct": 100,
            "missing_detail": "None",
            "next_data_needed": "None",
        },
        {
            "area": "Acquisition",
            "metric": "Marketing channel / campaign source conversion",
            "status": "Missing source",
            "coverage_pct": 0,
            "missing_detail": "The current source set does not include campaign attribution or ad spend for new users.",
            "next_data_needed": "Install/UTM attribution fields or an ad-spend export keyed by campaign/date.",
        },
        {
            "area": "Persona",
            "metric": "Follow-up user gender distribution",
            "status": "Partial" if unknown_gender_pct >= 20 else "Available",
            "coverage_pct": round(100 - unknown_gender_pct, 2),
            "missing_detail": f"{unknown_gender_pct:.2f}% of follow-up users could not be matched to DB profile or event gender.",
            "next_data_needed": "Keep prod.user_profiles.gender populated and continue sending DB user_id with Follow up Query events.",
        },
        {
            "area": "Persona",
            "metric": "Follow-up user age distribution",
            "status": "Partial" if unknown_age_pct >= 20 else "Available",
            "coverage_pct": round(100 - unknown_age_pct, 2),
            "missing_detail": f"{unknown_age_pct:.2f}% of follow-up users could not be matched to DB profile DOB or event DOB.",
            "next_data_needed": "Keep prod.user_profiles.birth_datetime_utc populated and continue sending DB user_id with Follow up Query events.",
        },
        {
            "area": "Bot / Entity",
            "metric": "Follow-up query bot name mapping",
            "status": "Partial" if unmapped_entity_pct > 5 else "Available",
            "coverage_pct": round(100 - unmapped_entity_pct, 2),
            "missing_detail": f"{unmapped_entity_pct:.2f}% of follow-up query events are unmapped to a bot name.",
            "next_data_needed": "Keep bot_id/entity slug mapping in chat_session or a dedicated bot dimension table.",
        },
        {
            "area": "Retention",
            "metric": "D0-D7 chat retention by platform and bot repeat usage",
            "status": "Available",
            "coverage_pct": 100,
            "missing_detail": "None",
            "next_data_needed": "None",
        },
        {
            "area": "Engagement",
            "metric": "Average time, session depth, BIM opens",
            "status": "Available" if bim_opens else "Partial",
            "coverage_pct": 100 if bim_opens else 70,
            "missing_detail": "BIM open counts exist, but delivered/impression denominators are not present.",
            "next_data_needed": "Notification delivered/impression event to calculate true open rate.",
        },
        {
            "area": "Engagement",
            "metric": "Notification open rate",
            "status": "Missing denominator",
            "coverage_pct": 0,
            "missing_detail": "App Opened from Notification is available, but notification delivered/sent count is not.",
            "next_data_needed": "Notification sent/delivered event by campaign_name, user_id, date, and platform.",
        },
    ]
    status_counts = Counter(row["status"] for row in rows)
    return {
        "rows": rows,
        "summary": [
            {"status": status, "metrics": count}
            for status, count in sorted(status_counts.items())
        ],
    }


def build_period_dashboard(
    engine,
    profiles: pd.DataFrame,
    all_mixpanel_events: list[dict[str, Any]],
    ranges: dict[str, Any],
    bot_lookup: dict[str, dict[str, str]],
    latest_complete_day: date,
) -> dict[str, Any]:
    period_events = filter_events(all_mixpanel_events, ranges["current_start"], ranges["current_end"])
    mixpanel = aggregate_mixpanel(period_events, latest_complete_day, bot_lookup)

    monetization = build_monetization(engine, ranges, profiles, mixpanel["primary_entity_by_user"], bot_lookup)
    user_revenue_current = pd.DataFrame(monetization.pop("user_revenue_current"))
    if user_revenue_current.empty:
        user_revenue_current = pd.DataFrame(columns=["user_id", "revenue", "transactions"])
    user_family_revenue_current = pd.DataFrame(monetization.pop("user_family_revenue_current"))
    if user_family_revenue_current.empty:
        user_family_revenue_current = pd.DataFrame(columns=["user_id", "family", "revenue", "transactions"])

    acquisition = build_acquisition(profiles, ranges, mixpanel, user_revenue_current, user_family_revenue_current)
    config_funnel = build_config_funnel(engine, ranges, set(mixpanel["followup_users"].keys()), mixpanel)
    enrich_subscription_plan_followup(monetization, config_funnel)
    retention = build_retention(engine, profiles, ranges)
    engagement = build_engagement(mixpanel, profiles, ranges)
    period_dashboard = {
        "metadata": {
            "period_id": ranges["period_id"],
            "period_days": ranges["period_days"],
            "current_window": {
                "start": ranges["current_start"].isoformat(),
                "end": ranges["current_end"].isoformat(),
            },
            "comparison_window": {
                "start": ranges["prior_7_start"].isoformat(),
                "end": ranges["prior_7_end"].isoformat(),
                "label": ranges["comparison_label"],
            },
            "prior_30_window": {
                "start": ranges["prior_30_start"].isoformat(),
                "end": ranges["prior_30_end"].isoformat(),
            },
        },
        "monetization": {**monetization, "config_funnel": config_funnel},
        "acquisition": acquisition,
        "retention": retention,
        "engagement": engagement,
    }
    period_dashboard["metric_coverage"] = build_metric_coverage(period_dashboard)
    return period_dashboard


def write_latest_dashboard(dashboard: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for stale_path in DATA_DIR.glob("dashboard_data*.tmp"):
        stale_path.unlink(missing_ok=True)
    tmp_path = OUTPUT_PATH.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(dashboard, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp_path, OUTPUT_PATH)


def build_periods(
    env: dict[str, str],
    engine,
    period_ranges: dict[str, dict[str, Any]],
    latest_complete_day: date,
    mixpanel_start: date,
    mixpanel_end: date,
) -> dict[str, dict[str, Any]]:
    sql_lookup_start = min(ranges["prior_30_start"] for ranges in period_ranges.values())
    current_end = max(ranges["current_end"] for ranges in period_ranges.values())
    mixpanel_events = fetch_mixpanel_events(env, MIXPANEL_EVENTS, mixpanel_start, mixpanel_end)
    profiles = build_profiles(engine, latest_complete_day)
    bot_lookup = build_bot_lookup(engine, sql_lookup_start, current_end)
    return {
        period_id: build_period_dashboard(
            engine,
            profiles,
            mixpanel_events,
            ranges,
            bot_lookup,
            latest_complete_day,
        )
        for period_id, ranges in period_ranges.items()
    }


def build_daily_api_payload(day_value: date) -> dict[str, Any]:
    today_ist = datetime.now(IST).date()
    latest_complete_day = today_ist - timedelta(days=1)
    if day_value > latest_complete_day:
        raise ValueError(f"{day_value.isoformat()} is not complete yet. Latest complete date is {latest_complete_day.isoformat()}.")
    env = load_env()
    engine = mysql_engine(env)
    period_id = f"daily_{day_value.isoformat()}"
    period_ranges = {
        period_id: make_ranges("daily", day_value, day_value),
    }
    periods = build_periods(
        env,
        engine,
        period_ranges,
        latest_complete_day,
        day_value,
        day_value,
    )
    period = periods[period_id]
    return {
        "metadata": {
            "generated_at_ist": datetime.now(IST).isoformat(timespec="seconds"),
            "timezone": "Asia/Kolkata",
            "latest_complete_day": latest_complete_day.isoformat(),
            "source_notes": dashboard_source_notes(),
            "data_retention_policy": {
                "storage": "In-memory response for the selected aggregate dashboard period",
                "refresh_behavior": "Selecting a date fetches aggregate metrics for that date; the local API does not append the result to dashboard_data.json.",
                "raw_data": "Raw SQL rows, Mixpanel event exports, user-level funnel rows, and credentials are not returned to the browser.",
            },
        },
        "period_id": period_id,
        "date": day_value.isoformat(),
        "period": period,
    }


def main() -> None:
    env = load_env()
    engine = mysql_engine(env)
    today_ist = datetime.now(IST).date()
    latest_complete_day = today_ist - timedelta(days=1)
    current_end = latest_complete_day
    weekly_start = current_end - timedelta(days=6)
    daily_history_days = max(7, min(31, int(env.get("DASHBOARD_DAILY_HISTORY_DAYS", "7"))))
    daily_start = current_end - timedelta(days=daily_history_days - 1)
    period_ranges = {
        "daily": make_ranges("daily", current_end, current_end),
        "weekly": make_ranges("weekly", weekly_start, current_end),
    }
    for day in day_range(daily_start, current_end):
        day_value = date.fromisoformat(day)
        period_ranges[f"daily_{day}"] = make_ranges("daily", day_value, day_value)
    mixpanel_start = daily_start
    periods = build_periods(env, engine, period_ranges, latest_complete_day, mixpanel_start, current_end)
    weekly = periods["weekly"]
    daily_periods = [
        {
            "id": f"daily_{day}",
            "date": day,
            "label": datetime.fromisoformat(day).strftime("%d %b"),
            **periods[f"daily_{day}"]["metadata"],
        }
        for day in day_range(daily_start, current_end)
    ]

    dashboard = {
        "metadata": {
            "generated_at_ist": datetime.now(IST).isoformat(timespec="seconds"),
            "default_period": "weekly",
            "current_window": weekly["metadata"]["current_window"],
            "prior_7_window": weekly["metadata"]["comparison_window"],
            "prior_30_window": weekly["metadata"]["prior_30_window"],
            "available_periods": [
                {"id": "daily", "label": "Daily", **periods["daily"]["metadata"]},
                {"id": "weekly", "label": "Weekly", **periods["weekly"]["metadata"]},
            ],
            "daily_periods": daily_periods,
            "daily_history_days": daily_history_days,
            "timezone": "Asia/Kolkata",
            "data_retention_policy": {
                "storage": "Latest aggregate dashboard JSON only",
                "refresh_behavior": "Each refresh replaces the previous dashboard_data.json file; old aggregate output is not appended or archived.",
                "raw_data": "Raw SQL rows, Mixpanel event exports, user-level funnel rows, and credentials are not stored in this repo.",
            },
            "source_notes": dashboard_source_notes(),
        },
        "periods": periods,
        "monetization": weekly["monetization"],
        "acquisition": weekly["acquisition"],
        "retention": weekly["retention"],
        "engagement": weekly["engagement"],
        "metric_coverage": weekly["metric_coverage"],
    }

    write_latest_dashboard(dashboard)
    print(f"WROTE {OUTPUT_PATH}")
    print(
        "SUMMARY",
        json.dumps(
            {
                "revenue": dashboard["monetization"]["kpis"]["current"]["revenue"],
                "new_users": dashboard["acquisition"]["kpis"]["new_users"],
                "retention_d1": dashboard["retention"]["curve"][1]["retention_pct"],
                "engagement_sessions": dashboard["engagement"]["kpis"]["sessions"],
                "periods": list(periods.keys()),
            },
            indent=2,
        ),
    )


if __name__ == "__main__":
    main()
