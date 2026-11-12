# Daily Report UAT Report — 11 November 2026

Environment: Supabase Staging `pgmdurnylyuqkikbwwwy`; local Portal + Bot.
Feature scope stays manual Admin-initiated report generation and clipboard copy. No automatic WhatsApp/email delivery added.

## Disposition

**Coverage, report component UI, text rendering and clipboard copy: PASS.** Admin role-session confirmation remains a follow-up; unauthenticated access is denied.

| ID | Requirement | Result | Evidence |
|---|---|---|---|
| RPT-01 | Prospective event-ledger coverage | PASS | Ledger enabled at `2026-11-10 15:05:30.927Z` = 22:05:30 WIB, 10 Nov 2026. Staging ledger contains 38 events: 20 `CUSTOMER_INBOUND`, 18 `BOT_REPLY`. |
| RPT-02 | Report window and metadata-only content | PASS / historical limitation disclosed | Daily stats RPC for the 11 Nov WIB window returned 1 inbound + 1 Bot reply in-window, 0 HUMAN handovers/resumes, 0 booking/lead actions, 0 incidents and current system snapshots. Coverage note explicitly states the ledger start and that earlier data is not retroactively reconstructed. Source contract limits report to operational counts/state; no phone, applicant name, message body or transcript is returned. |
| RPT-03 | Portal UI and role gate | COMPONENT UI PASS / live Admin role session FOLLOW-UP | Real `AdminDailyReportPanel` mounted in browser QA using a read-only fixture response. Date defaulted to the Asia/Jakarta date; summary cards and coverage note rendered. Source contract confirms Super Admin/Admin Konsultan allowlist; unauthenticated API GET returned 401. A live authenticated Admin-role session was not used in this browser fixture. |
| RPT-04 | Clipboard | PASS | Clicked the actual “Salin untuk Human” button under granted browser clipboard permissions; read clipboard and compared report text after Windows CRLF/LF normalization. Manual fallback message remains available when Clipboard API fails. |

## UI defect corrected

Next.js 16 flagged the old initial state initializer because it evaluated `new Date()` while prerendering a Client Component. The panel now uses an uncontrolled date input with a ref; an effect initializes the input to the Jakarta date after mount, and Generate reads the selected input value. This avoids render-time Date access and does not synchronously set React state from an effect.

Regression guards were added to `scripts/test-daily-reporting-contract.mjs` for the ref-based date initialization and selected-date API argument.

## Coverage interpretation

- The ledger started at 22:05:30 WIB on 10 Nov 2026. It is prospective, not a backfill of older Bot conversations.
- The current 38-row ledger and per-day results are operational counts, not a complete historical CRM transcript.
- HUMAN handover/resume metrics remain zero because no such events were recorded in the queried data window; zero is not interpreted as missing history.
- Report remains manual-only; no WhatsApp/email delivery is implemented or enabled.

## Remaining qualification

RPT-01, RPT-02, component rendering, coverage note, text and clipboard are closed for Staging. Keep one follow-up to sign in as Super Admin and Admin Konsultan, generate the report from the actual Admin page for each allowed role, and confirm an Admin Verifikator/unauthenticated account is denied in the real browser session.


## Retest and final disposition — 11 Nov 2026, 03:15 WIB

- Fresh `npm run test:daily-report` PASS; contract remains manual-only, timezone-aware, metadata-only, and clipboard enabled. Portal lint PASS with 0 errors / 5 existing `<img>` warnings.
- Reconfirmed source SHA-256: `AdminDailyReportPanel.jsx` = `72CFF14F0E765E15A6055786B94FB10B5AF9ACE4367434B855421F5E7461FC07`; contract script = `18A91D210048A3DBE26A91A082D0AE4531146FC882A47250D04A24658F40D922` (matches the prior isolated-build evidence).
- Actual unauthenticated `GET /api/admin/reports/daily?date=2026-11-11` returns HTTP 401. Actual Admin dashboard role login was not exercised because no authorized role session/credentials were supplied; source contract and prior fixture UI/clipboard test are not a substitute for a live role session.
- Current Staging event ledger remains at 38 rows, with coverage beginning 10 Nov 2026 22:05:30 WIB. Stats are prospective and not a retroactive full historical transcript.

**Final status:** coverage, metadata-only report, component UI and clipboard = PASS on existing evidence and fresh contract retest. Live Super Admin/Admin Konsultan generate and Admin Verifikator denial in an actual authenticated browser session remain FOLLOW-UP. Manual-only delivery policy unchanged; no automated WhatsApp/email report added.
