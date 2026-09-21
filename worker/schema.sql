CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL UNIQUE,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  latency_ms REAL,
  agent TEXT NOT NULL,
  region TEXT NOT NULL,
  is_valid INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_checks_timestamp ON checks(timestamp);
CREATE INDEX IF NOT EXISTS idx_checks_service ON checks(service_id);
CREATE INDEX IF NOT EXISTS idx_checks_status ON checks(status_code);
