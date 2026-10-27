-- The Worker also upgrades existing installations through ensureSchema.
ALTER TABLE login_users ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE tracks ADD COLUMN member_ids_json TEXT;
