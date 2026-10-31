-- For existing installations not already upgraded by the Worker's ensureSchema.
-- Do not run twice or after the runtime has added these columns.
ALTER TABLE login_users ADD COLUMN password_hash TEXT;
ALTER TABLE login_users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auth_sessions ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;

-- Old phone-only maintainer sessions must not retain write access.
UPDATE auth_sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE user_id IN (SELECT id FROM login_users WHERE role = 'maintainer')
  AND revoked_at IS NULL;
