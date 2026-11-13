# CR/CIR — Portal Nested minimatch Advisory Remediation

- **CR ID:** CR-CIR-KDJ-PORTAL-MINIMATCH-OVERRIDE-2026-11-12
- **Status:** IMPLEMENTED — local Portal dependency tree and lockfile only
- **Date:** 12 November 2026 (Asia/Jakarta)
- **Owner authorization:** Owner instruction in this conversation to close all non-live blockers; no Production or database action is included.
- **Scope:** Portal development dependency tree only.

## 1. Finding

The Portal full dependency audit reported seven moderate advisories through the nested dependency path:

`typescript-eslint -> @typescript-eslint/typescript-estree -> minimatch 10.2.6`

Production dependencies were already clean. The upstream package range declared `minimatch ^10.2.2`, while the advisory fix requires `minimatch >=11.0.1`.

## 2. Implemented change

Add an exact, scoped npm override:

```json
{
  "overrides": {
    "@typescript-eslint/typescript-estree": {
      "minimatch": "11.0.8"
    }
  }
}
```

The override affects only the nested parser dependency. It does not replace ESLint's separate minimatch 3.x dependency or any application/runtime dependency. The lockfile was regenerated with `npm install --package-lock-only --ignore-scripts`.

## 3. Risk assessment

- The override is outside the upstream-declared semver range `^10.2.2`; this is a deliberate, narrowly-scoped security override.
- Compatibility was tested on Node v24.21.0; the project minimum is Node >=22.
- Reassess and remove the override when upstream updates its declared dependency range to a fixed compatible release.
- No runtime API, application behavior, schema, RPC, security boundary, WhatsApp behavior, or business rule changed.

## 4. Verification evidence

Isolated trial folder: `_TMP_PORTAL_MINIMATCH11_TRIAL_20261112`.

- `npm ls minimatch --all`: the target nested dependency resolves to `minimatch@11.0.8`; unrelated ESLint minimatch 3.1.5 remains unchanged.
- `npm audit --audit-level=moderate`: 0 vulnerabilities.
- 14/14 non-Staging Portal contract test scripts: PASS. The DB-mutating OTP concurrency test was excluded from the isolated trial.
- `npm run lint`: 0 errors; 5 existing `no-img-element` warnings.
- `npm run build`: PASS.
- Main Portal `package-lock.json` SHA-256 matches the isolated trial lockfile exactly.
- Main Portal `npm audit --audit-level=moderate`: 0 vulnerabilities.

## 5. Rollback

Remove the scoped `overrides` object from `package.json`, regenerate `package-lock.json`, and rerun audit/lint/build. Do not change application source or Production dependencies as part of rollback.

## 6. Release disposition

The B-04 dependency advisory is closed for the current non-live release candidate. No files were staged or committed, and no deployment was performed. The upstream semver compatibility caveat remains recorded above.
