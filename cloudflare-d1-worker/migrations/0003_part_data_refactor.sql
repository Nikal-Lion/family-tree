PRAGMA foreign_keys = ON;

-- 1. 新建配偶独立表
CREATE TABLE IF NOT EXISTS spouses (
  id INTEGER PRIMARY KEY,
  husband_id INTEGER NOT NULL,
  surname TEXT NOT NULL,
  full_name TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  relation_label TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 1,
  birth_date TEXT NOT NULL DEFAULT '',
  death_date TEXT NOT NULL DEFAULT '',
  burial_place TEXT NOT NULL DEFAULT '',
  biography TEXT NOT NULL DEFAULT '',
  status_flags_json TEXT NOT NULL DEFAULT '[]',
  raw_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (husband_id) REFERENCES members(id) ON DELETE CASCADE
);

-- 2. 新建子女声明表
CREATE TABLE IF NOT EXISTS child_claims (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER NOT NULL,
  claimed_name TEXT NOT NULL,
  ordinal_index INTEGER NOT NULL DEFAULT 1,
  gender TEXT NOT NULL DEFAULT 'unknown',
  is_adoptive INTEGER NOT NULL DEFAULT 0,
  out_adopted_to_hint TEXT NOT NULL DEFAULT '',
  resolved_member_id INTEGER,
  status TEXT NOT NULL DEFAULT 'missing',
  status_flags_json TEXT NOT NULL DEFAULT '[]',
  raw_text TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (parent_id) REFERENCES members(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_member_id) REFERENCES members(id) ON DELETE SET NULL
);

-- 3. members 表加 generation_number
ALTER TABLE members ADD COLUMN generation_number INTEGER;

-- 4. 删除 members.spouse_ids（D1 不支持 DROP COLUMN，使用占位策略：保留列但忽略）
-- 注：保留 spouse_ids 列以避免迁移失败，后续代码不再读写它

-- 5. 索引
CREATE INDEX IF NOT EXISTS idx_spouses_husband_id ON spouses(husband_id);
CREATE INDEX IF NOT EXISTS idx_child_claims_parent_id ON child_claims(parent_id);
CREATE INDEX IF NOT EXISTS idx_child_claims_status ON child_claims(status);
CREATE INDEX IF NOT EXISTS idx_members_generation_number ON members(generation_number);

-- 6. 元数据
INSERT OR IGNORE INTO metadata (key, value) VALUES ('next_spouse_id', '1');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('next_child_claim_id', '1');
UPDATE metadata SET value = '4' WHERE key = 'schema_version';
