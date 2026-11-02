# Validation

2026-11-02, Node 26.12.1, macOS, installed Chrome 156.0.8078.76.

## Executed

- TypeScript checks (`npm run typecheck`).
- Full Node suite (`npm test`): 80 passing tests, including real stdio MCP child processes, real loopback HTTP, durable ownership/leases, uncertain effects, input cancellation, provider validation, and control-panel origin/host protection.
- Real SDK + patched extension + Chrome gate (`npm run test:browser`).
- Installed CLI launcher and doctor, private configuration, Codex MCP registration, installed stdio MCP operation, routing-skill discovery, and a complete local panel operation.
- GitHub Actions clean Linux checkout/install/audit/check/build/browser gate passed: run 41531437604.
- `npm audit`: zero reported vulnerabilities after pinned transitive dependency overrides; the Chrome gate was rerun against that dependency graph.

## Browser gate assertions

1. Save through real Chrome pointer/keyboard input; independently read the server's business result.
2. Repeat the same operation ID without another save.
3. Observe trusted input events and qualifying user activation.
4. Pause; verify that this extension can no longer issue a debugger command.
5. Complete the task through the independent test connection during human ownership.
6. Restart the engine; verify it stays paused.
7. Inject a real second-extension iframe; reattachment fails explicitly, preserves the iframe, and retains human ownership.
8. Remove only the test fixture overlay; explicitly resume and verify completion with zero new actions.
9. Execute the same business update through a browser request requiring an HttpOnly cookie and CSRF header. A plain Node request to the protected endpoint gets 401.
10. Close the operator without closing the existing test tab.

The latest executable evidence is generated as `work/browser-evidence.json`. The gate took about two seconds locally; that includes fixture startup/interaction but is not a benchmark against another tool or model.

## Remaining qualification

Personal Chrome-profile installation and real password-manager interaction still require the user's action-time approval for the bridge's debugger/site access. No real vault, credential, paid model, physical-device approval, native dialog, generic website discovery, or production write was used. No existing integration has been disabled. A fixture pass cannot establish those capabilities.

The development dependency tree measured approximately 156 MiB; the built extension approximately 332 KiB. No clean-machine installed footprint or model cost has been claimed.
