PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS member_profiles (
  member_id INTEGER PRIMARY KEY,
  generation_label_raw TEXT,
  lineage_branch TEXT,
  raw_notes TEXT,
  uncertainty_flags_json TEXT DEFAULT '[]',
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS name_aliases (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  is_preferred INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  raw_text TEXT,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS temporal_expressions (
  id INTEGER PRIMARY KEY,
  member_id INTEGER,
  label TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  calendar_type TEXT NOT NULL,
  normalized_date TEXT,
  precision TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kinship_relations (
  id INTEGER PRIMARY KEY,
  from_member_id INTEGER NOT NULL,
  to_member_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  temporal_id INTEGER,
  note TEXT,
  raw_text TEXT,
  FOREIGN KEY (from_member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (to_member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (temporal_id) REFERENCES temporal_expressions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS burial_records (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL,
  temporal_id INTEGER,
  place_raw TEXT NOT NULL,
  mountain_direction TEXT,
  fenjin TEXT,
  note TEXT,
  raw_text TEXT,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (temporal_id) REFERENCES temporal_expressions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_aliases_member_id ON name_aliases(member_id);
CREATE INDEX IF NOT EXISTS idx_temporals_member_id ON temporal_expressions(member_id);
CREATE INDEX IF NOT EXISTS idx_relations_from_member_id ON kinship_relations(from_member_id);
CREATE INDEX IF NOT EXISTS idx_relations_to_member_id ON kinship_relations(to_member_id);
CREATE INDEX IF NOT EXISTS idx_relations_temporal_id ON kinship_relations(temporal_id);
CREATE INDEX IF NOT EXISTS idx_burials_member_id ON burial_records(member_id);
CREATE INDEX IF NOT EXISTS idx_burials_temporal_id ON burial_records(temporal_id);

INSERT OR IGNORE INTO metadata (key, value) VALUES ('next_alias_id', '1');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('next_relation_id', '1');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('next_temporal_id', '1');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('next_burial_id', '1');
UPDATE metadata SET value = '3' WHERE key = 'schema_version';
