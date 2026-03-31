PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER,
  gender TEXT CHECK(gender IN ('男', '女')) DEFAULT '男',
  spouse_ids TEXT DEFAULT '[]',
  birth_date TEXT,
  photo_url TEXT,
  biography TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (parent_id) REFERENCES members(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS family_events (
  id INTEGER PRIMARY KEY,
  member_id INTEGER,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  member_id INTEGER,
  points_json TEXT NOT NULL,
  start_point_json TEXT NOT NULL,
  end_point_json TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_members_parent_id ON members(parent_id);
CREATE INDEX IF NOT EXISTS idx_events_member_id ON family_events(member_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON family_events(date);
CREATE INDEX IF NOT EXISTS idx_tracks_member_id ON tracks(member_id);

INSERT OR IGNORE INTO metadata (key, value) VALUES ('schema_version', '2');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('next_id', '1');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('next_track_id', '1');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('next_event_id', '1');
