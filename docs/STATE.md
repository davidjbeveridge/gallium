# Current state

## Objective

Continue Web Operator from the 0.1 prototype into an installed local CLI/MCP plugin with a working browser workflow, durable takeover/handback, verified request reuse, and configurable navigation. Primary checkout under `~/src/web-operator`; public repository `davidjbeveridge/web-operator`.

## Canonical plan

1. Import and reproduce 0.1. Complete: original 75 tests passed.
2. Implement and qualify the Chrome/control/request vertical slice. Complete in a disposable Chrome profile: real SDK UI save, independent result verification, duplicate prevention, trusted input/user activation, actual debugger detach, restart while paused, explicit handback with zero actions, preserved cross-extension iframe, cookie/CSRF browser request.
3. Install CLI, MCP, routing skill. Complete. Private config preserves user changes and starts with live-browser compatibility disabled.
4. Publish source and run CI. Complete: clean GitHub checkout, npm ci, audit, TypeScript/unit checks, extension build and real Chrome gate passed.
5. Install/qualify the bridge in the personal Chrome profile and test the actual password manager. Approved bridge installed. Installed MCP saved the loopback fixture, detached for handoff, and resumed. Real password-manager interaction remains unqualified. SMTP2GO qualification started in a dedicated signed-out Chrome tab. The real bridge detached and a fresh MCP process confirmed durable human ownership and rejected a page read while paused. Awaiting user authentication and explicit handback.

## Decisions

- Reuse installed Chrome and Node. No browser download, profile copy, Docker, or required model endpoint.
- Deterministic recipes and configurable TypeSafe/OpenAI-compatible navigator providers share one engine.
- Browser-session requests keep cookies and CSRF inside Chrome. Only configured scalar account/goal fields leave the page.
- Human ownership survives restart. A failed detach is durably visible as `detach_required`; resume retains human ownership until reattachment succeeds.
- Uncertain writes block repeat mutations across routes in the same scope.
- MCP web_control is the full durable takeover path. The extension shortcut only detaches tabs; no unsupported global native keyboard hook is claimed.
- Existing browser integrations stay installed until personal-profile/password-manager qualification passes.

## Verification

- Node 26.12.1; Chrome 156.0.8078.76; macOS.
- `npm run check`: TypeScript + 81 tests pass.
- `npm run build:extension`: pinned, hash-checked Playwriter compatibility build.
- `npm run test:browser`: all assertions pass; generated evidence in ignored `work/browser-evidence.json`.
- `npm audit`: zero vulnerabilities. Dependency overrides were followed by full local and Chrome checks.
- Installed CLI/API operation verified; repeat returned ALREADY_VERIFIED.
- Codex MCP registered and installed stdio smoke test verified an operation through all four advertised tools. New chats load it. Routing skill installed and skillq synchronized.
- GitHub Actions run 41531437604 passed clean install, audit, unit/type checks, extension build and browser gate on Linux.

The private installation enables the verified bridge for the configured loopback fixture. Shipped configurations still default to disabled.

Concurrent first startup now publishes the journal key atomically. TypeScript and all 79 tests passed after the change. This work is local.

## Remaining implementation and acceptance

The revised product contract in build-plan.md supersedes host-selected recipe routing. Goal-level MCP routing and the shared service are implemented for configured procedures. Automatic discovery of unfamiliar websites remains pending. SMTP2GO remains under human ownership until explicit handback.

1. Qualify real Bitwarden handoff first. Use a dedicated Chrome tab and a private, exact-origin recipe with an authenticated account marker. Observe the signed-out state without collecting form values. Pause and verify debugger detachment, then exercise Bitwarden and any user-owned authentication steps. Resume only on explicit handback and verify the account through a read-only recipe. Test that an account mismatch fails closed. Record only outcomes and versions.
2. Add shared authentication contexts and qualify cross-origin handoff, native input, and approval flows.
3. Add route resolution and host connector handoff. Preserve operation identity and the uncertain-write barrier across transports.
4. Add redacted endpoint observation and reviewed recipe promotion. Keep discovery separate from execution authority.
5. Extend scoped browser observations, frame support, and text generation. Run reproducible navigator and input measurements with authorized providers.
6. Finish retention controls and integration packaging. Keep all product interaction in MCP and the routing skill.

## Task controller release

- Added web_task. It bundles procedure applicability judgments through OpenRouter System One using Jev 1.14. Code chooses the route and persists task identity and selected procedure before execution.
- MCP clients default to a shared local Unix-socket service. One process owns the Chrome connection. Tasks serialize while status and control bypass the queue. Client disconnect cancels its pending work. Multiple available Chrome bridges require a configured selection.
- Installed private OpenRouter credential-file binding and shared-service setting. Installed MCP verified a fixture write with one action.
- Real task checks verified VS Code and TypeScript license metadata through the public GitHub API, and the Learn more link on the public Example Domain page through existing Chrome.
- Two MCP clients shared a service PID and verified cross-client browser pause/resume. Unsupported deletion intent returned CAPABILITY_UNCERTAIN.
- Live evaluation including unsuccessful trials used 23 Jev requests and reported $0.000422142, below the authorized $2 limit. Generated receipts are in ignored work/.
- TypeScript and 81 tests passed. Publishing still requires the clean CI browser gate.
- Remaining limits include configured procedures, fixed route preference rather than learned performance ranking, serialization of HTTP tasks as well as browser tasks, and explicit service recovery after crashes or configuration changes.
