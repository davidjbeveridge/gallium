# Architecture roadmap

[Current state](STATE.md) and [validation](../VALIDATION.md) describe the shipped engine. It supports public-document retrieval, bounded live exploration, configured procedures, and a shared local service. Learned route ranking, inferred write procedures, alternate browser engines, and native automation remain research directions.

The staged architecture below records the original roadmap.

## Revised product contract

The primary MCP entry accepts the user's goal, target, nonsecret business inputs, and stable operation identity. The host delegates the task to Gallium. Task analysis, capability selection, route selection, navigation, and verification run inside the operator. The routing skill directs agents to this entry point by default.

Configure separate System One providers for task assessment, route selection, and action selection. Reuse the existing TypeSafe/Jev and structured-output provider interface. Deterministic execution remains available for previously validated tasks. Record each decision's latency and provider usage when reported.

Task assessment combines the request with bounded read-only reconnaissance. A direct page fetch can identify forms, script dependence, authentication redirects, extension requirements, and challenge indicators. It cannot establish that a challenge is absent or that a logged-in browser shares the response. Credentials and raw page content stay out of durable records.

The task controller chooses among configured service tools, portable HTTP, authenticated in-page requests, compact browser interaction, and native interaction. Rank feasible routes using measured success, latency, model usage, and startup cost. One-shot execution requires an explicit verifier and an effect contract. Ambiguous writes retain the original operation identity and prevent speculative transport fallback.

The host need not approve individual ordinary actions within the delegated task. Local ownership, scope, and effect checks remain executable boundaries. Escalation is reserved for missing task authority, unresolvable ambiguity, unavailable capability, required platform confirmation, or a human challenge.

Use one machine-wide browser session by default. A broker owns the installed Chrome profile and bridge connection; MCP clients share its state and acquire operation/tab leases. Independent profile sessions are explicit configuration. Pause propagates to every client sharing the authentication context. Starting a client must never launch another Chrome profile implicitly.

Investigate a compact Jev-style observation and execution path against the existing bridge. Compare protocol round trips, DOM payload size, runtime memory, cold and warm latency, and independent task success. Existing installed Chrome is the initial baseline. A lighter engine is an optional measured alternative only after session, extension, and login compatibility is demonstrated.

Input policy is separate from planning. Support efficient interaction and configurable pointer paths, target-relative click positions, selection, typing bursts, and bounded edit corrections. Check ownership throughout and preserve the requested final text. Changes to timing or motion carry no guarantee of avoiding automation detection. Password fields and irreversible shortcuts require their own interaction rules.

The product remains MCP and skill driven. No standalone control panel.

## Original staged plan


### 1. Validate the real browser bridge

Build Playwriter's extension at the pinned commit with the preservation patch. Keep the existing Chrome installation and profile. Install only the optional SDK dependencies, without browser downloads. Run the local fixture through the browser recipe, then compare its independently verified result with the portable HTTP recipe.

Acceptance: existing tabs stay open; no other extension iframe is removed; account and stale-node mismatches stop execution; cancellation does not dispatch queued actions; no duplicate save follows interruption. Measure actual incremental SDK/extension disk use, cold/warm connection latency, and input behavior on macOS. Until this passes, `preserveExtensionsVerified` stays false.

### 2. Complete authentication handoff

Add a local controller/shortcut independent of the model, verified per-tab debugger detach plus reattach suppression, and a foreground native adapter where needed. Generalize scope locking to an explicit shared authentication-context ID for sites that span origins. Keep operation effect state separate from control ownership.

Start with existing sessions, then Bitwarden overlay/autofill, then normal user completion of MFA and passkeys. Add scoped email/OTP or credential-provider integrations only when the user has authorized that provider and account. Use credential exclusion windows with no DOM values, screenshots, response bodies, or model traces while credentials are visible.

Acceptance: Bitwarden locked/unlocked and inline popups, one-time email code, device/passkey prompt, account switching, and user completion of the entire task all recover through fresh observation. Restart never returns human control to the agent automatically. CAPTCHA or device approval can remain a human step.

### 3. Add authenticated in-page fetch and route choice

Create an `in-page` adapter behind the same operation/effect contract. Requests must execute within the active browser context, with configured same-origin endpoints and normal CSRF/nonce acquisition procedures. Never assume copied cookies recreate device-bound credentials or browser transport identity.

Add a route resolver before navigation. First choose an already-validated host connector or portable API; then browser-session requests; then DOM; then visual/native/human. The MCP process cannot call all other host tools implicitly, so return a structured `needs_host_action` for connectors or research that only the supervisor can invoke.

Acceptance: fresh token acquisition, one-use nonce consumption, expired sessions, rate cooldown shared across transports, condition/version mismatch, and ambiguous server effects. A failure after a possible write never triggers another transport's mutation. Use provider conditional writes and idempotency where available; preflight reads alone do not eliminate races.

### 4. Turn successful exploration into reviewed recipes

Add scoped endpoint observation during authorized tasks, with credentials and bodies redacted by default. The supervisor proposes a recipe containing target identity, inputs, effect class, token acquisition, preconditions, verification, and retry semantics. Record source evidence and a version fingerprint. Validate against a local or designated test account before promotion.

Recipes should remain human-readable files. Store measurements in SQLite, not a vector database. Invalidate a recipe when expected identity, response schema, target shape, or business verification changes. An unfamiliar page should return to the supervisor; learning must not grant new authority by itself.

Acceptance: repeated tasks progress without new model calls when the validated recipe suffices, and page/API changes lead to a safe re-observation or escalation rather than speculative writes.

### 5. Expand the navigator and input layers

Keep the existing `Navigator` interface. Add broader semantic/AX observations, scoped screenshots only when useful, frame/shadow-root support, and a separately configurable text provider. Compare deterministic execution, TypeSafe, and at least one generic structured-output provider on the same tasks. Track end-to-end time, success, retries, tokens, API cost, and human interventions.

Extract browser input into a motor-policy interface with an efficient default and an optional natural interaction policy. Natural behavior should advance the task and have a bounded time budget. Test real keyboard/pointer event semantics; do not equate `isTrusted` with physical input, add unrelated mouse/selection noise, or promise undetectability.

Acceptance: independent business success on repeated trials; fewer host/model round trips; measured improvement on the user's Macs. No navigation-model score grants permission or replaces verification.

### 6. Package the preferred integration

After the browser and authentication gates pass, add the routing skill and local installer. The routing policy should select connectors/direct requests before browser UI and progressively load auth/recipe references. Register Gallium as the preferred integration and disable competing configurable browser servers when the user chooses. A plugin cannot rewrite the host's built-in browser implementation.

Keep runtime dependencies optional. Preserve one durable data directory outside versioned plugin caches, keep unresolved operation receipts, and expose explicit data retention controls for completed records. Finish a locked, reproducible optional SDK dependency graph only after measuring it.

## Current release boundaries

0.1.0 includes a deterministic fixture and configured portable HTTP route, the journal/control engine, three navigator providers, a guarded Playwriter adapter, CLI, stdio MCP transport, and portable manifests. It does not include generic website navigation, learned API discovery, in-page fetch, automatic password-manager/email/SMS integration, native computer use, a natural motor policy, or an installed personal skill.

Those are separate implementation milestones, not capabilities implied by the prototype tests.
