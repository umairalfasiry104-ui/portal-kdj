# CR/CIR Draft — Portal Tailwind v4 PostCSS Build Configuration

- **CR ID:** CR-CIR-KDJ-PORTAL-POSTCSS-BUILD-2026-11-12
- **Status:** DRAFT — review/owner approval required before staging or commit
- **Target:** Local Portal / Staging build tooling only
- **Production:** Not changed

## 1. Problem
The local Portal build requires the Tailwind v4 PostCSS plugin to be declared and configured explicitly. The current working tree adds `@tailwindcss/postcss` to devDependencies and a `postcss.config.mjs` file.

## 2. Proposed change
- Add `@tailwindcss/postcss` as a Portal development dependency.
- Configure PostCSS to load the `@tailwindcss/postcss` plugin.
- Keep Tailwind v4 and existing UI source behavior unchanged.
- No runtime API, database, schema, auth, document or business-rule change.

## 3. Impact review
- **Build:** Next.js production build uses the PostCSS plugin.
- **Runtime:** dev-only dependency/configuration; no server route contract change.
- **Database/Supabase:** no impact.
- **Security:** no new secret or network permission.
- **Compatibility:** lockfile must remain synchronized with package.json.
- **Rollback:** revert only the package dependency/lockfile and PostCSS config if a supported alternative build configuration is approved.

## 4. Verification evidence
- Portal lint: 0 errors; 5 existing `no-img-element` warnings.
- Next.js 16.4.3 production build: PASS; TypeScript PASS; 19/19 static pages generated.
- Portal automated test suite: 14/14 scripts PASS.
- Production dependency audit: 0 vulnerabilities.
- Full development dependency audit still reports 7 moderate nested minimatch findings; this CR does not claim to remediate them.

## 5. Approval
This record is a draft only. Do not stage/commit the build configuration until its CR/CIR status is reviewed and approved.
