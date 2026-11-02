# Web Operator

Read `docs/STATE.md` before work. Keep it as the canonical plan and verification record.
Use Node 24+; the Mac has Node 26 at `/opt/homebrew/opt/node@26/bin/node`.
Run `npm test` and the relevant integration gate before publishing.
Never commit runtime state, credentials, browser profiles, transcripts, or raw page captures.
Preserve existing Chrome tabs and extensions. No iframe removal, cookie extraction, or automatic reattachment during human ownership.
Browser tests must check the resulting business state, not just successful clicks.
