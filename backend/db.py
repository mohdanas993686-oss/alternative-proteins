import os
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS samples (
  id TEXT PRIMARY KEY, sample_code TEXT, byproduct TEXT, supplier TEXT, batch TEXT, sample_date TEXT,
  storage_history TEXT, notes TEXT, spectrum TEXT, spectrum_source TEXT, review_status TEXT DEFAULT 'none',
  review_note TEXT, is_demo INTEGER DEFAULT 1, created_at TEXT);
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY, sample_id TEXT, target TEXT, value REAL, error REAL, model TEXT, r2 REAL,
  reliable INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS lab_results (
  id TEXT PRIMARY KEY, sample_id TEXT, target TEXT, value REAL, result TEXT, unit TEXT, method TEXT,
  confirmation TEXT, notes TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS agent_logs (
  id TEXT PRIMARY KEY, run_id TEXT, sample_id TEXT, step INTEGER, kind TEXT, tool TEXT, args TEXT,
  result TEXT, reasoning TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS ix_pred ON predictions(sample_id);
CREATE INDEX IF NOT EXISTS ix_lab ON lab_results(sample_id);
CREATE INDEX IF NOT EXISTS ix_log ON agent_logs(run_id);
"""


def _conn():
    path = os.environ["SQLITE_PATH"]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(path, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c


def init():
    with closing(_conn()) as c:
        c.executescript(SCHEMA)
        c.commit()


def now():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return uuid.uuid4().hex[:12]


def query(sql, params=()):
    with closing(_conn()) as c:
        return [dict(r) for r in c.execute(sql, params).fetchall()]


def one(sql, params=()):
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql, params=()):
    with closing(_conn()) as c:
        c.execute(sql, params)
        c.commit()


def insert(table, row):
    cols = ",".join(row.keys())
    execute(f"INSERT INTO {table} ({cols}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))
    return row
