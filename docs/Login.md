# Login and Sysadmin Bootstrap Summary

## Commit Context

- Commit: 19bc6f812909cc43aa0ff34d7a4e70e0eeec2722
- Message: feat: add login functionality with user, sysadmin, and bootstrap modes
- Scope: Introduces authentication routing, session lifecycle, bootstrap initialization, and role-based UI gating.

## Sysadmin Initialization (Bootstrap)

1. Bootstrap mode is used for first-time sysadmin setup.
2. It requires mobile number and sysadmin password.
3. Server checks whether an enabled sysadmin already exists.
4. If no enabled sysadmin exists and password hash validation passes:
   - Create sysadmin login user record.
   - Create auth session token and return authenticated session context.
5. If sysadmin already exists, bootstrap is rejected.

## Login Flow

1. Three login modes are supported:
   - user
   - sysadmin
   - bootstrap
2. User login authenticates by mobile number.
3. Sysadmin login requires mobile number and password.
4. Successful login creates a server-side session and returns token plus role.
5. Frontend stores token, initializes auth state on app start, and validates current session.
6. Router guard redirects unauthenticated users away from protected workspace routes.
7. Logout revokes the server session and clears client auth state.

## Role and Access Behavior

- Roles include anonymous, user, and sysadmin.
- Sysadmin-only capabilities are gated in workspace management UI.
- Anonymous users are redirected to login for protected pages.

## Notable Caveats

1. Non-sysadmin login is mobile-only in this implementation (no password or OTP).
2. Bootstrap entry remains visible in UI even after initialization, leading to expected conflict responses.
3. Legacy API token bypass is now disabled by default and should only be enabled temporarily for emergency rollback.
4. Session token persistence in localStorage increases impact if XSS occurs.
5. Family data read path appears less strictly protected than write path and should be reviewed.

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
