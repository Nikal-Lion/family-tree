-- Existing bearer sessions have no version proof and must sign in again.
-- No default passwords are assigned to existing accounts.
-- Requires the columns from 0003_maintainer_passwords.sql (or runtime upgrade).
CREATE TABLE IF NOT EXISTS login_credentials (
  user_id INTEGER PRIMARY KEY,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL CHECK (must_change_password IN (0, 1)),
  version INTEGER NOT NULL CHECK (version >= 1),
  FOREIGN KEY (user_id) REFERENCES login_users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS auth_session_credentials (
  session_id INTEGER PRIMARY KEY,
  credential_version INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES auth_sessions(id) ON DELETE CASCADE
);
INSERT OR IGNORE INTO login_credentials (user_id, password_hash, must_change_password, version)
SELECT id, password_hash, 1, 1 FROM login_users WHERE password_hash IS NOT NULL;
