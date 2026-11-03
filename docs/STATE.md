# Current state

## Objective

Continue Web Operator from the 0.1 prototype into an installed local CLI/MCP plugin with a working browser workflow, durable takeover/handback, verified request reuse, and configurable navigation. Primary checkout under `~/src/web-operator`; public repository `davidjbeveridge/web-operator`.

## Canonical plan

1. Import and reproduce 0.1. Complete: original 75 tests passed.
2. Implement and qualify the Chrome/control/request vertical slice. Complete in a disposable Chrome profile: real SDK UI save, independent result verification, duplicate prevention, trusted input/user activation, actual debugger detach, restart while paused, explicit handback with zero actions, preserved cross-extension iframe, cookie/CSRF browser request.
3. Install CLI, MCP, routing skill. Complete. Private config preserves user changes and starts with live-browser compatibility disabled.
4. Publish source and run CI. Complete: clean GitHub checkout, npm ci, audit, TypeScript/unit checks, extension build and real Chrome gate passed.
5. Install/qualify the bridge in the personal Chrome profile and test the actual password manager. Approved bridge installed. Installed MCP saved the loopback fixture, detached for handoff, and resumed. Real password-manager interaction remains unqualified.

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
- `npm run check`: TypeScript + 79 tests pass.
- `npm run build:extension`: pinned, hash-checked Playwriter compatibility build.
- `npm run test:browser`: all assertions pass; generated evidence in ignored `work/browser-evidence.json`.
- `npm audit`: zero vulnerabilities. Dependency overrides were followed by full local and Chrome checks.
- Installed CLI/API operation verified; repeat returned ALREADY_VERIFIED.
- Codex MCP registered and installed stdio smoke test verified an operation through all four advertised tools. New chats load it. Routing skill installed and skillq synchronized.
- GitHub Actions run 41531437604 passed clean install, audit, unit/type checks, extension build and browser gate on Linux.

The private installation enables the verified bridge for the configured loopback fixture. Shipped configurations still default to disabled.

## Remaining limits

Real Bitwarden/other password-manager, native dialogs/input, physical device approval, generic website discovery/recipe learning, separately generated field text, shared multi-origin authentication contexts, and live paid navigator benchmarks are unqualified. The implemented recipe-based vertical slice must not be represented as a universal browser replacement.
