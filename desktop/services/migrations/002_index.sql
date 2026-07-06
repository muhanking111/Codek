CREATE VIRTUAL TABLE IF NOT EXISTS code_index USING fts5(
  file_path,
  name,
  functions,
  variables,
  imports,
  content_preview,
  line_count,
  project_root,
  tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS index_meta (
  file_path TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_base USING fts5(
  title,
  content,
  category,
  project_root,
  tokenize='porter unicode61'
);
