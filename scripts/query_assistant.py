"""Natural-language -> read-only SQL assistant for the HiAstro dashboard.

A question in plain English is sent to Claude, which returns a single SELECT
statement against the production MySQL schema. The statement is then validated
(read-only, single statement, row + time capped) and executed inside a READ ONLY
transaction. Raw rows never leave this process except as the capped result the
caller explicitly requested; credentials are never returned.

Safety layers (defence in depth):
  1. Claude is instructed to emit a single SELECT only.
  2. validate_sql() rejects anything that is not a lone SELECT/WITH...SELECT and
     blocks DDL/DML/admin keywords after stripping comments and string literals.
  3. A LIMIT is forced on the outer query.
  4. Execution runs in a READ ONLY transaction with MAX_EXECUTION_TIME set, so the
     database itself refuses writes even if validation were bypassed.
"""

from __future__ import annotations

import os
import re
from typing import Any

from sqlalchemy import text

from build_dashboard_data import clean_value, load_env, mysql_engine, read_sql

MODEL = os.environ.get("DASHBOARD_QUERY_MODEL", "claude-opus-4-8")
MAX_ROWS = int(os.environ.get("DASHBOARD_QUERY_MAX_ROWS", "200"))
MAX_EXECUTION_MS = int(os.environ.get("DASHBOARD_QUERY_TIMEOUT_MS", "15000"))

# Keywords that must never appear as statement verbs in a generated query.
BLOCKED_KEYWORDS = {
    "insert", "update", "delete", "replace", "merge", "upsert",
    "drop", "alter", "create", "truncate", "rename",
    "grant", "revoke", "set", "lock", "unlock", "call", "do",
    "exec", "execute", "prepare", "deallocate", "handler", "load",
    "import", "install", "uninstall", "use", "commit", "rollback",
    "begin", "start", "savepoint", "shutdown", "kill", "reset", "flush",
    "outfile", "dumpfile", "into",
}

_ENGINE = None
_SCHEMA_CONTEXT: str | None = None


def _engine():
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = mysql_engine(load_env())
    return _ENGINE


def _strip_sql_noise(sql: str) -> str:
    """Remove string/identifier literals and comments so keyword checks are reliable."""
    no_block = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    no_line = re.sub(r"(--|#)[^\n]*", " ", no_block)
    no_strings = re.sub(r"'(?:[^'\\]|\\.)*'", " ", no_line)
    no_strings = re.sub(r'"(?:[^"\\]|\\.)*"', " ", no_strings)
    no_idents = re.sub(r"`[^`]*`", " ", no_strings)
    return no_idents


def validate_sql(sql: str) -> str:
    """Return a safe, single SELECT statement or raise ValueError."""
    if not sql or not sql.strip():
        raise ValueError("Empty query.")
    cleaned = sql.strip().rstrip(";").strip()
    bare = _strip_sql_noise(cleaned)

    if ";" in bare:
        raise ValueError("Only a single statement is allowed.")
    if not re.match(r"^\s*(select|with)\b", bare, flags=re.IGNORECASE):
        raise ValueError("Only SELECT (or WITH ... SELECT) queries are allowed.")
    # A WITH chain must still resolve to a SELECT, never a data-modifying CTE.
    if re.match(r"^\s*with\b", bare, flags=re.IGNORECASE) and not re.search(r"\bselect\b", bare, flags=re.IGNORECASE):
        raise ValueError("WITH query must contain a SELECT.")

    tokens = set(re.findall(r"[a-zA-Z_]+", bare.lower()))
    hits = tokens & BLOCKED_KEYWORDS
    # `into` is only dangerous as INTO OUTFILE/DUMPFILE; a plain SELECT ... INTO is still blocked for safety.
    if hits:
        raise ValueError(f"Query contains disallowed keyword(s): {', '.join(sorted(hits))}.")

    # Force an outer LIMIT.
    if not re.search(r"\blimit\s+\d+", bare, flags=re.IGNORECASE):
        cleaned = f"{cleaned}\nLIMIT {MAX_ROWS}"
    return cleaned


def schema_context() -> str:
    """Introspect the live schema once (table + column names) for the prompt."""
    global _SCHEMA_CONTEXT
    if _SCHEMA_CONTEXT is not None:
        return _SCHEMA_CONTEXT
    df = read_sql(
        _engine(),
        """
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
        FROM information_schema.columns
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME, ORDINAL_POSITION
        """,
    )
    lines: list[str] = []
    current = None
    cols: list[str] = []
    for _, row in df.iterrows():
        table = row["TABLE_NAME"]
        if table != current:
            if current is not None:
                lines.append(f"{current}({', '.join(cols)})")
            current = table
            cols = []
        cols.append(f"{row['COLUMN_NAME']} {row['DATA_TYPE']}")
    if current is not None:
        lines.append(f"{current}({', '.join(cols)})")
    _SCHEMA_CONTEXT = "\n".join(lines)
    return _SCHEMA_CONTEXT


SYSTEM_PROMPT = """You are a careful analytics engineer for HiAstro, an astrology app.
You translate a business question into ONE read-only MySQL SELECT query against the schema below.

Rules:
- Emit exactly one statement. It MUST be a SELECT (a leading WITH clause is allowed if it ends in SELECT).
- Never write INSERT/UPDATE/DELETE/DDL or any statement that changes data or settings.
- Always include a LIMIT (<= {max_rows}) unless the query is a single aggregate row.
- Times are stored in UTC; IST is UTC+5:30. To bucket by IST day use DATE(DATE_ADD(col, INTERVAL 330 MINUTE)).
- user_id columns are stored as BINARY UUID; convert with LOWER(BIN_TO_UUID(col)) when selecting them.
- Prefer clear column aliases and aggregate where the question implies a total or rate.
- If the question cannot be answered from this schema, set answerable=false and explain why; leave sql empty.

Schema (table(column type, ...)):
{schema}
"""

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "answerable": {"type": "boolean"},
        "sql": {"type": "string"},
        "explanation": {"type": "string"},
        "refusal_reason": {"type": "string"},
    },
    "required": ["answerable", "sql", "explanation", "refusal_reason"],
    "additionalProperties": False,
}


def generate_sql(question: str) -> dict[str, Any]:
    import anthropic  # lazy import; only needed for this feature

    client = anthropic.Anthropic()
    system = SYSTEM_PROMPT.format(schema=schema_context(), max_rows=MAX_ROWS)
    response = client.messages.create(
        model=MODEL,
        max_tokens=2000,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": question.strip()[:2000]}],
        output_config={"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
    )
    import json

    text_block = next((b.text for b in response.content if b.type == "text"), "{}")
    return json.loads(text_block)


def run_select(sql: str) -> dict[str, Any]:
    """Execute a validated SELECT inside a READ ONLY transaction and return capped rows."""
    engine = _engine()
    with engine.connect() as conn:
        setup_conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        try:
            setup_conn.execute(text(f"SET SESSION MAX_EXECUTION_TIME={MAX_EXECUTION_MS}"))
        except Exception:
            pass  # MAX_EXECUTION_TIME is MySQL 5.7+; validation + READ ONLY still protect us.
        setup_conn.execute(text("START TRANSACTION READ ONLY"))
        try:
            result = conn.execute(text(sql))
            columns = list(result.keys())
            rows = []
            for raw in result.fetchmany(MAX_ROWS):
                rows.append([clean_value(value) for value in raw])
        finally:
            try:
                setup_conn.execute(text("ROLLBACK"))
            except Exception:
                pass
    return {"columns": columns, "rows": rows, "row_count": len(rows), "truncated": len(rows) >= MAX_ROWS}


def answer_question(question: str) -> dict[str, Any]:
    if not question or not question.strip():
        return {"status": "error", "error": "Ask a question first."}
    try:
        generated = generate_sql(question)
    except Exception as exc:  # network / API / parse failure
        return {"status": "error", "error": f"Could not generate a query: {exc}"}

    if not generated.get("answerable", False):
        return {
            "status": "unanswerable",
            "explanation": generated.get("explanation", ""),
            "refusal_reason": generated.get("refusal_reason", "This question cannot be answered from the available schema."),
        }

    raw_sql = generated.get("sql", "")
    try:
        safe_sql = validate_sql(raw_sql)
    except ValueError as exc:
        return {"status": "rejected", "error": str(exc), "sql": raw_sql}

    try:
        result = run_select(safe_sql)
    except Exception as exc:
        return {"status": "error", "error": f"Query failed: {exc}", "sql": safe_sql}

    return {
        "status": "ok",
        "sql": safe_sql,
        "explanation": generated.get("explanation", ""),
        "columns": result["columns"],
        "rows": result["rows"],
        "row_count": result["row_count"],
        "truncated": result["truncated"],
        "max_rows": MAX_ROWS,
    }
