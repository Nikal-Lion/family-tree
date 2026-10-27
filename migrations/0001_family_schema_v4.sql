-- Additive migration; legacy family and authentication tables are preserved.
CREATE TABLE IF NOT EXISTS family_data_revision (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL
);
INSERT OR IGNORE INTO family_data_revision VALUES (1, 0);
CREATE TABLE IF NOT EXISTS member_generations (
  member_id INTEGER PRIMARY KEY,
  generation_number INTEGER NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS spouses (
  id INTEGER PRIMARY KEY,
  husband_id INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (husband_id) REFERENCES members(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS child_claims (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER NOT NULL,
  resolved_member_id INTEGER,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_member_id) REFERENCES members(id) ON DELETE SET NULL
);
