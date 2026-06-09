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
from sqlalchemy.engine import URL


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DASHBOARD_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = DASHBOARD_ROOT / "data"
OUTPUT_PATH = DATA_DIR / "dashboard_data.json"

IST = timezone(timedelta(hours=5, minutes=30))
UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
ENTITY_ID_RE = re.compile(r"^[0-9a-fA-F]{24}$")


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
    match = UUID_RE.search(str(value))
    return match.group(0).lower() if match else None


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
        user_id = extract_uuid(props.get(key))
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
    with engine.connect() as conn:
        return pd.read_sql(text(sql), conn, params=params or {})


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
    bim_daily: dict[str, dict[str, Any]] = defaultdict(lambda: {"opens": 0, "users": set()})
    bim_platform: dict[str, dict[str, Any]] = defaultdict(lambda: {"opens": 0, "users": set()})
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
            {key_name: key, "opens": value["opens"], "users": len(value["users"])}
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
        "session_users_total": len(session_users_total),
        "login_daily": user_rows(login_daily, "date", "login_success_users"),
        "followup_daily": user_rows(followup_daily, "date", "followup_users"),
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
        "bim_daily": open_rows(bim_daily, "date"),
        "bim_by_platform": open_rows(bim_platform, "platform"),
        "notification_campaigns": [
            {"campaign": campaign, "opens": value["opens"], "users": len(value["users"])}
            for campaign, value in sorted(notification_campaigns.items(), key=lambda item: item[1]["opens"], reverse=True)[:15]
        ],
    }


def build_monetization(
    engine,
    ranges: dict[str, Any],
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
            sle.event_created_at AS event_time,
            LOWER(BIN_TO_UUID(sle.user_id)) AS user_id,
            'subscription' AS family,
            CASE
                WHEN sle.event_type = 'subscription.authenticated' THEN CONCAT('Trial Rs ', CAST(ROUND(sle.charge_amount, 0) AS CHAR))
                WHEN sle.event_type = 'subscription.charged' THEN CONCAT('Main Rs ', CAST(ROUND(sle.charge_amount, 0) AS CHAR))
                ELSE CONCAT('Subscription Rs ', CAST(ROUND(sle.charge_amount, 0) AS CHAR))
            END AS pack,
            COALESCE(sp.code, 'unknown_plan') AS plan_code,
            sle.charge_amount AS amount
        FROM prod.subscription_lifecycle_events sle
        LEFT JOIN prod.subscription_plans sp ON sle.plan_id = sp.id
        WHERE sle.event_created_at >= :start_utc
          AND sle.event_created_at < :end_utc
          AND sle.charge_amount IS NOT NULL
          AND sle.charge_amount > 0
          AND sle.event_type IN ('subscription.authenticated', 'subscription.charged')

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
            po.created_at AS event_time,
            LOWER(BIN_TO_UUID(po.user_id)) AS user_id,
            'day_pass' AS family,
            CONCAT('Day Pass Rs ', CAST(ROUND(po.amount, 0) AS CHAR)) AS pack,
            'custom_day_pass' AS plan_code,
            po.amount AS amount
        FROM prod.payment_orders po
        WHERE po.created_at >= :start_utc
          AND po.created_at < :end_utc
          AND po.status = 'PAID'
          AND JSON_UNQUOTE(JSON_EXTRACT(po.notes, '$.type')) = 'DAY_PASS'
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

    daily = (
        current.groupby(["day", "family"], as_index=False)
        .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"), payers=("user_id", "nunique"))
        .sort_values(["day", "family"])
    )
    daily["day"] = daily["day"].astype(str)

    family = (
        current.groupby("family", as_index=False)
        .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"), payers=("user_id", "nunique"))
        .sort_values("revenue", ascending=False)
    )
    family["avg_transaction"] = (family["revenue"] / family["transactions"]).round(2)

    pack = (
        current.groupby(["family", "pack", "plan_code", "amount"], as_index=False)
        .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"), payers=("user_id", "nunique"))
        .sort_values("revenue", ascending=False)
    )
    pack["avg_transaction"] = (pack["revenue"] / pack["transactions"]).round(2)

    user_revenue = (
        current.groupby("user_id", as_index=False)
        .agg(revenue=("revenue", "sum"), transactions=("transactions", "sum"))
    )
    entity_rows = []
    for user_id, entity in primary_entity_by_user.items():
        row = user_revenue[user_revenue["user_id"].eq(user_id)]
        revenue_value = float(row["revenue"].sum()) if not row.empty else 0.0
        txns = int(row["transactions"].sum()) if not row.empty else 0
        entity_rows.append(
            {
                **resolve_entity(entity, bot_lookup),
                "user_id": user_id,
                "revenue": revenue_value,
                "transactions": txns,
            }
        )
    entity_df = pd.DataFrame(entity_rows)
    if entity_df.empty:
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
            ]
        )
    else:
        entity_distribution = (
            entity_df.groupby(["entity_label", "bot_name", "entity_slug", "bot_id", "entity_match_type"], as_index=False)
            .agg(
                followup_users=("user_id", "nunique"),
                payers=("revenue", lambda s: int((s > 0).sum())),
                transactions=("transactions", "sum"),
                revenue=("revenue", "sum"),
            )
            .sort_values(["revenue", "followup_users"], ascending=False)
            .head(20)
        )
        entity_distribution["conversion_pct"] = (
            entity_distribution["payers"] / entity_distribution["followup_users"] * 100
        ).round(2)

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
        },
        "daily": records(daily),
        "family": records(family),
        "pack": records(pack.head(30)),
        "entity_distribution": records(entity_distribution),
        "user_revenue_current": records(user_revenue),
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
    profiles["age_bucket"] = profiles["birth_datetime_utc"].apply(lambda value: age_bucket(value, as_of))
    return profiles


def build_acquisition(
    profiles: pd.DataFrame,
    ranges: dict[str, Any],
    mixpanel: dict[str, Any],
    user_revenue_current: pd.DataFrame,
) -> dict[str, Any]:
    current_users = profiles[
        (profiles["signup_date"] >= ranges["current_start"])
        & (profiles["signup_date"] <= ranges["current_end"])
    ].copy()
    followup_ids = set(mixpanel["followup_users"].keys())
    payer_ids = set(user_revenue_current.loc[user_revenue_current["revenue"] > 0, "user_id"])

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
    daily["signup_date"] = daily["signup_date"].astype(str)

    segment_rows = []
    for field in ["platform", "gender", "age_bucket", "config_id"]:
        seg = (
            current_users.groupby(field, dropna=False)
            .agg(new_users=("user_id", "nunique"), followup_users=("had_followup", "sum"), payers=("paid", "sum"))
            .reset_index()
            .rename(columns={field: "bucket"})
        )
        seg["segment"] = field
        seg["followup_rate_pct"] = (seg["followup_users"] / seg["new_users"] * 100).round(2)
        seg["payer_rate_pct"] = (seg["payers"] / seg["new_users"] * 100).round(2)
        segment_rows.append(seg)
    segments = pd.concat(segment_rows, ignore_index=True) if segment_rows else pd.DataFrame()

    return {
        "kpis": {
            "new_users": new_users,
            "login_success_users": int(sum(row["login_success_users"] for row in mixpanel["login_daily"])),
            "new_user_to_followup_pct": safe_div(followup_users, new_users),
            "new_user_to_payment_pct": safe_div(payers, new_users),
        },
        "daily": records(daily),
        "login_daily": mixpanel["login_daily"],
        "funnel": funnel,
        "segments": records(segments.sort_values(["segment", "new_users"], ascending=[True, False])),
        "followup_entity_events": mixpanel.get("followup_entity_events", []),
        "followup_demographics": mixpanel.get("followup_demographics", {}),
    }


def build_config_funnel(engine, ranges: dict[str, Any], followup_user_ids: set[str]) -> list[dict[str, Any]]:
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
            LOWER(BIN_TO_UUID(user_id)) AS user_id,
            event_type,
            charge_amount
        FROM prod.subscription_lifecycle_events
        WHERE event_created_at >= :start_utc
          AND event_created_at < :end_utc
          AND charge_amount IS NOT NULL
          AND charge_amount > 0
          AND event_type IN ('subscription.authenticated', 'subscription.charged')
        """,
        {
            "start_utc": utc_naive(local_midnight(ranges["current_start"])),
            "end_utc": utc_naive(local_midnight(ranges["current_end"] + timedelta(days=1))),
        },
    )
    purchases["amount"] = pd.to_numeric(purchases["charge_amount"], errors="coerce").round(0)
    rows = []
    for config_id, trial_amount in [(18, 1), (20, 49)]:
        cohort_ids = set(users.loc[users["config_id"].eq(config_id), "user_id"])
        follow_ids = cohort_ids.intersection(followup_user_ids)
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
                "assigned_users": len(cohort_ids),
                "followup_users": len(follow_ids),
                "trial_buyers": len(trial_ids),
                "main_plan_buyers": len(main_ids),
                "main_199_buyers": len(main_199_ids),
                "main_499_buyers": len(main_499_ids),
                "followup_to_trial_pct": safe_div(len(trial_ids), len(follow_ids)),
                "trial_to_main_pct": safe_div(len(main_ids), len(trial_ids)),
                "followup_to_main_pct": safe_div(len(main_ids), len(follow_ids)),
            }
        )
    return rows


def build_retention(engine, profiles: pd.DataFrame, ranges: dict[str, Any]) -> dict[str, Any]:
    cohort_start = ranges["prior_30_start"]
    cohort_end = ranges["current_end"] - timedelta(days=7)
    cohort_users = profiles[
        (profiles["signup_date"] >= cohort_start)
        & (profiles["signup_date"] <= cohort_end)
    ][["user_id", "signup_date", "platform", "gender", "age_bucket"]].copy()

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

    return {
        "cohort_window": {"start": cohort_start.isoformat(), "end": cohort_end.isoformat()},
        "curve": curve_rows,
        "platform": platform_rows,
        "bot": records(bot),
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


def build_engagement(mixpanel: dict[str, Any]) -> dict[str, Any]:
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
    return {
        "kpis": {
            **engagement_kpis,
            "bim_notification_opens": int(bim_opens),
            "bim_notification_users": int(bim_users),
        },
        "session_daily": mixpanel["session_daily"],
        "session_by_platform": mixpanel["session_by_platform"],
        "bim_daily": mixpanel["bim_daily"],
        "bim_by_platform": mixpanel["bim_by_platform"],
        "notification_campaigns": mixpanel["notification_campaigns"],
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

    monetization = build_monetization(engine, ranges, mixpanel["primary_entity_by_user"], bot_lookup)
    user_revenue_current = pd.DataFrame(monetization.pop("user_revenue_current"))
    if user_revenue_current.empty:
        user_revenue_current = pd.DataFrame(columns=["user_id", "revenue", "transactions"])

    acquisition = build_acquisition(profiles, ranges, mixpanel, user_revenue_current)
    config_funnel = build_config_funnel(engine, ranges, set(mixpanel["followup_users"].keys()))
    retention = build_retention(engine, profiles, ranges)
    engagement = build_engagement(mixpanel)

    return {
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


def main() -> None:
    env = load_env()
    engine = mysql_engine(env)
    today_ist = datetime.now(IST).date()
    latest_complete_day = today_ist - timedelta(days=1)
    current_end = latest_complete_day
    period_ranges = {
        "daily": make_ranges("daily", current_end, current_end),
        "weekly": make_ranges("weekly", current_end - timedelta(days=6), current_end),
    }
    mixpanel_start = period_ranges["weekly"]["current_start"]
    sql_lookup_start = period_ranges["weekly"]["prior_30_start"]

    mixpanel_events = fetch_mixpanel_events(
        env,
        ["$ae_session", "Login Success", "Follow up Query", "App Opened from Notification"],
        mixpanel_start,
        current_end,
    )

    profiles = build_profiles(engine, latest_complete_day)
    bot_lookup = build_bot_lookup(engine, sql_lookup_start, current_end)
    periods = {
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
    weekly = periods["weekly"]

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
            "timezone": "Asia/Kolkata",
            "source_notes": [
                "Revenue comes from MySQL subscription_lifecycle_events and payment_orders.",
                "Pay as you go means successful ADD_MONEY wallet payment orders.",
                "Customized day pass means successful DAY_PASS payment orders.",
                "Acquisition new users come from MySQL users.created_at; login success comes from Mixpanel.",
                "Follow-up entity values are resolved to bot names using chat_session bot_id and normalized bot-name slugs.",
                "Retention uses completed MySQL chat_session activity for new-user cohorts.",
                "Engagement duration and BIM notification opens come from Mixpanel app events.",
            ],
        },
        "periods": periods,
        "monetization": weekly["monetization"],
        "acquisition": weekly["acquisition"],
        "retention": weekly["retention"],
        "engagement": weekly["engagement"],
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(dashboard, indent=2, ensure_ascii=False), encoding="utf-8")
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
