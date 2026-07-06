CREATE TABLE IF NOT EXISTS collab_operations (
  session_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  operation_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_collab_session ON collab_operations(session_id, revision);
