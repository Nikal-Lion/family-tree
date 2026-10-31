# Login, Maintainer Passwords and Sysadmin Bootstrap

## Implementation Status

This document describes the v0.1.4 productization increment. In v0.1.3 and earlier,
maintainers used phone-only login; v0.1.4 requires independent passwords. The separate
browsing contract retains all approved genealogy fields, including raw evidence,
burials and exact track points; it is not a sensitive-field filtering policy.

## Sysadmin Initialization (Bootstrap)

1. `GET /api/auth/status` checks initialization before showing the secondary
   first-time setup entry; initialized systems hide it. Detection failures show a
   retry instead of assuming an empty system. This entry is not a role selector.
2. It requires mobile number and sysadmin password.
3. Server checks whether any sysadmin already exists, including disabled accounts.
4. If no sysadmin exists and password hash validation passes:
   - Create sysadmin login user record.
   - Create auth session token and return authenticated session context.
5. If sysadmin already exists, bootstrap is rejected.

## Login Flow

1. The default login form starts with one registered mobile number. It accepts an
   optional international `+` prefix and 6–20 digits, removing whitespace.
2. Leaving the phone field calls `POST /api/auth/login-options`. This anonymous,
   no-store query returns only `passwordRequired`, not an identity, role or token,
   and never creates a session. Management accounts reveal the password field
   before submitting; ordinary accounts still require an explicit login action.
   Changing the phone discards pending lookup results and clears the password.
3. `POST /api/auth/login` resolves the enabled account's role on the server:
   ordinary users log in directly, maintainers require their own account password,
   and sysadmins require the existing fixed server-configured password.
4. `PASSWORD_REQUIRED` also reveals a password field when submitting without a
   prior lookup, without asking the user to select
   a role. `PASSWORD_NOT_SET` asks legacy maintainers to contact a system
   administrator; it never falls back to phone-only maintenance access.
5. Successful login creates a server-side session and returns token plus role.
6. Frontend stores token, initializes auth state on app start, and validates current session.
7. Router guard redirects unauthenticated users away from protected workspace routes.
8. Ordinary users automatically see the usage guide on their first visit in this
   browser. Only a local display preference is stored; the account menu can
   reopen the guide. Existing “do not show again” preferences are respected.
9. Logout revokes the server session and clears client auth state.

## Role and Access Behavior

- Roles include anonymous, user, maintainer, and sysadmin.
- Ordinary users can browse but cannot write business data or manage accounts.
- Maintainers can maintain business data but cannot list or change login accounts.
- Only sysadmins can set/reset maintainer passwords and assign roles. Server
  authorization is required even if a client manually sends a privileged request.
- Anonymous users are redirected to login for protected pages.

## Maintainer Password Setup, Reset and Migration

- When creating or promoting a maintainer, a sysadmin must set an initial password.
  Existing maintainers can keep a configured password when editing other fields,
  or set a replacement to reset it. Forgotten passwords are reset by a sysadmin;
  there is no public phone-only password-reset endpoint.
- Passwords are 8–128 characters, cannot be entirely whitespace, and otherwise
  retain the exact entered text, including leading/trailing spaces. No shared or
  default maintainer password is created. Store them in a password manager and
  communicate initial/reset passwords through a trusted channel.
- Each password is stored as a PBKDF2-SHA256 digest with a random 16-byte salt,
  100,000 iterations (the existing Worker runtime limit), and a 32-byte derived key.
  API responses expose only `passwordConfigured`, never hashes or authentication
  versions. Business JSON/SQLite backups do not contain accounts or credentials.
- `login_users.password_hash` and `login_users.auth_version`, plus
  `auth_sessions.auth_version`, are added automatically by `ensureSchema`.
  `migrations/0003_maintainer_passwords.sql` is an alternative for an existing
  database that has not already received those fields. Inspect the schema first;
  do not apply the SQL after automatic migration or run it twice.
- Old ordinary-user and sysadmin sessions retain version 0 and remain valid.
  Old phone-only maintainer sessions are rejected immediately because the account
  has no configured password. A sysadmin sets their passwords after deployment;
  no maintainer can regain write access merely by knowing a phone number.
- Changing a role, mobile number, enabled state, or maintainer password increments
  the authentication version and revokes existing sessions in the same D1 batch.
  Name-only edits do not log users out. Promotion requires a fresh login, so an
  old phone-only user token cannot acquire maintenance or sysadmin privileges.
  Conditional session creation also rejects credentials changed during login.
- Changing away from maintainer removes its unused account password. Sysadmin
  accounts never use per-account passwords and continue to verify the existing
  server secret; this increment does not rotate or replace that secret.
- Before deployment, arrange password setup for existing maintainers and notify
  them that old sessions will no longer work. Do not roll back to the old Worker
  while leaving maintainers enabled: old code ignores these password/version
  fields and restores phone-only maintenance access. A rollback must first
  disable affected accounts and revoke their sessions, then verify access.

## Notable Caveats

1. Ordinary-user login deliberately has no password or OTP. Knowing a registered
   mobile number is not proof of possessing that phone or of a family identity.
2. Bootstrap is hidden after initialization; the server still rejects further
   initialization even if an existing sysadmin is disabled or initialization
   occurred in another browser after the status check.
3. Legacy API token bypass is now disabled by default and should only be enabled temporarily for emergency rollback.
4. Session token persistence in localStorage increases impact if XSS occurs.
5. `GET /api/browse-data` requires authentication and exposes all approved family
   records without maintenance allocation counters. Ordinary users cannot read or
   write the complete `/api/family-data` maintenance snapshot. This separates
   capabilities, not sensitive genealogy fields; phone-only browsing does not
   provide strong identity verification.

## Key References

- [api/index.ts](../api/index.ts)
- [src/pages/LoginPage.vue](../src/pages/LoginPage.vue)
- [src/services/authService.ts](../src/services/authService.ts)
- [src/services/d1ApiService.ts](../src/services/d1ApiService.ts)
- [src/router/index.ts](../src/router/index.ts)
- [src/pages/FamilyWorkspace.vue](../src/pages/FamilyWorkspace.vue)
- [src/components/AuthManager.vue](../src/components/AuthManager.vue)
- [src/components/LoginUserManager.vue](../src/components/LoginUserManager.vue)
- [src/types/auth.ts](../src/types/auth.ts)

## Zero-Downtime Sysadmin Password Rotation Plan

Status: implemented in API password verification.

### What changed

- API now supports PBKDF2-SHA256 hash rotation (preferred):
   - `SYSADMIN_PASSWORD_PBKDF2` (active)
   - `SYSADMIN_PASSWORD_PBKDF2_NEXT` (grace window)
- API token auth bypass is default-off and only enabled when `ALLOW_LEGACY_API_TOKEN_AUTH=true`.

PBKDF2 secret format:

```text
pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
```

说明：当前 Worker 运行时支持的迭代次数上限为 `100000`，请使用 `100000`。

PBKDF2 配置示例（可直接放到 Cloudflare Secrets）：

```text
SYSADMIN_PASSWORD_PBKDF2=pbkdf2_sha256$100000$8f9a2b7c1e4d6f0a9b3c5d7e1a2c4f6b$de3f3bbf7ff778ecb7eeb2456fb32476643c8b4f9d9e8e83c4f6d66ce5f0f668
SYSADMIN_PASSWORD_PBKDF2_NEXT=pbkdf2_sha256$100000$4e2a8c1d5b7f9a3c6d1e0f2a4b8c7d5e$0e0ab2e1aef54f1bf521f70d9fcdfc860e3de01559ac998f94f9dcefa88f26db
```

生成 PBKDF2 字符串示例（Node.js）：

```bash
node -e "const crypto=require('node:crypto');const password='ChangeMe!';const iterations=100000;const salt=crypto.randomBytes(16);const hash=crypto.pbkdf2Sync(password,salt,iterations,32,'sha256');console.log(`pbkdf2_sha256$${iterations}$${salt.toString('hex')}$${hash.toString('hex')}`)"
```

### Rotation procedure

1. Prepare new password hash.
2. Phase A (dual-accept rollout):
   - Keep current PBKDF2 hash in `SYSADMIN_PASSWORD_PBKDF2`.
   - Set new PBKDF2 hash to `SYSADMIN_PASSWORD_PBKDF2_NEXT`.
   - Deploy Worker.
3. Phase B (adoption window):
   - Communicate password change.
   - Allow both old and new passwords temporarily.
4. Phase C (promote new hash):
   - Move new hash into `SYSADMIN_PASSWORD_PBKDF2`.
   - Keep old hash in `SYSADMIN_PASSWORD_PBKDF2_NEXT` for short rollback window.
   - Deploy Worker.
5. Phase D (finalize):
   - Remove `SYSADMIN_PASSWORD_PBKDF2_NEXT`.
   - Deploy Worker.

### Rollback procedure

- If login issues occur, restore previous known-good values:
   - Put old hash back to `SYSADMIN_PASSWORD_PBKDF2`.
   - Put temporary fallback hash to `SYSADMIN_PASSWORD_PBKDF2_NEXT`.
   - Deploy Worker.

### Verification checklist

- New password can login as sysadmin.
- Old password behavior matches current phase policy.
- Existing logged-in sessions remain usable.
- No 500 error for missing hash after secret setup.

### Cloudflare secret commands

```bash
wrangler secret put SYSADMIN_PASSWORD_PBKDF2 --env production
wrangler secret put SYSADMIN_PASSWORD_PBKDF2_NEXT --env production
# keep ALLOW_LEGACY_API_TOKEN_AUTH unset (or set to false) to disable legacy token bypass
# optional when finalizing
wrangler secret delete SYSADMIN_PASSWORD_PBKDF2_NEXT --env production
```

### Security notes

- Keep hash values only in Cloudflare Secrets.
- Do not commit hash values to repository files.
- If compromise is suspected, rotate password and consider revoking active sessions.
